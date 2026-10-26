/**
 * The air-defence situation at the picture time, in the terms the CONOP decides on:
 * saturation (hostile tracks in R3 against fire channels, DP-7), the leaker forecast against
 * its threshold (DP-6), who holds engagement authority (the latest delegation in force),
 * magazine depth against reserve floors, and the time to the first impact on the defended
 * point. Everything is read from the picture and the journal; nothing is assumed.
 */
import type { DecisionPayload, JournalRecord, RuleFirePayload } from '@me/schema';
import type { MapClient } from '@me/client';
import type { Derived } from './derived.ts';
import type { Target } from './targets.ts';

export interface Situation {
  saturation: { hostileR3: number; channels: number; busy: number; fired: boolean };
  leakers: { value: number | null; threshold: number | null; fired: boolean };
  authority: { holder: string; detail: string; dp: string | null; since: number | null; delegated: boolean };
  magazines: { ready: number; capacity: number; atFloor: number; units: number };
  /** Minutes to the first hostile reaching the defended point (null: none inbound). */
  firstImpactMin: number | null;
  firstImpactRef: string | null;
  /** Identity of that track: an unknown one minutes out is the case to raise. */
  firstImpactIdentity: string | null;
}

function latestRule(events: JournalRecord[], rule: RuleFirePayload['rule']): JournalRecord<RuleFirePayload> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const r = events[i]!;
    if (r.kind === 'rule_fire' && (r.payload as RuleFirePayload).rule === rule) return r as JournalRecord<RuleFirePayload>;
  }
  return null;
}

export function situationOf(client: MapClient, derived: Derived, targets: Target[]): Situation {
  const events = client.events;
  let channels = 0;
  let busy = 0;
  let ready = 0;
  let capacity = 0;
  let atFloor = 0;
  let units = 0;
  for (const e of derived.effectors) {
    const eff = e.effector;
    if (!eff) continue;
    if (eff.type === 'interceptor_drone') {
      channels += eff.channels.total;
      busy += eff.channels.busy;
    }
    if (eff.magazine.ready >= 900) continue;
    units++;
    ready += eff.magazine.ready;
    capacity += eff.magazine.capacity ?? eff.magazine.ready + eff.magazine.reserve;
    if (eff.magazine.ready <= eff.magazine.floor) atFloor++;
  }

  const sat = latestRule(events, 'saturation');
  const leak = latestRule(events, 'leaker_forecast');

  // Authority: the latest DP-7 record decides whether engagement authority is delegated.
  let authority: Situation['authority'] = { holder: 'L3 · AD Direction Centre', detail: 'Engagement authority held at L3', dp: null, since: null, delegated: false };
  for (let i = events.length - 1; i >= 0; i--) {
    const r = events[i]!;
    if (r.kind !== 'decision') continue;
    const d = r.payload as DecisionPayload;
    if (d.dp !== 'DP-7') continue;
    authority =
      d.status === 'delegated'
        ? { holder: 'L4/L5 · fire units', detail: `${d.title} · ${d.authority ?? ''}`.trim(), dp: d.dp, since: r.ingest_time, delegated: true }
        : { holder: 'L3 · AD Direction Centre', detail: d.title, dp: d.dp, since: r.ingest_time, delegated: false };
    break;
  }

  let firstImpactMin: number | null = null;
  let firstImpactRef: string | null = null;
  let firstImpactIdentity: string | null = null;
  for (const t of targets) {
    if (t.stage === 'assessed' || t.etaMin === undefined) continue;
    if (t.identity === 'friend' || t.identity === 'assumed_friend' || t.identity === 'neutral') continue;
    if (firstImpactMin === null || t.etaMin < firstImpactMin) {
      firstImpactMin = t.etaMin;
      firstImpactRef = t.ref;
      firstImpactIdentity = t.identity ?? null;
    }
  }

  return {
    saturation: { hostileR3: derived.rings.R3, channels, busy, fired: sat?.payload.state === 'fired' },
    leakers: {
      value: leak?.payload.value ?? null,
      threshold: typeof leak?.payload.threshold === 'number' ? leak.payload.threshold : null,
      fired: leak?.payload.state === 'fired',
    },
    authority,
    magazines: { ready, capacity, atFloor, units },
    firstImpactMin,
    firstImpactRef,
    firstImpactIdentity,
  };
}
