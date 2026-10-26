/**
 * Decision authority for the Strategic View (storyboard A4): the decision layers, the
 * decision-point table (owner from the DP legend; trigger, presentation status and delegation
 * from the coverage pages, CONOP §9.3, verbatim), each trigger read from the picture, and the
 * strategic picture for a role: the plan in force, the new event and its indication thread,
 * impact, the role's permitted actions, and the same indication at L3, L2 and L1.
 *
 * Read-only: nothing here records a decision. DP-2 and DP-11 are options only, never
 * suggested and never selectable. A trigger the picture cannot evidence reads null; the UI
 * does not supply missing thresholds.
 */
import { ROLES, ROLE_LAYER, releasable, type DecisionPayload, type EngagementPayload, type EntityComponents, type JournalRecord, type LonLat, type RuleFirePayload } from '@me/schema';
import { distance, inverse } from '@me/geo';
import type { MapClient } from '@me/client';
import type { Derived } from './derived.ts';
import { eventSummary } from './format.ts';

export type Layer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export const LAYERS: Array<{ id: Layer; name: string; meaning: string; role: string | null }> = [
  { id: 'L1', name: 'National level', meaning: 'Strategic/national', role: 'l1' },
  { id: 'L2', name: 'Joint HQ West', meaning: 'Operational/joint', role: 'l2' },
  { id: 'L3', name: 'AD Direction Centre', meaning: 'Tactical air-defence C2', role: 'l3' },
  { id: 'L4', name: 'Fire units · RIL control room', meaning: 'Fire unit/site, including RIL control room', role: 'ril' },
  { id: 'L5', name: 'Edge autonomy', meaning: 'Edge autonomy inside the L3 envelope', role: null },
];

export interface DecisionPointDef {
  dp: string;
  decision: string;
  /** Owner as the DP legend writes it. */
  owner: string;
  owners: Layer[];
  trigger: string;
  presentation: string;
  delegation: string;
  /** Shown as an option only: never suggested, never selectable (DP-2, DP-11). */
  optionOnly?: boolean;
}

export const DECISION_POINTS: DecisionPointDef[] = [
  { dp: 'DP-0', decision: 'Pre-delegation package', owner: 'L2 drafts; L1 approves', owners: ['L1', 'L2'], trigger: 'Peacetime/rising tension', presentation: 'Prior illustrative approval record; later preparation', delegation: 'Human approval of the package' },
  { dp: 'DP-1', decision: 'Alert posture', owner: 'L1/L2', owners: ['L1', 'L2'], trigger: 'Intelligence or probes', presentation: 'Illustrative posture review and decision', delegation: 'Partly to L2' },
  { dp: 'DP-2', decision: 'Pre-emption / left-of-launch', owner: 'L1 only', owners: ['L1'], trigger: 'High-confidence launch preparations', presentation: 'Option only, never selected or executed', delegation: 'None', optionOnly: true },
  { dp: 'DP-3', decision: 'Weapons control status', owner: 'L2; conditional L3', owners: ['L2', 'L3'], trigger: 'Raid detected', presentation: 'Illustrative weapons control status', delegation: 'To L3 only under prior R4 track-count condition; N unspecified' },
  { dp: 'DP-4', decision: 'Airspace/sea restrictions', owner: 'L2 + DGCA/AAI, ports', owners: ['L2'], trigger: 'Raid detected; civil coordination required', presentation: 'Draft restrictions and recorded review', delegation: 'Pre-agreed trigger' },
  { dp: 'DP-5', decision: 'Weapon–target pairing', owner: 'L3; execution L4/L5', owners: ['L3'], trigger: 'Tracks in R4/R3', presentation: 'Machine recommendation, named human approval', delegation: 'L4/L5 execution within the envelope' },
  { dp: 'DP-6', decision: 'Missile reserve release', owner: 'L2', owners: ['L2'], trigger: 'Leakage forecast threshold or cruise missile', presentation: 'New decision or prior condition identified; unresolved action stays pending', delegation: 'Conditional pre-delegation' },
  { dp: 'DP-7', decision: 'Inner-ring weapons free', owner: 'L3 → L4/L5', owners: ['L3'], trigger: 'Saturation', presentation: 'Prior envelope, condition and recorded execution', delegation: 'Pre-authorised; drone class; civil/fratricide checks' },
  { dp: 'DP-8', decision: 'Plant protective action', owner: 'RIL L4; L3 advisory', owners: ['L4'], trigger: 'Aimpoint/time forecast', presentation: 'Synthetic plant action record', delegation: 'Pre-agreed RIL triggers' },
  { dp: 'DP-9', decision: 'Restart / continued shutdown', owner: 'RIL L4 + L2', owners: ['L4', 'L2'], trigger: 'All-clear/BDA', presentation: 'Review only; no invented restart approval', delegation: 'Partly' },
  { dp: 'DP-10', decision: 'Public narrative', owner: 'L1 + state', owners: ['L1'], trigger: 'Red information operations', presentation: 'Narrative support; no publication', delegation: 'None' },
  { dp: 'DP-11', decision: 'Counter-strike / response', owner: 'L1 only', owners: ['L1'], trigger: 'Completed attribution', presentation: 'Option only; no response approval', delegation: 'None', optionOnly: true },
  { dp: 'DP-12', decision: 'Reconstitution', owner: 'L2/L3', owners: ['L2', 'L3'], trigger: 'After raid', presentation: 'Reconstitution proposals', delegation: 'Partly' },
];

/**
 * The delegations DP-0 carries: the coverage table's decision points with a conditional or
 * pre-agreed delegation (five, as DP-0's "five delegation triggers"). Conditions stay as
 * written; N and T are unspecified.
 */
export const PACKAGE_DELEGATIONS = ['DP-3', 'DP-4', 'DP-6', 'DP-7', 'DP-8'];

/** A record's decision layer on the L1–L5 ladder (the RIL control room sits at L4). */
export function layerOf(l: DecisionPayload['layer']): Layer {
  return l === 'RIL' ? 'L4' : l;
}

export interface TriggerState {
  /** null: the picture cannot evidence this trigger. */
  met: boolean | null;
  /** Record or entity ids that evidence it. */
  evidence: string[];
  note: string;
}

export interface Indication {
  recordId: string;
  entityId: string;
  /** Fragment class, e.g. launch_prep, emitter. */
  cls: string;
  summary: string;
  sourceKind: string;
  sensor: string;
  confidence: string;
  observed: number;
  received: number;
  associated: boolean;
  notional: boolean;
  thread: string | null;
  at?: LonLat;
  /** Semi-major and semi-minor axes of the uncertainty ellipse, km. */
  ellipseKm?: [number, number];
  releasability?: string[];
}

export interface DecisionItem {
  id: string;
  hash: string;
  dp: string;
  title: string;
  layer: Layer;
  status: DecisionPayload['status'];
  authority?: string;
  author?: string;
  at: number;
  summary: string;
  inputs: Array<{ id: string; title: string }>;
  /** Earlier records of the same DP in view. */
  earlier: number;
  releasability?: string[];
}

export interface DpState {
  def: DecisionPointDef;
  trigger: TriggerState;
  latest: DecisionItem | null;
  records: number;
}

export interface Action {
  id: string;
  title: string;
  detail: string;
  state: 'done' | 'due' | 'review' | 'open';
  dp?: string;
  evidence: string[];
}

export interface LadderColumn {
  layer: Layer;
  name: string;
  duty: string;
  /** Its plan: decisions in force releasable to that level. */
  plan: DecisionItem[];
  /** The change: the indication as that level can see it. */
  change: Indication[];
  /** The decisions it owns, with recorded status (or why none shows). */
  owns: Array<{ dp: string; decision: string; status: string; optionOnly: boolean }>;
  /** Caveats this level reads that the session does not hold: shown, never counted. */
  beyond: string[];
}

export interface StrategicPicture {
  role: string;
  layer: Layer | null;
  dps: DpState[];
  plan: DecisionItem[];
  intent: string[];
  event: Indication | null;
  thread: { id: string | null; items: Indication[]; unassociated: Indication[]; revisions: Array<{ entityId: string; items: Indication[] }>; disagreements: Array<{ entityId: string; sources: string[] }> };
  impact: {
    rangeKm: number | null;
    bearing: number | null;
    atDefendedPoint: boolean;
    evidences: string[];
    decidedOn: DecisionItem[];
    readiness: { sensorsUp: number; sensors: number; unitsReady: number; units: number };
  } | null;
  actions: Action[];
  ladder: LadderColumn[];
  dp0: DecisionItem | null;
  dp2: DecisionItem | null;
  /** DP-2's recorded options (shown, never selectable). */
  dp2Options: Array<{ id: string; label: string }>;
  branches: string;
}

const INDICATION_CLASSES = new Set(['launch_prep', 'emitter', 'hostile_hq']);
const CONFIDENCE_RANK: Record<string, number> = { doubtful: 0, possible: 1, likely: 2, confirmed: 3 };
const IN_FORCE = new Set(['approved', 'delegated']);
/** Within this distance an indication sits at the defended point. */
const AT_VP_KM = 1;
/** The decisions frame A4 shows at every level (storyboard skeleton: "DP-0 record, DP-1, DP-2 option"). */
const A4_DPS = new Set(['DP-0', 'DP-1', 'DP-2']);

/** The duty each level has at an indication (storyboard A3/A4 Decision out). */
const DUTY: Record<Layer, string> = {
  L1: 'Handles national posture; reviews the recorded DP-0 approval',
  L2: 'Assesses posture within its authority; drafts changes',
  L3: 'Reviews the indication and elevates it',
  L4: 'Plant protective action under pre-agreed triggers',
  L5: 'Executes inside the L3 envelope',
};

function indicationOf(r: JournalRecord): Indication | null {
  const p = r.payload as EntityComponents;
  if (!p.fragment || !r.entity_id) return null;
  const u = p.location_uncertainty;
  return {
    recordId: r.record_id,
    entityId: r.entity_id,
    cls: p.ontology?.class ?? '',
    summary: p.fragment.summary,
    sourceKind: p.fragment.source_kind,
    sensor: r.provenance.sensor_class ?? r.provenance.source_feed,
    confidence: p.fragment.confidence,
    observed: r.source_time,
    received: r.ingest_time,
    associated: p.fragment.associated !== false,
    notional: !!p.indicators?.notional,
    thread: r.thread_id ?? null,
    ...(p.location ? { at: [p.location.lon, p.location.lat] as LonLat } : {}),
    ...(u ? { ellipseKm: [u.semi_major_m / 1000, u.semi_minor_m / 1000] as [number, number] } : {}),
    ...(r.releasability ? { releasability: r.releasability } : {}),
  };
}

function decisionItem(r: JournalRecord<DecisionPayload>, byId: Map<string, JournalRecord>, earlier: number): DecisionItem {
  const d = r.payload;
  return {
    id: r.record_id,
    hash: r.hash,
    dp: d.dp,
    title: d.title,
    layer: layerOf(d.layer),
    status: d.status,
    ...(d.authority ? { authority: d.authority } : {}),
    ...(r.author ? { author: r.author } : {}),
    at: r.ingest_time,
    summary: d.summary,
    inputs: (r.derived_from ?? []).map((id) => {
      const src = byId.get(id);
      return { id, title: src ? eventSummary(src).title : 'Not in this view' };
    }),
    earlier,
    ...(r.releasability ? { releasability: r.releasability } : {}),
  };
}

/** Each decision point's trigger, read from the picture at the client's time. */
export function triggers(client: MapClient, derived: Derived): Map<string, TriggerState> {
  const frags: Indication[] = [];
  const rules: Array<JournalRecord<RuleFirePayload>> = [];
  const bda: JournalRecord[] = [];
  for (const r of client.events) {
    if (r.kind === 'fragment') {
      const i = indicationOf(r);
      if (i) frags.push(i);
    } else if (r.kind === 'rule_fire') rules.push(r as JournalRecord<RuleFirePayload>);
    else if (r.kind === 'bda') bda.push(r);
  }
  const fired = (...kinds: Array<RuleFirePayload['rule']>) => rules.filter((r) => kinds.includes(r.payload.rule) && r.payload.state === 'fired');
  const out = new Map<string, TriggerState>();
  const none = (note: string): TriggerState => ({ met: null, evidence: [], note });

  out.set('DP-0', none('Standing package: approved before the indications'));
  const ind = frags.filter((i) => i.associated && (INDICATION_CLASSES.has(i.cls) || i.sourceKind === 'probe'));
  out.set('DP-1', { met: ind.length > 0, evidence: [...new Set(ind.map((i) => i.entityId))], note: ind.length ? `${new Set(ind.map((i) => i.entityId)).size} indications on record` : 'No intelligence or probe indication yet' });
  const launch = frags.filter((i) => i.cls === 'launch_prep');
  const best = launch.reduce((b, i) => Math.max(b, CONFIDENCE_RANK[i.confidence] ?? 0), -1);
  const bestWord = Object.keys(CONFIDENCE_RANK).find((k) => CONFIDENCE_RANK[k] === best);
  out.set('DP-2', { met: launch.length ? best >= CONFIDENCE_RANK.confirmed! : false, evidence: [...new Set(launch.map((i) => i.entityId))], note: launch.length ? `Highest confidence on record: ${bestWord}` : 'No launch preparation reported' });
  const groups = derived.groups.filter((g) => g.group?.raid_id);
  const raid: TriggerState = { met: groups.length > 0, evidence: groups.map((g) => g.entity_id), note: groups.length ? `${groups.length} raid groups in the picture` : 'No raid detected' };
  out.set('DP-3', raid);
  out.set('DP-4', raid);
  const r43 = derived.rings.R4 + derived.rings.R3;
  out.set('DP-5', { met: r43 > 0, evidence: [], note: `${r43} hostile tracks in R4/R3` });
  const leak = fired('leaker_forecast', 'missile_appears');
  out.set('DP-6', { met: leak.length > 0, evidence: leak.map((r) => r.record_id), note: leak.length ? 'Leakage forecast or cruise missile rule fired' : 'No leakage forecast or cruise missile' });
  const sat = fired('saturation');
  out.set('DP-7', { met: sat.length > 0, evidence: sat.map((r) => r.record_id), note: sat.length ? 'Saturation rule fired' : 'No saturation' });
  const aim = [...client.entities.values()].filter((e) => e.geo_details?.type === 'aimpoint');
  out.set('DP-8', { met: aim.length > 0, evidence: aim.map((e) => e.entity_id), note: aim.length ? `${aim.length} predicted aimpoints` : 'No aimpoint forecast' });
  out.set('DP-9', { met: bda.length > 0, evidence: bda.map((r) => r.record_id), note: bda.length ? `${bda.length} BDA records` : 'No BDA yet' });
  out.set('DP-10', none('Not derivable from the picture'));
  out.set('DP-11', none('Not derivable from the picture'));
  out.set('DP-12', { met: bda.length > 0 && derived.hostile === 0, evidence: [], note: bda.length && derived.hostile === 0 ? 'Raid over: BDA on record, no hostile tracks' : 'Raid not over' });
  return out;
}

/** The strategic picture for `role` at the client's time. Pure: everything comes from the client. */
export function strategicPicture(client: MapClient, derived: Derived, role: string, indicationId?: string | null): StrategicPicture {
  const byId = new Map<string, JournalRecord>();
  const decisions: Array<JournalRecord<DecisionPayload>> = [];
  const fragments: Indication[] = [];
  for (const r of client.events) {
    byId.set(r.record_id, r);
    if (r.kind === 'decision') decisions.push(r as JournalRecord<DecisionPayload>);
    else if (r.kind === 'fragment') {
      const i = indicationOf(r);
      if (i) fragments.push(i);
    }
  }
  const layer = (ROLE_LAYER[role] ?? null) as Layer | null;
  const trig = triggers(client, derived);

  // Latest record per DP, and how many earlier ones are in view.
  const perDp = new Map<string, Array<JournalRecord<DecisionPayload>>>();
  for (const d of decisions) {
    let a = perDp.get(d.payload.dp);
    if (!a) perDp.set(d.payload.dp, (a = []));
    a.push(d);
  }
  const latestOf = (dp: string) => {
    const a = perDp.get(dp);
    return a?.length ? decisionItem(a[a.length - 1]!, byId, a.length - 1) : null;
  };
  const dps: DpState[] = DECISION_POINTS.map((def) => ({ def, trigger: trig.get(def.dp)!, latest: latestOf(def.dp), records: perDp.get(def.dp)?.length ?? 0 }));
  const plan = dps.map((s) => s.latest).filter((d): d is DecisionItem => !!d && IN_FORCE.has(d.status) && !DECISION_POINTS.find((x) => x.dp === d.dp)?.optionOnly);
  const dp0 = latestOf('DP-0');
  const dp1 = latestOf('DP-1');
  const dp2 = latestOf('DP-2');
  const dp2Rec = perDp.get('DP-2')?.at(-1);

  // The new event and its indication thread (latest record per entity; earlier ones are revisions).
  const event = (indicationId ? [...fragments].reverse().find((i) => i.entityId === indicationId || i.recordId === indicationId) : undefined) ?? fragments.at(-1) ?? null;
  const byEntity = new Map<string, Indication[]>();
  for (const i of fragments) {
    let a = byEntity.get(i.entityId);
    if (!a) byEntity.set(i.entityId, (a = []));
    a.push(i);
  }
  const threadId = event?.thread ?? null;
  const latestPer = [...byEntity.values()].map((a) => a[a.length - 1]!);
  const inThread = latestPer.filter((i) => i.thread === threadId).sort((a, b) => b.received - a.received);
  const thread = {
    id: threadId,
    items: inThread.filter((i) => i.associated),
    unassociated: latestPer.filter((i) => !i.associated).sort((a, b) => b.received - a.received),
    revisions: [...byEntity.entries()].filter(([, a]) => a.length > 1 && a[0]!.thread === threadId).map(([entityId, items]) => ({ entityId, items })),
    disagreements: [...byEntity.entries()]
      .filter(([, a]) => new Set(a.map((i) => i.sensor)).size > 1 && new Set(a.map((i) => i.confidence)).size > 1)
      .map(([entityId, a]) => ({ entityId, sources: [...new Set(a.map((i) => `${i.sensor}: ${i.confidence}`))] })),
  };

  let impact: StrategicPicture['impact'] = null;
  if (event) {
    const center = derived.center as LonLat;
    const inv = event.at ? inverse(center, event.at) : null;
    const evidences = dps.filter((s) => s.trigger.evidence.includes(event.entityId)).map((s) => s.def.dp);
    const decidedOn = decisions.filter((d) => (d.derived_from ?? []).includes(event.recordId) || (d.derived_from ?? []).some((id) => byId.get(id)?.entity_id === event.entityId)).map((d) => decisionItem(d, byId, 0));
    let sensors = 0;
    let sensorsUp = 0;
    for (const e of client.entities.values()) {
      if (!e.sensor || e.layer !== 'fused') continue;
      sensors++;
      if (e.sensor.status !== 'down' && e.health?.link !== 'down') sensorsUp++;
    }
    const units = derived.effectors.length;
    const unitsReady = derived.effectors.filter((e) => e.effector && e.effector.status !== 'down').length;
    impact = {
      rangeKm: inv ? inv.distance_m / 1000 : null,
      bearing: inv ? inv.azimuth_deg : null,
      atDefendedPoint: !!event.at && distance(center, event.at) / 1000 <= AT_VP_KM,
      evidences,
      decidedOn,
      readiness: { sensorsUp, sensors, unitsReady, units },
    };
  }

  // Permitted actions for the selected role: its duties, then decisions due. Never an option-only DP.
  const actions: Action[] = [];
  const elevated = decisions.filter((d) => layerOf(d.payload.layer) !== 'L3' && (d.derived_from ?? []).some((id) => byId.get(id)?.kind === 'fragment'));
  if (layer === 'L3') {
    const last = elevated.at(-1);
    actions.push(
      last
        ? { id: 'l3-elevate', title: 'Indication elevated', detail: `${last.payload.dp} recorded by ${last.author ?? last.payload.authority ?? last.payload.layer}`, state: 'done', evidence: [last.record_id] }
        : { id: 'l3-elevate', title: 'Review the indication and elevate it', detail: event ? `${thread.items.length} supporting fragments; elevate to L2` : 'No indication yet', state: event ? 'open' : 'review', evidence: thread.items.map((i) => i.entityId) },
    );
  }
  if (layer === 'L2') {
    actions.push(
      dp1 && dp1.layer === 'L2'
        ? { id: 'l2-posture', title: 'Posture assessed', detail: `${dp1.dp} ${dp1.title}`, state: 'done', dp: 'DP-1', evidence: [dp1.id] }
        : { id: 'l2-posture', title: 'Assess posture within authority', detail: 'Alert posture is DP-1 (L1/L2)', state: trig.get('DP-1')?.met ? 'due' : 'open', dp: 'DP-1', evidence: trig.get('DP-1')?.evidence ?? [] },
      { id: 'l2-draft', title: 'Draft changes to the package', detail: 'No package change pending; changes remain pending L1 approval', state: 'open', dp: 'DP-0', evidence: [] },
    );
  }
  if (layer === 'L1') {
    actions.push(
      dp0
        ? { id: 'l1-dp0', title: 'Review the recorded DP-0 approval', detail: `${dp0.author ?? dp0.authority ?? 'L1'} · package changes remain pending L1 approval`, state: 'review', dp: 'DP-0', evidence: [dp0.id] }
        : { id: 'l1-dp0', title: 'Review the DP-0 package', detail: 'No DP-0 record in this view', state: 'open', dp: 'DP-0', evidence: [] },
      dp1
        ? { id: 'l1-posture', title: 'National posture', detail: `${dp1.dp} in force: ${dp1.title}`, state: 'done', dp: 'DP-1', evidence: [dp1.id] }
        : { id: 'l1-posture', title: 'National posture', detail: 'Alert posture is DP-1 (L1/L2)', state: trig.get('DP-1')?.met ? 'due' : 'open', dp: 'DP-1', evidence: trig.get('DP-1')?.evidence ?? [] },
    );
  }
  if (layer) {
    for (const s of dps) {
      if (s.def.optionOnly || !s.def.owners.includes(layer) || s.trigger.met !== true || s.records) continue;
      if (actions.some((a) => a.dp === s.def.dp)) continue;
      actions.push({ id: `due-${s.def.dp}`, title: `Decision due: ${s.def.dp} ${s.def.decision}`, detail: `Trigger met: ${s.trigger.note}`, state: 'due', dp: s.def.dp, evidence: s.trigger.evidence });
    }
  }

  // The same indication at L3, L2 and L1: each level's plan, the change and the decisions it owns.
  const mine = ROLES[role]?.releasability ?? [];
  const ladder: LadderColumn[] = (['L3', 'L2', 'L1'] as Layer[]).map((lv) => {
    const def = LAYERS.find((l) => l.id === lv)!;
    const rel = ROLES[def.role!]!.releasability;
    const sees = (r?: string[]) => releasable(r, rel);
    const beyond = rel.filter((c) => !mine.includes(c));
    return {
      layer: lv,
      name: def.name,
      duty: DUTY[lv],
      plan: plan.filter((d) => sees(d.releasability)),
      change: thread.items.filter((i) => sees(i.releasability)),
      // The A4 decisions, then any other the level owns that is recorded or triggered.
      owns: DECISION_POINTS.filter((d) => d.owners.includes(lv) && (A4_DPS.has(d.dp) || perDp.has(d.dp) || trig.get(d.dp)?.met === true)).map((d) => {
        const last = latestOf(d.dp);
        const visible = !!last && sees(last.releasability);
        // "L1 only" decisions sit under caveats this session may not hold: say so, never guess.
        const status = visible ? last!.status : beyond.length && d.owner.endsWith('only') ? 'not releasable to this view' : trig.get(d.dp)?.met ? 'trigger met' : 'none on record';
        return { dp: d.dp, decision: d.decision, status, optionOnly: !!d.optionOnly };
      }),
      beyond,
    };
  });

  return {
    role,
    layer,
    dps,
    plan,
    intent: [dp0, dp1].filter((d): d is DecisionItem => !!d).map((d) => `${d.dp}: ${d.summary}`),
    event,
    thread,
    impact,
    actions,
    ladder,
    dp0,
    dp2: layer === 'L1' ? dp2 : null,
    dp2Options: layer === 'L1' && dp2Rec ? dp2Rec.payload.options.map((o) => ({ id: o.id, label: o.label })) : [],
    branches: 'No evaluated branch recorded for this situation',
  };
}

/** Records carried under a decision (from /api/consequences), grouped for display. */
export function groupConsequences(records: JournalRecord[]): Array<{ group: string; items: Array<{ id: string; entity?: string; title: string; at: number }> }> {
  const by = new Map<string, Array<{ id: string; entity?: string; title: string; at: number }>>();
  for (const r of records) {
    const group = r.kind === 'decision' ? 'Decisions' : r.kind === 'rule_fire' ? 'Rule firings' : r.kind === 'command' ? 'Control measures and rules' : r.kind === 'engagement' ? 'Engagements' : r.provenance.source_feed;
    const sum = eventSummary(r);
    const p = r.payload as EntityComponents & Partial<EngagementPayload>;
    const title = r.kind === 'fused' || r.kind === 'command' ? (p.aliases?.name ?? p.geo_details?.label ?? r.entity_id ?? sum.title) : sum.title;
    let a = by.get(group);
    if (!a) by.set(group, (a = []));
    a.push({ id: r.record_id, ...(r.entity_id ? { entity: r.entity_id } : {}), title, at: r.ingest_time });
  }
  return [...by.entries()].map(([group, items]) => ({ group, items }));
}
