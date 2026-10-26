/**
 * Derived picture statistics for panels (counts per layer key, age distribution, ring
 * occupancy, active rules). Recomputed at ≤4 Hz from the client store.
 */
import { useMemo } from 'react';
import { inverse } from '@me/geo';
import type { AgeState, Entity, JournalRecord, RuleFirePayload } from '@me/schema';
import type { MapClient } from '@me/client';
import { categorize, isThreat, type LayerKey } from '@me/map';
import { useClient, useClientTick, useEngineTime } from '@me/map-react';

export interface LayerStat {
  count: number;
  age: Record<AgeState, number>;
  /** Age of the most recently updated entity in the layer, and that entity's age state. */
  newestAge: number;
  newestState: AgeState;
}

export interface SourceStat {
  feed: string;
  agency?: string;
  count: number;
  newestAge: number;
  newestState: AgeState;
  /** Entities on the feed whose link is down or degraded. */
  linkIssues: number;
  /** Entities the feed updated in the last minute (its rate, per minute). */
  perMin: number;
  /** Every object on the feed is planned (command or reference layer): it does not age. */
  planned: boolean;
}

export interface Derived {
  t: number;
  byKey: Partial<Record<LayerKey, LayerStat>>;
  sources: SourceStat[];
  /** Fused tracks and own assets with a position (the "N TRACKS" figure). */
  tracks: number;
  hostile: number;
  contested: number;
  stale: number;
  rings: Record<'R4' | 'R3' | 'R2' | 'R1', number>;
  groups: Entity[];
  effectors: Entity[];
  activeRules: Array<JournalRecord<RuleFirePayload>>;
  center: [number, number];
}

const emptyAge = (): Record<AgeState, number> => ({ current: 0, aging: 0, stale: 0, disc: 0 });

export function computeDerived(client: MapClient, t: number): Derived {
  const center = (client.scenario?.center ?? [69.86, 22.36]) as [number, number];
  const byKey: Partial<Record<LayerKey, LayerStat>> = {};
  const bySource = new Map<string, SourceStat>();
  let tracks = 0;
  const rings = { R4: 0, R3: 0, R2: 0, R1: 0 };
  const groups: Entity[] = [];
  const effectors: Entity[] = [];
  let hostile = 0;
  let contested = 0;
  let stale = 0;
  for (const e of client.entities.values()) {
    const key = categorize(e);
    const st = (byKey[key] ??= { count: 0, age: emptyAge(), newestAge: Infinity, newestState: 'disc' });
    st.count++;
    const age = client.ageState(e.entity_id, t);
    st.age[age]++;
    const ageMs = t - e.source_time;
    if (ageMs < st.newestAge) {
      st.newestAge = ageMs;
      st.newestState = age;
    }
    const feed = e.provenance?.source_feed ?? 'Unattributed';
    let src = bySource.get(feed);
    if (!src) bySource.set(feed, (src = { feed, ...(e.provenance?.agency ? { agency: e.provenance.agency } : {}), count: 0, newestAge: Infinity, newestState: 'disc', linkIssues: 0, perMin: 0, planned: true }));
    if (e.layer !== 'command' && e.layer !== 'reference') src.planned = false;
    src.count++;
    if (ageMs < 60_000) src.perMin++;
    if (ageMs < src.newestAge) {
      src.newestAge = ageMs;
      src.newestState = age;
    }
    if (e.health && e.health.link !== 'up') src.linkIssues++;
    if (e.layer === 'fused' && e.location && (e.ontology?.template === 'track' || e.ontology?.template === 'asset')) tracks++;
    if (key === 'fused.groups') groups.push(e);
    if (e.ontology?.template === 'effector') effectors.push(e);
    if (e.classification?.contested) contested++;
    if (key.startsWith('fused') && (age === 'stale' || age === 'disc')) stale++;
    if (isThreat(e) && e.location && e.track?.state !== 'destroyed') {
      hostile++;
      const { distance_m } = inverse(center, [e.location.lon, e.location.lat]);
      const km = distance_m / 1000;
      if (km < 5) rings.R1++;
      else if (km < 20) rings.R2++;
      else if (km < 60) rings.R3++;
      else if (km < 150) rings.R4++;
    }
  }
  // Rules currently fired (last state per rule id).
  const ruleState = new Map<string, JournalRecord<RuleFirePayload>>();
  for (const r of client.events) if (r.kind === 'rule_fire') ruleState.set((r.payload as RuleFirePayload).rule_id, r as JournalRecord<RuleFirePayload>);
  const activeRules = [...ruleState.values()].filter((r) => r.payload.state === 'fired');
  groups.sort((a, b) => (b.group?.members.length ?? 0) - (a.group?.members.length ?? 0));
  effectors.sort((a, b) => (a.ontology?.class ?? '').localeCompare(b.ontology?.class ?? ''));
  const sources = [...bySource.values()].sort((a, b) => b.count - a.count);
  return { t, byKey, sources, tracks, hostile, contested, stale, rings, groups, effectors, activeRules, center };
}

export function useDerived(ms = 250): Derived {
  const client = useClient();
  const tick = useClientTick(ms);
  const t = useEngineTime(ms);
  const bucket = Math.floor(t / 1000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeDerived(client, t), [client, tick, bucket]);
}
