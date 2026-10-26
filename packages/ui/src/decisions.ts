/**
 * The decision record and delegation console (storyboard B5): every DP record at the picture
 * time with its named authority, and each standing delegation shown as an envelope. An
 * envelope is the condition as written, its current state read from the picture, and the log
 * of every engagement carried under it. Thresholds the documents leave open stay symbolic
 * (N, T): the UI does not supply missing thresholds. No replacement engagement is invented.
 */
import { type DecisionPayload, type EngagementPayload, type JournalRecord, type RuleFirePayload } from '@me/schema';
import type { MapClient } from '@me/client';
import type { Situation } from './situation.ts';

export interface EnvelopeEntry {
  id: string;
  target: string;
  effector: string;
  weapon: string;
  result: EngagementPayload['result'];
  at: number;
}

export interface Envelope {
  dp: string;
  title: string;
  /** `standing`: pre-authorised at DP-0, not invoked. `unseen`: no record releasable to this view. */
  state: 'standing' | 'unseen' | 'delegated' | 'released' | 'returned';
  /** Who holds the authority the envelope moves. */
  holder: string;
  condition: string;
  /** The condition read from the picture now. */
  now: { met: boolean; text: string };
  /** The record that opened the envelope (null while it stands unused). */
  record: { id: string; hash: string; at: number; authority?: string; author?: string } | null;
  closed?: { at: number; summary: string };
  logLabel: string;
  /** One line per target, latest result, newest first. */
  log: EnvelopeEntry[];
}

export interface DecisionRow {
  id: string;
  hash: string;
  dp: string;
  title: string;
  layer: string;
  status: DecisionPayload['status'];
  authority?: string;
  author?: string;
  at: number;
  summary: string;
  /** Targets engaged under this record. */
  executions: number;
}

export interface DecisionBook {
  envelopes: Envelope[];
  rows: DecisionRow[];
}

const MISSILE_TYPES = new Set(['sam_mr', 'sam_sr']);

/** Latest result per target, newest first. */
function perTarget(list: Array<JournalRecord<EngagementPayload>>): EnvelopeEntry[] {
  const by = new Map<string, EnvelopeEntry>();
  for (const r of list) {
    const p = r.payload;
    if (p.result === 'refused') continue;
    by.set(p.target_id, { id: r.record_id, target: p.target_id, effector: p.effector_id, weapon: p.weapon, result: p.result, at: r.ingest_time });
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}

export function decisionBook(client: MapClient, sit: Situation): DecisionBook {
  const decisions: Array<JournalRecord<DecisionPayload>> = [];
  const engagements: Array<JournalRecord<EngagementPayload>> = [];
  let leakRule: JournalRecord<RuleFirePayload> | null = null;
  for (const r of client.events) {
    if (r.kind === 'decision') decisions.push(r as JournalRecord<DecisionPayload>);
    else if (r.kind === 'engagement') engagements.push(r as JournalRecord<EngagementPayload>);
    else if (r.kind === 'rule_fire' && (r.payload as RuleFirePayload).rule === 'leaker_forecast') leakRule = r as JournalRecord<RuleFirePayload>;
  }
  const under = new Map<string, Set<string>>();
  for (const r of engagements) {
    const a = r.payload.authority_record;
    if (!a || r.payload.result === 'refused') continue;
    let s = under.get(a);
    if (!s) under.set(a, (s = new Set()));
    s.add(r.payload.target_id);
  }
  // Without DP-0 in view, a missing record says nothing about whether the envelope was used.
  const idle: Envelope['state'] = decisions.some((d) => d.payload.dp === 'DP-0') ? 'standing' : 'unseen';
  const rec = (d: JournalRecord<DecisionPayload>): Envelope['record'] => ({ id: d.record_id, hash: d.hash, at: d.ingest_time, ...(d.payload.authority ? { authority: d.payload.authority } : {}), ...(d.author ? { author: d.author } : {}) });

  // DP-7: inner-ring weapons free for the drone class, opened by the saturation condition.
  const dp7s = decisions.filter((d) => d.payload.dp === 'DP-7');
  const dp7Open = [...dp7s].reverse().find((d) => d.payload.status === 'delegated') ?? null;
  const dp7Last = dp7s[dp7s.length - 1] ?? null;
  const dp7State: Envelope['state'] = !dp7Last ? idle : dp7Last.payload.status === 'delegated' ? 'delegated' : 'returned';
  const satOver = sit.saturation.hostileR3 > sit.saturation.channels;
  const dp7: Envelope = {
    dp: 'DP-7',
    title: 'Inner-ring weapons free (drone class)',
    state: dp7State,
    holder: dp7State === 'delegated' ? 'L4/L5 · fire units' : 'L3 · AD Direction Centre',
    condition: 'Hostile tracks in R3 exceed fire-unit channels for N s · drone class, inner rings',
    now: { met: satOver, text: `${sit.saturation.hostileR3} hostile in R3 · ${sit.saturation.channels} channels` },
    record: dp7Open ? rec(dp7Open) : null,
    ...(dp7State === 'returned' && dp7Last ? { closed: { at: dp7Last.ingest_time, summary: dp7Last.payload.summary } } : {}),
    logLabel: 'Engagements under the delegation',
    log: dp7Open ? perTarget(engagements.filter((r) => r.payload.authority_record === dp7Open.record_id)) : [],
  };

  // DP-6: missile reserve release, opened by the leaker-forecast condition written at DP-0.
  const dp6 = [...decisions].reverse().find((d) => d.payload.dp === 'DP-6') ?? null;
  const threshold = typeof leakRule?.payload.threshold === 'number' || typeof leakRule?.payload.threshold === 'string' ? String(leakRule.payload.threshold) : 'T';
  const leakNow = sit.leakers.value !== null && sit.leakers.threshold !== null && sit.leakers.value > sit.leakers.threshold;
  const missileUnits = new Set<string>();
  for (const e of client.entities.values()) if (e.effector && MISSILE_TYPES.has(e.effector.type)) missileUnits.add(e.entity_id);
  const dp6Env: Envelope = {
    dp: 'DP-6',
    title: 'Missile reserve release',
    state: dp6 ? 'released' : idle,
    holder: 'L2 · condition written at DP-0',
    condition: `Leaker forecast above ${threshold} · reserve floors open on the missile units`,
    now: { met: leakNow, text: sit.leakers.value !== null ? `Forecast ${sit.leakers.value} · threshold ${sit.leakers.threshold ?? 'T'}` : 'No forecast yet' },
    record: dp6 ? rec(dp6) : null,
    logLabel: 'Missile engagements since release',
    log: dp6 ? perTarget(engagements.filter((r) => r.ingest_time >= dp6.ingest_time && missileUnits.has(r.payload.effector_id))) : [],
  };

  const rows: DecisionRow[] = [...decisions].reverse().map((d) => ({
    id: d.record_id,
    hash: d.hash,
    dp: d.payload.dp,
    title: d.payload.title,
    layer: d.payload.layer,
    status: d.payload.status,
    ...(d.payload.authority ? { authority: d.payload.authority } : {}),
    ...(d.author ? { author: d.author } : {}),
    at: d.ingest_time,
    summary: d.payload.summary,
    executions: under.get(d.record_id)?.size ?? 0,
  }));

  return { envelopes: [dp7, dp6Env], rows };
}
