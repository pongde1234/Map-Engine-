import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { EntityComponents, RecordDraft } from '@me/schema';
import { Cursor, Engine, MemoryJournal, verifyChain } from '../src/index.ts';

const prov = { integration: 'test', source_feed: 'Test feed' };

function draft(i: number, id: string, ingest: number, source: number, patch: EntityComponents): RecordDraft<EntityComponents> {
  return {
    record_id: `r${i}`,
    kind: 'fused',
    layer: 'fused',
    entity_id: id,
    source_time: source,
    ingest_time: ingest,
    provenance: prov,
    label: 'SYNTHETIC//DEMO',
    payload: patch,
  };
}

function loc(lon: number, lat: number): EntityComponents {
  return { location: { lon, lat, hae: 0 } };
}

describe('journal', () => {
  it('chains hashes over stored bytes and detects tampering', () => {
    const j = new MemoryJournal();
    j.append([draft(1, 'a', 10, 10, loc(70, 22)), draft(2, 'a', 20, 20, loc(70.1, 22))]);
    expect(verifyChain(j)).toEqual({ ok: true, checked: 2 });
    const b0 = (j as unknown as { bodies: Uint8Array[] }).bodies[0]!;
    b0[5] = b0[5]! ^ 0xff;
    expect(verifyChain(j).ok).toBe(false);
    expect(verifyChain(j).brokenAt).toBe(1);
  });

  it('rejects decreasing ingest_time and duplicate ids', () => {
    const j = new MemoryJournal();
    j.append([draft(1, 'a', 10, 10, loc(70, 22))]);
    expect(() => j.append([draft(2, 'a', 5, 5, loc(70, 22))])).toThrow(/non-decreasing/);
    expect(() => j.append([draft(1, 'b', 11, 11, loc(70, 22))])).toThrow(/duplicate/);
  });
});

describe('time travel on the ingest axis', () => {
  it('hides material until receipt and keeps last writer by source time', () => {
    const e = new Engine(new MemoryJournal());
    e.append([
      draft(1, 'f1', 100, 90, { ...loc(70, 22), aliases: { name: 'first' } }),
      // Late arrival: older source time, newer ingest. Must not overwrite state.
      draft(2, 'f1', 200, 50, { aliases: { name: 'stale' } }),
      draft(3, 'f2', 300, 300, loc(71, 23)),
    ]);
    expect(e.asOf(99).entities.size).toBe(0);
    expect(e.asOf(150).get('f1')?.aliases?.name).toBe('first');
    expect(e.asOf(250).get('f1')?.aliases?.name).toBe('first');
    expect(e.asOf(250).get('f2')).toBeUndefined();
    expect(e.asOf(300).get('f2')).toBeDefined();
  });

  it('removes entities on expiry and on is_live=false', () => {
    const e = new Engine(new MemoryJournal());
    e.append([
      draft(1, 'x', 10, 10, { ...loc(70, 22), expiry_time: 50 }),
      draft(2, 'y', 20, 20, loc(70, 22)),
      draft(3, 'y', 30, 30, { is_live: false }),
    ]);
    expect(e.asOf(49).get('x')).toBeDefined();
    expect(e.asOf(50).get('x')).toBeUndefined();
    expect(e.asOf(25).get('y')).toBeDefined();
    expect(e.asOf(30).get('y')).toBeUndefined();
  });

  it('keyframe seek equals sequential replay at every time (property)', () => {
    const recArb = fc.record({
      entity: fc.integer({ min: 0, max: 7 }),
      dIngest: fc.integer({ min: 0, max: 5 }),
      lag: fc.integer({ min: -3, max: 10 }),
      kill: fc.boolean(),
      expires: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
      lon: fc.double({ min: 60, max: 80, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(recArb, { minLength: 1, maxLength: 120 }), fc.integer({ min: 1, max: 9 }), (specs, every) => {
        const e = new Engine(new MemoryJournal(), { everyRecords: every, everyMs: 1e12 });
        let t = 1000;
        const drafts = specs.map((s, i) => {
          t += s.dIngest;
          const patch: EntityComponents = s.kill && i % 5 === 0 ? { is_live: false } : { ...loc(s.lon, 22) };
          if (s.expires !== undefined) patch.expiry_time = t + s.expires;
          return draft(i, `e${s.entity}`, t, t - s.lag, patch);
        });
        e.append(drafts);
        const cursor = new Cursor(e);
        cursor.seek(999);
        for (let q = 999; q <= t + 25; q += 1) {
          cursor.advance(q);
          const a = e.asOf(q);
          const b = cursor.picture;
          expect([...b.entities.keys()].sort()).toEqual([...a.entities.keys()].sort());
          for (const [id, ent] of a.entities) expect(b.get(id)).toEqual(ent);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('cursor reports moves separately from attribute changes', () => {
    const e = new Engine(new MemoryJournal());
    e.append([
      draft(1, 'm', 10, 10, { ...loc(70, 22), aliases: { name: 'm' } }),
      draft(2, 'm', 20, 20, loc(70.01, 22)),
      draft(3, 'm', 30, 30, { aliases: { name: 'renamed' } }),
    ]);
    const c = new Cursor(e);
    c.seek(10);
    const ch1 = c.advance(20);
    expect([...ch1.moved]).toEqual(['m']);
    expect(ch1.upserts.size).toBe(0);
    const ch2 = c.advance(30);
    expect([...ch2.upserts]).toEqual(['m']);
    const back = c.advance(15);
    expect(back.reset).toBe(true);
    expect(c.picture.get('m')?.location?.lon).toBe(70);
  });
});

describe('lineage downstream', () => {
  it('lists what was derived from a record, as known at the cursor', () => {
    const e = new Engine(new MemoryJournal());
    const dec = (i: number, t: number, derived?: string[]): RecordDraft => ({
      record_id: `d${i}`,
      kind: 'decision',
      layer: 'event',
      source_time: t,
      ingest_time: t,
      provenance: prov,
      label: 'SYNTHETIC//DEMO',
      ...(derived ? { derived_from: derived } : {}),
      payload: { dp: `DP-${i}`, title: '', layer: 'L1', status: 'approved', summary: '', options: [] },
    });
    e.append([dec(0, 10), dec(1, 20, ['d0']), { ...draft(2, 'a', 30, 30, loc(70, 22)), derived_from: ['d1'] }, dec(3, 40, ['d0'])]);
    e.index();
    const ids = (depth: number, t = 100) => e.lineage.consequences(e.journal, 'd0', e.journal.seqAtOrBefore(t), depth).map((r) => r.record_id);
    expect(ids(1)).toEqual(['d1', 'd3']);
    expect(ids(2)).toEqual(['d1', 'r2', 'd3']);
    // Nothing received after the cursor.
    expect(ids(2, 35)).toEqual(['d1', 'r2']);
  });
});

describe('outcome accounting', () => {
  it('records what happened to each threat track, as known at the cursor', () => {
    const e = new Engine(new MemoryJournal());
    const track = (cls: string) => ({ ontology: { template: 'track', class: cls }, track: { state: 'detected', contributing: [], sensor_classes: [], axis: 'NORTH', wave: 'W2' } }) as EntityComponents;
    e.append([
      draft(1, 'T-1', 10, 10, track('owa_drone')),
      draft(2, 'T-2', 11, 11, track('probe')),
      draft(3, 'C-1', 12, 12, track('civil_air')),
      draft(4, 'T-1', 20, 20, { track: { state: 'destroyed', contributing: [], sensor_classes: [] } } as EntityComponents),
      draft(5, 'T-2', 30, 30, { track: { state: 'withdrawn', contributing: [], sensor_classes: [] } } as EntityComponents),
      draft(6, 'T-2', 31, 31, { is_live: false }),
      draft(7, 'PU-1', 32, 32, { plant: { unit: 'Crude unit', tier: 1, state: 'running' } }),
      draft(8, 'PU-1', 40, 40, { plant: { unit: 'Crude unit', tier: 1, state: 'depressurised' } }),
    ]);
    e.index();
    const at = (t: number) => e.outcomes.accounting(e.journal.seqAtOrBefore(t));
    expect(at(15).tracks.map((x) => [x.id, x.outcome])).toEqual([['T-1', 'in flight'], ['T-2', 'in flight']]);
    expect(Object.fromEntries(at(100).tracks.map((x) => [x.id, x.outcome]))).toEqual({ 'T-1': 'destroyed', 'T-2': 'withdrawn' });
    expect(at(100).plant[0]!.history.map((h) => h.state)).toEqual(['running', 'depressurised']);
    expect(at(35).plant[0]!.history.map((h) => h.state)).toEqual(['running']);
  });
});
