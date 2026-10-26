/**
 * One client session: its own cursor on the ingest axis, its own clock, its own dense index
 * for position frames. Seeks bump the epoch so the client can drop stale frames.
 */
import type { WebSocket } from 'ws';
import { Cursor, OPERATOR_SEQ_BASE, type Engine } from '@me/engine-core';
import {
  type ClientMessage,
  type ClockState,
  type Entity,
  type IndexAssignment,
  type JournalRecord,
  type ScenarioInfo,
  type ServerMessage,
  type SessionIdentity,
  POS_STRIDE,
  PROTOCOL_VERSION,
  decode,
  encode,
} from '@me/schema';
import { canSeeEntity, canSeeRecord, identityFor } from './identity.ts';
import type { OperatorDesk } from './operator.ts';

const TICK_MS = 100;
const CLOCK_EVERY_MS = 500;
const MAX_BUFFERED = 1_000_000;
const MAX_RATE = 3600;
const SNAPSHOT_EVENTS = 2000;

let sessionCounter = 0;

export class Session {
  readonly id = `s${++sessionCounter}`;
  identity: SessionIdentity;
  private cursor: Cursor;
  private clock: ClockState;
  private index = new Map<string, number>();
  private nextIdx = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private lastClockSent = 0;
  private pendingMoves = new Set<string>();
  private unsubOperator: () => void;

  constructor(
    private readonly ws: WebSocket,
    private readonly engine: Engine,
    private readonly scenario: ScenarioInfo,
    private readonly desk: OperatorDesk,
    startT: number,
  ) {
    this.identity = identityFor(undefined);
    this.cursor = new Cursor(engine);
    this.clock = { epoch: 0, t: startT, rate: 1, playing: false, mode: 'replay' };
    this.unsubOperator = engine.onOperatorAppend((recs) => this.onOperator(recs));
    ws.on('message', (data: Buffer) => this.onMessage(data));
    ws.on('close', () => this.dispose());
  }

  /**
   * Operator records from any session. Those at or before this reader's time are applied now
   * (advancing will never cross them); a withdrawal there re-sends the picture, since it can
   * supersede firings this client already holds. Later ones arrive as the clock advances.
   */
  private onOperator(recs: JournalRecord[]): void {
    if (!this.timer) return;
    const past = recs.filter((r) => r.ingest_time <= this.cursor.t);
    if (!past.length) return;
    if (past.some((r) => (r.payload as { is_live?: boolean } | undefined)?.is_live === false)) this.seek(this.clock.t);
    else this.flush(this.cursor.late(past));
  }

  private send(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(encode(msg));
  }

  private onMessage(data: Buffer): void {
    let msg: ClientMessage;
    try {
      msg = decode<ClientMessage>(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } catch {
      this.send({ type: 'error', message: 'undecodable message' });
      return;
    }
    switch (msg.type) {
      case 'hello':
        this.identity = identityFor(msg.role);
        this.send({
          type: 'welcome',
          protocol: PROTOCOL_VERSION,
          session: this.id,
          identity: this.identity,
          scenario: this.scenario,
          clock: this.clock,
          serverTime: Date.now(),
        });
        this.seek(this.clock.t);
        this.start();
        break;
      case 'seek':
        this.seek(clampT(msg.t, this.scenario));
        break;
      case 'play':
        this.clock = { ...this.clock, playing: true, rate: Math.max(-MAX_RATE, Math.min(MAX_RATE, msg.rate)), mode: 'replay' };
        this.lastTick = Date.now();
        this.send({ type: 'clock', clock: this.clock });
        break;
      case 'pause':
        this.clock = { ...this.clock, playing: false };
        this.send({ type: 'clock', clock: this.clock });
        break;
      case 'live':
        this.clock = { ...this.clock, mode: 'live', playing: true, rate: 1 };
        this.seek(this.engine.journal.head().t);
        break;
      case 'lineage': {
        const records = this.engine.lineage.trace(this.engine.journal, msg.id, this.cursor.seq).filter((r) => canSeeRecord(r, this.identity));
        this.send({ type: 'lineage', reqId: msg.reqId, root: msg.id, records });
        break;
      }
      case 'records': {
        const records = msg.ids
          .slice(0, 200)
          .map((id) => this.engine.findRecord(id))
          .filter((r): r is JournalRecord => !!r && (r.seq >= OPERATOR_SEQ_BASE ? r.ingest_time <= this.cursor.t : r.seq <= this.cursor.seq) && canSeeRecord(r, this.identity));
        this.send({ type: 'records', reqId: msg.reqId, records });
        break;
      }
      case 'publish':
        try {
          const record = this.desk.publish(msg.draft, this.identity, this.clock.t);
          this.send({ type: 'published', reqId: msg.reqId, record });
        } catch (e) {
          this.send({ type: 'published', reqId: msg.reqId, error: (e as Error).message });
        }
        break;
      case 'ping':
        this.send({ type: 'pong', at: msg.at, serverTime: Date.now() });
        break;
    }
  }

  /** Jump to t: new epoch, full snapshot. */
  private seek(t: number): void {
    this.clock = { ...this.clock, epoch: this.clock.epoch + 1, t };
    this.cursor.seek(t);
    this.index.clear();
    this.nextIdx = 0;
    this.pendingMoves.clear();
    const entities: Entity[] = [];
    const index: IndexAssignment[] = [];
    for (const e of this.cursor.picture.entities.values()) {
      if (!canSeeEntity(e, this.identity)) continue;
      entities.push(e);
      index.push(this.assign(e.entity_id));
    }
    const events = this.engine.recentEventsAt(this.cursor.seq, t, SNAPSHOT_EVENTS).filter((r) => canSeeRecord(r, this.identity));
    this.send({ type: 'snapshot', clock: this.clock, entities, index, events });
  }

  private assign(id: string): IndexAssignment {
    let idx = this.index.get(id);
    if (idx === undefined) {
      idx = this.nextIdx++;
      this.index.set(id, idx);
    }
    return { idx, entity_id: id };
  }

  private start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.clock.playing) {
      let t = this.clock.mode === 'live' ? this.engine.journal.head().t : this.clock.t + dt * this.clock.rate;
      if (t > this.scenario.t1) {
        t = this.scenario.t1;
        this.clock = { ...this.clock, playing: false };
      }
      if (t < this.scenario.t0) {
        t = this.scenario.t0;
        this.clock = { ...this.clock, playing: false };
      }
      if (t < this.clock.t) {
        this.seek(t);
        return;
      }
      this.clock = { ...this.clock, t };
      this.flush(this.cursor.advance(t));
    }
    if (now - this.lastClockSent >= CLOCK_EVERY_MS) {
      this.lastClockSent = now;
      this.send({ type: 'clock', clock: this.clock });
    }
  }

  private flush(ch: ReturnType<Cursor['advance']>): void {
    if (ch.reset) {
      this.seek(this.clock.t);
      return;
    }
    const pic = this.cursor.picture;
    const upserts: Entity[] = [];
    const index: IndexAssignment[] = [];
    const removes: string[] = [];
    for (const id of ch.upserts) {
      const e = pic.get(id);
      if (!e || !canSeeEntity(e, this.identity)) continue;
      if (!this.index.has(id)) index.push(this.assign(id));
      upserts.push(e);
      this.pendingMoves.delete(id);
    }
    for (const id of ch.moved) {
      if (this.index.has(id)) this.pendingMoves.add(id);
      else {
        const e = pic.get(id);
        if (e && canSeeEntity(e, this.identity)) {
          index.push(this.assign(id));
          upserts.push(e);
        }
      }
    }
    for (const id of ch.removes) {
      if (this.index.has(id)) {
        removes.push(id);
        this.index.delete(id);
        this.pendingMoves.delete(id);
      }
    }
    if (upserts.length || removes.length) this.send({ type: 'delta', clock: this.clock, upserts, removes, index });
    const events = ch.events.filter((r) => canSeeRecord(r, this.identity));
    if (events.length) this.send({ type: 'events', epoch: this.clock.epoch, records: events });

    // Positions: latest-wins, skipped under backpressure (they are re-sent next tick).
    if (this.pendingMoves.size && this.ws.bufferedAmount < MAX_BUFFERED) {
      const n = this.pendingMoves.size;
      const idx = new Uint32Array(n);
      const data = new Float64Array(n * POS_STRIDE);
      const st = new Float64Array(n);
      let k = 0;
      for (const id of this.pendingMoves) {
        const e = pic.get(id);
        const i = this.index.get(id);
        if (!e?.location || i === undefined) continue;
        idx[k] = i;
        const o = k * POS_STRIDE;
        data[o] = e.location.lon;
        data[o + 1] = e.location.lat;
        data[o + 2] = e.location.hae ?? 0;
        data[o + 3] = e.location.vel?.e ?? 0;
        data[o + 4] = e.location.vel?.n ?? 0;
        st[k] = e.source_time;
        k++;
      }
      this.pendingMoves.clear();
      this.send({ type: 'pos', epoch: this.clock.epoch, t: this.clock.t, idx: idx.subarray(0, k), data: data.subarray(0, k * POS_STRIDE), st: st.subarray(0, k) });
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.unsubOperator();
  }
}

function clampT(t: number, s: ScenarioInfo): number {
  return Math.max(s.t0, Math.min(s.t1, t));
}
