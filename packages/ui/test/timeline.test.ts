import { describe, expect, it } from 'vitest';
import { DAY, HOUR, MINUTE } from '@me/schema';
import { adaptiveTicks, bucketEvents, chooseStep, clampPill, nearestBucket, snapToFrame } from '../src/timeline.ts';

describe('chooseStep', () => {
  it('takes the smallest step whose ticks are at least 64 px apart', () => {
    // 6 px a minute: 15 minutes is 90 px, 10 minutes only 60.
    expect(chooseStep(6 / MINUTE)).toBe(15 * MINUTE);
    // A crowded segment gets a longer step.
    expect(chooseStep(0.7 / MINUTE)).toBe(2 * HOUR);
    // 1 h is 42 px here, 2 h is 84.
  });
  it('never goes past a day', () => {
    expect(chooseStep(1e-12)).toBe(DAY);
  });
  it('uses a minute when there is room', () => {
    expect(chooseStep(100 / MINUTE)).toBe(MINUTE);
  });
});

describe('adaptiveTicks', () => {
  const d0 = Date.UTC(2026, 10, 14);
  const h = d0 + 3 * DAY + 6 * HOUR;
  it('aligns short steps to H and long steps to midnight', () => {
    const raid = { t0: h - 90 * MINUTE, t1: h + 60 * MINUTE, x0: 0, x1: 900 }; // 6 px a minute
    const days = { t0: d0, t1: d0 + 2 * DAY, x0: 900, x1: 1100 }; // 200 px over 48 h: a day apart is 100 px
    const ticks = adaptiveTicks([raid, days], h, d0);
    const inRaid = ticks.filter((k) => k.t >= raid.t0 && k.t <= raid.t1);
    expect(inRaid.every((k) => k.step === 15 * MINUTE && (k.t - h) % (15 * MINUTE) === 0)).toBe(true);
    expect(inRaid.some((k) => k.t === h)).toBe(true);
    const long = ticks.filter((k) => k.step >= 6 * HOUR);
    expect(long.length).toBeGreaterThan(0);
    expect(long.every((k) => (k.t - d0) % k.step === 0)).toBe(true);
  });
  it('does not repeat a tick on a segment boundary', () => {
    const a = { t0: 0, t1: 60 * MINUTE, x0: 0, x1: 600 };
    const b = { t0: 60 * MINUTE, t1: 120 * MINUTE, x0: 600, x1: 1200 };
    const ts = adaptiveTicks([a, b], 0, 0).map((k) => k.t);
    expect(new Set(ts).size).toBe(ts.length);
  });
});

describe('bucketEvents', () => {
  const ev = (kind: 'frag' | 'dec' | 'rule', x: number) => ({ kind, x, rec: `${kind}@${x}` });
  it('merges events within 10 px and keeps a tally per kind', () => {
    const b = bucketEvents([ev('frag', 100), ev('frag', 104), ev('dec', 108), ev('frag', 200)]);
    expect(b).toHaveLength(2);
    expect(b[0]!.tally).toEqual({ frag: 2, dec: 1, rule: 0 });
    expect(b[1]!.items).toHaveLength(1);
  });
  it('lets a rule beat a decision beat intel for the glyph, whatever the order', () => {
    expect(bucketEvents([ev('frag', 10), ev('dec', 12)])[0]!.top).toBe('dec');
    expect(bucketEvents([ev('rule', 10), ev('frag', 12), ev('dec', 14)])[0]!.top).toBe('rule');
    expect(bucketEvents([ev('frag', 10), ev('rule', 11)])[0]!.top).toBe('rule');
    expect(bucketEvents([ev('frag', 10)])[0]!.top).toBe('frag');
  });
  it('centres a bucket on its events', () => {
    expect(bucketEvents([ev('frag', 100), ev('frag', 108)])[0]!.x).toBe(104);
  });
  it('merges nothing when a kind is filtered out beforehand', () => {
    const all = [ev('frag', 100), ev('rule', 104)];
    expect(bucketEvents(all.filter((e) => e.kind !== 'rule'))[0]!.top).toBe('frag');
  });
});

describe('nearestBucket', () => {
  it('picks the closest bucket within 7 px, or none', () => {
    const buckets = bucketEvents([
      { kind: 'frag' as const, x: 100, rec: 1 },
      { kind: 'rule' as const, x: 130, rec: 2 },
    ]);
    expect(nearestBucket(buckets, 104)!.items[0]!.rec).toBe(1);
    expect(nearestBucket(buckets, 126)!.items[0]!.rec).toBe(2);
    expect(nearestBucket(buckets, 115)).toBeNull();
  });
});

describe('snapToFrame', () => {
  const frames = [
    { id: 'B3', x: 400 },
    { id: 'B4', x: 410 },
  ];
  it('snaps to the nearest frame within 6 px', () => {
    expect(snapToFrame(405, frames)).toBe('B3');
    expect(snapToFrame(407, frames)).toBe('B4');
    expect(snapToFrame(430, frames)).toBeNull();
  });
  it('does not snap while Shift is held', () => {
    expect(snapToFrame(400, frames, 6, true)).toBeNull();
  });
});

describe('clampPill', () => {
  it('keeps the pill inside the lanes', () => {
    expect(clampPill(5, 60, 800)).toBe(30);
    expect(clampPill(790, 60, 800)).toBe(770);
    expect(clampPill(400, 60, 800)).toBe(400);
  });
});
