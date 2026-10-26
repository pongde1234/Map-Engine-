/**
 * Post-mission debrief (storyboard C1): the run's outcomes as recorded, every injected fragment
 * and engagement accounted for, the notional targets with their plant-state history and BDA, the
 * thread from a received fragment to an engagement and its BDA, DP-9, re-attack and attribution.
 * Counts come from the run: tallies are derived from records and set beside the run manifest;
 * any mismatch is shown, never smoothed. Nothing here estimates what the run did not record.
 */
import { CLASSES, type Accounting, type BdaPayload, type DecisionPayload, type EngagementPayload, type EntityComponents, type JournalRecord, type LonLat } from '@me/schema';
import { distance } from '@me/geo';
import type { MapClient } from '@me/client';
import type { Derived } from './derived.ts';
import { DECISION_POINTS, triggers, type TriggerState } from './authority.ts';

export interface Tally {
  id: string;
  label: string;
  /** Derived from the records at the picture time. */
  recorded: number;
  /** The run manifest's figure for the whole run, where it has one. */
  run?: number;
}

export interface FragmentRow {
  recordId: string;
  entityId: string;
  cls: string;
  summary: string;
  sensor: string;
  confidence: string;
  received: number;
  associated: boolean;
  /** Decisions and assessments derived from this report. */
  usedBy: string[];
  /** Earlier records of the same entity (prior assessments kept beside revisions). */
  revision: number;
}

export interface EngagementRow {
  id: string;
  at: number;
  target: string;
  effector: string;
  weapon: string;
  result: EngagementPayload['result'];
  /** Release token of the authority record, e.g. "DP-5·A1A0A4". */
  token?: string;
}

export interface BdaRow {
  id: string;
  at: number;
  target: string;
  damage: BdaPayload['damage'];
  summary: string;
  sources: number;
  location?: LonLat;
}

export interface NotionalTarget {
  id: string;
  unit: string;
  tier: number;
  history: Array<{ t: number; state: string }>;
  aimpoint?: { label: string; tot?: number };
  /** The BDA that covers this unit: its own, or the plant-wide one. */
  bda?: BdaRow;
  damage: BdaPayload['damage'] | 'no BDA';
}

export interface Debrief {
  run: string;
  tallies: Tally[];
  tier1Hits: Tally;
  tracks: Accounting['tracks'];
  fragments: FragmentRow[];
  engagements: EngagementRow[];
  withToken: number;
  bda: BdaRow[];
  targets: NotionalTarget[];
  dp9: { trigger: TriggerState; status: string; owner: string; presentation: string };
  reattack: { groups: Array<{ id: string; name: string; members: number }>; note: string };
  attribution: string;
}

const STEP_LABELS = ['Received fragments', 'Assessment', 'DP record', 'Approved envelope', 'Task', 'Engagement', 'BDA'] as const;
export type ThreadStepId = (typeof STEP_LABELS)[number];

export interface ThreadStep {
  id: ThreadStepId;
  records: Array<{ id: string; title: string; at: number; hash: string }>;
}

const short = (r: JournalRecord) => r.hash.slice(0, 6).toUpperCase();

function bdaRow(r: JournalRecord<BdaPayload>): BdaRow {
  return {
    id: r.record_id,
    at: r.ingest_time,
    target: r.payload.target_id,
    damage: r.payload.damage,
    summary: r.payload.summary,
    sources: r.derived_from?.length ?? 0,
    ...(r.payload.location ? { location: r.payload.location as LonLat } : {}),
  };
}

export function debriefOf(client: MapClient, derived: Derived, accounting: Accounting | null): Debrief {
  const events = client.events;
  const byId = new Map(events.map((r) => [r.record_id, r]));
  const decisions = events.filter((r): r is JournalRecord<DecisionPayload> => r.kind === 'decision');
  const tracks = accounting?.tracks ?? [];
  const counts = client.scenario?.counts ?? {};
  const n = (f: (t: (typeof tracks)[number]) => boolean) => tracks.filter(f).length;
  const tallies: Tally[] = [
    { id: 'threats', label: 'Threat tracks', recorded: tracks.length, ...(counts.threats !== undefined ? { run: counts.threats } : {}) },
    { id: 'destroyed', label: 'Destroyed', recorded: n((t) => t.outcome === 'destroyed'), ...(counts.hardKills !== undefined ? { run: counts.hardKills } : {}) },
    { id: 'soft', label: 'Soft kill', recorded: n((t) => t.outcome === 'deflected' && t.cls !== 'arm'), ...(counts.softKill !== undefined ? { run: counts.softKill } : {}) },
    { id: 'emcon', label: 'Emission control', recorded: n((t) => t.outcome === 'deflected' && t.cls === 'arm'), ...(counts.emcon !== undefined ? { run: counts.emcon } : {}) },
    { id: 'withdrawn', label: 'Withdrew', recorded: n((t) => t.outcome === 'withdrawn'), ...(counts.probesWithdrawn !== undefined ? { run: counts.probesWithdrawn } : {}) },
    { id: 'leaked', label: 'Leaked', recorded: n((t) => t.outcome === 'leaked'), ...(counts.leakers !== undefined ? { run: counts.leakers } : {}) },
    { id: 'flight', label: 'Still in flight', recorded: n((t) => t.outcome === 'in flight') },
    { id: 'unrecorded', label: 'No outcome recorded', recorded: n((t) => t.outcome === 'no outcome recorded'), run: 0 },
  ];

  // Fragments: every report received, with what was derived from it; revisions kept in order.
  const usedBy = new Map<string, string[]>();
  for (const r of events) for (const p of r.derived_from ?? []) usedBy.set(p, [...(usedBy.get(p) ?? []), r.kind === 'decision' ? (r.payload as DecisionPayload).dp : (r.entity_id ?? r.kind)]);
  const seen = new Map<string, number>();
  const fragments: FragmentRow[] = [];
  for (const r of events) {
    if (r.kind !== 'fragment' || !r.entity_id) continue;
    const p = r.payload as EntityComponents;
    if (!p.fragment) continue;
    const revision = seen.get(r.entity_id) ?? 0;
    seen.set(r.entity_id, revision + 1);
    fragments.push({
      recordId: r.record_id,
      entityId: r.entity_id,
      cls: p.ontology?.class ?? '',
      summary: p.fragment.summary,
      sensor: r.provenance.sensor_class ?? r.provenance.source_feed,
      confidence: p.fragment.confidence,
      received: r.ingest_time,
      associated: p.fragment.associated !== false,
      usedBy: usedBy.get(r.record_id) ?? [],
      revision,
    });
  }

  // Engagements with the release token of their authority record.
  const engagements: EngagementRow[] = [];
  for (const r of events) {
    if (r.kind !== 'engagement') continue;
    const p = r.payload as EngagementPayload;
    const auth = p.authority_record ? byId.get(p.authority_record) : undefined;
    engagements.push({
      id: r.record_id,
      at: r.ingest_time,
      target: p.target_id,
      effector: p.effector_id,
      weapon: p.weapon,
      result: p.result,
      ...(auth && auth.kind === 'decision' ? { token: `${(auth.payload as DecisionPayload).dp}·${short(auth)}` } : {}),
    });
  }

  const bda = events.filter((r): r is JournalRecord<BdaPayload> => r.kind === 'bda').map(bdaRow);
  const plantWide = [...bda].reverse().find((b) => !accounting?.plant.some((p) => p.id === b.target) && b.target.startsWith('VP-'));
  const aims = [...client.entities.values()].filter((e) => e.geo_details?.type === 'aimpoint' && e.geo_shape?.type === 'point');
  const targets: NotionalTarget[] = (accounting?.plant ?? []).map((p) => {
    const own = [...bda].reverse().find((b) => b.target === p.id);
    const cover = own ?? plantWide;
    const unit = client.entities.get(p.id);
    const at = unit?.location ? ([unit.location.lon, unit.location.lat] as LonLat) : undefined;
    const aim = at ? aims.find((a) => a.geo_shape?.type === 'point' && distance(a.geo_shape.coordinates as LonLat, at) < 600) : undefined;
    return {
      id: p.id,
      unit: p.unit,
      tier: p.tier,
      history: p.history,
      ...(aim ? { aimpoint: { label: aim.geo_details?.label ?? aim.entity_id, ...(aim.geo_details?.tot ? { tot: aim.geo_details.tot } : {}) } } : {}),
      ...(cover ? { bda: cover } : {}),
      damage: cover?.damage ?? 'no BDA',
    };
  });
  const tier1Damaged = targets.filter((x) => x.tier === 1 && x.damage !== 'none' && x.damage !== 'no BDA').length;

  const trig = triggers(client, derived).get('DP-9')!;
  const dp9 = [...decisions].reverse().find((d) => d.payload.dp === 'DP-9');
  const def9 = DECISION_POINTS.find((d) => d.dp === 'DP-9')!;
  const dp11 = [...decisions].reverse().find((d) => d.payload.dp === 'DP-11');

  // Re-attack: raid groups still in the picture after the first BDA was recorded.
  const firstBda = bda[0]?.at;
  const groups = firstBda === undefined ? [] : derived.groups.filter((g) => g.group?.raid_id && g.source_time >= firstBda);

  return {
    run: `Run · ${client.scenario?.id ?? 'scenario'} · seed ${client.scenario?.seed ?? '—'} · synthetic`,
    tallies,
    tier1Hits: { id: 'tier1', label: 'Tier-1 units hit', recorded: tier1Damaged, ...(counts.tier1Hits !== undefined ? { run: counts.tier1Hits } : {}) },
    tracks,
    fragments,
    engagements,
    withToken: engagements.filter((e) => e.token).length,
    bda,
    targets,
    dp9: { trigger: trig, status: dp9 ? dp9.payload.status : trig.met ? 'due' : 'not triggered', owner: def9.owner, presentation: def9.presentation },
    reattack: {
      groups: groups.map((g) => ({ id: g.entity_id, name: g.aliases?.name ?? g.entity_id, members: g.group?.members.length ?? 0 })),
      note: groups.length ? 'Re-attack in the picture after BDA' : 'No raid group in the picture after BDA',
    },
    attribution: dp11 ? `Attribution pending at L1 (DP-11 ${dp11.payload.status}); no response approved` : 'No attribution record in this view',
  };
}

/**
 * The thread behind a track, from its lineage records (GET /api/lineage/:id): received fragment,
 * assessment, DP record, approved envelope, task, engagement and BDA. A step with no records is
 * a link the record does not make; it is shown empty, never filled in.
 */
export function threadOf(records: JournalRecord[], trackId: string): ThreadStep[] {
  const steps = new Map<ThreadStepId, ThreadStep['records']>(STEP_LABELS.map((s) => [s, []]));
  const put = (id: ThreadStepId, r: JournalRecord, title: string) => steps.get(id)!.push({ id: r.record_id, title, at: r.ingest_time, hash: r.hash });
  for (const r of records) {
    if (r.kind === 'fragment') {
      const p = r.payload as EntityComponents;
      // A report built on earlier decisions is an assessment; a raw report is received material.
      put(r.derived_from?.length ? 'Assessment' : 'Received fragments', r, `${r.entity_id} · ${p.fragment?.summary ?? CLASSES[p.ontology?.class ?? '']?.label ?? ''}`);
    } else if (r.kind === 'decision') {
      const d = r.payload as DecisionPayload;
      const step: ThreadStepId = d.dp === 'DP-0' || (d.dp === 'DP-7' && d.status === 'delegated') ? 'Approved envelope' : d.dp === 'DP-5' ? 'Task' : 'DP record';
      put(step, r, `${d.dp} · ${d.title}${d.authority ? ` · ${d.authority}` : ''}`);
    } else if (r.kind === 'engagement') {
      const e = r.payload as EngagementPayload;
      if (e.target_id === trackId) put('Engagement', r, `${e.result.toUpperCase()} · ${e.effector_id} · ${e.weapon}`);
    } else if (r.kind === 'bda') {
      const b = r.payload as BdaPayload;
      if (b.target_id === trackId) put('BDA', r, `${b.damage} · ${b.summary}`);
    }
  }
  return STEP_LABELS.map((id) => ({ id, records: steps.get(id)!.sort((a, b) => a.at - b.at) }));
}
