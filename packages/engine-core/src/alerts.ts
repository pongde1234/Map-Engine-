/**
 * Custom alerts. When an operator sets an alert, walk the picture forward from the moment it was
 * set and record each firing and clearing as a rule firing, with the operator's severity. Like
 * the geofence rule, the firings are journaled in the operator log, so replay and scrubbing show
 * them at the times they happened; a later withdrawal supersedes the ones after it. Every number
 * the rule tests is the operator's own.
 */
import { CLASSES, type AlertRule, type Entity, type EntityComponents, type GeoShape, type JournalRecord, type LonLat, type Provenance, type RecordDraft, type RuleFirePayload, watchedBy } from '@me/schema';
import { distance, pointInShape } from '@me/geo';
import { Cursor } from './cursor.ts';
import type { Engine } from './engine.ts';

export function alertRuleId(entityId: string): string {
  return `alert:${entityId}`;
}

export interface AlertOptions {
  /** Last time to evaluate (the journal's end). */
  endT: number;
  /** The defended point, for `near_vp`. */
  center: LonLat;
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

export interface AlertRun {
  drafts: RecordDraft<RuleFirePayload>[];
  truncated: boolean;
}

const WATCH_WORD: Record<string, string> = { hostile: 'hostile', unidentified: 'unidentified', any: '' };
const tag = (e: Entity | undefined, id: string) => e?.aliases?.track_number ?? e?.aliases?.name ?? id;
const loc = (e: Entity): LonLat => [e.location!.lon, e.location!.lat];

/** The ring's shape on the map at the time the alert is set; `all` is the whole picture. */
function ringShape(entities: Iterable<Entity>, ring: AlertRule['ring']): GeoShape | null {
  if (!ring || ring === 'all') return null;
  for (const e of entities) if (e.geo_details?.type === 'ring' && e.geo_details.ring === ring && e.geo_shape) return e.geo_shape;
  return null;
}

export async function evaluateAlert(engine: Engine, alert: JournalRecord, o: AlertOptions): Promise<AlertRun> {
  const comp = alert.payload as EntityComponents;
  const rule = comp.alert_rule;
  const alertId = alert.entity_id;
  if (!rule || !alertId) return { drafts: [], truncated: false };
  // Firings read in the operator's own words: the name as typed.
  const name = comp.aliases?.name ?? comp.geo_details?.label ?? alertId;
  const step = o.stepMs ?? 5000;
  const max = o.maxFirings ?? 300;
  const yieldEvery = o.yieldEvery ?? 400;

  const drafts: RecordDraft<RuleFirePayload>[] = [];
  const fire = (t: number, payload: Omit<RuleFirePayload, 'rule_id' | 'rule' | 'severity'>) =>
    drafts.push({
      record_id: `${alertId}-F${String(drafts.length + 1).padStart(4, '0')}`,
      kind: 'rule_fire',
      layer: 'event',
      source_time: t,
      ingest_time: t,
      provenance: o.provenance,
      derived_from: [alert.hash],
      label: o.label,
      ...(o.releasability ? { releasability: o.releasability } : {}),
      author: 'Rules engine · custom alert',
      payload: { rule_id: alertRuleId(alertId), rule: 'custom', severity: rule.severity, ...payload },
    });

  const cursor = new Cursor(engine);
  cursor.seek(alert.ingest_time);
  const watch = rule.watch ?? 'hostile';
  const watched = WATCH_WORD[watch] ? `${WATCH_WORD[watch]} tracks` : 'tracks';
  const shape = ringShape(cursor.picture.entities.values(), rule.ring);
  const where = rule.ring && rule.ring !== 'all' ? `in ${rule.ring}` : 'in the picture';
  const km = rule.distance_m !== undefined ? `${Math.round(rule.distance_m / 100) / 10} km` : '';
  const classes = new Set(rule.classes ?? []);

  /** Whether an object meets the condition now. `class_appears` is an event, handled apart. */
  const meets = (e: Entity | undefined): boolean => {
    if (!e) return false;
    switch (rule.condition) {
      case 'count_in_ring':
        return watchedBy(e, watch) && (!shape || pointInShape(loc(e), shape));
      case 'near_vp':
        return watchedBy(e, watch) && rule.distance_m !== undefined && distance(o.center, loc(e)) <= rule.distance_m;
      case 'magazine_low': {
        const m = e.effector?.magazine;
        if (!m || e.ontology?.template !== 'effector' || (rule.unit && e.entity_id !== rule.unit)) return false;
        return m.ready <= (rule.ready ?? m.floor);
      }
      default:
        return false;
    }
  };
  const level = (e: Entity | undefined) => (rule.ready !== undefined ? `${rule.ready} ready or fewer` : `its floor of ${e?.effector?.magazine?.floor ?? '—'}`);

  const inside = new Set<string>();
  const seen = new Set<string>();
  let fired = false;
  /** Count rules fire on reaching the count and clear on falling below it. */
  const countState = (t: number, subject: string[]) => {
    const n = inside.size;
    if (!fired && n >= (rule.count ?? 1)) {
      fired = true;
      fire(t, { state: 'fired', value: n, threshold: rule.count ?? 1, subject_ids: subject.slice(0, 20), note: `${name}: ${n} ${watched} ${where} (reached ${rule.count})` });
    } else if (fired && n < (rule.count ?? 1)) {
      fired = false;
      fire(t, { state: 'cleared', value: n, threshold: rule.count ?? 1, subject_ids: [], note: `${name}: ${n} ${watched} ${where}, below ${rule.count}` });
    }
  };
  const appear = (t: number, e: Entity) => {
    const cls = e.ontology?.class ?? '';
    if (seen.has(e.entity_id) || !classes.has(cls) || !watchedBy(e, 'any')) return;
    seen.add(e.entity_id);
    fire(t, { state: 'fired', value: seen.size, subject_ids: [e.entity_id], note: `${name}: ${CLASSES[cls]?.label ?? cls} ${tag(e, e.entity_id)} appeared` });
  };

  // At the moment the alert is set.
  const t0 = alert.ingest_time;
  for (const e of cursor.picture.entities.values()) {
    if (rule.condition === 'class_appears') appear(t0, e);
    else if (meets(e)) inside.add(e.entity_id);
  }
  if (rule.condition === 'count_in_ring') countState(t0, [...inside]);
  else if (inside.size && rule.condition !== 'class_appears') {
    fire(t0, { state: 'fired', value: inside.size, subject_ids: [...inside].slice(0, 20), note: `${name}: ${inside.size} already ${rule.condition === 'near_vp' ? `within ${km} of the VA/VP` : 'at the level'} when set` });
  }

  let n = 0;
  for (let t = t0 + step; ; t += step) {
    const tt = Math.min(t, o.endT);
    const ch = cursor.advance(tt);
    const pic = cursor.picture;
    for (const id of [...ch.upserts, ...ch.moved]) {
      const e = pic.get(id);
      if (rule.condition === 'class_appears') {
        if (e) appear(tt, e);
        continue;
      }
      const now = meets(e);
      if (now === inside.has(id)) continue;
      if (now) inside.add(id);
      else inside.delete(id);
      if (rule.condition === 'count_in_ring') countState(tt, [id]);
      else if (now) {
        const what = rule.condition === 'near_vp' ? `${tag(e, id)} within ${km} of the VA/VP` : `${tag(e, id)} at ${e?.effector?.magazine?.ready ?? '—'} ready (${level(e)})`;
        fire(tt, { state: 'fired', value: inside.size, subject_ids: [id], note: `${name}: ${what}` });
      } else {
        const what = rule.condition === 'near_vp' ? `${tag(e, id)} beyond ${km}` : `${tag(e, id)} back above ${level(e)}`;
        fire(tt, { state: inside.size ? 'fired' : 'cleared', value: inside.size, subject_ids: [id], note: `${name}: ${what}` });
      }
    }
    if (rule.condition !== 'class_appears') {
      for (const id of ch.removes) {
        if (!inside.delete(id)) continue;
        if (rule.condition === 'count_in_ring') countState(tt, [id]);
        else fire(tt, { state: inside.size ? 'fired' : 'cleared', value: inside.size, subject_ids: [id], note: `${name}: ${id} left the picture` });
      }
    }
    if (drafts.length >= max) return { drafts: drafts.slice(0, max), truncated: true };
    if (tt >= o.endT) break;
    if (++n % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { drafts, truncated: false };
}
