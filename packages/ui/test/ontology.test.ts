import { describe, expect, it } from 'vitest';
import type { Entity, EntityComponents, JournalRecord } from '@me/schema';
import { envelopeOf, ontologyGraph, permittedTo, rehearsalOf, theaterState } from '../src/ontology.ts';
import { T, VP, clientWith, decision, fragment } from './fixtures.ts';

const JOINT = ['JOINT STAFF WEST'];
const PLANT = ['JOINT STAFF WEST', 'RIL'];

function object(id: string, layer: string, payload: EntityComponents, rel?: string[]): Entity {
  return {
    entity_id: id,
    layer,
    is_live: true,
    source_time: T - 60_000,
    ingest_time: T - 60_000,
    version: 2,
    history: [],
    last_hash: `h-${id}`,
    label: 'SYNTHETIC//DEMO',
    ...(rel ? { releasability: rel } : {}),
    provenance: { integration: 'scenario', source_feed: 'Force state', agency: 'synthetic' },
    ...payload,
  } as unknown as Entity;
}

function record(id: string, entity: string, kind: string, layer: string, payload: EntityComponents, o: { derived?: string[]; thread?: string; rel?: string[]; label?: string } = {}): JournalRecord {
  return {
    seq: 1,
    record_id: id,
    kind,
    layer,
    entity_id: entity,
    source_time: T - 50_000,
    ingest_time: T - 50_000,
    provenance: { integration: 'scenario', source_feed: 'Army AD control & reporting', sensor_class: 'low-level radar' },
    label: o.label ?? 'SYNTHETIC//DEMO',
    ...(o.rel ? { releasability: o.rel } : {}),
    ...(o.thread ? { thread_id: o.thread } : {}),
    ...(o.derived ? { derived_from: o.derived } : {}),
    payload,
    prev_hash: '',
    hash: `h-${id}`,
  } as JournalRecord;
}

const fireUnit = (id: string) => object(id, 'fused', { ontology: { template: 'effector', class: 'sr_sam' }, effector: { type: 'sr_sam', channels: { total: 2, busy: 0 }, magazine: { ready: 8, reserve: 4, floor: 4, capacity: 12 }, status: 'ready' }, relationships: [{ type: 'protects', target: 'VP-RIL' }] } as EntityComponents, JOINT);
const entities = [
  object('X-LCH-N', 'observation', { ontology: { template: 'fragment', class: 'launch_prep' }, aliases: { name: 'Launch area N' } } as EntityComponents, JOINT),
  object('CM-RULES', 'command', { ontology: { template: 'geo', class: 'rule_set' }, geo_details: { type: 'annotation', label: 'DELEGATION TRIGGERS', status: 'active' } } as EntityComponents),
  object('CM-R1', 'command', { ontology: { template: 'geo', class: 'ring' }, geo_details: { type: 'ring', ring: 'R1', status: 'active' } } as EntityComponents),
  fireUnit('B-SRS1'),
  fireUnit('B-SRS2'),
  object('S-LLR1', 'fused', { ontology: { template: 'sensor', class: 'low_level_radar' }, sensor: { type: 'low_level_radar', status: 'up' } } as EntityComponents, JOINT),
  object('VP-RIL', 'reference', { ontology: { template: 'installation', class: 'refinery' }, geo_details: { type: 'vp', tier: 1, label: 'VP · REFINERY COMPLEX', status: 'active' } } as EntityComponents, PLANT),
  object('PU-CDU', 'reference', { ontology: { template: 'installation', class: 'process_unit' }, plant: { unit: 'Crude unit', tier: 1, state: 'running' }, relationships: [{ type: 'member_of', target: 'VP-RIL' }] } as EntityComponents, PLANT),
];
const dp0 = decision('DP0', 'DP-0', T - 59_000, { layer: 'L1' });
(dp0 as { thread_id?: string }).thread_id = 'TH-IW';
const frag = { ...fragment('X-LCH-N', T - 40_000, 'launch_prep', 'possible', { thread: 'TH-IW' }), record_id: 'FR-LCH-N' } as JournalRecord;
const lineage = [dp0, frag];
const prepared = [
  record('REC-RULES', 'CM-RULES', 'command', 'command', {}, { derived: ['DP0'] }),
  record('REC-FLOOR-1', 'B-SRS1', 'fused', 'fused', {}, { derived: ['DP0'], rel: JOINT }),
  record('REC-FLOOR-2', 'B-SRS2', 'fused', 'fused', {}, { derived: ['DP0'], rel: JOINT }),
];

describe('ontology explorer', () => {
  it('counts the five layers of the Theater State Model by group', () => {
    const rows = theaterState(clientWith(entities, [dp0]));
    expect(rows.map((r) => r.label)).toEqual(['Reference', 'Observation', 'Fused', 'Command', 'Event']);
    const by = Object.fromEntries(rows.map((r) => [r.layer, Object.fromEntries(r.groups.map((g) => [g.label, g.count]))]));
    expect(by.reference).toEqual({ 'VA/VP': 1, 'Process units': 1 });
    expect(by.fused).toEqual({ 'Fire units': 2, Sensors: 1 });
    expect(by.command).toEqual({ 'Delegation triggers': 1, 'Control measures': 1 });
    expect(by.event).toEqual({ 'DP records': 1 });
  });

  it('links the A1 source record to the preparation records only by what the records carry', () => {
    const g = ontologyGraph(clientWith(entities, [dp0]), 'X-LCH-N', lineage, prepared, PLANT);
    const has = (from: string, to: string, type: string) => g.edges.some((e) => e.from === from && e.to === to && e.type === type);
    expect(g.nodes.find((n) => n.focus)!.id).toBe('X-LCH-N');
    expect(has('X-LCH-N', 'DP0', 'thread')).toBe(true);
    expect(has('DP0', 'CM-RULES', 'derived from')).toBe(true);
    expect(has('DP0', 'grp:fire-units', 'derived from')).toBe(true);
    expect(has('grp:fire-units', 'VP-RIL', 'protects')).toBe(true);
    expect(has('grp:process-units', 'VP-RIL', 'member of')).toBe(true);
    // Sensors were prepared before the raid but no record links them: they stay unlinked.
    expect(g.nodes.some((n) => n.id === 'grp:sensors')).toBe(true);
    expect(g.edges.some((e) => e.from === 'grp:sensors' || e.to === 'grp:sensors')).toBe(false);
  });

  it('colours nodes by permission for the identity viewed as', () => {
    const asRil = ontologyGraph(clientWith(entities, [dp0]), 'X-LCH-N', lineage, prepared, ['RIL']);
    const p = Object.fromEntries(asRil.nodes.map((n) => [n.id, n.permitted]));
    expect(p).toMatchObject({ 'X-LCH-N': 'none', DP0: 'none', 'grp:fire-units': 'none', 'VP-RIL': 'all', 'grp:process-units': 'all', 'CM-RULES': 'all' });
    expect(permittedTo(['RIL'])).toEqual(['National level', 'Joint HQ West', 'AD Direction Centre', 'RIL control room']);
    expect(permittedTo(['NATIONAL'])).toEqual(['National level']);
  });

  it('keeps one envelope for objects and records: provenance, time, label, version, signature', () => {
    const e = envelopeOf(entities[0]!);
    expect(e).toMatchObject({ feed: 'Force state', label: 'SYNTHETIC//DEMO', version: 2, hash: 'h-X-LCH-N', signature: null });
    const r = envelopeOf(dp0);
    expect(r).toMatchObject({ version: null, signature: null, receipt: T - 59_000 });
  });

  it('the rehearsal inset keeps both conflicting radar reports and the assessment made from both', () => {
    const a = record('REH-A', 'O:S-LLR1:REH-1', 'observation', 'observation', { ontology: { template: 'track', class: 'owa_drone' }, location: { lon: VP[0], lat: VP[1], hae: 300 }, mil_view: { identity: 'suspect' } } as EntityComponents, { thread: 'TH-REH', label: 'SYNTHETIC//REHEARSAL' });
    const b = record('REH-B', 'O:S-CR1:REH-1', 'observation', 'observation', { ontology: { template: 'track', class: 'civil_air' }, location: { lon: VP[0] + 0.01, lat: VP[1], hae: 900 }, mil_view: { identity: 'neutral' } } as EntityComponents, { thread: 'TH-REH', label: 'SYNTHETIC//REHEARSAL' });
    const fused = record('REH-F', 'REH-1', 'fused', 'fused', { classification: { hypotheses: [{ class: 'owa_drone', label: 'OWA drone', sidc: 'x', p: 0.54 }, { class: 'civil_air', label: 'Civil aircraft', sidc: 'y', p: 0.46 }], contested: true, margin: 0.08 } } as EntityComponents, { thread: 'TH-REH', derived: ['REH-A', 'REH-B'], label: 'SYNTHETIC//REHEARSAL' });
    const r = rehearsalOf([fused, b, a]);
    expect(r.reports.map((x) => x.report)).toHaveLength(2);
    expect(new Set(r.reports.map((x) => x.report)).size).toBe(2);
    expect(r.assessment).toMatchObject({ contested: true, derivedFrom: ['REH-A', 'REH-B'] });
    expect(r.assessment!.hypotheses.map((h) => h.label)).toEqual(['OWA drone', 'Civil aircraft']);
    expect(r.apartM).toBeGreaterThan(900);
    expect(r.label).toBe('SYNTHETIC//REHEARSAL');
  });
});
