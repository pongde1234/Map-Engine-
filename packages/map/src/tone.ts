/**
 * The colour an operator-drawn object takes. The console gives each one by default and the
 * operator may choose another (`geo_details.color`). Red is kept for hostile and focus blue for
 * selection, so the colours come from FDS's categorical palette, made for telling series apart.
 *
 * In order, the first that applies:
 *   1. The colour the operator chose.
 *   2. A geofence or no-fly zone is amber: a warning, as ever.
 *   3. An object in a live operator layer takes that layer's colour, so a layer reads as a group.
 *   4. Otherwise by type: a kept measurement is green, anything else sapphire.
 */
import type { GeoDetails, OperatorColor } from '@me/schema';
import { THEME_TOKENS, type ThemeKey } from './theme.ts';

export type OperatorTone = Extract<ThemeKey, 'notice' | 'info' | 'cat1' | 'cat2' | 'cat4' | 'cat5' | 'cat6' | 'cat9'>;

/** Each colour an operator can choose, as the theme token it is drawn in. */
export const COLOR_TONE: Record<OperatorColor, OperatorTone> = {
  sapphire: 'info',
  indigo: 'cat1',
  green: 'cat2',
  teal: 'cat6',
  pink: 'cat5',
  lavender: 'cat9',
  steel: 'cat4',
  amber: 'notice',
};

/** The colours as the operator is offered them, in order. */
export const OPERATOR_COLORS = Object.keys(COLOR_TONE) as OperatorColor[];

/** What operator layers cycle through: indigo, green, teal, pink, lavender, steel. */
export const LAYER_TONES: readonly OperatorTone[] = ['cat1', 'cat2', 'cat6', 'cat5', 'cat9', 'cat4'];

/** FNV-1a: a stable number from a layer's id, so a layer keeps its colour as others come and go. */
export function layerHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The colour the console would give with no choice made. `layerLive`: the object's layer still exists. */
export function defaultTone(gd: Pick<GeoDetails, 'type' | 'layer'> | undefined, layerLive: boolean): OperatorTone {
  if (gd?.type === 'geofence' || gd?.type === 'nfz') return 'notice';
  if (gd?.layer && layerLive) return LAYER_TONES[layerHash(gd.layer) % LAYER_TONES.length]!;
  return gd?.type === 'measure' ? 'cat2' : 'info';
}

/** The colour it is drawn in: the operator's choice, else the default. */
export function operatorTone(gd: Pick<GeoDetails, 'type' | 'layer' | 'color'> | undefined, layerLive: boolean): OperatorTone {
  return gd?.color ? COLOR_TONE[gd.color] : defaultTone(gd, layerLive);
}

/** A tone as the colour name the operator sees (every default is one of the choices). */
export const toneColor = (tone: OperatorTone): OperatorColor => OPERATOR_COLORS.find((c) => COLOR_TONE[c] === tone)!;

/** The colour an operator layer gives its objects (also shown beside the layer in the Layers panel). */
export const layerTone = (layerId: string): OperatorTone => defaultTone({ type: 'annotation', layer: layerId }, true);

/** The tone as a CSS colour, for a swatch beside the object in a panel. */
export const toneCss = (tone: OperatorTone): string => `var(${THEME_TOKENS[tone]})`;
