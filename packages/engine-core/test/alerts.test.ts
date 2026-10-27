import { describe, expect, it } from 'vitest';
import type { AlertRule, EntityComponents, LonLat, RecordDraft, RuleFirePayload } from '@me/schema';
import { Engine, MemoryJournal, alertRuleId, evaluateAlert } from '../src/index.ts';

const prov = { integration: 'test', source_feed: 'Test feed' };
const op = { integration: 'console', source_feed: 'Operator console' };
const rules = { integration: 'rules', source_feed: 'Rules engine' };
const VP: LonLat = [69.6, 22.5];

function rec(id: string, kind: RecordDraft['kind'], layer: RecordDraft['layer'], t: number, entity: string, payload: unknown, p = prov): RecordDraft {
  return { record_id: id, kind, layer, entity_id: entity, source_time: t, ingest_time: t, provenance: p, label: 'SYNTHETIC//DEMO', payload };
}

/** A hostile drone flying east along 22.5°N through the defended point, one update per 10 s to 600 s; a ring R3 of 10 km; a fire unit firing down. */
function picture(): Engine {
  const e = new Engine(new MemoryJournal());
  const drafts: RecordDraft[] = [
    rec('r3', 'command', 'command', 0, 'CM-R3', { geo_shape: { type: 'circle', center: VP, radius_m: 10_000 }, geo_details: { type: 'ring', ring: 'R3', status: 'active' } } satisfies EntityComponents),
    rec('fu0', 'fused', 'fused', 0, 'B-1', { ontology: { template: 'effector', class: 'sr_sam' }, aliases: { name: 'SR SAM 1' }, effector: { type: 'sam_sr', channels: { total: 2, busy: 0 }, magazine: { ready: 10, reserve: 0, floor: 4 }, status: 'ready' } } satisfies EntityComponents),
    rec('fu1', 'fused', 'fused', 200_000, 'B-1', { effector: { type: 'sam_sr', channels: { total: 2, busy: 1 }, magazine: { ready: 6, reserve: 0, floor: 4 }, status: 'ready' } } satisfies EntityComponents),
    rec('fu2', 'fused', 'fused', 400_000, 'B-1', { effector: { type: 'sam_sr', channels: { total: 2, busy: 1 }, magazine: { ready: 3, reserve: 0, floor: 4 }, status: 'ready' } } satisfies EntityComponents),
  ];
  for (let i = 0; i <= 60; i++) {
    const t = i * 10_000;
    drafts.push(
      rec(`t${i}`, 'fused', 'fused', t, 'F-1', {
        location: { lon: 69 + i * 0.02, lat: 22.5, hae: 100 },
        ...(i === 0 ? { ontology: { template: 'track', class: 'owa_drone' }, mil_view: { identity: 'hostile', environment: 'air', sidc: '10061000001103000000', context: 'reality' } } : {}),
      } satisfies EntityComponents),
    );
  }
  e.append(drafts.sort((a, b) => a.ingest_time - b.ingest_time));
  e.index();
  return e;
}

async function run(rule: Partial<AlertRule> & Pick<AlertRule, 'condition'>, t = 0) {
  const e = picture();
  const [alert] = e.appendOperator([rec('op1', 'command', 'command', t, 'OP-001', { aliases: { name: 'Watch' }, geo_details: { type: 'alert', label: 'WATCH', status: 'active' }, alert_rule: { severity: 'high', ...rule } } satisfies EntityComponents, op)]);
  const res = await evaluateAlert(e, alert!, { endT: 600_000, center: VP, provenance: rules, label: 'SYNTHETIC//DEMO', stepMs: 10_000 });
  return res.drafts.map((d) => ({ t: d.ingest_time, ...(d.payload as RuleFirePayload) }));
}

describe('custom alerts', () => {
  it('count in a ring fires on reaching the count and clears below it, with the author’s severity', async () => {
    const f = await run({ condition: 'count_in_ring', watch: 'hostile', ring: 'R3', count: 1, severity: 'medium' });
    expect(f.map((x) => x.state)).toEqual(['fired', 'cleared']);
    expect(f.every((x) => x.rule === 'custom' && x.rule_id === alertRuleId('OP-001') && x.severity === 'medium')).toBe(true);
    // 10 km of R3 at 0.02° (≈2.06 km) per 10 s: inside from about 210 s to 390 s.
    expect(f[0]!.t).toBeGreaterThanOrEqual(200_000);
    expect(f[1]!.t).toBeLessThanOrEqual(400_000);
  });

  it('near the VA/VP fires per track within the distance', async () => {
    const f = await run({ condition: 'near_vp', watch: 'hostile', distance_m: 5_000 });
    expect(f.map((x) => x.state)).toEqual(['fired', 'cleared']);
    expect(f[0]!.note).toMatch(/within 5 km of the VA\/VP/);
  });

  it('magazine low fires at the unit’s floor unless the author sets a level', async () => {
    const atFloor = await run({ condition: 'magazine_low' });
    expect(atFloor.map((x) => [x.state, x.t])).toEqual([['fired', 400_000]]);
    const atSix = await run({ condition: 'magazine_low', unit: 'B-1', ready: 6 });
    expect(atSix.map((x) => x.t)).toEqual([200_000]);
  });

  it('a withdrawn alert’s later firings are superseded', async () => {
    const e = picture();
    const [alert] = e.appendOperator([rec('op1', 'command', 'command', 0, 'OP-001', { aliases: { name: 'Watch' }, geo_details: { type: 'alert', label: 'WATCH', status: 'active' }, alert_rule: { condition: 'near_vp', watch: 'hostile', distance_m: 5_000, severity: 'high' } } satisfies EntityComponents, op)]);
    const res = await evaluateAlert(e, alert!, { endT: 600_000, center: VP, provenance: rules, label: 'SYNTHETIC//DEMO', stepMs: 10_000 });
    e.appendOperator(res.drafts);
    const fired = res.drafts[0]!.ingest_time;
    expect(e.operator.between(-Infinity, 600_000).filter((r) => r.kind === 'rule_fire')).toHaveLength(2);
    // Withdrawn before the first firing: neither firing is returned any more.
    e.appendOperator([rec('op2', 'command', 'command', fired - 10_000, 'OP-001', { is_live: false } satisfies EntityComponents, op)]);
    expect(e.operator.between(-Infinity, 600_000).filter((r) => r.kind === 'rule_fire')).toHaveLength(0);
  });

  it('a class appearing fires once per track, including one already in the picture when set', async () => {
    const f = await run({ condition: 'class_appears', classes: ['owa_drone'] }, 50_000);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ state: 'fired', subject_ids: ['F-1'], t: 50_000 });
    expect(await run({ condition: 'class_appears', classes: ['cruise_missile'] })).toEqual([]);
  });
});
