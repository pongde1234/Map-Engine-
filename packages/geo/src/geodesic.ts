/**
 * WGS84 geodesics (geographiclib). Spherical approximations err by ~0.5 km on a 150 km ring,
 * so every ring, sector, range and bearing in the engine goes through here.
 */
import geodesicLib from 'geographiclib-geodesic';
import type { GeoShape, LonLat } from '@me/schema';

const geod = geodesicLib.Geodesic.WGS84;

/** Point at distance `distM` along azimuth `azDeg` (true) from `from`. */
export function destination(from: LonLat, azDeg: number, distM: number): LonLat {
  const r = geod.Direct(from[1], from[0], azDeg, distM);
  return [r.lon2!, r.lat2!];
}

export interface Inverse {
  distance_m: number;
  /** Initial azimuth from a to b, degrees true in [0, 360). */
  azimuth_deg: number;
}

export function inverse(a: LonLat, b: LonLat): Inverse {
  const r = geod.Inverse(a[1], a[0], b[1], b[0]);
  return { distance_m: r.s12!, azimuth_deg: normAz(r.azi1!) };
}

export function distance(a: LonLat, b: LonLat): number {
  return geod.Inverse(a[1], a[0], b[1], b[0]).s12!;
}

export function normAz(az: number): number {
  const x = az % 360;
  return x < 0 ? x + 360 : x;
}

function ring(center: LonLat, radius: number, az0: number, az1: number, steps: number): LonLat[] {
  const span = normAz(az1 - az0) || 360;
  const n = Math.max(8, Math.ceil((steps * span) / 360));
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) out.push(destination(center, az0 + (span * i) / n, radius));
  return out;
}

/** Closed geodesic circle as a polygon ring. */
export function circle(center: LonLat, radiusM: number, steps = 128): LonLat[] {
  const pts = ring(center, radiusM, 0, 360, steps);
  pts[pts.length - 1] = pts[0]!;
  return pts;
}

/** Annulus as polygon with a hole: [outer, inner]. */
export function annulus(center: LonLat, innerM: number, outerM: number, steps = 128): LonLat[][] {
  return [circle(center, outerM, steps), circle(center, innerM, steps).reverse()];
}

/** Sector (optionally with inner radius) from az0 clockwise to az1. */
export function sector(
  center: LonLat,
  radiusM: number,
  az0: number,
  az1: number,
  innerM = 0,
  steps = 128,
): LonLat[] {
  const outer = ring(center, radiusM, az0, az1, steps);
  const inner = innerM > 0 ? ring(center, innerM, az0, az1, steps).reverse() : [center];
  const pts = [...outer, ...inner];
  pts.push(pts[0]!);
  return pts;
}

/** Ellipse with semi-axes in metres; orientation is the major axis azimuth (degrees true). */
export function ellipse(center: LonLat, semiMajorM: number, semiMinorM: number, orientationDeg: number, steps = 72): LonLat[] {
  const pts: LonLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const th = (2 * Math.PI * i) / steps;
    const x = semiMajorM * Math.cos(th);
    const y = semiMinorM * Math.sin(th);
    const r = Math.hypot(x, y);
    const az = orientationDeg + (Math.atan2(y, x) * 180) / Math.PI;
    pts.push(destination(center, az, r));
  }
  pts[pts.length - 1] = pts[0]!;
  return pts;
}

/** Polygon rings (outer first, then holes) for any GeoShape; lines and points return []. */
export function shapeToPolygon(shape: GeoShape): LonLat[][] {
  switch (shape.type) {
    case 'polygon':
      return shape.coordinates;
    case 'circle':
      return shape.inner_radius_m
        ? annulus(shape.center, shape.inner_radius_m, shape.radius_m)
        : [circle(shape.center, shape.radius_m)];
    case 'sector':
      return [sector(shape.center, shape.radius_m, shape.az_start, shape.az_end, shape.inner_radius_m ?? 0)];
    case 'ellipse':
      return [ellipse(shape.center, shape.semi_major_m, shape.semi_minor_m, shape.orientation_deg)];
    default:
      return [];
  }
}

/** Ray-casting point-in-ring on lon/lat; adequate for theatre-scale polygons (no antimeridian). */
export function pointInRing(p: LonLat, poly: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Exact containment for circles/sectors (geodesic range + bearing); polygons by ray casting. */
export function pointInShape(p: LonLat, shape: GeoShape): boolean {
  switch (shape.type) {
    case 'circle': {
      const d = distance(shape.center, p);
      return d <= shape.radius_m && d >= (shape.inner_radius_m ?? 0);
    }
    case 'sector': {
      const { distance_m, azimuth_deg } = inverse(shape.center, p);
      if (distance_m > shape.radius_m || distance_m < (shape.inner_radius_m ?? 0)) return false;
      const span = normAz(shape.az_end - shape.az_start) || 360;
      return normAz(azimuth_deg - shape.az_start) <= span;
    }
    case 'polygon': {
      const [outer, ...holes] = shape.coordinates;
      if (!outer || !pointInRing(p, outer)) return false;
      return !holes.some((h) => pointInRing(p, h));
    }
    case 'ellipse':
      return pointInRing(p, ellipse(shape.center, shape.semi_major_m, shape.semi_minor_m, shape.orientation_deg));
    default:
      return false;
  }
}

/** Heading (degrees true) and speed (m/s) from an ENU velocity. */
export function headingSpeed(vel: { e: number; n: number } | undefined): { heading: number; speed: number } {
  if (!vel) return { heading: 0, speed: 0 };
  return { heading: normAz((Math.atan2(vel.e, vel.n) * 180) / Math.PI), speed: Math.hypot(vel.e, vel.n) };
}

/** Dead-reckon a position by an ENU velocity over dt seconds (geodesic step). */
export function deadReckon(p: LonLat, vel: { e: number; n: number } | undefined, dtS: number): LonLat {
  if (!vel || dtS === 0) return p;
  const { heading, speed } = headingSpeed(vel);
  if (speed === 0) return p;
  return destination(p, heading, speed * dtS);
}

/** Geodesic length of a path, metres. */
export function pathLength(path: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += distance(path[i - 1]!, path[i]!);
  return s;
}

/** Geodesic area (m²) and perimeter (m) of a ring; the first point need not be repeated. */
export function ringArea(ring: LonLat[]): { area_m2: number; perimeter_m: number } {
  const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
  if (pts.length < 3) return { area_m2: 0, perimeter_m: pathLength(pts) };
  const p = geod.Polygon(false);
  for (const [lon, lat] of pts) p.AddPoint(lat, lon);
  // Signed: a clockwise ring comes back negative instead of as the rest of the globe.
  const r = p.Compute(false, true);
  return { area_m2: Math.abs(r.area ?? 0), perimeter_m: r.perimeter };
}
