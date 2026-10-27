import { beforeAll, describe, expect, it } from 'vitest';
import { distance } from '@me/geo';
import { Cursor, Engine, MemoryJournal, verifyChain } from '@me/engine-core';
import { CLASSES, MINUTE, SECOND, type JournalRecord, type RuleFirePayload } from '@me/schema';
import { generateJamnagar, jamnagar, type ScenarioManifest } from '../src/index.ts';

let engine: Engine;
let manifest: ScenarioManifest;

beforeAll(() => {
  const g = generateJamnagar({ seed: 7 });
  manifest = g.manifest;
  engine = new Engine(new MemoryJournal());
  engine.append(g.drafts);
});

describe('jamnagar scenario (seed 7)', () => {
  it('is deterministic for a seed', () => {
    const a = new MemoryJournal();
    a.append(generateJamnagar({ seed: 7 }).drafts);
    expect(a.head().hash).toBe(engine.journal.head().hash);
    const b = new MemoryJournal();
    b.append(generateJamnagar({ seed: 8 }).drafts);
    expect(b.head().hash).not.toBe(a.head().hash);
  });

  it('hash chain verifies end to end', () => {
    expect(verifyChain(engine.journal).ok).toBe(true);
  });

  it('meets the CONOP outcome targets from the data', () => {
    expect(manifest.counts.threats).toBe(150);
    expect(manifest.counts.defeated).toBe(148);
    expect(manifest.counts.leakers).toBe(2);
    expect(manifest.counts.tier1Hits).toBe(0);
    expect(manifest.counts.saturationValue).toBeGreaterThan(manifest.counts.saturationThreshold!);
  });

  it('detects the raid about an hour out', () => {
    const mark = manifest.clock.marks.find((m) => m.id === 'H-60')!;
    const minutesOut = (manifest.clock.h - mark.t) / MINUTE;
    expect(minutesOut).toBeGreaterThan(54);
    expect(minutesOut).toBeLessThan(66);
  });

  it('defines H as the first Wave 2 drone reaching R1', () => {
    const h = manifest.clock.h;
    const inR1 = (t: number) =>
      [...engine.asOf(t).entities.values()].filter(
        (e) => e.track?.wave === 'W2' && e.ontology?.class && CLASSES[e.ontology.class]?.threat && e.location && distance(jamnagar.VP, [e.location.lon, e.location.lat]) <= 5200,
      ).length;
    expect(inR1(h - 10 * SECOND)).toBe(0);
    expect(inR1(h + 10 * SECOND)).toBeGreaterThan(0);
  });

  it('hides fragments until receipt (bitemporal)', () => {
    const before = engine.asOf(jamnagar.T0 + 7 * 60 * MINUTE);
    const after = engine.asOf(jamnagar.T0 + 8 * 60 * MINUTE);
    expect(before.get('X-LCH-N')).toBeUndefined();
    const f = after.get('X-LCH-N')!;
    expect(f).toBeDefined();
    expect(f.ingest_time - f.source_time).toBeGreaterThan(60 * MINUTE);
  });

  it('keeps contested decoys unmerged until the interceptor classifies them', () => {
    const early = [...engine.asOf(manifest.clock.h - 27 * MINUTE).entities.values()].filter((e) => e.track?.wave === 'W1');
    expect(early.some((e) => e.classification?.contested)).toBe(true);
    expect(early.every((e) => e.ontology?.class !== 'decoy')).toBe(true);
    const late = [...engine.asOf(manifest.clock.h - 20 * MINUTE).entities.values()].filter((e) => e.track?.wave === 'W1' && e.mil_view?.identity === 'hostile');
    expect(late.some((e) => e.ontology?.class === 'decoy')).toBe(true);
  });

  it('records the saturation window and debris refusal as journaled rule firings', () => {
    const rules = engine.eventsBetween(manifest.t0, manifest.t1).filter((r) => r.kind === 'rule_fire') as JournalRecord<RuleFirePayload>[];
    const sat = rules.filter((r) => r.payload.rule === 'saturation');
    expect(sat.map((r) => r.payload.state)).toEqual(['fired', 'cleared']);
    expect(rules.some((r) => r.payload.rule === 'debris_on_vp')).toBe(true);
    expect(rules.some((r) => r.payload.rule === 'civil_in_engagement_area')).toBe(true);
  });

  it('ranks the plant units and trips the interlocks with the protective action (DP-8)', () => {
    const h = manifest.clock.h;
    const units = (t: number) => [...engine.asOf(t).entities.values()].filter((e) => e.plant);
    const before = units(h - 13 * MINUTE);
    expect(before.map((e) => e.plant!.rank).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(before.every((e) => e.plant!.state === 'running' && e.plant!.interlock === 'armed')).toBe(true);
    const after = new Map(units(h - 6 * MINUTE).map((e) => [e.entity_id, e.plant!]));
    expect(after.get('PU-CDU')).toMatchObject({ rank: 1, state: 'depressurised', interlock: 'tripped' });
    expect(after.get('PU-FCC')).toMatchObject({ rank: 2, state: 'feed_isolated', interlock: 'tripped' });
    expect(after.get('PU-HCU')).toMatchObject({ rank: 3, state: 'running', interlock: 'armed' });
    // Both trips are consequences of the DP-8 record; the interlock stays tripped into the restart review.
    const dp8 = engine.eventsBetween(manifest.t0, manifest.t1).find((r) => r.kind === 'decision' && (r.payload as { dp: string }).dp === 'DP-8')!;
    const tripped = engine.lineage.consequences(engine.journal, dp8.record_id).filter((r) => (r.payload as { plant?: { interlock?: string } }).plant?.interlock === 'tripped');
    expect(tripped.map((r) => r.entity_id).sort()).toEqual(['PU-CDU', 'PU-FCC']);
    expect(units(h + 55 * MINUTE).find((e) => e.entity_id === 'PU-CDU')!.plant).toMatchObject({ rank: 1, state: 'restart_assessment', interlock: 'tripped' });
  });

  it('keeps the rehearsal fixture outside the raid timeline: two disagreeing radar reports, one assessment from both', () => {
    const th = manifest.threads.rehearsal!;
    const recs = engine.lineage.trace(engine.journal, th);
    const reports = recs.filter((r) => r.kind === 'observation');
    const assessment = recs.find((r) => r.kind === 'fused')!;
    expect(reports).toHaveLength(2);
    expect(recs.every((r) => r.label === 'SYNTHETIC//REHEARSAL' && r.ingest_time < manifest.t0)).toBe(true);
    // The radars disagree, and the assessment keeps both hypotheses and both reports.
    const classes = reports.map((r) => (r.payload as { ontology: { class: string } }).ontology.class).sort();
    expect(classes).toEqual(['civil_air', 'owa_drone']);
    expect(assessment.derived_from!.sort()).toEqual(reports.map((r) => r.record_id).sort());
    expect((assessment.payload as { classification: { contested: boolean; hypotheses: unknown[] } }).classification).toMatchObject({ contested: true });
    // Never in the picture or on the map at any raid time.
    for (const t of [manifest.t0, manifest.clock.h, manifest.t1]) expect(engine.asOf(t).get('REH-1')).toBeUndefined();
  });

  it('links the phase-0 preparation records: floors from DP-0, fire units protect the VA/VP, units are members of it', () => {
    const pic = engine.asOf(manifest.t0 + 10 * MINUTE);
    const fireUnits = [...pic.entities.values()].filter((e) => e.ontology?.template === 'effector');
    expect(fireUnits.length).toBeGreaterThan(10);
    expect(fireUnits.every((e) => e.relationships?.some((r) => r.type === 'protects' && r.target === 'VP-RIL'))).toBe(true);
    const units = [...pic.entities.values()].filter((e) => e.plant);
    expect(units.every((e) => e.relationships?.some((r) => r.type === 'member_of' && r.target === 'VP-RIL'))).toBe(true);
    const dp0 = engine.eventsBetween(manifest.t0, manifest.t1).find((r) => r.kind === 'decision' && (r.payload as { dp: string }).dp === 'DP-0')!;
    const floors = engine.lineage.consequences(engine.journal, dp0.record_id).filter((r) => r.kind === 'fused');
    expect(floors.length).toBeGreaterThan(5);
    expect(floors.every((r) => (r.payload as { effector?: { magazine?: { floor: number } } }).effector?.magazine?.floor !== undefined)).toBe(true);
  });

  it('traces an engaged track back to the D-3 fragments', () => {
    const kill = engine.eventsBetween(manifest.t0, manifest.t1).find((r) => r.kind === 'engagement' && (r.payload as { result: string }).result === 'kill')!;
    const target = (kill.payload as { target_id: string }).target_id;
    const trace = engine.lineage.trace(engine.journal, target);
    const kinds = new Set(trace.map((r) => r.kind));
    expect(kinds.has('engagement')).toBe(true);
    expect(kinds.has('decision')).toBe(true);
    expect(kinds.has('fragment')).toBe(true);
  });

  it('cursor playback matches asOf across the raid window', () => {
    const c = new Cursor(engine);
    const h = manifest.clock.h;
    c.seek(h - 31 * MINUTE);
    for (let t = h - 30 * MINUTE; t <= h + 10 * MINUTE; t += 37 * SECOND) {
      c.advance(t);
      const a = engine.asOf(t);
      expect(c.picture.entities.size).toBe(a.entities.size);
    }
  });
});
