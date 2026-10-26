/**
 * Coordinate formats. MGRS is the default readout; DD/DMS are built in. Further grids
 * (Indian Grid zones, IMGRS once the customer supplies its specification) register as plugins.
 */
import * as mgrsNs from 'mgrs';

// mgrs ships ESM (named exports, used by Vite) and CJS (default only, used by Node/tsx).
const mgrs: { forward(ll: [number, number], accuracy?: number): string; toPoint(s: string): [number, number] } =
  (mgrsNs as unknown as { forward?: unknown }).forward ? (mgrsNs as never) : (mgrsNs as unknown as { default: never }).default;
import type { LonLat } from '@me/schema';

export interface CoordinateFormat {
  id: string;
  label: string;
  format(p: LonLat): string;
}

/** "42Q VJ 12345 67890" at 1 m precision (accuracy 5) or coarser. */
export function formatMgrs(p: LonLat, accuracy: 1 | 2 | 3 | 4 | 5 = 5): string {
  const raw = mgrs.forward([p[0], p[1]], accuracy);
  const m = /^(\d{1,2}[C-X])([A-Z]{2})(\d*)$/.exec(raw);
  if (!m) return raw;
  const digits = m[3] ?? '';
  const half = digits.length / 2;
  return `${m[1]} ${m[2]} ${digits.slice(0, half)} ${digits.slice(half)}`.trim();
}

/** Parse an MGRS reference ("42Q WK 88546 72927", spaces optional) to [lon, lat]; null if invalid. */
export function parseMgrs(text: string): LonLat | null {
  const compact = text.replace(/\s+/g, '').toUpperCase();
  if (!/^\d{1,2}[C-X][A-Z]{2}(\d{2}){0,5}$/.test(compact)) return null;
  try {
    const p = mgrs.toPoint(compact);
    return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
  } catch {
    return null;
  }
}

export function formatDD(p: LonLat, places = 4): string {
  const lat = `${Math.abs(p[1]).toFixed(places)}°${p[1] >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(p[0]).toFixed(places)}°${p[0] >= 0 ? 'E' : 'W'}`;
  return `${lat} ${lon}`;
}

function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  const s = Math.round((mFloat - m) * 60);
  return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${v >= 0 ? pos : neg}`;
}

export function formatDMS(p: LonLat): string {
  return `${dms(p[1], 'N', 'S')} ${dms(p[0], 'E', 'W')}`;
}

const registry = new Map<string, CoordinateFormat>();

export function registerCoordinateFormat(f: CoordinateFormat): void {
  registry.set(f.id, f);
}

export function coordinateFormats(): CoordinateFormat[] {
  return [...registry.values()];
}

export function getCoordinateFormat(id: string): CoordinateFormat {
  return registry.get(id) ?? registry.get('mgrs')!;
}

registerCoordinateFormat({ id: 'mgrs', label: 'MGRS', format: (p) => formatMgrs(p) });
registerCoordinateFormat({ id: 'dd', label: 'DD', format: (p) => formatDD(p) });
registerCoordinateFormat({ id: 'dms', label: 'DMS', format: (p) => formatDMS(p) });

/** Range and bearing text, e.g. "34.2 km · 312°". */
export function formatRangeBearing(distanceM: number, azimuthDeg: number): string {
  const r = distanceM >= 10_000 ? `${(distanceM / 1000).toFixed(0)} km` : `${(distanceM / 1000).toFixed(1)} km`;
  return `${r} · ${String(Math.round(azimuthDeg) % 360).padStart(3, '0')}°`;
}

/** Distance text: metres under 1 km, one decimal under 100 km, whole km above. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return m < 100_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString('en')} km`;
}

/** Area text in km² (hectare-scale areas keep two decimals). */
export function formatArea(m2: number): string {
  const km2 = m2 / 1e6;
  if (km2 < 10) return `${km2.toFixed(2)} km²`;
  return `${Math.round(km2).toLocaleString('en')} km²`;
}

/** Bearing text, three digits, degrees true. */
export function formatBearing(deg: number): string {
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
}
