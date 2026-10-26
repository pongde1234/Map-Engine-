/**
 * Magazine state, shared by the fire-unit table and the inspector so a unit reads the same in
 * both: at or under its reserve floor, near it (within a fifth of the load, at least 2 rounds),
 * or healthy.
 */
export type MagState = 'ok' | 'low' | 'floor';

/** ProgressBar colour per state (full is the good outcome). */
export const MAG_COLOR = { ok: 'Positive', low: 'Notice', floor: 'Negative' } as const;

export function magState(ready: number, floor: number, capacity: number): MagState {
  if (ready <= floor) return 'floor';
  if (ready - floor <= Math.max(2, Math.round(capacity * 0.2))) return 'low';
  return 'ok';
}
