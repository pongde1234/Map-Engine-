/**
 * Target board model: every threat track through the engagement chain, derived from the
 * picture and the journal as known at the picture time (nothing is stored here). Seven stages,
 * each entered through a named gate:
 *
 *   nominated    entry: detection, report or operator; identity still open
 *   identified   gate Identification: hostile, not contested
 *   prioritized  gate Time to VP: inside R3 or ≤ 15 min; no option through the gates, or no
 *                channel left (channels go to targets nearer the VP first)
 *   paired       gate Doctrine: an option passes doctrine and civilian harm, with a channel
 *                committed to it; pending approval
 *   approved     gate Release token: the order carries a named authority record
 *   executing    launched
 *   assessed     outcome recorded (kill, miss, deflected, withdrawn, leaked, impact)
 *
 * Each target carries the three card gates (identification, doctrine, civilian harm), the six
 * admission checks of tasking (origin, checker, channel, conflicts, ladder, release) and a
 * dossier checklist. The system carries orders; it never originates authority.
 */
import { CLASSES, type DecisionPayload, type EngagementPayload, type Entity, type GeoShape, type JournalRecord, type LonLat, type RuleFirePayload } from '@me/schema';
import { distance, pointInShape } from '@me/geo';
import type { MapClient } from '@me/client';
import { commitChannels, costWord, doctrineFits, doctrineRule, pairingFor, type Pairing } from './pairing.ts';
import { shortHash } from './format.ts';

export type Stage = 'nominated' | 'identified' | 'prioritized' | 'paired' | 'approved' | 'executing' | 'assessed';

export const STAGES: Array<{ id: Stage; label: string; gate: string; hint: string }> = [
  { id: 'nominated', label: 'Nominated', gate: 'Entry', hint: 'Detection, report or operator' },
  { id: 'identified', label: 'Identified', gate: 'Identification', hint: 'Hostile · outside R3 and 15 min' },
  { id: 'prioritized', label: 'Prioritized', gate: 'Time to VP', hint: 'Waiting on a gate or a channel' },
  { id: 'paired', label: 'Paired', gate: 'Doctrine', hint: 'Machine recommends · pending approval' },
  { id: 'approved', label: 'Approved', gate: 'Release token', hint: 'Named authority on record' },
  { id: 'executing', label: 'In execution', gate: 'Release', hint: 'Launched · in flight' },
  { id: 'assessed', label: 'Assessed', gate: 'Outcome', hint: 'Outcome recorded' },
];

/** Columns are subtractive by role: each view keeps the stages that role acts on. */
const ROLE_VIEW: Record<string, { label: string; stages?: Stage[] }> = {
  planning: { label: 'PLANNING' },
  l1: { label: 'L1' },
  l2: { label: 'L2' },
  l3: { label: 'L3' },
  // The plant acts on threat timing (DP-8 protective action), not on pairing or release.
  ril: { label: 'RIL', stages: ['prioritized', 'executing', 'assessed'] },
};

export interface BoardView {
  label: string;
  stages: Stage[];
}

export function viewFor(role: string | undefined): BoardView {
  const v = ROLE_VIEW[role ?? ''] ?? { label: (role ?? 'L3').toUpperCase() };
  return { label: v.label, stages: v.stages ?? STAGES.map((s) => s.id) };
}

export type CheckState = 'pass' | 'pending' | 'fail';

export interface Check {
  id: string;
  /** Short code on the card. */
  code: string;
  name: string;
  state: CheckState;
  note: string;
}

/** The order's authority record, shown as the release token. */
export interface ReleaseToken {
  dp: string;
  record: string;
  hash: string;
  /** Short code, e.g. "DP-5·3F9A2C". */
  code: string;
  /** Named person or appointment holding the authority. */
  authority: string;
  /** Who signed the record. */
  author?: string;
  layer: string;
  title: string;
  at: number;
  /** Standing delegation (DP-7) rather than an approval. */
  delegated: boolean;
}

/** Threat type, for filtering: the CONOP's drone class, fast movers (jets, missiles), decoys. */
export type ThreatKind = 'drone' | 'fast' | 'decoy' | 'other';

export interface Target {
  id: string;
  ref: string;
  axis?: string;
  wave?: string;
  kind: ThreatKind;
  /** The machine's recommended fire unit, through the gates (identified to paired). */
  recommended?: { name: string; effector: string; inEnvelope: boolean; toEnvelopeMin: number | null; followOn?: string };
  /** Every fire unit judged for this target, channels committed (identified to paired). */
  pairing?: Pairing;
  /** Options pass the gates but their channels went to targets nearer the VP. */
  saturated: boolean;
  /** Class, axis and wave, e.g. "One-way-attack drone · WEST · W2". */
  title: string;
  cls?: string;
  stage: Stage;
  priority?: 'P1' | 'P2' | 'P3';
  identity?: string;
  contested: boolean;
  ring?: 'R4' | 'R3' | 'R2' | 'R1';
  rangeKm?: number;
  etaMin?: number;
  effector?: string;
  token?: ReleaseToken;
  result?: string;
  updated: number;
  /** Identification · Doctrine · Civilian harm. */
  gates: Check[];
  /** Origin · Checker · Channel · Conflicts · Ladder · Release. */
  admission: Check[];
  dossier: Check[];
  /** The journal records about this target, oldest first. */
  history: JournalRecord[];
  /** Present in the picture now (assessed targets may have left it). */
  live: boolean;
}

const RING_KM: Array<['R1' | 'R2' | 'R3' | 'R4', number]> = [
  ['R1', 5],
  ['R2', 20],
  ['R3', 60],
  ['R4', 150],
];
const ENDED = new Set(['destroyed', 'impact', 'deflected', 'withdrawn', 'leaked', 'landed']);
const CIVIL_KM = 10;
/** Friendly manned or high-value air this close to a target is a fratricide conflict. */
const FRIENDLY_KM = 5;
const FRIENDLY_AIR = new Set(['fighter', 'aew']);
/** The layer each engagement DP sits at on the ladder. */
const DP_LAYER: Record<string, string> = { 'DP-5': 'L3', 'DP-7': 'L3' };
const ENGAGED = new Set(['assigned', 'launched', 'kill']);
/** An order or an outcome on record: pairing is over for that target. */
const ORDERED = new Set(['assigned', 'launched', 'kill', 'miss']);

function ringOf(km: number): Target['ring'] {
  return RING_KM.find(([, r]) => km <= r)?.[0];
}

function wcsAt(p: LonLat, client: MapClient): { wcs: 'free' | 'tight' | 'hold'; label: string } | null {
  for (const e of client.entities.values()) {
    if (e.geo_details?.type !== 'wcs_sector' || !e.geo_shape || !e.geo_details.wcs) continue;
    if (pointInShape(p, e.geo_shape as GeoShape)) return { wcs: e.geo_details.wcs, label: e.geo_details.label ?? e.entity_id };
  }
  return null;
}

interface Placed {
  name: string;
  p: LonLat;
}

function nearest(p: LonLat, list: Placed[]): { name: string; km: number } | null {
  let best: { name: string; km: number } | null = null;
  for (const q of list) {
    const km = distance(p, q.p) / 1000;
    if (!best || km < best.km) best = { name: q.name, km };
  }
  return best;
}

const check = (id: string, code: string, name: string, state: CheckState, note: string): Check => ({ id, code, name, state, note });

function tokenOf(r: JournalRecord<DecisionPayload>): ReleaseToken {
  return {
    dp: r.payload.dp,
    record: r.record_id,
    hash: r.hash,
    code: `${r.payload.dp}·${r.hash.slice(0, 6).toUpperCase()}`,
    authority: r.payload.authority ?? r.payload.layer,
    ...(r.author ? { author: r.author } : {}),
    layer: r.payload.layer,
    title: r.payload.title,
    at: r.ingest_time,
    delegated: r.payload.status === 'delegated',
  };
}

/** All targets known at t, by priority, then time to the VP, then newest change. */
export function deriveTargets(client: MapClient, t: number, center: LonLat): Target[] {
  // Journal records per target: engagements, BDA and rules naming it.
  const byTarget = new Map<string, JournalRecord[]>();
  const decisions = new Map<string, JournalRecord<DecisionPayload>>();
  let dp7: JournalRecord<DecisionPayload> | null = null;
  for (const r of client.events) {
    if (r.kind === 'decision') {
      const d = r as JournalRecord<DecisionPayload>;
      decisions.set(r.record_id, d);
      if (d.payload.dp === 'DP-7') dp7 = d;
    }
    const id = r.kind === 'engagement' ? (r.payload as EngagementPayload).target_id : r.kind === 'rule_fire' ? (r.payload as RuleFirePayload).subject_ids[0] : r.kind === 'bda' ? (r.payload as { target_id: string }).target_id : undefined;
    if (!id) continue;
    let list = byTarget.get(id);
    if (!list) byTarget.set(id, (list = []));
    list.push(r);
  }
  const delegated = (dp7 as JournalRecord<DecisionPayload> | null)?.payload.status === 'delegated';

  const tmp: [number, number, number] = [0, 0, 0];
  const kinematics = (id: string, e: Entity | undefined) => {
    const pos = e?.location ? client.positionAt(id, t, tmp) : null;
    const p: LonLat | null = pos ? [pos[0], pos[1]] : null;
    const km = p ? distance(center, p) / 1000 : undefined;
    const vel = e?.location?.vel;
    const speed = vel ? Math.hypot(vel.e, vel.n) : 0;
    const etaMin = km !== undefined && speed > 1 ? km / ((speed * 60) / 1000) : undefined;
    // Threat evaluation by time as well as range: a fast mover 5 min out outranks a drone in R3.
    const inWindow = km !== undefined && (km <= 60 || (etaMin !== undefined && etaMin <= 15));
    return { p, km, etaMin, inWindow };
  };
  const isCandidate = (e: Entity) =>
    e.layer === 'fused' && e.ontology?.template === 'track' && (!!CLASSES[e.ontology?.class ?? '']?.threat || e.mil_view?.identity === 'unknown' || e.mil_view?.identity === 'pending');

  // Pairing for every identified threat with no order yet. Inside the window, channels are
  // committed target by target in time-to-VP order: a channel recommended for one target is
  // not offered to the next, so the board never recommends more engagements than channels.
  const pairings = new Map<string, Pairing>();
  const queue: Array<{ id: string; eta: number; pair: Pairing }> = [];
  for (const e of client.entities.values()) {
    if (!isCandidate(e) || e.mil_view?.identity !== 'hostile' || e.classification?.contested) continue;
    if (e.track?.state && ENDED.has(e.track.state)) continue;
    if ((byTarget.get(e.entity_id) ?? []).some((r) => r.kind === 'engagement' && ORDERED.has((r.payload as EngagementPayload).result))) continue;
    const pair = pairingFor(e, client, t);
    pairings.set(e.entity_id, pair);
    const k = kinematics(e.entity_id, e);
    if (k.inWindow) queue.push({ id: e.entity_id, eta: k.etaMin ?? Infinity, pair });
  }
  queue.sort((a, b) => a.eta - b.eta);
  const left = new Map<string, number>();
  for (const q of queue) pairings.set(q.id, commitChannels(q.pair, left));

  // Civil and friendly air positions, once.
  const civil: Placed[] = [];
  const friendly: Placed[] = [];
  for (const e of client.entities.values()) {
    const c = e.ontology?.class ?? '';
    if (c !== 'civil_air' && !FRIENDLY_AIR.has(c)) continue;
    const q = client.positionAt(e.entity_id, t, tmp);
    if (!q) continue;
    (c === 'civil_air' ? civil : friendly).push({ name: e.aliases?.callsign ?? e.aliases?.name ?? e.entity_id, p: [q[0], q[1]] });
  }

  const out: Target[] = [];
  const seen = new Set<string>();
  const consider = (id: string, e: Entity | undefined) => {
    if (seen.has(id)) return;
    seen.add(id);
    const cls = e ? CLASSES[e.ontology?.class ?? ''] : undefined;
    const fast = !!cls?.fast;
    const kind: ThreatKind = cls?.id === 'decoy' ? 'decoy' : fast ? 'fast' : cls?.threat ? 'drone' : 'other';
    const droneClass = kind === 'drone' || kind === 'decoy';
    const history = byTarget.get(id) ?? [];
    const engagements = history.filter((r) => r.kind === 'engagement') as Array<JournalRecord<EngagementPayload>>;
    const last = engagements[engagements.length - 1];
    const refused = engagements.find((r) => r.payload.result === 'refused');
    const assigned = engagements.filter((r) => r.payload.result === 'assigned');
    const launched = engagements.find((r) => r.payload.result === 'launched');
    const order = assigned[assigned.length - 1] ?? launched;
    const authRec = order?.payload.authority_record;
    const auth = authRec ? decisions.get(authRec) : undefined;
    const token = auth ? tokenOf(auth) : undefined;

    const { p, km, etaMin, inWindow } = kinematics(id, e);
    const identity = e?.mil_view?.identity;
    const contested = !!e?.classification?.contested;
    const trackState = e?.track?.state;
    const idPass = identity === 'hostile' && !contested;
    // Pairing ran above, once identification passed and before an order exists.
    const pair = pairings.get(id) ?? null;
    const rec = pair?.recommended ?? null;

    let stage: Stage;
    let result: string | undefined;
    if (trackState && ENDED.has(trackState)) {
      stage = 'assessed';
      result = trackState;
    } else if (last && (last.payload.result === 'kill' || last.payload.result === 'miss')) {
      stage = 'assessed';
      result = last.payload.result;
    } else if (!e) {
      return; // left the picture with no recorded outcome: nothing to show
    } else if (launched) stage = 'executing';
    else if (assigned.length) stage = 'approved';
    else if (!idPass) stage = 'nominated';
    else if (!inWindow) stage = 'identified';
    else stage = rec ? 'paired' : 'prioritized';

    const priority: Target['priority'] = stage === 'prioritized' || stage === 'paired' || stage === 'approved' ? (etaMin !== undefined && etaMin <= 5 ? 'P1' : etaMin !== undefined && etaMin <= 12 ? 'P2' : 'P3') : undefined;

    // --- Card gates.
    const hyp = e?.classification?.hypotheses ?? [];
    // A track that has left the picture keeps the identification its order was issued on.
    const gId = !e && order
      ? check('id', 'ID', 'Identification', 'pass', 'Passed when ordered · track has left the picture')
      : check(
          'id',
          'ID',
          'Identification',
          idPass ? 'pass' : identity === 'friend' || identity === 'neutral' ? 'fail' : 'pending',
          idPass ? `Hostile, not contested${hyp[0] ? ` · ${hyp[0].label} ${Math.round(hyp[0].p * 100)}%` : ''}` : contested ? `Contested: ${hyp.slice(0, 2).map((h) => h.label).join(' vs ')}` : `Identity ${identity ?? 'unknown'}`,
        );

    // The doctrine checker: the ordered unit, else the machine's option, against the class.
    const orderedUnit = order ? client.entities.get(order.payload.effector_id) : undefined;
    const orderedType = orderedUnit?.effector?.type;
    let gDoc: Check;
    if (order && orderedType) {
      const fits = doctrineFits(orderedType, fast);
      gDoc = check('doc', 'DOC', 'Doctrine', fits ? 'pass' : 'fail', `${orderedUnit?.aliases?.callsign ?? order.payload.effector_id} (${costWord(orderedType)}): ${fits ? doctrineRule(fast) : `outside doctrine, ${doctrineRule(fast)}`}`);
    } else if (order) gDoc = check('doc', 'DOC', 'Doctrine', 'pass', `${order.payload.weapon} on record`);
    else if (!idPass) gDoc = check('doc', 'DOC', 'Doctrine', 'pending', 'Runs after identification');
    else if (rec) gDoc = check('doc', 'DOC', 'Doctrine', 'pass', `${rec.name} (${rec.costWord}): ${doctrineRule(fast)}`);
    else if (pair?.saturated) gDoc = check('doc', 'DOC', 'Doctrine', 'pass', `Options pass (${doctrineRule(fast)}); channels committed to targets nearer the VP`);
    else if (pair?.options.some((o) => o.gate === 'doctrine' && (o.inEnvelope || o.toEnvelopeMin !== null))) gDoc = check('doc', 'DOC', 'Doctrine', 'fail', `Units in reach fail the gate (${doctrineRule(fast)}): refer to L3`);
    else gDoc = check('doc', 'DOC', 'Doctrine', 'pending', 'No fire unit in reach yet');

    const civ = p ? nearest(p, civil) : null;
    const refusedOpen = refused && !engagements.some((r) => r.ingest_time > refused.ingest_time && ENGAGED.has(r.payload.result));
    const debrisHeld = !!pair && !rec && pair.options.some((o) => o.gate === 'civil');
    let gCiv: Check;
    if (refusedOpen) gCiv = check('civ', 'CIV', 'Civilian harm', 'fail', refused.payload.note ?? 'Engagement refused: debris footprint on a Tier-1 VP');
    else if (civ && civ.km < CIVIL_KM) gCiv = check('civ', 'CIV', 'Civilian harm', 'fail', `Civil ${civ.name} at ${civ.km.toFixed(1)} km`);
    else if (debrisHeld) gCiv = check('civ', 'CIV', 'Civilian harm', 'fail', `Any hard kill now drops debris on ${pair!.debrisOver}`);
    else if (refused) gCiv = check('civ', 'CIV', 'Civilian harm', 'pass', `${refused.payload.effector_id} refused (${refused.payload.note ?? 'debris'}); engaged clear of it`);
    else if (!p) gCiv = check('civ', 'CIV', 'Civilian harm', stage === 'assessed' ? 'pass' : 'pending', stage === 'assessed' ? 'No refusal on record' : 'No position');
    else gCiv = check('civ', 'CIV', 'Civilian harm', 'pass', `No civil track within ${CIVIL_KM} km${pair?.debrisOver ? ` · over ${pair.debrisOver}: soft kill or engage before it closes` : ''}`);
    const gates = [gId, gDoc, gCiv];

    // --- Admission checks (tasking): origin, checker, channel, conflicts, ladder, release.
    const first = history[0];
    const origin = e
      ? check('origin', 'ORG', 'Origin', 'pass', `${e.provenance.integration === 'console' ? 'Operator nomination' : e.provenance.source_feed} · record ${shortHash(e.last_hash)}`)
      : first
        ? check('origin', 'ORG', 'Origin', 'pass', `${first.provenance.source_feed} · record ${shortHash(first.hash)}`)
        : check('origin', 'ORG', 'Origin', 'pending', 'No track record');
    const checker = { ...gDoc, id: 'checker', code: 'CHK', name: 'Checker' };

    let channel: Check;
    if (!order) channel = check('channel', 'CHN', 'Channel', 'pending', 'No order on record');
    else if (!token) channel = check('channel', 'CHN', 'Channel', 'fail', 'The order carries no authority record');
    else if (DP_LAYER[token.dp] && token.layer !== DP_LAYER[token.dp]) channel = check('channel', 'CHN', 'Channel', 'fail', `${token.dp} issued at ${token.layer}; the ladder places it at ${DP_LAYER[token.dp]}`);
    else channel = check('channel', 'CHN', 'Channel', 'pass', `${token.dp} from ${token.layer}${token.delegated ? ' → L4/L5 (delegated)' : ''} · record ${shortHash(token.hash)}`);

    const units = [...new Set(assigned.map((r) => r.payload.effector_id))];
    const ally = p ? nearest(p, friendly) : null;
    const conflicts =
      units.length > 1 && stage !== 'assessed'
        ? check('conflicts', 'CNF', 'Conflicts', 'fail', `Two units on one target: ${units.join(', ')}`)
        : contested
          ? check('conflicts', 'CNF', 'Conflicts', 'fail', 'Identification contested')
          : ally && ally.km < FRIENDLY_KM && stage !== 'assessed'
            ? check('conflicts', 'CNF', 'Conflicts', 'fail', `Friendly ${ally.name} at ${ally.km.toFixed(1)} km`)
            : check('conflicts', 'CNF', 'Conflicts', 'pass', `No double assignment, contest or friendly air within ${FRIENDLY_KM} km`);

    const inner = km !== undefined && km <= 60;
    let ladder: Check;
    if (token?.dp === 'DP-7') ladder = droneClass ? check('ladder', 'LDR', 'Ladder', 'pass', 'Inside DP-7: drone class, inner rings · L4/L5 engage') : check('ladder', 'LDR', 'Ladder', 'fail', 'DP-7 covers the drone class only');
    else if (token) ladder = check('ladder', 'LDR', 'Ladder', 'pass', `Approved at ${token.layer} under ${token.dp}`);
    else if (delegated && droneClass && inner) ladder = check('ladder', 'LDR', 'Ladder', 'pass', 'DP-7 in force: fire units hold authority for this target');
    else if (delegated && !droneClass) ladder = check('ladder', 'LDR', 'Ladder', 'pending', 'DP-7 covers the drone class only: L3 approval (DP-5)');
    else ladder = check('ladder', 'LDR', 'Ladder', 'pending', 'L3 approval needed (DP-5)');

    const release = launched
      ? check('release', 'REL', 'Release', 'pass', `Released by ${launched.payload.effector_id} · ${launched.payload.weapon}`)
      : token
        ? check('release', 'REL', 'Release', 'pending', 'Token issued · awaiting release by the fire unit')
        : check('release', 'REL', 'Release', 'pending', 'No token: release waits for approval');
    const admission = [origin, checker, channel, conflicts, ladder, release];

    // --- Dossier checklist.
    const sensors = e?.track?.contributing ?? [];
    const wcs = p ? wcsAt(p, client) : null;
    const outcomeBad = result === 'leaked' || result === 'impact' || result === 'miss';
    const dossier: Check[] = [
      { ...origin, id: 'd-track', name: 'Track record' },
      { ...gId, id: 'd-id', name: 'Identification basis' },
      check('d-src', 'SRC', 'Source evidence', sensors.length >= 2 ? 'pass' : 'pending', sensors.length >= 2 ? `${sensors.length} sensors · ${sensors.slice(0, 3).join(', ')}` : sensors.length ? `Single source · ${sensors[0]}` : 'No contributing sensor on the track'),
      check(
        'd-wcs',
        'WCS',
        'Weapons control at position',
        !wcs ? 'pending' : wcs.wcs === 'free' ? 'pass' : wcs.wcs === 'tight' ? (idPass ? 'pass' : 'pending') : 'fail',
        !wcs ? (p ? 'Outside the weapons-control sectors' : 'No position') : `${wcs.label} (${wcs.wcs})${wcs.wcs === 'tight' && !idPass ? ': positive identification needed' : ''}`,
      ),
      check('d-civ', 'CIV', 'Civil picture', !p ? 'pending' : civ && civ.km < CIVIL_KM ? 'fail' : 'pass', !p ? 'No position' : civ && civ.km < CIVIL_KM ? `Civil ${civ.name} at ${civ.km.toFixed(1)} km` : `No civil track within ${CIVIL_KM} km`),
      check('d-deb', 'DEB', 'Debris footprint', refusedOpen || debrisHeld ? 'fail' : 'pass', refused ? (refused.payload.note ?? 'Engagement refused for debris') : pair?.debrisOver ? `Over ${pair.debrisOver}` : 'Clear of Tier-1 units'),
      check('d-pair', 'PAIR', 'Pairing', order || rec ? 'pass' : 'pending', order ? `${order.payload.effector_id} · ${order.payload.weapon}` : rec ? `${rec.name} recommended · pending approval` : pair?.saturated ? 'Saturated: no channel left' : 'No option through the gates'),
      check('d-auth', 'AUTH', 'Authority', token ? 'pass' : 'pending', token ? `${token.authority} · ${token.layer}` : 'Not approved'),
      check('d-token', 'TOK', 'Release token', token ? 'pass' : 'pending', token ? token.code : 'Not issued'),
      check('d-out', 'OUT', 'Outcome', result ? (outcomeBad ? 'fail' : 'pass') : 'pending', result ? `${result}${last?.payload.effector_id && (result === 'kill' || result === 'miss') ? ` · ${last.payload.effector_id}` : ''}` : 'Open'),
    ];

    const name = cls?.label ?? (last ? `Engaged by ${last.payload.weapon}` : 'Track');
    const recFollow = pair?.followOn ?? null;
    const where = [e?.track?.axis, e?.track?.wave].filter(Boolean).join(' · ');
    out.push({
      id,
      ref: e?.aliases?.track_number ?? id,
      title: where ? `${name} · ${where}` : name,
      ...(e?.track?.axis ? { axis: e.track.axis } : {}),
      ...(e?.track?.wave ? { wave: e.track.wave } : {}),
      kind,
      ...(rec ? { recommended: { name: rec.name, effector: rec.effector, inEnvelope: rec.inEnvelope, toEnvelopeMin: rec.toEnvelopeMin, ...(recFollow ? { followOn: recFollow.name } : {}) } } : {}),
      ...(pair ? { pairing: pair } : {}),
      saturated: !!pair?.saturated,
      ...(cls ? { cls: cls.abbr } : {}),
      stage,
      ...(priority ? { priority } : {}),
      ...(identity ? { identity } : {}),
      contested,
      ...(km !== undefined ? { ring: ringOf(km), rangeKm: km } : {}),
      ...(etaMin !== undefined && stage !== 'assessed' ? { etaMin } : {}),
      ...(last ? { effector: last.payload.effector_id } : {}),
      ...(token ? { token } : {}),
      ...(result ? { result } : {}),
      updated: Math.max(e?.source_time ?? 0, history[history.length - 1]?.ingest_time ?? 0),
      gates,
      admission,
      dossier,
      history,
      live: !!e,
    });
  };

  for (const e of client.entities.values()) if (isCandidate(e)) consider(e.entity_id, e);
  // Targets with a recorded outcome that have since left the picture.
  for (const id of byTarget.keys()) if (!client.entities.has(id)) consider(id, undefined);

  const rank = { P1: 0, P2: 1, P3: 2 } as const;
  return out.sort((a, b) => (a.priority && b.priority ? rank[a.priority] - rank[b.priority] : 0) || (a.etaMin ?? Infinity) - (b.etaMin ?? Infinity) || b.updated - a.updated);
}
