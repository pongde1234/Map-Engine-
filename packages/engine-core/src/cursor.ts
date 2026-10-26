/**
 * Cursor: one reader's position on the ingest axis (one per client session). Moving forward
 * applies records incrementally — the journal's and the operator log's — and reports what
 * changed; moving backward re-seeks from the nearest keyframe.
 */
import type { JournalRecord } from '@me/schema';
import type { Engine } from './engine.ts';
import { isEntityKind } from './journal.ts';
import { Picture } from './picture.ts';

export interface CursorChanges {
  /** Entities whose attributes changed (send full entity). */
  upserts: Set<string>;
  /** Entities whose only change is position (send in a pos frame). */
  moved: Set<string>;
  removes: Set<string>;
  /** Discrete records crossed (fragments, decisions, rule firings, engagements, BDA). */
  events: JournalRecord[];
  /** True when the cursor re-seeked (client should replace its store). */
  reset: boolean;
}

export class Cursor {
  picture = new Picture();
  seq = 0;
  t = 0;

  constructor(private readonly engine: Engine) {}

  seek(t: number): void {
    this.picture = this.engine.asOf(t);
    this.seq = this.engine.journal.seqAtOrBefore(t);
    this.t = t;
  }

  /** Advance to t (forward), returning the changes since the previous position. */
  advance(t: number): CursorChanges {
    const ch: CursorChanges = { upserts: new Set(), moved: new Set(), removes: new Set(), events: [], reset: false };
    if (t < this.t) {
      this.seek(t);
      ch.reset = true;
      return ch;
    }
    const j = this.engine.journal;
    const target = j.seqAtOrBefore(t);
    for (let s = this.seq + 1; s <= target; s++) {
      const r = j.read(s);
      this.sweep(r.ingest_time, ch);
      this.applyOne(r, ch);
    }
    for (const r of this.engine.operator.between(this.t, t)) this.applyOne(r, ch);
    this.sweep(t, ch);
    this.seq = target;
    this.t = t;
    return ch;
  }

  /**
   * Operator records authored at or before the cursor's time (by this reader or another):
   * applied now, since advancing will never cross them.
   */
  late(records: JournalRecord[]): CursorChanges {
    const ch: CursorChanges = { upserts: new Set(), moved: new Set(), removes: new Set(), events: [], reset: false };
    for (const r of records) if (r.ingest_time <= this.t) this.applyOne(r, ch);
    return ch;
  }

  private applyOne(r: JournalRecord, ch: CursorChanges): void {
    const res = this.picture.apply(r);
    if (res.type === 'upsert') {
      ch.removes.delete(res.id);
      if (res.moveOnly && !ch.upserts.has(res.id)) ch.moved.add(res.id);
      else {
        ch.upserts.add(res.id);
        ch.moved.delete(res.id);
      }
    } else if (res.type === 'remove') {
      ch.upserts.delete(res.id);
      ch.moved.delete(res.id);
      ch.removes.add(res.id);
    }
    if (!isEntityKind(r.kind) || r.kind === 'fragment') ch.events.push(r);
  }

  private sweep(t: number, ch: CursorChanges): void {
    for (const id of this.picture.sweepExpired(t)) {
      ch.upserts.delete(id);
      ch.moved.delete(id);
      ch.removes.add(id);
    }
  }
}
