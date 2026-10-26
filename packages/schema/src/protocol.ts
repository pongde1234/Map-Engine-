/**
 * WebSocket protocol between server and client (msgpack frames).
 *
 * - Every time-dependent message carries an `epoch`; a seek starts a new epoch and the client
 *   drops anything from an older one.
 * - Attribute changes travel as `delta` (reliable). Movement travels as `pos` frames
 *   (coalesced, latest-wins), addressed by a per-session dense index assigned in `delta`.
 * - Discrete records (fragments, decisions, rule firings, engagements, BDA) travel as `events`
 *   and are never coalesced or dropped.
 */
import type { Entity, EntityComponents } from './entity.ts';
import type { JournalRecord } from './envelope.ts';
import type { RaidClock } from './time.ts';

export const PROTOCOL_VERSION = 1;

export type ClockMode = 'replay' | 'live';

export interface ClockState {
  epoch: number;
  /** Engine time (ingest-time axis): what the system knew at t. */
  t: number;
  rate: number;
  playing: boolean;
  mode: ClockMode;
}

export interface SessionIdentity {
  user: string;
  display: string;
  role: string;
  /** Releasability caveats this identity may read. */
  releasability: string[];
}

export interface ScenarioInfo {
  id: string;
  name: string;
  seed: number;
  clock: RaidClock;
  /** Inclusive time range covered by the journal. */
  t0: number;
  t1: number;
  /** Map focus. */
  center: [number, number];
  zoom: number;
  counts: Record<string, number>;
}

/**
 * An operator-authored command object (annotation, geofence, kept measurement), or its
 * withdrawal (`payload.is_live: false`). The server stamps author, times, label,
 * releasability and the hash chain; the client never sets them.
 */
export interface OperatorDraft {
  /** Omit to create a new object; pass an existing operator object's id to change or withdraw it. */
  entity_id?: string;
  payload: EntityComponents;
}

// ---------- client -> server ----------

export type ClientMessage =
  | { type: 'hello'; protocol: number; token?: string; role?: string }
  | { type: 'seek'; t: number }
  | { type: 'play'; rate: number }
  | { type: 'pause' }
  | { type: 'live' }
  | { type: 'lineage'; reqId: number; id: string }
  | { type: 'records'; reqId: number; ids: string[] }
  | { type: 'publish'; reqId: number; draft: OperatorDraft }
  | { type: 'ping'; at: number };

// ---------- server -> client ----------

export interface IndexAssignment {
  /** Dense per-session index used by `pos` frames. */
  idx: number;
  entity_id: string;
}

export type ServerMessage =
  | {
      type: 'welcome';
      protocol: number;
      session: string;
      identity: SessionIdentity;
      scenario: ScenarioInfo;
      clock: ClockState;
      serverTime: number;
    }
  | {
      /** Full state at clock.t (after seek or on connect). Replaces the client store. */
      type: 'snapshot';
      clock: ClockState;
      entities: Entity[];
      index: IndexAssignment[];
      /** Recent discrete records up to t, newest last (bounded). */
      events: JournalRecord[];
    }
  | {
      type: 'delta';
      clock: ClockState;
      upserts: Entity[];
      removes: string[];
      index: IndexAssignment[];
    }
  | {
      /** Coalesced positions: parallel arrays addressed by idx. */
      type: 'pos';
      epoch: number;
      t: number;
      idx: Uint32Array;
      /** Interleaved [lon, lat, hae, ve, vn] per entry. */
      data: Float64Array;
      /** Source time of each sample (data age stays exact). */
      st: Float64Array;
    }
  | { type: 'events'; epoch: number; records: JournalRecord[] }
  | { type: 'clock'; clock: ClockState }
  | { type: 'lineage'; reqId: number; root: string; records: JournalRecord[] }
  | { type: 'records'; reqId: number; records: JournalRecord[] }
  | { type: 'published'; reqId: number; record?: JournalRecord; error?: string }
  | { type: 'pong'; at: number; serverTime: number }
  | { type: 'error'; message: string };

/** Stride of the interleaved `pos.data` array. */
export const POS_STRIDE = 5;
