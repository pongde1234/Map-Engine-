/**
 * Lineage index: thread_id groups and derived_from edges, so any entity or record can be
 * traced from the first D-3 fragment to assessment, decision, envelope, engagement and BDA,
 * and any decision forward to what was done under it.
 */
import type { JournalRecord } from '@me/schema';
import type { JournalStore } from './journal.ts';

export class LineageIndex {
  private byThread = new Map<string, number[]>();
  private byEntity = new Map<string, number[]>();
  /** Records that name another record/entity as a subject (engagement target, rule subjects…). */
  private bySubject = new Map<string, number[]>();
  /** derived_from edges reversed: record id → the records derived from it. */
  private byParent = new Map<string, number[]>();

  add(rec: JournalRecord): void {
    if (rec.thread_id) push(this.byThread, rec.thread_id, rec.seq);
    for (const p of rec.derived_from ?? []) push(this.byParent, p, rec.seq);
    if (rec.entity_id) push(this.byEntity, rec.entity_id, rec.seq);
    const p = rec.payload as Record<string, unknown> | undefined;
    if (p) {
      for (const k of ['target_id', 'effector_id', 'other_id'] as const) {
        const v = p[k];
        if (typeof v === 'string') push(this.bySubject, v, rec.seq);
      }
      const subjects = p['subject_ids'];
      if (Array.isArray(subjects)) for (const s of subjects) if (typeof s === 'string') push(this.bySubject, s, rec.seq);
    }
  }

  entitySeqs(entityId: string): readonly number[] {
    return this.byEntity.get(entityId) ?? [];
  }

  /**
   * Records explaining `id`, up to `uptoSeq`, ascending:
   * - a thread id expands to that thread's records;
   * - otherwise: the entity's first/latest records, records naming it as a subject
   *   (engagements, rule firings, corrections), and their full upstream ancestry via
   *   derived_from (fragment → assessment → decision → envelope → engagement → BDA).
   */
  trace(j: JournalStore, id: string, uptoSeq = j.length, limit = 400): JournalRecord[] {
    const seqs = new Set<number>();
    const queue: string[] = [];
    const take = (s: number) => {
      if (s > uptoSeq || seqs.has(s)) return;
      seqs.add(s);
      const r = j.read(s);
      if (r.derived_from) queue.push(...r.derived_from);
    };

    const thread = this.byThread.get(id);
    if (thread) for (const s of thread) take(s);

    const direct = j.findById(id);
    if (direct) take(direct.seq);

    const ent = this.byEntity.get(id);
    if (ent && ent.length) {
      take(ent[0]!);
      const lastIdx = upperIndex(ent, uptoSeq);
      if (lastIdx >= 0) take(ent[lastIdx]!);
      for (const s of ent) {
        if (s > uptoSeq) break;
        const r = j.read(s);
        if (r.derived_from?.length) take(s);
      }
    }
    for (const s of this.bySubject.get(id) ?? []) take(s);

    const seen = new Set<string>();
    while (queue.length) {
      const rid = queue.pop()!;
      if (seen.has(rid)) continue;
      seen.add(rid);
      const r = j.findById(rid);
      if (r) take(r.seq);
    }

    return [...seqs]
      .sort((a, b) => a - b)
      .slice(-limit)
      .map((s) => j.read(s));
  }

  /**
   * Records derived from record `id` (its consequences), up to `uptoSeq`, ascending: the
   * downstream direction of `trace`, e.g. a decision → the asset moves and rules carried under
   * it. `depth` 2 adds what was derived from those.
   */
  consequences(j: JournalStore, id: string, uptoSeq = j.length, depth = 1, limit = 400): JournalRecord[] {
    const seqs = new Set<number>();
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = [];
      for (const pid of frontier) {
        for (const s of this.byParent.get(pid) ?? []) {
          if (s > uptoSeq || seqs.has(s)) continue;
          seqs.add(s);
          next.push(j.read(s).record_id);
        }
      }
      frontier = next;
    }
    return [...seqs]
      .sort((a, b) => a - b)
      .slice(0, limit)
      .map((s) => j.read(s));
  }
}

function push(m: Map<string, number[]>, k: string, v: number): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function upperIndex(a: readonly number[], x: number): number {
  let lo = -1;
  let hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (a[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
