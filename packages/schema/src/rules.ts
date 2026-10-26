/**
 * Rule predicates shared by the server (journaled firings) and the console (live readouts),
 * so both count the same tracks.
 */
import type { Entity } from './entity.ts';

export type GeofenceWatch = 'hostile' | 'unidentified' | 'any';

const GONE = new Set(['destroyed', 'impact', 'withdrawn', 'landed']);

/** Live fused tracks a geofence watches. */
export function watchedBy(e: Entity, watch: GeofenceWatch): boolean {
  if (e.layer !== 'fused' || !e.location || e.ontology?.template !== 'track') return false;
  if (e.track?.state && GONE.has(e.track.state)) return false;
  const id = e.mil_view?.identity;
  if (watch === 'hostile') return id === 'hostile' || id === 'suspect';
  if (watch === 'unidentified') return id === 'pending' || id === 'unknown';
  return true;
}
