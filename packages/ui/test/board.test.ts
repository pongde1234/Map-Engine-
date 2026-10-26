import { describe, expect, it } from 'vitest';
import type { Entity, JournalRecord } from '@me/schema';
import { MapClient } from '@me/client';
import { deriveTargets, viewFor } from '../src/targets.ts';
import { decisionBook } from '../src/decisions.ts';
import { situationOf } from '../src/situation.ts';
import { answer } from '../src/assistant.ts';
import { pairingFor } from '../src/pairing.ts';
import type { Derived } from '../src/derived.ts';

const VP: [number, number] = [69.86, 22.36];
const T = 1_000_000;

function track(id: string, lon: number, identity: 'hostile' | 'suspect' | 'pending', extra: Partial<Entity> = {}): Entity {
  return {
    entity_id: id,
    layer: 'fused',
    is_live: true,
    source_time: T,
    ingest_time: T,
    version: 1,
    history: [],
    last_hash: 'h',
    label: 'SYNTHETIC//DEMO',
    provenance: { integration: 'test', source_feed: 'Test feed' },
    ontology: { template: 'track', class: 'owa_drone' },
    mil_view: { identity, environment: 'air', sidc: '10060100001103000100', context: 'reality' },
    location: { lon, lat: VP[1], hae: 100, vel: { e: 40, n: 0, u: 0 } },
    aliases: { track_number: id },
    ...extra,
  } as Entity;
}

function engagement(i: number, target: string, result: string, t: number, authority?: string, effector = 'B-VSH1'): JournalRecord {
  return {
    seq: i,
    record_id: `e${i}`,
    kind: 'engagement',
    layer: 'event',
    source_time: t,
    ingest_time: t,
    provenance: { integration: 'test', source_feed: 'Test feed' },
    label: 'SYNTHETIC//DEMO',
    payload: { effector_id: effector, target_id: target, weapon: 'VSHORADS missile', result, ...(authority ? { authority_record: authority } : {}) },
    prev_hash: '',
    hash: `h${i}`,
  } as JournalRecord;
}

function decision(id: string, dp: string, status: string, t: number, authority: string, author?: string): JournalRecord {
  return {
    seq: 0,
    record_id: id,
    kind: 'decision',
    layer: 'event',
    source_time: t,
    ingest_time: t,
    provenance: { integration: 'test', source_feed: 'Command' },
    label: 'SYNTHETIC//DEMO',
    ...(author ? { author } : {}),
    payload: { dp, title: dp, layer: 'L3', status, authority, summary: '', options: [] },
    prev_hash: '',
    hash: `abc123${id}`,
  } as JournalRecord;
}

function clientWith(entities: Entity[], events: JournalRecord[]): MapClient {
  const c = new MapClient({ url: 'ws://unused' });
  for (const e of entities) (c as unknown as { upsert(e: Entity): void }).upsert(e);
  c.events = events;
  return c;
}

describe('target board', () => {
  it('places each threat at its stage in the engagement chain', () => {
    const c = clientWith(
      [
        track('F-1', 69.4, 'hostile'), // ~47 km west: inside R3, unassigned
        track('F-2', 68.0, 'hostile'), // ~190 km: outside R3
        track('F-3', 69.5, 'pending'),
        track('F-4', 69.6, 'hostile'),
        track('F-5', 69.7, 'hostile'),
      ],
      [engagement(1, 'F-4', 'assigned', T - 5000), engagement(2, 'F-5', 'assigned', T - 9000), engagement(3, 'F-5', 'launched', T - 4000), engagement(4, 'F-9', 'kill', T - 1000)],
    );
    const stage = Object.fromEntries(deriveTargets(c, T, VP).map((t) => [t.id, t.stage]));
    // F-1 is in the window with no fire unit in reach: prioritized, not paired.
    expect(stage).toEqual({ 'F-1': 'prioritized', 'F-2': 'identified', 'F-3': 'nominated', 'F-4': 'approved', 'F-5': 'executing', 'F-9': 'assessed' });
  });

  it('marks identification pending while a track is contested', () => {
    const c = clientWith([track('F-1', 69.4, 'hostile', { classification: { hypotheses: [], contested: true, margin: 0.1 } })], []);
    const [t] = deriveTargets(c, T, VP);
    expect(t!.stage).toBe('nominated');
    expect(t!.gates.find((x) => x.id === 'id')!.state).toBe('pending');
    expect(t!.admission.find((x) => x.id === 'conflicts')!.state).toBe('fail');
  });
});

describe('assistant', () => {
  const derived = { t: T, byKey: {}, sources: [], tracks: 1, hostile: 1, contested: 0, stale: 0, rings: { R4: 0, R3: 1, R2: 0, R1: 0 }, groups: [], effectors: [], activeRules: [], center: VP } as Derived;

  it('describes the picture but never proposes a target or course of action', () => {
    const a = answer('Which target should we engage first?', clientWith([track('F-1', 69.4, 'hostile')], []), derived);
    expect(a.tools).toEqual([]);
    expect(a.text).toMatch(/do not propose targets or courses of action/);
  });

  it('answers track questions through a visible tool call', () => {
    const a = answer('Which tracks are hostile right now?', clientWith([track('F-1', 69.4, 'hostile')], []), derived);
    expect(a.tools[0]!.name).toBe('query_tracks');
    expect((a.tools[0]!.output as { count: number }).count).toBe(1);
    expect(a.cites).toEqual(['F-1']);
  });
});


function unit(id: string, type: string, lon: number, lat: number, wezKm: [number, number], extra: { ready?: number; floor?: number; total?: number; busy?: number } = {}): Entity {
  return {
    entity_id: id,
    layer: 'fused',
    is_live: true,
    source_time: T,
    ingest_time: T,
    version: 1,
    history: [],
    last_hash: 'h',
    label: 'SYNTHETIC//DEMO',
    provenance: { integration: 'test', source_feed: 'Force state' },
    ontology: { template: 'effector', class: type },
    location: { lon, lat, hae: 0 },
    aliases: { callsign: id },
    effector: {
      type,
      channels: { total: extra.total ?? 2, busy: extra.busy ?? 0 },
      magazine: { ready: extra.ready ?? 10, reserve: 0, floor: extra.floor ?? 2, capacity: 12 },
      status: 'ready',
      wez: { min_m: wezKm[0] * 1000, max_m: wezKm[1] * 1000 },
    },
  } as unknown as Entity;
}

describe('pairing doctrine', () => {
  // Target 30 km west of the VP; SAM and EW in range, guns and interceptors near.
  const units = [
    unit('EW', 'ew', 69.6, 22.36, [0, 110], { ready: 999, total: 6 }),
    unit('INT', 'interceptor_drone', 69.6, 22.36, [0, 50]),
    unit('SAM', 'sam_mr', 69.8, 22.36, [3, 60], { total: 4 }),
    unit('GUN', 'gun', 69.85, 22.36, [0, 4]),
  ];

  it('drones: soft kill first, with a hard kill named to follow', () => {
    const c = clientWith([track('F-1', 69.57, 'hostile'), ...units], []);
    const p = pairingFor(c.entities.get('F-1')!, c, T);
    expect(p.recommended?.effector).toBe('EW');
    expect(p.followOn?.effector).toBe('INT');
    expect(p.options.find((o) => o.effector === 'SAM')!.doctrineFit).toBe(false);
  });

  it('missiles for missiles: no soft kill, a SAM is recommended', () => {
    const cm = track('F-2', 69.57, 'hostile', { ontology: { template: 'track', class: 'cruise_missile' } } as Partial<Entity>);
    const c = clientWith([cm, ...units], []);
    const p = pairingFor(c.entities.get('F-2')!, c, T);
    expect(p.options.some((o) => o.effector === 'EW')).toBe(false);
    expect(p.recommended?.effector).toBe('SAM');
  });

  it('a unit at its reserve floor is unavailable until the reserve is released', () => {
    const c = clientWith([track('F-1', 69.57, 'hostile'), unit('INT', 'interceptor_drone', 69.6, 22.36, [0, 50], { ready: 2, floor: 2 })], []);
    const o = pairingFor(c.entities.get('F-1')!, c, T).options[0]!;
    expect(o.verdict).toBe('unavailable');
    expect(o.reasons.join(' ')).toMatch(/DP-6/);
  });
});

describe('doctrine is a gate', () => {
  const cm = (id: string) => track(id, 69.57, 'hostile', { ontology: { template: 'track', class: 'cruise_missile' } } as Partial<Entity>);

  it('drone-class options fail the gate for a fast mover: nothing is recommended', () => {
    const c = clientWith([cm('F-2'), unit('INT', 'interceptor_drone', 69.6, 22.36, [0, 50]), unit('GUN', 'gun', 69.58, 22.36, [0, 4])], []);
    const p = pairingFor(c.entities.get('F-2')!, c, T);
    expect(p.recommended).toBeNull();
    expect(p.options.every((o) => o.verdict === 'gated' && o.gate === 'doctrine')).toBe(true);
    expect(p.rationale).toMatch(/doctrine gate/);
    const [x] = deriveTargets(c, T, VP);
    expect(x!.stage).toBe('prioritized');
    expect(x!.gates.find((g) => g.id === 'doc')!.state).toBe('fail');
  });

  it('a drone in the window with a unit through the gates is paired, the SAM gated', () => {
    const c = clientWith([track('F-1', 69.57, 'hostile'), unit('INT', 'interceptor_drone', 69.6, 22.36, [0, 50]), unit('SAM', 'sam_mr', 69.8, 22.36, [3, 60], { total: 4 })], []);
    const p = pairingFor(c.entities.get('F-1')!, c, T);
    expect(p.recommended?.effector).toBe('INT');
    expect(p.options.find((o) => o.effector === 'SAM')!.verdict).toBe('gated');
    const [x] = deriveTargets(c, T, VP);
    expect(x!.stage).toBe('paired');
    expect(x!.recommended?.effector).toBe('INT');
    expect(x!.gates.map((g) => g.state)).toEqual(['pass', 'pass', 'pass']);
  });
});

describe('release token and ladder', () => {
  it('an order under DP-5 is approved with a token naming the officer', () => {
    const d = decision('D5', 'DP-5', 'approved', T - 60_000, 'Col. R. Rathi (named release)', 'Col. R. Rathi · releasing officer (L3)');
    const c = clientWith([track('F-1', 69.57, 'hostile')], [d, engagement(1, 'F-1', 'assigned', T - 5000, 'D5')]);
    const [x] = deriveTargets(c, T, VP);
    expect(x!.stage).toBe('approved');
    expect(x!.token?.authority).toBe('Col. R. Rathi (named release)');
    expect(x!.token?.author).toMatch(/releasing officer/);
    expect(x!.token?.code).toMatch(/^DP-5·/);
    const state = Object.fromEntries(x!.admission.map((a) => [a.id, a.state]));
    expect(state).toMatchObject({ origin: 'pass', channel: 'pass', ladder: 'pass', release: 'pending' });
  });

  it('an order with no authority record fails the channel check', () => {
    const c = clientWith([track('F-1', 69.57, 'hostile')], [engagement(1, 'F-1', 'assigned', T - 5000)]);
    const [x] = deriveTargets(c, T, VP);
    expect(x!.stage).toBe('approved');
    expect(x!.admission.find((a) => a.id === 'channel')!.state).toBe('fail');
  });

  it('under DP-7 the ladder passes for a drone in the inner rings, not for a cruise missile', () => {
    const d7 = decision('D7', 'DP-7', 'delegated', T - 60_000, 'Pre-authorised at DP-0 · L3 → L4/L5');
    const cm = track('F-2', 69.57, 'hostile', { ontology: { template: 'track', class: 'cruise_missile' } } as Partial<Entity>);
    const c = clientWith([track('F-1', 69.57, 'hostile'), cm], [d7]);
    const ladder = Object.fromEntries(deriveTargets(c, T, VP).map((x) => [x.id, x.admission.find((a) => a.id === 'ladder')!.state]));
    expect(ladder).toEqual({ 'F-1': 'pass', 'F-2': 'pending' });
  });
});

describe('board views and the delegation console', () => {
  it('columns are subtractive by role', () => {
    expect(viewFor('l3').stages).toHaveLength(7);
    expect(viewFor('ril').stages).toEqual(['prioritized', 'executing', 'assessed']);
  });

  it('the DP-7 envelope logs the engagements carried under it', () => {
    const d7 = decision('D7', 'DP-7', 'delegated', T - 60_000, 'Pre-authorised at DP-0 · L3 → L4/L5');
    const c = clientWith(
      [track('F-1', 69.57, 'hostile')],
      [d7, engagement(1, 'F-1', 'assigned', T - 50_000, 'D7', 'INT'), engagement(2, 'F-1', 'kill', T - 10_000, 'D7', 'INT'), engagement(3, 'F-7', 'assigned', T - 9000, 'D5')],
    );
    const derived = { t: T, byKey: {}, sources: [], tracks: 1, hostile: 1, contested: 0, stale: 0, rings: { R4: 0, R3: 9, R2: 0, R1: 0 }, groups: [], effectors: [], activeRules: [], center: VP } as Derived;
    const book = decisionBook(c, situationOf(c, derived, deriveTargets(c, T, VP)));
    const dp7 = book.envelopes.find((e) => e.dp === 'DP-7')!;
    expect(dp7.state).toBe('delegated');
    expect(dp7.now.met).toBe(true);
    expect(dp7.log).toEqual([expect.objectContaining({ target: 'F-1', result: 'kill' })]);
    expect(book.rows.find((r) => r.id === 'D7')!.executions).toBe(1);
  });
});

describe('channels are committed across targets', () => {
  it('one channel, two drones: the nearer is paired, the other waits saturated', () => {
    const c = clientWith([track('F-1', 69.7, 'hostile'), track('F-2', 69.57, 'hostile'), unit('INT', 'interceptor_drone', 69.6, 22.36, [0, 50], { total: 1 })], []);
    const by = Object.fromEntries(deriveTargets(c, T, VP).map((x) => [x.id, x]));
    expect(by['F-1']!.stage).toBe('paired');
    expect(by['F-2']!.stage).toBe('prioritized');
    expect(by['F-2']!.saturated).toBe(true);
    expect(by['F-2']!.pairing?.rationale).toMatch(/Saturated/);
    expect(by['F-2']!.gates.find((g) => g.id === 'doc')!.state).toBe('pass');
  });
});

describe('targets that have left the picture', () => {
  it('keep the identification their order was issued on', () => {
    const d = decision('D5', 'DP-5', 'approved', T - 60_000, 'L3 · AD Direction Centre');
    const c = clientWith([], [d, engagement(1, 'F-8', 'assigned', T - 9000, 'D5'), engagement(2, 'F-8', 'kill', T - 1000, 'D5')]);
    const [x] = deriveTargets(c, T, VP);
    expect(x!.stage).toBe('assessed');
    expect(x!.gates.find((g) => g.id === 'id')!.state).toBe('pass');
  });
});
