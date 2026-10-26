import { describe, expect, it } from 'vitest';
import type { EntityComponents, JournalRecord, RecordDraft, RuleFirePayload } from '@me/schema';
import { Cursor, Engine, MemoryJournal, evaluateGeofence } from '../src/index.ts';

const prov = { integration: 'test', source_feed: 'Test feed' };
const op = { integration: 'operator', source_feed: 'Operator console' };

function rec(id: string, kind: RecordDraft['kind'], layer: RecordDraft['layer'], t: number, entity: string, payload: unknown, p = prov): RecordDraft {
  return { record_id: id, kind, layer, entity_id: entity, source_time: t, ingest_time: t, provenance: p, label: 'SYNTHETIC//DEMO', payload };
}

/** A hostile track flying east along 22.5°N, one fused update per 10 s from t=0 to t=600 s. */
function eastbound(): Engine {
  const e = new Engine(new MemoryJournal());
  const drafts: RecordDraft[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i * 10_000;
    const patch: EntityComponents = {
      location: { lon: 69 + i * 0.02, lat: 22.5, hae: 100 },
      ...(i === 0 ? { ontology: { template: 'track', class: 'owa_drone' }, mil_view: { identity: 'hostile', environment: 'air', sidc: '10061000001103000000', context: 'reality' } } : {}),
    };
    drafts.push(rec(`t${i}`, 'fused', 'fused', t, 'F-1', patch));
  }
  e.append(drafts);
  e.index();
  return e;
}

const fence = (t: number, lon0: number, lon1: number): RecordDraft =>
  rec(
    'op1',
    'command',
    'command',
    t,
    'OP-001',
    {
      geo_shape: { type: 'polygon', coordinates: [[[lon0, 22.4], [lon1, 22.4], [lon1, 22.6], [lon0, 22.6], [lon0, 22.4]]] },
      geo_details: { type: 'geofence', label: 'BOX', status: 'active', watch: 'hostile' },
    } satisfies EntityComponents,
    op,
  );

describe('operator log', () => {
  it('chains onto the journal head and shows objects from the time they were authored', () => {
    const e = eastbound();
    const [r] = e.appendOperator([fence(200_000, 69.5, 69.7)]);
    expect(r!.prev_hash).toBe(e.journal.head().hash);
    expect(e.asOf(199_999).get('OP-001')).toBeUndefined();
    expect(e.asOf(200_000).get('OP-001')?.geo_details?.type).toBe('geofence');

    // A reader already past the authoring time picks it up late; one before it, on advance.
    const late = new Cursor(e);
    late.seek(300_000);
    expect(late.picture.get('OP-001')).toBeDefined();
    const early = new Cursor(e);
    early.seek(100_000);
    expect(early.picture.get('OP-001')).toBeUndefined();
    expect(early.advance(250_000).upserts.has('OP-001')).toBe(true);
  });

  it('re-verifies a persisted chain and refuses one anchored elsewhere', () => {
    const e = eastbound();
    e.appendOperator([fence(200_000, 69.5, 69.7)]);
    const saved = JSON.parse(JSON.stringify(e.operator.all())) as JournalRecord[];

    const again = eastbound();
    expect(again.operator.load(saved)).toEqual({ ok: true, checked: 1 });

    const other = new Engine(new MemoryJournal());
    expect(other.operator.load(saved).ok).toBe(false);

    const tampered = structuredClone(saved);
    (tampered[0]!.payload as EntityComponents).geo_details!.label = 'EDITED';
    expect(eastbound().operator.load(tampered).ok).toBe(false);
  });

  it('withdrawal removes the object from that time on', () => {
    const e = eastbound();
    e.appendOperator([fence(200_000, 69.5, 69.7)]);
    e.appendOperator([rec('op2', 'command', 'command', 400_000, 'OP-001', { is_live: false }, op)]);
    expect(e.asOf(300_000).get('OP-001')).toBeDefined();
    expect(e.asOf(400_000).get('OP-001')).toBeUndefined();
  });
});

describe('geofence rule', () => {
  it('fires on entry and clears on exit at the sampled times', async () => {
    const e = eastbound();
    // Box spans lon 69.51–69.69: the track is inside from t=260 s (69.52) to t=340 s (69.68).
    const [f] = e.appendOperator([fence(0, 69.51, 69.69)]);
    const run = await evaluateGeofence(e, f!, { endT: 600_000, provenance: { integration: 'rules', source_feed: 'Rules engine' }, label: 'SYNTHETIC//DEMO', stepMs: 10_000 });
    const p = run.drafts.map((d) => d.payload as RuleFirePayload);
    expect(p.map((x) => x.state)).toEqual(['fired', 'cleared']);
    expect(p[0]!.subject_ids).toEqual(['F-1']);
    expect(run.drafts[0]!.ingest_time).toBe(260_000);
    expect(run.drafts[1]!.ingest_time).toBe(350_000);
    expect(run.drafts[0]!.derived_from).toEqual([f!.hash]);
  });

  it('drops firings after the geofence is withdrawn', async () => {
    const e = eastbound();
    const [f] = e.appendOperator([fence(0, 69.5, 69.7)]);
    const run = await evaluateGeofence(e, f!, { endT: 600_000, provenance: prov, label: 'SYNTHETIC//DEMO', stepMs: 10_000 });
    e.appendOperator(run.drafts);
    e.appendOperator([rec('op9', 'command', 'command', 300_000, 'OP-001', { is_live: false }, op)]);
    const kinds = e.operator.upTo(600_000).filter((r) => r.kind === 'rule_fire').map((r) => (r.payload as RuleFirePayload).state);
    expect(kinds).toEqual(['fired']);
  });
});
