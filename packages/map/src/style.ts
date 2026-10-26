/**
 * Offline MapLibre style. Vector basemap from a local PMTiles archive (Protomaps OSM build)
 * coloured from FDS tokens; optional DEM hillshade; international boundaries are NOT drawn
 * from OSM (India's political maps must carry the Survey of India boundary — a separate,
 * authorised layer is added when available).
 */
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import { layers as pmLayers, namedFlavor } from '@protomaps/basemaps';
import type { MapTheme } from './theme.ts';

export interface BasemapOptions {
  /** e.g. "/tiles/basemap.pmtiles"; absent → token background only. */
  pmtiles?: string;
  /** e.g. "/tiles/fonts/{fontstack}/{range}.pbf" */
  glyphs?: string;
  /** e.g. "/tiles/sprites/v4/dark" */
  sprite?: string;
  /** Terrarium-encoded DEM PMTiles for hillshade. */
  dem?: string;
  /** Hide boundaries from OSM (default true). */
  hideBoundaries?: boolean;
}

export const ATTRIBUTION = '© OpenStreetMap contributors (ODbL) · Protomaps · Copernicus DEM GLO-30 (DLR/Airbus, ESA)';

export function buildStyle(theme: MapTheme, o: BasemapOptions): StyleSpecification {
  const c = theme.css;
  const style: StyleSpecification = {
    version: 8,
    ...(o.glyphs ? { glyphs: o.glyphs } : {}),
    ...(o.sprite ? { sprite: o.sprite } : {}),
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': c.sunken } }],
  };
  if (o.pmtiles) {
    style.sources.protomaps = { type: 'vector', url: `pmtiles://${o.pmtiles}`, attribution: ATTRIBUTION };
    const flavor = {
      ...namedFlavor(theme.dark ? 'dark' : 'light'),
      background: c.sunken,
      earth: c.surface,
      water: c.sunken,
      boundaries: c.lineStrong,
      buildings: c.subtle,
      ocean_label: c.textSubtle,
      city_label: c.textMuted,
      city_label_halo: c.sunken,
      state_label: c.textSubtle,
      state_label_halo: c.sunken,
      country_label: c.textSubtle,
      subplace_label: c.textSubtle,
      subplace_label_halo: c.sunken,
      roads_label_minor: c.textSubtle,
      roads_label_minor_halo: c.sunken,
      roads_label_major: c.textSubtle,
      roads_label_major_halo: c.sunken,
      highway: c.line,
      major: c.line,
      minor_a: c.subtle,
      minor_b: c.subtle,
      railway: c.line,
    };
    let ls: LayerSpecification[] = pmLayers('protomaps', flavor, { lang: 'en' }) as LayerSpecification[];
    if (o.hideBoundaries ?? true) ls = ls.filter((l) => !l.id.includes('boundar'));
    // No glyphs offline → drop symbol layers rather than fail.
    if (!o.glyphs) ls = ls.filter((l) => l.type !== 'symbol');
    if (!o.sprite) ls = ls.filter((l) => !(l.type === 'symbol' && l.layout && 'icon-image' in l.layout));
    style.layers = ls;
  }
  if (o.dem) {
    style.sources.dem = { type: 'raster-dem', url: `pmtiles://${o.dem}`, encoding: 'terrarium', tileSize: 256 };
    const firstSymbol = style.layers.findIndex((l) => l.type === 'symbol');
    const hill: LayerSpecification = {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: { 'hillshade-shadow-color': c.sunken, 'hillshade-highlight-color': c.moderate, 'hillshade-exaggeration': 0.35 },
    };
    style.layers.splice(firstSymbol < 0 ? style.layers.length : firstSymbol, 0, hill);
  }
  return style;
}

/** First symbol layer id: deck area bands render beneath basemap labels. */
export function firstSymbolLayerId(style: StyleSpecification): string | undefined {
  return style.layers.find((l) => l.type === 'symbol')?.id;
}
