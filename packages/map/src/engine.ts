/**
 * createMapEngine — the imperative map. MapLibre draws the offline basemap; one interleaved
 * deck.gl overlay draws everything else. The engine reads the headless client every frame for
 * positions (no React on the hot path) and the view store for selection and layer toggles.
 */
import { Map as MlMap, ScaleControl, addProtocol, type StyleSpecification, type MapMouseEvent } from 'maplibre-gl';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import type { PickingInfo } from '@deck.gl/core';
import { Protocol } from 'pmtiles';
import type { Entity, LonLat } from '@me/schema';
import { CLASSES, sidcWithIdentity } from '@me/schema';
import { distance } from '@me/geo';
import type { MapClient, ViewStore, Bookmark } from '@me/client';
import { SymbolAtlas } from '@me/symbology';
import { buildStyle, firstSymbolLayerId, type BasemapOptions } from './style.ts';
import { onThemeChange, readTheme, type MapTheme } from './theme.ts';
import { categorize, isThreat, type LayerKey } from './categorize.ts';
import { GROUP_ZOOM, areaFor, areaLayers, engagementLayers, groupMarkerLayers, plotLayer, sketchLayers, symbolSize, trackLayers, type AreaItem, type FrameCtx, type GroupMarker, type PlotItem, type TrackItem } from './layers.ts';
import { DrawController } from './draw.ts';

export interface MapEngineOptions {
  container: HTMLElement;
  client: MapClient;
  view: ViewStore;
  basemap: BasemapOptions;
  center?: [number, number];
  zoom?: number;
  maxBounds?: [[number, number], [number, number]];
}

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
}

export interface MapEngine {
  readonly map: MlMap;
  /** Sketch tools (draw, measure, geofence). */
  readonly tools: DrawController;
  flyTo(cam: Camera, durationMs?: number): void;
  applyBookmark(b: Bookmark): void;
  getCamera(): Camera;
  /** Screen-space pixel of a lon/lat (for anchored HUD widgets). */
  project(lonlat: [number, number]): { x: number; y: number };
  redraw(): void;
  destroy(): void;
  stats(): { fps: number; tracks: number; areas: number };
}

let protocolAdded = false;

interface TrackTemplate {
  version: number;
  key: LayerKey;
  sidc: string;
  label: string;
  hostile: boolean;
  contested: boolean;
  size: number;
}

export function createMapEngine(o: MapEngineOptions): MapEngine {
  if (!protocolAdded) {
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    protocolAdded = true;
  }
  let theme: MapTheme = readTheme();
  const abs = (u?: string) => (u ? new URL(u, location.href).href : undefined);
  const basemap: BasemapOptions = {
    ...o.basemap,
    pmtiles: abs(o.basemap.pmtiles),
    glyphs: o.basemap.glyphs ? decodeURI(abs(o.basemap.glyphs)!) : undefined,
    sprite: abs(o.basemap.sprite),
    dem: abs(o.basemap.dem),
  };
  let style: StyleSpecification = buildStyle(theme, basemap);
  let beforeId = firstSymbolLayerId(style);

  const map = new MlMap({
    container: o.container,
    style,
    center: o.center ?? [69.86, 22.36],
    zoom: o.zoom ?? 7,
    maxBounds: o.maxBounds,
    attributionControl: { compact: true },
    maxPitch: 70,
    hash: false,
    fadeDuration: 0,
  });
  map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
  // The attribution stays one click away behind its ⓘ (ADR 0003) but starts collapsed. MapLibre
  // expands it once, when it first turns compact; collapsing it as soon as that happens sticks.
  const attrib = (o.container as HTMLElement).querySelector('.maplibregl-ctrl-attrib');
  if (attrib) {
    const watch = new MutationObserver(() => {
      if (!attrib.classList.contains('maplibregl-compact-show')) return;
      attrib.classList.remove('maplibregl-compact-show');
      attrib.removeAttribute('open');
      watch.disconnect();
    });
    watch.observe(attrib, { attributes: true, attributeFilter: ['class'] });
  }
  // Diagnostics hook for tests and devtools: document.querySelector('.me-map').__meMap
  (o.container as HTMLElement & { __meMap?: MlMap }).__meMap = map;

  const atlas = new SymbolAtlas({ size: 22, scale: Math.min(2, window.devicePixelRatio || 1) * 1.5 });
  const { client, view } = o;

  // Caches keyed by entity version.
  const areas = new Map<string, { version: number; item: AreaItem | null }>();
  const templates = new Map<string, TrackTemplate>();
  let lastEntitiesVersion = -1;
  let dirty = true;
  let frames = 0;
  let fps = 0;
  let fpsT = performance.now();
  let lastTrackCount = 0;
  /** R3's outer circle: context traffic inside it draws at full strength. */
  let r3: { center: LonLat; radius_m: number } | null = null;

  const tools = new DrawController(map);
  const overlay = new MapLibreOverlay({
    interleaved: true,
    layers: [],
    onHover: (info: PickingInfo) => {
      const id = tools.capturing() ? null : pickId(info);
      if (view.get().hovered !== id) view.set({ hovered: id });
    },
    onClick: (info: PickingInfo) => {
      // While sketching, clicks place vertices (DrawController) instead of selecting.
      if (tools.capturing()) return;
      view.set({ selected: pickId(info) });
    },
    getCursor: ({ isHovering, isDragging }: { isHovering: boolean; isDragging: boolean }) =>
      isDragging ? 'grabbing' : isHovering && !tools.capturing() ? 'pointer' : 'crosshair',
  });
  map.addControl(overlay);

  // Cursor readout, coalesced to one store update per frame.
  let pendingCursor: [number, number] | null = null;
  map.on('mousemove', (e: MapMouseEvent) => {
    pendingCursor = [e.lngLat.lng, e.lngLat.lat];
  });
  map.on('move', () => (dirty = true));

  const unsubClient = client.subscribe(() => (dirty = true));
  const unsubView = view.subscribe(() => (dirty = true));
  const unsubAtlas = atlas.onChange(() => (dirty = true));
  const unsubTools = tools.subscribe(() => (dirty = true));
  const unsubTheme = onThemeChange(() => {
    theme = readTheme();
    style = buildStyle(theme, basemap);
    beforeId = firstSymbolLayerId(style);
    map.setStyle(style);
    areas.clear();
    dirty = true;
  });

  function refreshTemplates(): void {
    const sidcs = new Set<string>();
    r3 = null;
    for (const e of client.entities.values()) {
      const key = categorize(e);
      if (e.geo_details?.ring === 'R3' && e.geo_shape?.type === 'circle') r3 = { center: e.geo_shape.center, radius_m: e.geo_shape.radius_m };
      if (key.startsWith('command') || key === 'reference.vp' || key === 'observation.fragments' || key === 'fused.groups') {
        const cached = areas.get(e.entity_id);
        if (!cached || cached.version !== e.version) {
          const item = areaFor(e, key, theme);
          if (item && e.geo_details?.layer) item.layer = e.geo_details.layer;
          areas.set(e.entity_id, { version: e.version, item });
        }
      }
      if (!e.mil_view || !e.location) continue;
      if (key === 'observation.plots' || key === 'fused.groups') continue;
      const tpl = templates.get(e.entity_id);
      if (tpl && tpl.version === e.version) {
        sidcs.add(tpl.sidc);
        continue;
      }
      const sidc = displaySidc(e);
      sidcs.add(sidc);
      templates.set(e.entity_id, {
        version: e.version,
        key,
        sidc,
        label: labelFor(e),
        hostile: isThreat(e),
        contested: !!e.classification?.contested,
        size: symbolSize(e),
      });
    }
    for (const id of [...areas.keys()]) if (!client.entities.has(id)) areas.delete(id);
    for (const id of [...templates.keys()]) if (!client.entities.has(id)) templates.delete(id);
    atlas.ensure(sidcs);
  }

  function frame(): void {
    raf = requestAnimationFrame(frame);
    frames++;
    const now = performance.now();
    if (now - fpsT >= 1000) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
    }
    if (pendingCursor) {
      view.set({ cursor: pendingCursor });
      pendingCursor = null;
    }
    const playing = client.clock.playing;
    if (!dirty && !playing) return;
    dirty = false;

    const v = client.getVersions();
    if (v.entities !== lastEntitiesVersion) {
      lastEntitiesVersion = v.entities;
      refreshTemplates();
    }
    const vs = view.get();
    const t = client.now();
    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const ctx: FrameCtx = {
      theme,
      atlas: atlas.atlas,
      t,
      zoom,
      pitch,
      visible: vs.layers,
      selected: vs.selected,
      hovered: vs.hovered,
      highlight: new Set(vs.highlight),
      beforeId,
      client,
      project: (p) => map.project(p),
      placed: [],
    };

    const tracks: TrackItem[] = [];
    const plots: PlotItem[] = [];
    const positions = new Map<string, [number, number]>();
    const tmp: [number, number, number] = [0, 0, 0];
    // At theatre zoom a live raid group draws as one marker with its count and its member
    // tracks hide, pending ones included; a selected or hovered member still shows.
    const groups: Entity[] = [];
    const folded = new Set<string>();
    if (zoom < GROUP_ZOOM && vs.layers['fused.groups'] !== false) {
      for (const e of client.entities.values()) {
        if (e.ontology?.template !== 'group' || !e.is_live || !e.group?.members.length) continue;
        groups.push(e);
        for (const m of e.group.members) if (m !== vs.selected && m !== vs.hovered) folded.add(m);
      }
    }
    for (const e of client.entities.values()) {
      if (!e.location) continue;
      const tpl = templates.get(e.entity_id);
      const key = tpl?.key ?? categorize(e);
      const p = client.positionAt(e.entity_id, t, tmp);
      if (!p) continue;
      positions.set(e.entity_id, [p[0], p[1]]);
      if (key === 'observation.plots') {
        if (vs.layers['observation.plots']) plots.push({ id: e.entity_id, pos: [p[0], p[1]] });
        continue;
      }
      if (!tpl || vs.layers[key] === false) continue;
      if (folded.has(e.entity_id)) continue;
      const k = client.kin.get(e.entity_id);
      // Context traffic outside R3 draws quietly unless it is selected or hovered.
      const dim =
        (key === 'fused.civil' || key === 'fused.maritime') &&
        e.entity_id !== vs.selected &&
        e.entity_id !== vs.hovered &&
        !(r3 && distance(r3.center, [p[0], p[1]]) <= r3.radius_m);
      // Declutter: threats shrink at theatre zoom (groups carry the count).
      const size = Math.round(tpl.size * (tpl.hostile && zoom < 7.6 ? 0.7 : dim ? 0.8 : 1));
      tracks.push({
        id: e.entity_id,
        key,
        sidc: tpl.sidc,
        pos: [p[0], p[1], p[2]],
        vel: [k?.ve ?? 0, k?.vn ?? 0],
        age: client.ageState(e.entity_id, t),
        contested: tpl.contested,
        label: tpl.label,
        hostile: tpl.hostile,
        size,
        dim,
      });
    }
    lastTrackCount = tracks.length;
    const markers: GroupMarker[] = [];
    for (const g of groups) {
      const at = g.group!.members.map((m) => positions.get(m)).filter((q): q is [number, number] => !!q);
      if (!at.length) continue;
      const lon = at.reduce((s, q) => s + q[0], 0) / at.length;
      const lat = at.reduce((s, q) => s + q[1], 0) / at.length;
      markers.push({ id: g.entity_id, pos: [lon, lat], count: g.group!.members.length });
    }
    const areaItems: AreaItem[] = [];
    for (const a of areas.values()) if (a.item) areaItems.push(a.item);
    // Fragments also show their symbol at the fragment location (tracks list handles it).
    const layers = [
      ...areaLayers(areaItems, ctx),
      ...(vs.layers['observation.plots'] ? [plotLayer(plots, ctx)] : []),
      ...(vs.layers['event.engagements'] !== false ? engagementLayers(client.events, ctx, positions) : []),
      ...trackLayers(tracks, ctx),
      ...(markers.length ? groupMarkerLayers(markers, ctx) : []),
      ...sketchLayers(tools.get(), tools.measure(), ctx),
    ];
    overlay.setProps({ layers });
  }
  let raf = requestAnimationFrame(frame);

  return {
    map,
    tools,
    flyTo(cam, durationMs = 1200) {
      map.flyTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch ?? 0, bearing: cam.bearing ?? 0, duration: durationMs, essential: true });
    },
    applyBookmark(b) {
      if (b.camera) this.flyTo(b.camera);
      const patch: Partial<ReturnType<ViewStore['get']>> = {};
      if (b.layers) patch.layers = { ...view.get().layers, ...b.layers };
      if (b.select !== undefined) patch.selected = b.select;
      view.set(patch);
      client.seek(b.t);
    },
    getCamera() {
      const c = map.getCenter();
      return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    },
    project(lonlat) {
      const p = map.project(lonlat);
      return { x: p.x, y: p.y };
    },
    redraw() {
      dirty = true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      unsubClient();
      unsubView();
      unsubAtlas();
      unsubTools();
      tools.destroy();
      unsubTheme();
      map.removeControl(overlay);
      overlay.finalize();
      map.remove();
    },
    stats() {
      return { fps: Math.round(fps), tracks: lastTrackCount, areas: areas.size };
    },
  };
}

function pickId(info: PickingInfo): string | null {
  const o = info.object as { id?: string; a?: { id: string } } | undefined;
  if (!o) return null;
  return o.id ?? o.a?.id ?? null;
}

/** SIDC actually drawn: identity from mil_view (pending → hostile progression). */
function displaySidc(e: Entity): string {
  const mv = e.mil_view!;
  try {
    return sidcWithIdentity(mv.sidc, mv.identity);
  } catch {
    return mv.sidc;
  }
}

function labelFor(e: Entity): string {
  const cls = CLASSES[e.ontology?.class ?? ''];
  const name = e.aliases?.track_number ?? e.aliases?.callsign ?? e.aliases?.name ?? e.entity_id;
  return cls && cls.template === 'track' && cls.abbr ? `${name} ${cls.abbr}` : name;
}
