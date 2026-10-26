/**
 * Headless map client. Owns the connection, the entity store and the clock estimate. The map
 * reads positions straight from here every frame; React reads a throttled version counter.
 *
 * Positions: the server sends samples stamped with source time; between samples the client
 * dead-reckons along the velocity, capped, and never for STALE/DISC tracks.
 */
import {
  type ClientMessage,
  type ClockState,
  type Entity,
  type JournalRecord,
  type OperatorDraft,
  type ScenarioInfo,
  type ServerMessage,
  type SessionIdentity,
  CLASSES,
  DEFAULT_AGE_PROFILES,
  POS_STRIDE,
  PROTOCOL_VERSION,
  ageState,
  decode,
  encode,
  type AgeState,
} from '@me/schema';
import { deadReckon } from '@me/geo';

export type ConnState = 'connecting' | 'open' | 'closed';

export interface Kin {
  lon: number;
  lat: number;
  hae: number;
  ve: number;
  vn: number;
  /** Source time of the sample. */
  st: number;
}

export interface ClientOptions {
  url: string;
  role?: string;
  /** Trail length in samples. */
  trailLength?: number;
}

export interface Versions {
  entities: number;
  positions: number;
  events: number;
  clock: number;
  conn: number;
}

const MAX_EVENTS = 5000;
const DR_CAP_MS = 12_000;

/**
 * Close a socket that is no longer current. One still connecting is closed once it opens:
 * closing it mid-handshake makes the browser log a warning (React StrictMode's mount/unmount).
 */
function retire(ws: WebSocket | null): void {
  if (!ws) return;
  if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
  else ws.close();
}

export class MapClient {
  conn: ConnState = 'closed';
  scenario: ScenarioInfo | null = null;
  identity: SessionIdentity | null = null;
  clock: ClockState = { epoch: 0, t: 0, rate: 1, playing: false, mode: 'replay' };
  private clockRecvAt = 0;
  readonly entities = new Map<string, Entity>();
  readonly kin = new Map<string, Kin>();
  readonly trails = new Map<string, number[]>();
  events: JournalRecord[] = [];
  private eventIds = new Set<string>();
  private idxToId: string[] = [];
  private ws: WebSocket | null = null;
  private reqId = 0;
  private pending = new Map<number, (records: JournalRecord[]) => void>();
  private publishing = new Map<number, { resolve: (r: JournalRecord) => void; reject: (e: Error) => void }>();
  private listeners = new Set<() => void>();
  private notifyScheduled = false;
  private versions: Versions = { entities: 0, positions: 0, events: 0, clock: 0, conn: 0 };
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByUser = false;
  private role: string | undefined;
  /** Server minus client wall clock (ms), from pong. */
  serverOffset = 0;

  constructor(private readonly opts: ClientOptions) {
    this.role = opts.role;
  }

  // ------------------------------------------------------------- connection

  connect(): void {
    this.closedByUser = false;
    clearTimeout(this.retryTimer);
    // One live socket per client: retire any previous one before opening the next.
    const prev = this.ws;
    this.ws = null;
    retire(prev);
    this.setConn('connecting');
    const ws = new WebSocket(this.opts.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.setConn('open');
      this.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...(this.role ? { role: this.role } : {}) });
      this.send({ type: 'ping', at: Date.now() });
    };
    // Handlers ignore sockets that are no longer current, so a late close or a late snapshot
    // from a retired connection can never schedule a duplicate reconnect or overwrite state.
    ws.onmessage = (ev) => {
      if (ws === this.ws) this.onMessage(decode<ServerMessage>(new Uint8Array(ev.data as ArrayBuffer)));
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.setConn('closed');
      if (!this.closedByUser) this.retryTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => ws.close();
  }

  disconnect(): void {
    this.closedByUser = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    retire(ws);
    this.setConn('closed');
  }

  /** Reconnect as another identity (role views). */
  setRole(role: string): void {
    this.role = role;
    this.pendingSeek = this.now();
    this.connect();
  }
  private pendingSeek: number | undefined;

  private send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m) as Uint8Array<ArrayBuffer>);
  }

  private setConn(c: ConnState): void {
    this.conn = c;
    this.bump('conn');
  }

  // ------------------------------------------------------------- commands

  seek(t: number): void {
    this.send({ type: 'seek', t: Math.round(t) });
  }
  play(rate = this.clock.rate || 1): void {
    this.send({ type: 'play', rate });
  }
  pause(): void {
    this.send({ type: 'pause' });
  }
  live(): void {
    this.send({ type: 'live' });
  }

  lineage(id: string): Promise<JournalRecord[]> {
    const reqId = ++this.reqId;
    this.send({ type: 'lineage', reqId, id });
    return new Promise((res) => this.pending.set(reqId, res));
  }

  records(ids: string[]): Promise<JournalRecord[]> {
    const reqId = ++this.reqId;
    this.send({ type: 'records', reqId, ids });
    return new Promise((res) => this.pending.set(reqId, res));
  }

  /**
   * Publish an operator object (or its withdrawal) at the current picture time. Resolves with
   * the journaled record once the server has stamped and chained it; the object itself
   * arrives through the normal picture updates.
   */
  publish(draft: OperatorDraft): Promise<JournalRecord> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Not connected to the engine.'));
    const reqId = ++this.reqId;
    this.send({ type: 'publish', reqId, draft });
    return new Promise((resolve, reject) => this.publishing.set(reqId, { resolve, reject }));
  }

  // ------------------------------------------------------------- reading

  /** Engine time now (ingest axis), extrapolated between clock messages. */
  now(): number {
    const c = this.clock;
    if (!c.playing || !this.clockRecvAt) return c.t;
    const t = c.t + (performance.now() - this.clockRecvAt) * c.rate;
    return this.scenario ? Math.min(this.scenario.t1, Math.max(this.scenario.t0, t)) : t;
  }

  /** Position at display time t: dead-reckoned from the last sample, capped. */
  positionAt(id: string, t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] | null {
    const k = this.kin.get(id);
    if (!k) return null;
    const dt = Math.min(DR_CAP_MS, Math.max(0, t - k.st));
    if (dt > 0 && (k.ve !== 0 || k.vn !== 0) && this.ageState(id, t) !== 'stale') {
      const p = deadReckon([k.lon, k.lat], { e: k.ve, n: k.vn }, dt / 1000);
      out[0] = p[0];
      out[1] = p[1];
    } else {
      out[0] = k.lon;
      out[1] = k.lat;
    }
    out[2] = k.hae;
    return out;
  }

  ageMs(id: string, t: number): number {
    const e = this.entities.get(id);
    return e ? t - e.source_time : Infinity;
  }

  ageState(id: string, t: number): AgeState {
    const e = this.entities.get(id);
    if (!e) return 'disc';
    const profile = DEFAULT_AGE_PROFILES[CLASSES[e.ontology?.class ?? '']?.age ?? 'asset'];
    return ageState(t - e.source_time, profile, e.health?.link === 'down');
  }

  getVersions(): Versions {
    return this.versions;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // ------------------------------------------------------------- inbound

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        this.scenario = m.scenario;
        this.identity = m.identity;
        // Epochs are per server session: a new session restarts the epoch count.
        this.clock = { ...m.clock, epoch: -1 };
        this.setClock(m.clock);
        if (this.pendingSeek !== undefined) {
          this.seek(this.pendingSeek);
          this.pendingSeek = undefined;
        }
        this.bump('conn');
        break;
      case 'snapshot':
        if (m.clock.epoch < this.clock.epoch) return;
        this.setClock(m.clock);
        this.entities.clear();
        this.kin.clear();
        this.trails.clear();
        this.idxToId = [];
        for (const a of m.index) this.idxToId[a.idx] = a.entity_id;
        for (const e of m.entities) this.upsert(e);
        this.events = [];
        this.eventIds.clear();
        this.addEvents(m.events);
        this.bump('entities');
        this.bump('positions');
        break;
      case 'delta':
        if (m.clock.epoch !== this.clock.epoch) return;
        this.setClock(m.clock);
        for (const a of m.index) this.idxToId[a.idx] = a.entity_id;
        for (const e of m.upserts) this.upsert(e);
        for (const id of m.removes) {
          this.entities.delete(id);
          this.kin.delete(id);
          this.trails.delete(id);
        }
        this.bump('entities');
        break;
      case 'pos': {
        if (m.epoch !== this.clock.epoch) return;
        const trailLen = (this.opts.trailLength ?? 45) * 3;
        for (let k = 0; k < m.idx.length; k++) {
          const id = this.idxToId[m.idx[k]!];
          if (!id) continue;
          const o = k * POS_STRIDE;
          const kin: Kin = {
            lon: m.data[o]!,
            lat: m.data[o + 1]!,
            hae: m.data[o + 2]!,
            ve: m.data[o + 3]!,
            vn: m.data[o + 4]!,
            st: m.st[k]!,
          };
          this.kin.set(id, kin);
          const e = this.entities.get(id);
          if (e) {
            e.source_time = kin.st;
            e.location = { lon: kin.lon, lat: kin.lat, hae: kin.hae, vel: { e: kin.ve, n: kin.vn, u: 0 } };
          }
          let tr = this.trails.get(id);
          if (!tr) this.trails.set(id, (tr = []));
          tr.push(kin.lon, kin.lat, kin.st);
          if (tr.length > trailLen) tr.splice(0, tr.length - trailLen);
        }
        this.bump('positions');
        break;
      }
      case 'events':
        if (m.epoch !== this.clock.epoch) return;
        this.addEvents(m.records);
        break;
      case 'clock':
        this.setClock(m.clock);
        break;
      case 'lineage':
      case 'records': {
        const res = this.pending.get(m.reqId);
        this.pending.delete(m.reqId);
        res?.(m.records);
        break;
      }
      case 'published': {
        const p = this.publishing.get(m.reqId);
        this.publishing.delete(m.reqId);
        if (m.record) p?.resolve(m.record);
        else p?.reject(new Error(m.error ?? 'The engine refused the object.'));
        break;
      }
      case 'pong':
        this.serverOffset = m.serverTime - (m.at + Date.now()) / 2;
        break;
      case 'error':
        console.warn('[map-client]', m.message);
        break;
    }
  }

  private upsert(e: Entity): void {
    this.entities.set(e.entity_id, e);
    if (e.location) {
      this.kin.set(e.entity_id, {
        lon: e.location.lon,
        lat: e.location.lat,
        hae: e.location.hae ?? 0,
        ve: e.location.vel?.e ?? 0,
        vn: e.location.vel?.n ?? 0,
        st: e.source_time,
      });
    }
  }

  private addEvents(rs: JournalRecord[]): void {
    let added = false;
    for (const r of rs) {
      if (this.eventIds.has(r.record_id)) continue;
      this.eventIds.add(r.record_id);
      this.events.push(r);
      added = true;
    }
    if (!added) return;
    this.events.sort((a, b) => a.ingest_time - b.ingest_time || a.seq - b.seq);
    if (this.events.length > MAX_EVENTS) {
      for (const r of this.events.splice(0, this.events.length - MAX_EVENTS)) this.eventIds.delete(r.record_id);
    }
    this.bump('events');
  }

  private setClock(c: ClockState): void {
    if (c.epoch < this.clock.epoch) return;
    this.clock = c;
    this.clockRecvAt = performance.now();
    this.bump('clock');
  }

  private bump(k: keyof Versions): void {
    this.versions = { ...this.versions, [k]: this.versions[k] + 1 };
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const l of this.listeners) l();
    });
  }
}
