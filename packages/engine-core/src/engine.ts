/**
 * Engine: a journal plus the indexes built from it (keyframes, lineage), and the operator log
 * chained onto it. Cursors read both at any time T on the ingest axis; appends extend indexes
 * incrementally.
 */
import type { JournalRecord, RecordDraft } from '@me/schema';
import { type JournalStore, isEntityKind } from './journal.ts';
import { DEFAULT_KEYFRAME_POLICY, KeyframeIndex, type KeyframePolicy } from './keyframes.ts';
import { LineageIndex } from './lineage.ts';
import { OutcomeIndex } from './outcomes.ts';
import { OperatorLog } from './operator.ts';
import { Picture } from './picture.ts';

export type AppendListener = (records: JournalRecord[]) => void;

export class Engine {
  readonly keyframes: KeyframeIndex;
  readonly lineage = new LineageIndex();
  /** Track outcomes and plant-state history, for the debrief. */
  readonly outcomes = new OutcomeIndex();
  /** Head picture (state after the last record). */
  readonly head = new Picture();
  /** Operator-authored records, chained onto the journal head at startup. */
  readonly operator: OperatorLog;
  private listeners = new Set<AppendListener>();
  private operatorListeners = new Set<AppendListener>();
  private indexedSeq = 0;

  constructor(
    readonly journal: JournalStore,
    policy: KeyframePolicy = DEFAULT_KEYFRAME_POLICY,
  ) {
    this.keyframes = new KeyframeIndex(policy);
    this.operator = new OperatorLog(() => journal.head().hash);
  }

  /** Index records not yet indexed (startup pass, or after external loads). */
  index(onProgress?: (seq: number, total: number) => void): void {
    const total = this.journal.length;
    for (let s = this.indexedSeq + 1; s <= total; s++) {
      const r = this.journal.read(s);
      this.indexRecord(r);
      if (onProgress && s % 50_000 === 0) onProgress(s, total);
    }
  }

  /**
   * Expiry semantics (shared by every reader): before applying a record received at t_r,
   * entities with expiry_time <= t_r are removed; a read at T finishes with a sweep at T.
   */
  private indexRecord(r: JournalRecord): void {
    this.head.sweepExpired(r.ingest_time);
    this.head.apply(r);
    this.lineage.add(r);
    this.outcomes.add(r);
    this.keyframes.maybeCapture(r.seq, r.ingest_time, this.head);
    this.indexedSeq = r.seq;
  }

  append(drafts: RecordDraft[]): JournalRecord[] {
    const recs = this.journal.append(drafts);
    for (const r of recs) this.indexRecord(r);
    for (const l of this.listeners) l(recs);
    return recs;
  }

  onAppend(l: AppendListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Append operator records (chained onto the operator log) and tell every reader. */
  appendOperator(drafts: RecordDraft[]): JournalRecord[] {
    const recs = this.operator.append(drafts);
    for (const l of this.operatorListeners) l(recs);
    return recs;
  }

  onOperatorAppend(l: AppendListener): () => void {
    this.operatorListeners.add(l);
    return () => this.operatorListeners.delete(l);
  }

  findRecord(id: string): JournalRecord | undefined {
    return this.journal.findById(id) ?? this.operator.findById(id);
  }

  /** Picture as known at time t (records with ingest_time <= t), expiries applied at t. */
  asOf(t: number): Picture {
    const target = this.journal.seqAtOrBefore(t);
    const kf = this.keyframes.atOrBefore(target);
    const p = new Picture(new Map(kf.entities));
    for (let s = kf.seq + 1; s <= target; s++) {
      const r = this.journal.read(s);
      p.sweepExpired(r.ingest_time);
      p.apply(r);
    }
    for (const r of this.operator.upTo(t)) p.apply(r);
    p.sweepExpired(t);
    return p;
  }

  /** The last `n` discrete event records at or before seq, ascending. */
  recentEvents(uptoSeq: number, n: number): JournalRecord[] {
    const ev = this.journal.eventSeqs();
    let lo = 0;
    let hi = ev.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ev[mid]! <= uptoSeq) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - n);
    const out: JournalRecord[] = [];
    for (let i = start; i < lo; i++) out.push(this.journal.read(ev[i]!));
    return out;
  }

  /** The last `n` discrete events known at t: the journal's up to `uptoSeq` and the operator's. */
  recentEventsAt(uptoSeq: number, t: number, n: number): JournalRecord[] {
    const base = this.recentEvents(uptoSeq, n);
    const ops = this.operator.upTo(t).filter((r) => !isEntityKind(r.kind));
    if (!ops.length) return base;
    return [...base, ...ops].sort((a, b) => a.ingest_time - b.ingest_time || a.seq - b.seq).slice(-n);
  }

  /** All discrete events in [fromT, toT] on the ingest axis (timeline lanes), ascending. */
  eventsBetween(fromT: number, toT: number, limit = 5000): JournalRecord[] {
    const a = this.journal.seqAtOrBefore(fromT - 1) + 1;
    const b = this.journal.seqAtOrBefore(toT);
    const out: JournalRecord[] = [];
    for (const s of this.journal.eventSeqs()) {
      if (s < a) continue;
      if (s > b || out.length >= limit) break;
      out.push(this.journal.read(s));
    }
    return out;
  }
}
