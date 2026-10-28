/**
 * Where an object is, as one point to fly the map to: a track's position, a point or a shape's
 * centre, the middle of a polygon or a line. `null` for what has no place (an alert rule, a source).
 */
import type { Entity } from '@me/schema';

export function entityCenter(e: Pick<Entity, 'location' | 'geo_shape'>): [number, number] | null {
  if (e.location) return [e.location.lon, e.location.lat];
  const g = e.geo_shape;
  if (!g) return null;
  switch (g.type) {
    case 'point':
      return [g.coordinates[0], g.coordinates[1]];
    case 'circle':
    case 'sector':
    case 'ellipse':
      return [g.center[0], g.center[1]];
    case 'line': {
      const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
      return mid ? [mid[0], mid[1]] : null;
    }
    case 'polygon': {
      const ring = g.coordinates[0];
      if (!ring?.length) return null;
      // The closing vertex repeats the first: left out of the mean.
      const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
      return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    }
    default:
      return null;
  }
}
