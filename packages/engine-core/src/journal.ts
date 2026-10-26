/**
 * Append-only journal. Records are ordered by `seq`, which is ingest order; `ingest_time` is
 * non-decreasing in seq, so "what did the system know at T" is a binary search.
 *
 * Bodies are kept as the exact bytes that were hashed. Reads decode on demand.
 */
import {
  type JournalRecord,
  type RecordBody,
  type RecordDraft,
  type RecordKind,
  ENTITY_KINDS,
  GENESIS_HASH,
  decode,
  encode,
} from '@me/schema';
import { chainHash } from './hash.ts';

export interface JournalHead {
  seq: number;
  hash: string;
  t: number;
}

export interface JournalStore {
  /** Last assigned seq (seq starts at 1; 0 = empty). */
  readonly length: number;
  head(): JournalHead;
  append(drafts: RecordDraft[]): JournalRecord[];
  read(seq: number): JournalRecord;
  /** Inclusive range, ascending. */
  readRange(fromSeq: number, toSeq: number): JournalRecord[];
  ingestTime(seq: number): number;
  kindAt(seq: number): RecordKind;
  /** Last seq with ingest_time <= t (0 if none). */
  seqAtOrBefore(t: number): number;
  findById(recordId: string): JournalRecord | undefined;
  /** Stored body bytes for seq (what the hash covers). */
  bytes(seq: number): Uint8Array;
  hashAt(seq: number): string;
  /** Seqs of discrete (non-entity) records plus fragments, ascending. */
  eventSeqs(): readonly number[];
  timeRange(): { t0: number; t1: number };
}

/** Kinds surfaced as discrete events (timeline lanes, event list). */
export const EVENT_KINDS: ReadonlySet<RecordKind> = new Set([
  'fragment',
  'decision',
  'rule_fire',
  'correction',
  'engagement',
  'bda',
]);

export interface RawRow {
  seq: number;
  ingest_time: number;
  kind: RecordKind;
  record_id: string;
  body: Uint8Array;
  prev_hash: string;
  hash: string;
}

/** In-memory journal; also the read path of the SQLite store. */
export class MemoryJournal implements JournalStore {
  protected bodies: Uint8Array[] = [];
  protected ingest: number[] = [];
  protected kinds: RecordKind[] = [];
  protected hashes: string[] = [];
  protected prevHashes: string[] = [];
  protected ids = new Map<string, number>();
  protected events: number[] = [];

  get length(): number {
    return this.bodies.length;
  }

  head(): JournalHead {
    const n = this.length;
    return n === 0 ? { seq: 0, hash: GENESIS_HASH, t: 0 } : { seq: n, hash: this.hashes[n - 1]!, t: this.ingest[n - 1]! };
  }

  /** Load already-hashed rows (from disk or a bundle) without re-hashing. */
  loadRows(rows: Iterable<RawRow>): void {
    for (const r of rows) this.push(r);
  }

  protected push(r: RawRow): void {
    if (r.seq !== this.length + 1) throw new Error(`journal gap: expected seq ${this.length + 1}, got ${r.seq}`);
    this.bodies.push(r.body);
    this.ingest.push(r.ingest_time);
    this.kinds.push(r.kind);
    this.hashes.push(r.hash);
    this.prevHashes.push(r.prev_hash);
    this.ids.set(r.record_id, r.seq);
    if (EVENT_KINDS.has(r.kind)) this.events.push(r.seq);
  }

  /** Assign seq + chain fields, encode, hash. Returns the stored rows for persistence hooks. */
  protected prepare(drafts: RecordDraft[]): { records: JournalRecord[]; rows: RawRow[] } {
    const records: JournalRecord[] = [];
    const rows: RawRow[] = [];
    let { seq, hash: prev, t: lastT } = this.head();
    for (const d of drafts) {
      if (d.ingest_time < lastT) {
        throw new Error(`ingest_time must be non-decreasing (${d.ingest_time} < ${lastT}) for ${d.record_id}`);
      }
      if (this.ids.has(d.record_id)) throw new Error(`duplicate record_id ${d.record_id}`);
      seq += 1;
      const body: RecordBody = { seq, ...d };
      const bytes = encode(body);
      const hash = chainHash(prev, bytes);
      rows.push({ seq, ingest_time: d.ingest_time, kind: d.kind, record_id: d.record_id, body: bytes, prev_hash: prev, hash });
      records.push({ ...body, prev_hash: prev, hash });
      prev = hash;
      lastT = d.ingest_time;
    }
    return { records, rows };
  }

  append(drafts: RecordDraft[]): JournalRecord[] {
    const { records, rows } = this.prepare(drafts);
    for (const r of rows) this.push(r);
    return records;
  }

  read(seq: number): JournalRecord {
    const body = this.bodies[seq - 1];
    if (!body) throw new Error(`no record at seq ${seq}`);
    const rec = decode<RecordBody>(body) as JournalRecord;
    rec.prev_hash = this.prevHashes[seq - 1]!;
    rec.hash = this.hashes[seq - 1]!;
    return rec;
  }

  readRange(fromSeq: number, toSeq: number): JournalRecord[] {
    const out: JournalRecord[] = [];
    const a = Math.max(1, fromSeq);
    const b = Math.min(this.length, toSeq);
    for (let s = a; s <= b; s++) out.push(this.read(s));
    return out;
  }

  ingestTime(seq: number): number {
    return this.ingest[seq - 1] ?? 0;
  }

  kindAt(seq: number): RecordKind {
    return this.kinds[seq - 1]!;
  }

  seqAtOrBefore(t: number): number {
    let lo = 0;
    let hi = this.ingest.length; // answer in [0, length]
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.ingest[mid - 1]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  findById(recordId: string): JournalRecord | undefined {
    const seq = this.ids.get(recordId);
    return seq ? this.read(seq) : undefined;
  }

  bytes(seq: number): Uint8Array {
    return this.bodies[seq - 1]!;
  }

  hashAt(seq: number): string {
    return this.hashes[seq - 1]!;
  }

  eventSeqs(): readonly number[] {
    return this.events;
  }

  timeRange(): { t0: number; t1: number } {
    return { t0: this.ingest[0] ?? 0, t1: this.ingest[this.ingest.length - 1] ?? 0 };
  }
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  /** First seq whose hash does not match, if any. */
  brokenAt?: number;
}

/** Recompute the hash chain over stored bytes. */
export function verifyChain(j: JournalStore, fromSeq = 1, toSeq = j.length): VerifyResult {
  let prev = fromSeq <= 1 ? GENESIS_HASH : j.hashAt(fromSeq - 1);
  let checked = 0;
  for (let s = fromSeq; s <= toSeq; s++) {
    const h = chainHash(prev, j.bytes(s));
    if (h !== j.hashAt(s)) return { ok: false, checked, brokenAt: s };
    prev = h;
    checked++;
  }
  return { ok: true, checked };
}

export function isEntityKind(kind: RecordKind): boolean {
  return ENTITY_KINDS.has(kind);
}
