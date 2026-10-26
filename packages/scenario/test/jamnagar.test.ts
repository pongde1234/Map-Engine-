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
