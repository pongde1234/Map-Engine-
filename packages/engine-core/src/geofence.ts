/**
 * Geofence rule. When a geofence is promoted, walk the picture forward from the moment it was
 * drawn and record every entry and exit of a watched track as a rule firing. The firings are
 * journaled in the operator log, so replay and scrubbing show them at the times they happened,
 * like every other rule; a later withdrawal supersedes the ones after it.
 */
import { type Entity, type EntityComponents, type GeofenceWatch, type JournalRecord, type Provenance, type RecordDraft, type RuleFirePayload, watchedBy } from '@me/schema';
import { pointInShape } from '@me/geo';
import { Cursor } from './cursor.ts';
import type { Engine } from './engine.ts';
import { geofenceRuleId } from './operator.ts';

const ENDED = new Set(['destroyed', 'impact', 'withdrawn', 'landed']);

export interface GeofenceOptions {
  /** Last time to evaluate (the journal's end). */
  endT: number;
  provenance: Provenance;
  label: string;
  releasability?: string[];
  /** Sampling step on the ingest axis. Default 5 s. */
  stepMs?: number;
  /** Stop after this many firings. Default 300. */
  maxFirings?: number;
  /** Hand control back to the event loop every n steps. Default 400. */
  yieldEvery?: number;
}

export interface GeofenceRun {
  drafts: RecordDraft<RuleFirePayload>[];
  truncated: boolean;
}

export async function evaluateGeofence(engine: Engine, fence: JournalRecord, o: GeofenceOptions): Promise<GeofenceRun> {
  const comp = fence.payload as EntityComponents;
  const shape = comp.geo_shape;
  const fenceId = fence.entity_id;
  if (!shape || !fenceId) return { drafts: [], truncated: false };
  const watch: GeofenceWatch = comp.geo_details?.watch ?? 'hostile';
  // Alerts read in the operator's own words: the name as typed, not the map label.
  const name = comp.aliases?.name ?? comp.geo_details?.label ?? fenceId;
  const step = o.stepMs ?? 5000;
  const max = o.maxFirings ?? 300;
  const yieldEvery = o.yieldEvery ?? 400;

  const drafts: RecordDraft<RuleFirePayload>[] = [];
  const inside = new Set<string>();
  const fire = (t: number, payload: Omit<RuleFirePayload, 'rule_id' | 'rule'>) =>
    drafts.push({
      record_id: `${fenceId}-F${String(drafts.length + 1).padStart(4, '0')}`,
      kind: 'rule_fire',
      layer: 'event',
      source_time: t,
      ingest_time: t,
      provenance: o.provenance,
      derived_from: [fence.hash],
      label: o.label,
      ...(o.releasability ? { releasability: o.releasability } : {}),
      author: 'Rules engine · geofence',
      payload: { rule_id: geofenceRuleId(fenceId), rule: 'geofence', ...payload },
    });
  const tag = (e: Entity | undefined, id: string) => e?.aliases?.track_number ?? e?.aliases?.name ?? id;

  const cursor = new Cursor(engine);
  cursor.seek(fence.ingest_time);
  for (const e of cursor.picture.entities.values()) {
    if (watchedBy(e, watch) && pointInShape([e.location!.lon, e.location!.lat], shape)) inside.add(e.entity_id);
  }
  if (inside.size) {
    fire(fence.ingest_time, { state: 'fired', value: inside.size, subject_ids: [...inside].slice(0, 20), note: `${inside.size} watched inside ${name} at activation` });
  }

  let n = 0;
  for (let t = fence.ingest_time + step; ; t += step) {
    const tt = Math.min(t, o.endT);
    const ch = cursor.advance(tt);
    const pic = cursor.picture;
    for (const id of [...ch.upserts, ...ch.moved]) {
      const e = pic.get(id);
      const now = !!e && watchedBy(e, watch) && pointInShape([e.location!.lon, e.location!.lat], shape);
      if (now && !inside.has(id)) {
        inside.add(id);
        fire(tt, { state: 'fired', value: inside.size, subject_ids: [id], note: `${tag(e, id)} entered ${name}` });
      } else if (!now && inside.has(id)) {
        inside.delete(id);
        // A track that ended inside (destroyed, impact, withdrawn, landed) did not leave.
        const ended = e?.track?.state && ENDED.has(e.track.state) ? e.track.state : null;
        fire(tt, { state: inside.size ? 'fired' : 'cleared', value: inside.size, subject_ids: [id], note: ended ? `${tag(e, id)} ${ended} inside ${name}` : `${tag(e, id)} left ${name}` });
      }
    }
    for (const id of ch.removes) {
      if (!inside.delete(id)) continue;
      fire(tt, { state: inside.size ? 'fired' : 'cleared', value: inside.size, subject_ids: [id], note: `${id} dropped from the picture inside ${name}` });
    }
    if (drafts.length >= max) return { drafts: drafts.slice(0, max), truncated: true };
    if (tt >= o.endT) break;
    if (++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { drafts, truncated: false };
}
