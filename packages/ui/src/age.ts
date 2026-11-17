import type { AgeState } from '@me/schema';
import { DAY, HOUR, MINUTE, SECOND } from '@me/schema';

export const AGE_BADGE = { current: 'Positive', aging: 'Notice', stale: 'Negative', disc: 'Neutral' } as const;
export const AGE_WORD: Record<AgeState, string> = { current: 'Current', aging: 'Aging', stale: 'Stale', disc: 'Disc' };

/** "11 s", "4 min", "3 h", "2 d"; "Disc" when the link is down. */
export function ageLabel(ageMs: number, state?: AgeState): string {
  if (state === 'disc') return 'Disc';
  const a = Math.max(0, ageMs);
  if (a < MINUTE) return `${Math.floor(a / SECOND)} s`;
  if (a < HOUR) return `${Math.floor(a / MINUTE)} min`;
  if (a < DAY) return `${Math.floor(a / HOUR)} h`;
  return `${Math.floor(a / DAY)} d`;
}
