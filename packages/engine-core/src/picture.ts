/**
 * Materialised picture: entity state built by applying journal records in seq order.
 *
 * Entities are immutable values: every accepted record produces a new object. That makes a
 * keyframe a shallow Map copy (shared references), which is what keeps seeks cheap.
 *
 * Acceptance: last writer wins on source_time ("one writer per cell by key"). A record older
 * than the entity's current source_time is kept in the journal but does not change state.
 */
import type { Entity, EntityComponents, JournalRecord } from '@me/schema';
import { isEntityKind } from './journal.ts';

const HISTORY_LIMIT = 16;
// Kinematic refreshes (position, uncertainty, expiry extension) travel as position frames.
const MOVE_ONLY_KEYS = new Set(['location', 'location_uncertainty', 'expiry_time']);

export type ApplyResult =
  | { type: 'upsert'; id: string; moveOnly: boolean }
  | { type: 'remove'; id: string }
  | { type: 'event' }
  | { type: 'ignored' };

export class Picture {
  readonly entities: Map<string, Entity>;
  /** Lower bound on the earliest expiry_time present; -Infinity = unknown (scan on next sweep). */
  private nextExpiry = -Infinity;

  constructor(entities?: Map<string, Entity>) {
    this.entities = entities ?? new Map();
  }

  /** Shallow copy; safe because entity objects are never mutated. */
  clone(): Picture {
    const p = new Picture(new Map(this.entities));
    p.nextExpiry = this.nextExpiry;
    return p;
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  apply(rec: JournalRecord): ApplyResult {
    if (!isEntityKind(rec.kind)) return { type: 'event' };
    const id = rec.entity_id;
    if (!id) return { type: 'ignored' };
    const prev = this.entities.get(id);
    if (prev && rec.source_time < prev.source_time) return { type: 'ignored' };

    const patch = rec.payload as EntityComponents;
    const isLive = patch.is_live ?? prev?.is_live ?? true;
    if (!isLive) {
      if (!prev) return { type: 'ignored' };
      this.entities.delete(id);
      return { type: 'remove', id };
    }

    const next: Entity = { ...(prev as Entity) };
    let moveOnly = !!prev;
    for (const key in patch) {
      const v = (patch as Record<string, unknown>)[key];
      if (v === undefined) continue;
      (next as unknown as Record<string, unknown>)[key] = v;
      if (!MOVE_ONLY_KEYS.has(key)) moveOnly = false;
    }
    next.entity_id = id;
    next.layer = rec.layer;
    next.is_live = true;
    next.source_time = rec.source_time;
    next.ingest_time = rec.ingest_time;
    next.version = (prev?.version ?? 0) + 1;
    next.last_hash = rec.hash;
    const hist = prev ? prev.history.slice(-(HISTORY_LIMIT - 1)) : [];
    hist.push(rec.record_id);
    next.history = hist;
    next.label = rec.label;
    if (rec.releasability) next.releasability = rec.releasability;
    if (!moveOnly) next.provenance = rec.provenance;
    else if (!next.provenance) next.provenance = rec.provenance;
    if (moveOnly && prev && prev.label !== rec.label) moveOnly = false;
    this.entities.set(id, next);
    if (next.expiry_time !== undefined && next.expiry_time < this.nextExpiry) this.nextExpiry = next.expiry_time;
    return { type: 'upsert', id, moveOnly };
  }

  /** Remove entities whose expiry_time has passed. Returns removed ids. */
  sweepExpired(t: number): string[] {
    if (t < this.nextExpiry) return [];
    const removed: string[] = [];
    let min = Infinity;
    for (const [id, e] of this.entities) {
      if (e.expiry_time === undefined) continue;
      if (e.expiry_time <= t) {
        this.entities.delete(id);
        removed.push(id);
      } else if (e.expiry_time < min) min = e.expiry_time;
    }
    this.nextExpiry = min;
    return removed;
  }
}
