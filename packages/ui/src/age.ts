import type { AgeState } from '@me/schema';
import { DAY, HOUR, MINUTE, SECOND } from '@me/schema';

export const AGE_BADGE = { current: 'Positive', aging: 'Notice', stale: 'Negative', disc: 'Neutral' } as const;
export const AGE_WORD: Record<AgeState, string> = { current: 'CURRENT', aging: 'AGING', stale: 'STALE', disc: 'DISC' };

/** "11 S", "4 MIN", "3 H", "2 D"; "DISC" when the link is down. */
export function ageLabel(ageMs: number, state?: AgeState): string {
  if (state === 'disc') return 'DISC';
  const a = Math.max(0, ageMs);
  if (a < MINUTE) return `${Math.floor(a / SECOND)} S`;
  if (a < HOUR) return `${Math.floor(a / MINUTE)} MIN`;
  if (a < DAY) return `${Math.floor(a / HOUR)} H`;
  return `${Math.floor(a / DAY)} D`;
}
