/**
 * Map theme from FDS Tier-2 tokens, read at runtime. The map never carries its own palette:
 * basemap and overlay colours re-point with the FDS theme (light / dark / Classic).
 * Exception (documented): MIL-STD-2525 symbol fills come from the standard via milsymbol.
 */
export type RGBA = [number, number, number, number];

export interface MapTheme {
  /** CSS colour strings (MapLibre style). */
  css: Record<ThemeKey, string>;
  /** RGBA arrays (deck.gl). */
  rgba: Record<ThemeKey, RGBA>;
  dark: boolean;
}

export const THEME_TOKENS = {
  // FDS dark ramp: moderate (darkest) < subtle < intense. Water/background = sunken.
  sunken: '--background-surface-moderate',
  surface: '--background-surface-intense',
  subtle: '--background-surface-subtle',
  moderate: '--background-neutral-default',
  intense: '--background-surface-intense',
  line: '--border-neutral-default',
  lineStrong: '--border-neutral-highlighted',
  text: '--text-neutral-normal',
  textMuted: '--text-neutral-muted',
  textSubtle: '--text-neutral-subtle',
  brand: '--background-brand-default',
  info: '--background-info-default',
  positive: '--background-positive-default',
  negative: '--background-negative-default',
  notice: '--background-notice-default',
  neutral: '--background-neutral-default',
  infoFaded: '--background-info-faded',
  negativeFaded: '--background-negative-faded',
  noticeFaded: '--background-notice-faded',
  positiveFaded: '--background-positive-faded',
  brandFaded: '--background-brand-faded',
  // Data-age / status colours from the semantic tones (FDS ships no zone tokens).
  zoneNormal: '--background-positive-default',
  zoneWarning: '--background-notice-default',
  zoneCritical: '--background-negative-default',
  zoneUnknown: '--border-neutral-highlighted',
  zoneInfo: '--background-info-default',
  focus: '--border-focused',
} as const;

export type ThemeKey = keyof typeof THEME_TOKENS;

let probe: CanvasRenderingContext2D | null = null;

function toRgba(css: string): RGBA {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const ctx = probe!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

export function readTheme(el: Element = document.documentElement): MapTheme {
  const cs = getComputedStyle(el);
  const css = {} as Record<ThemeKey, string>;
  const rgba = {} as Record<ThemeKey, RGBA>;
  for (const [k, v] of Object.entries(THEME_TOKENS) as Array<[ThemeKey, string]>) {
    const val = cs.getPropertyValue(v).trim() || 'rgb(128,128,128)';
    css[k] = val;
    rgba[k] = toRgba(val);
  }
  const s = rgba.surface;
  const dark = (s[0] * 299 + s[1] * 587 + s[2] * 114) / 1000 < 128;
  return { css, rgba, dark };
}

/** Same colour with a new alpha (0–255). */
export function alpha(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], Math.round(a)];
}

/** Watch FDS theme switches (data-theme on <html>). */
export function onThemeChange(cb: () => void): () => void {
  const mo = new MutationObserver(() => cb());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  return () => mo.disconnect();
}
