/**
 * Operator log: records authored in the console — annotations, geofences, kept measurements —
 * and the rule firings a geofence produces. It is a second hash chain anchored to the base
 * journal: the first record's prev_hash is the journal's head hash, so the operator's work
 * extends the same verifiable record rather than sitting beside it.
 *
 * Unlike the base journal, records arrive out of ingest order (an operator annotates at
 * whatever replay time is on screen), so reads go through a time index. Append order is the
 * chain order.
 */
import { type JournalRecord, type RecordBody, type RecordDraft, type RuleFirePayload, type EntityComponents, encode } from '@me/schema';
import { chainHash } from './hash.ts';
import type { VerifyResult } from './journal.ts';

/** Operator seqs live far above the base journal's, so the two never collide. */
export const OPERATOR_SEQ_BASE = 1_000_000_000;

/** Rule id carried by a geofence's firings. */
export const geofenceRuleId = (entityId: string): string => `geofence:${entityId}`;

export class OperatorLog {
  private chain: JournalRecord[] = [];
  private byTime: JournalRecord[] = [];
  private ids = new Map<string, JournalRecord>();
  /** Operator entity id → ingest time of its withdrawal. */
  private withdrawn = new Map<string, number>();
  private fixedAnchor: string | undefined;

  /** `anchorOf` reads the journal head; it is fixed by the first append or load. */
  constructor(private readonly anchorOf: () => string) {}

  /** The journal hash this chain extends. */
  get anchor(): string {
    return this.fixedAnchor ?? this.anchorOf();
  }

  get length(): number {
    return this.chain.length;
  }

  head(): string {
    return this.chain[this.chain.length - 1]?.hash ?? this.anchor;
  }

  /** Records in chain (append) order. */
  all(): readonly JournalRecord[] {
    return this.chain;
  }

  append(drafts: RecordDraft[]): JournalRecord[] {
    this.fixedAnchor ??= this.anchorOf();
    const out: JournalRecord[] = [];
    let prev = this.head();
    for (const d of drafts) {
      if (this.ids.has(d.record_id)) throw new Error(`duplicate record_id ${d.record_id}`);
      const body: RecordBody = { seq: OPERATOR_SEQ_BASE + this.chain.length + 1, ...d };
      const hash = chainHash(prev, encode(body));
      const rec: JournalRecord = { ...body, prev_hash: prev, hash };
      this.push(rec);
      out.push(rec);
      prev = hash;
    }
    return out;
  }

  /** Load persisted records, re-hashing each against the chain from the anchor. */
  load(records: JournalRecord[]): VerifyResult {
    if (this.chain.length) throw new Error('operator log already holds records');
    const anchor = this.anchorOf();
    let prev = anchor;
    let checked = 0;
    for (const r of records) {
      const { prev_hash, hash, ...body } = r;
      if (prev_hash !== prev || chainHash(prev, encode(body as RecordBody)) !== hash) return { ok: false, checked, brokenAt: r.seq };
      this.push(r);
      prev = hash;
      checked++;
    }
    if (checked) this.fixedAnchor = anchor;
    return { ok: true, checked };
  }

  private push(r: JournalRecord): void {
    this.chain.push(r);
    this.ids.set(r.record_id, r);
    // Insert after every record at the same or an earlier time (stable by append order).
    let lo = 0;
    let hi = this.byTime.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.byTime[mid]!.ingest_time <= r.ingest_time) lo = mid + 1;
      else hi = mid;
    }
    this.byTime.splice(lo, 0, r);
    if (r.entity_id && (r.payload as EntityComponents | undefined)?.is_live === false) {
      const at = this.withdrawn.get(r.entity_id);
      if (at === undefined || r.ingest_time < at) this.withdrawn.set(r.entity_id, r.ingest_time);
    }
  }

  /**
   * Records with from < ingest_time <= to, ascending in time. A geofence's firings after the
   * geofence was withdrawn are superseded and not returned.
   */
  between(from: number, to: number): JournalRecord[] {
    const out: JournalRecord[] = [];
    let lo = 0;
    let hi = this.byTime.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.byTime[mid]!.ingest_time <= from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.byTime.length; i++) {
      const r = this.byTime[i]!;
      if (r.ingest_time > to) break;
      if (!this.superseded(r)) out.push(r);
    }
    return out;
  }

  upTo(t: number): JournalRecord[] {
    return this.between(-Infinity, t);
  }

  findById(id: string): JournalRecord | undefined {
    return this.ids.get(id);
  }

  /** Distinct operator entities ever created (for the next id). */
  entityCount(): number {
    const s = new Set<string>();
    for (const r of this.chain) if (r.kind === 'command' && r.entity_id) s.add(r.entity_id);
    return s.size;
  }

  private superseded(r: JournalRecord): boolean {
    if (r.kind !== 'rule_fire') return false;
    const id = (r.payload as RuleFirePayload).rule_id;
    if (!id.startsWith('geofence:')) return false;
    const at = this.withdrawn.get(id.slice('geofence:'.length));
    return at !== undefined && r.ingest_time > at;
  }
}
