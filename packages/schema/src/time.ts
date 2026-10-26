/** Integer milliseconds since the Unix epoch, UTC. Every time in the engine uses this unit. */
export type Ms = number;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A named point on the raid clock, e.g. "H-30" or "D-3". */
export interface ClockMark {
  id: string;
  label: string;
  t: Ms;
}

/**
 * Raid clock: D is the raid reference day, H the moment the first Wave 2 drone reaches R1.
 * Stored in the scenario manifest so every screen derives labels from the data.
 */
export interface RaidClock {
  /** Midnight UTC of day D. */
  d0: Ms;
  /** Absolute time of H. */
  h: Ms;
  marks: ClockMark[];
}

/** Format t relative to the raid clock: "D-3" far from H, "H-30" / "H+05:12" near it. */
export function formatRaidClock(t: Ms, clock: RaidClock, nearWindow: Ms = 6 * HOUR): string {
  const dh = t - clock.h;
  if (Math.abs(dh) <= nearWindow) {
    const sign = dh < 0 ? '-' : '+';
    const abs = Math.abs(dh);
    const m = Math.floor(abs / MINUTE);
    const s = Math.floor((abs % MINUTE) / SECOND);
    return s === 0 ? `H${sign}${m}` : `H${sign}${m}:${String(s).padStart(2, '0')}`;
  }
  const day = Math.floor((t - clock.d0) / DAY);
  return day === 0 ? 'D' : `D${day > 0 ? '+' : ''}${day}`;
}

/** Zulu date-time group, e.g. "06:42:10Z". */
export function formatZulu(t: Ms, withSeconds = true): string {
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}Z` : `${hh}:${mm}Z`;
}

/** Indian Standard Time (UTC+05:30), e.g. "12:12 IST". */
export function formatIst(t: Ms): string {
  const d = new Date(t + 5.5 * HOUR);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} IST`;
}

/** Compact age, e.g. "12s", "4m", "3h", "2d". */
export function formatAge(ageMs: Ms): string {
  if (ageMs < 0) return '0s';
  if (ageMs < MINUTE) return `${Math.floor(ageMs / SECOND)}s`;
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)}m`;
  if (ageMs < DAY) return `${Math.floor(ageMs / HOUR)}h`;
  return `${Math.floor(ageMs / DAY)}d`;
}
