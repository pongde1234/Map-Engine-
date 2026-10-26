/** Deterministic helpers for scenario generation. */
import { destination, inverse } from '@me/geo';
import type { LonLat, RecordDraft, RecordKind, Layer, Provenance } from '@me/schema';
import { DEFAULT_LABEL } from '@me/schema';

/** mulberry32: small, fast, deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rand {
  private next: () => number;
  constructor(seed: number) {
    this.next = rng(seed);
  }
  u(): number {
    return this.next();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  normal(sd = 1): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  }
}

interface Leg {
  from: LonLat;
  az: number;
  len: number;
  start: number;
}

/** Piecewise geodesic path; position by distance travelled. */
export class Path {
  readonly legs: Leg[] = [];
  readonly total: number;
  constructor(readonly points: LonLat[]) {
    let cum = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const inv = inverse(points[i]!, points[i + 1]!);
      this.legs.push({ from: points[i]!, az: inv.azimuth_deg, len: inv.distance_m, start: cum });
      cum += inv.distance_m;
    }
    this.total = cum;
  }

  at(d: number): { pos: LonLat; az: number } {
    const dd = Math.max(0, Math.min(this.total, d));
    let leg = this.legs[0]!;
    for (const l of this.legs) {
      if (dd >= l.start) leg = l;
      else break;
    }
    return { pos: destination(leg.from, leg.az, dd - leg.start), az: leg.az };
  }
}

export function enu(az: number, speed: number, up = 0): { e: number; n: number; u: number } {
  const r = (az * Math.PI) / 180;
  return { e: speed * Math.sin(r), n: speed * Math.cos(r), u: up };
}

/** Collects record drafts with deterministic ids. */
export class Emitter {
  readonly drafts: RecordDraft[] = [];
  private n = 0;

  emit<P>(
    kind: RecordKind,
    layer: Layer,
    o: {
      entity_id?: string;
      source_time: number;
      ingest_time?: number;
      provenance: Provenance;
      payload: P;
      derived_from?: string[];
      thread_id?: string;
      releasability?: string[];
      author?: string;
    },
  ): string {
    this.n += 1;
    const record_id = `R${String(this.n).padStart(7, '0')}`;
    const d: RecordDraft<P> = {
      record_id,
      kind,
      layer,
      source_time: Math.round(o.source_time),
      ingest_time: Math.round(o.ingest_time ?? o.source_time),
      provenance: o.provenance,
      label: DEFAULT_LABEL,
      payload: o.payload,
    };
    if (o.entity_id) d.entity_id = o.entity_id;
    if (o.derived_from?.length) d.derived_from = o.derived_from;
    if (o.thread_id) d.thread_id = o.thread_id;
    if (o.releasability) d.releasability = o.releasability;
    if (o.author) d.author = o.author;
    this.drafts.push(d as RecordDraft);
    return record_id;
  }

  /** Drafts ordered by ingest time (stable on creation order) — the journal's append order. */
  sorted(): RecordDraft[] {
    return this.drafts
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d.ingest_time - b.d.ingest_time || a.i - b.i)
      .map((x) => x.d);
  }
}
