/**
 * Pairing options for one target: every fire unit, judged the way the CONOP's pairing review
 * does (frames B3–B4) — weapon envelope, time until the target enters it, free channels,
 * rounds against the reserve floor and cost.
 *
 * Doctrine is a gate, never a weight: an option that fails the doctrine checker (soft kill and
 * cheap means first for the drone class, missiles for missiles) or the civilian-harm gate
 * (debris over Tier-1 plant) is shown with its reason and is never recommended. When no option
 * passes, none is recommended and the case goes to L3. Across targets, `commitChannels` gives
 * each fire channel to one target at a time in time-to-VP order, so the board never recommends
 * more engagements than there are channels. The machine recommends; the named authority decides.
 */
import { CLASSES, type Effector, type Entity, type LonLat } from '@me/schema';
import { distance } from '@me/geo';
import type { MapClient } from '@me/client';

/** Relative cost of one engagement (notional). */
const COST: Record<Effector['type'], { tier: number; word: string }> = {
  ew: { tier: 0, word: 'soft kill' },
  laser_dew: { tier: 1, word: 'directed energy' },
  cuas: { tier: 1, word: 'counter-UAS' },
  gun: { tier: 1, word: 'gun' },
  interceptor_drone: { tier: 1, word: 'interceptor drone' },
  vshorads: { tier: 2, word: 'VSHORADS missile' },
  sam_sr: { tier: 3, word: 'SR SAM' },
  sam_mr: { tier: 4, word: 'MR SAM' },
  fighter: { tier: 3, word: 'air-to-air missile' },
};

/** Debris from a hard kill this close to a Tier-1 unit can fall on it. */
const DEBRIS_KM = 2.5;

export type OptionVerdict = 'recommended' | 'alternative' | 'not-yet' | 'unavailable' | 'gated';

/** The gate an option fails: the doctrine checker, or civilian harm (debris over Tier-1). */
export type Gate = 'doctrine' | 'civil';

/** The doctrine checker: a fire-unit type against the target class (fast mover or drone class). */
export function doctrineFits(type: Effector['type'], fast: boolean): boolean {
  const tier = COST[type]?.tier ?? 0;
  return fast ? tier >= 3 : tier <= 2;
}

export function doctrineRule(fast: boolean): string {
  return fast ? 'missiles for missiles' : 'cheap means first for drones';
}

export function costWord(type: Effector['type']): string {
  return COST[type]?.word ?? type;
}

export interface PairingOption {
  effector: string;
  name: string;
  type: Effector['type'];
  costWord: string;
  costTier: number;
  rangeKm: number;
  inEnvelope: boolean;
  /** Minutes until the target enters the envelope (0 = inside now). */
  toEnvelopeMin: number | null;
  channelsFree: number;
  ready: number;
  floor: number;
  /** Rounds at or under the floor: needs the reserve released (DP-6). */
  atFloor: boolean;
  /** Passes the doctrine checker for this target class. */
  doctrineFit: boolean;
  debrisRisk: string | null;
  /** The gate this option fails; a gated option is never recommended. */
  gate: Gate | null;
  verdict: OptionVerdict;
  reasons: string[];
}

export interface Pairing {
  options: PairingOption[];
  recommended: PairingOption | null;
  /** After a soft kill, the hard kill to follow if the target keeps coming. */
  followOn: PairingOption | null;
  /** Why the recommended option was chosen (or why none is). */
  rationale: string;
  /** Tier-1 unit under the target now: a hard kill here drops debris on it. */
  debrisOver: string | null;
  /** Fast mover (missiles for missiles) rather than the drone class. */
  fast: boolean;
  /** Options pass the gates but every channel is committed to earlier targets. */
  saturated: boolean;
}

function tier1Near(p: LonLat, client: MapClient): string | null {
  for (const e of client.entities.values()) {
    if (e.layer !== 'reference' || e.geo_details?.tier !== 1 || e.entity_id === 'VP-RIL' || !e.geo_shape || e.geo_shape.type !== 'circle') continue;
    if (distance(p, e.geo_shape.center) / 1000 <= DEBRIS_KM + e.geo_shape.radius_m / 1000) return e.aliases?.name ?? e.entity_id;
  }
  return null;
}

const VERDICT_RANK: Record<OptionVerdict, number> = { recommended: 0, alternative: 0, 'not-yet': 1, unavailable: 2, gated: 3 };
const passes = (o: PairingOption) => o.verdict === 'alternative' || o.verdict === 'not-yet';

/** The options for target e at time t, best first. */
export function pairingFor(e: Entity, client: MapClient, t: number): Pairing {
  const tmp: [number, number, number] = [0, 0, 0];
  const pos = client.positionAt(e.entity_id, t, tmp);
  if (!pos) return { options: [], recommended: null, followOn: null, rationale: 'No position: pairing waits for a fix.', debrisOver: null, fast: false, saturated: false };
  const p: LonLat = [pos[0], pos[1]];
  const fast = !!CLASSES[e.ontology?.class ?? '']?.fast;
  const vel = e.location?.vel;
  const speedKmMin = vel ? (Math.hypot(vel.e, vel.n) * 60) / 1000 : 0;
  const debris = tier1Near(p, client);

  const options: PairingOption[] = [];
  for (const u of client.entities.values()) {
    const eff = u.effector;
    if (!eff || !u.location || !eff.wez) continue;
    const cost = COST[eff.type];
    // Soft kill works on the drone class only; it does not stop a missile.
    if (eff.type === 'ew' && fast) continue;
    const km = distance([u.location.lon, u.location.lat], p) / 1000;
    const min = eff.wez.min_m / 1000;
    const max = eff.wez.max_m / 1000;
    const inEnvelope = km >= min && km <= max;
    const toEnvelopeMin = inEnvelope ? 0 : km > max && speedKmMin > 0 ? (km - max) / speedKmMin : null;
    const channelsFree = Math.max(0, eff.channels.total - eff.channels.busy);
    const unlimited = eff.magazine.ready >= 900;
    const atFloor = !unlimited && eff.magazine.ready <= eff.magazine.floor;
    const doctrineFit = doctrineFits(eff.type, fast);
    const hardKill = eff.type !== 'ew';
    const debrisRisk = hardKill && debris && inEnvelope ? `Kill now would drop debris near ${debris}` : null;
    const gate: Gate | null = !doctrineFit ? 'doctrine' : debrisRisk ? 'civil' : null;

    const reasons: string[] = [];
    if (!doctrineFit) reasons.push(`Doctrine gate: ${doctrineRule(fast)}`);
    if (debrisRisk) reasons.push(`Civilian-harm gate: debris near ${debris}`);
    if (!inEnvelope) reasons.push(toEnvelopeMin !== null ? `Enters envelope in ${Math.max(1, Math.round(toEnvelopeMin))} min` : km < min ? 'Inside minimum range' : 'Out of envelope');
    if (!channelsFree) reasons.push('No free channel');
    if (atFloor) reasons.push('At reserve floor: needs DP-6 release');
    if (eff.status === 'down') reasons.push('Unit down');

    const unavailable = eff.status === 'down' || !channelsFree || atFloor || (!inEnvelope && toEnvelopeMin === null);
    const verdict: OptionVerdict = gate ? 'gated' : unavailable ? 'unavailable' : inEnvelope ? 'alternative' : 'not-yet';
    options.push({
      effector: u.entity_id,
      name: u.aliases?.callsign ?? u.aliases?.name ?? u.entity_id,
      type: eff.type,
      costWord: cost.word,
      costTier: cost.tier,
      rangeKm: km,
      inEnvelope,
      toEnvelopeMin,
      channelsFree,
      ready: unlimited ? Infinity : eff.magazine.ready,
      floor: eff.magazine.floor,
      atFloor,
      doctrineFit,
      debrisRisk,
      gate,
      verdict,
      reasons,
    });
  }

  // Through the gates first, then usable now, cheapest, soonest, deepest magazine.
  const rank = (o: PairingOption) => [VERDICT_RANK[o.verdict], o.costTier, o.toEnvelopeMin ?? 999, -(Number.isFinite(o.ready) ? o.ready - o.floor : 999)];
  options.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return a.rangeKm - b.rangeKm;
  });

  // Only an option through both gates can be recommended; a gate is never traded off.
  const best = options.find(passes) ?? null;
  if (best) best.verdict = 'recommended';
  return explain({ options, recommended: best, followOn: null, rationale: '', debrisOver: debris, fast, saturated: false });
}

/** Follow-on and rationale for the current recommendation. */
function explain(p: Pairing): Pairing {
  const best = p.recommended;
  const { fast, debrisOver: debris } = p;
  // Soft kill is not assured: name the hard kill that follows if the target keeps coming.
  p.followOn = best && best.costTier === 0 ? (p.options.find((o) => o !== best && o.costTier > 0 && passes(o)) ?? null) : null;
  if (!best) {
    const held = p.options.filter((o) => o.gate && (o.inEnvelope || o.toEnvelopeMin !== null));
    const byDoctrine = held.some((o) => o.gate === 'doctrine');
    p.rationale = p.saturated
      ? 'Saturated: every unit through the gates has its channels committed to targets nearer the VP. The target waits for a channel; this is the DP-7 condition.'
      : held.length
        ? `No option passes the ${byDoctrine ? 'doctrine' : 'civilian-harm'} gate: ${held.length} unit${held.length === 1 ? '' : 's'} in reach ${held.length === 1 ? 'is' : 'are'} held (${byDoctrine ? doctrineRule(fast) : `debris near ${debris}`}). Refer to L3; the board does not override a gate.`
        : 'No fire unit can take this target now: every option is out of envelope, saturated or at its reserve floor.';
  } else {
    const why = [best.inEnvelope ? 'inside its envelope now' : `in envelope in ${Math.max(1, Math.round(best.toEnvelopeMin ?? 0))} min`, `${best.channelsFree} channel${best.channelsFree === 1 ? '' : 's'} free`, fast ? 'missiles for missiles' : best.costTier === 0 ? 'soft kill before hard kill' : 'cheapest means through the gates'];
    p.rationale = `${best.name} (${best.costWord}): ${why.join(', ')}.${p.followOn ? ` If it keeps coming: ${p.followOn.name} (${p.followOn.costWord}).` : ''}${debris ? ` Target is over ${debris}: engage before it closes.` : ''}`;
  }
  return p;
}

/**
 * Commit one target's pairing against the channels left by earlier targets (the caller runs
 * targets in time-to-VP order and shares `left`). The recommendation goes to the first option
 * through the gates with a channel left; options whose channels are all committed become
 * unavailable. With none left, nothing is recommended and the target is saturated.
 */
export function commitChannels(p: Pairing, left: Map<string, number>): Pairing {
  let chosen: PairingOption | null = null;
  for (const o of p.options) {
    if (o.verdict !== 'recommended' && !passes(o)) continue;
    o.verdict = o.inEnvelope ? 'alternative' : 'not-yet';
    const n = left.get(o.effector) ?? o.channelsFree;
    o.channelsFree = n;
    if (n <= 0) {
      o.verdict = 'unavailable';
      o.reasons.push('Channels committed to earlier targets');
    } else if (!chosen) {
      chosen = o;
      left.set(o.effector, n - 1);
    }
  }
  if (chosen) chosen.verdict = 'recommended';
  const through = p.options.some((o) => o.reasons.includes('Channels committed to earlier targets'));
  return explain({ ...p, recommended: chosen, saturated: !chosen && through });
}
