/**
 * The timeline's pure logic, kept apart from the component so it can be tested: the adaptive tick
 * step per axis segment, merging events into one row of markers (a mixed bucket takes the shape
 * of its most important kind), snapping a drag to a storyboard frame, and keeping the playhead's
 * time pill inside the lanes.
 */
import { DAY, HOUR, MINUTE } from '@me/schema';

/** Tick steps, smallest first. */
export const TICK_STEPS = [MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 6 * HOUR, 12 * HOUR, DAY];
/** Ticks sit at least this far apart, so their labels have room to breathe. */
export const MIN_TICK_PX = 64;

/** The smallest step whose ticks sit at least `minPx` apart at `ppm` pixels per millisecond. */
export function chooseStep(ppm: number, minPx = MIN_TICK_PX): number {
  for (const s of TICK_STEPS) if (s * ppm >= minPx) return s;
  return TICK_STEPS[TICK_STEPS.length - 1]!;
}

export interface PxSegment {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}
export interface AutoTick {
  t: number;
  step: number;
}

/**
 * Ticks for every segment at the step that segment can carry. Steps of 6 hours or more align to
 * midnight of day 0 (so 12:00 and 00:00 line up); shorter steps align to H (so H-30, H-20 … do).
 */
export function adaptiveTicks(segs: PxSegment[], h: number, d0: number): AutoTick[] {
  const seen = new Set<number>();
  const out: AutoTick[] = [];
  for (const s of segs) {
    if (s.t1 <= s.t0 || s.x1 <= s.x0) continue;
    const step = chooseStep((s.x1 - s.x0) / (s.t1 - s.t0));
    const anchor = step >= 6 * HOUR ? d0 : h;
    for (let t = anchor + Math.ceil((s.t0 - anchor) / step) * step; t <= s.t1; t += step) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ t, step });
    }
  }
  return out;
}

export type EventKind = 'frag' | 'dec' | 'rule';
/** Which kind decides a mixed bucket's shape: a rule beats a decision, a decision beats intel. */
export const KIND_PRIORITY: Record<EventKind, number> = { frag: 0, dec: 1, rule: 2 };

export interface Bucket<T> {
  /** Centre of the bucket, in x. */
  x: number;
  items: Array<{ kind: EventKind; x: number; rec: T }>;
  tally: Record<EventKind, number>;
  /** The highest-priority kind present. */
  top: EventKind;
}

/** Events merged into markers: those within `merge` px of the bucket's first event share one. */
export function bucketEvents<T>(items: Array<{ kind: EventKind; x: number; rec: T }>, merge = 10): Array<Bucket<T>> {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const out: Array<Bucket<T>> = [];
  let first = -Infinity;
  for (const it of sorted) {
    let b = out[out.length - 1];
    if (!b || it.x - first > merge) {
      b = { x: it.x, items: [], tally: { frag: 0, dec: 0, rule: 0 }, top: it.kind };
      out.push(b);
      first = it.x;
    }
    b.items.push(it);
    b.tally[it.kind] += 1;
    if (KIND_PRIORITY[it.kind] > KIND_PRIORITY[b.top]) b.top = it.kind;
  }
  for (const b of out) b.x = b.items.reduce((s, i) => s + i.x, 0) / b.items.length;
  return out;
}

/** The bucket nearest `x`, if within `within` px. */
export function nearestBucket<T>(buckets: Array<Bucket<T>>, x: number, within = 7): Bucket<T> | null {
  let best: Bucket<T> | null = null;
  let d = Infinity;
  for (const b of buckets) {
    const e = Math.abs(b.x - x);
    // The nearest within range; on a tie, the earlier one.
    if (e <= within && e < d) {
      best = b;
      d = e;
    }
  }
  return best;
}

/** The frame whose tick is within `within` px of `x`; none while snapping is off (Shift held). */
export function snapToFrame(x: number, frames: Array<{ id: string; x: number }>, within = 6, off = false): string | null {
  if (off) return null;
  let best: string | null = null;
  let d = Infinity;
  for (const f of frames) {
    const e = Math.abs(f.x - x);
    // The nearest within range; on a tie, the earlier one.
    if (e <= within && e < d) {
      best = f.id;
      d = e;
    }
  }
  return best;
}

/** The centre of a `w`-wide pill at `x`, kept inside [w/2, width − w/2]. */
export function clampPill(x: number, w: number, width: number): number {
  return Math.max(w / 2, Math.min(width - w / 2, x));
}
