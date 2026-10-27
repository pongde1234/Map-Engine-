/**
 * deck.gl layer construction. Bands (bottom → top): command areas, reference, observation,
 * fused tracks, labels, selection. Areas render beneath basemap labels via beforeId.
 *
 * Colours: overlays use FDS tokens through MapTheme; symbol fills are MIL-STD-2525 artwork.
 */
import { IconLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import type { Layer } from '@deck.gl/core';
import type { Entity, EngagementPayload, JournalRecord, LonLat } from '@me/schema';
import { CLASSES } from '@me/schema';
import { circle, destination, formatArea, formatBearing, formatDistance, shapeToPolygon } from '@me/geo';
import type { MapClient } from '@me/client';
import type { Atlas } from '@me/symbology';
import type { MapTheme, RGBA } from './theme.ts';
import { alpha } from './theme.ts';
import { operatorLayerKey, type LayerKey } from './categorize.ts';
import type { DrawState, SketchMeasure } from './draw.ts';

export interface AreaItem {
  id: string;
  key: LayerKey;
  polygons: LonLat[][];
  line?: LonLat[];
  /** A marker (operator point objects). */
  point?: LonLat;
  label?: string;
  labelAt?: LonLat;
  fill: RGBA;
  stroke: RGBA;
  dashed: boolean;
  width: number;
  /** Operator objects: the operator layer it sits in, whose own toggle shows or hides it. */
  layer?: string;
}

export interface TrackItem {
  id: string;
  key: LayerKey;
  sidc: string;
  pos: [number, number, number];
  vel: [number, number];
  age: 'current' | 'aging' | 'stale' | 'disc';
  contested: boolean;
  label: string;
  hostile: boolean;
  size: number;
  /** Context traffic (civil air, AIS) outside R3, drawn quietly unless selected or hovered. */
  dim: boolean;
}

/** One raid group drawn as a single marker with its member count (theatre zoom). */
export interface GroupMarker {
  id: string;
  pos: [number, number];
  count: number;
}

/** Below this zoom a raid group is one marker with its count; its hostile tracks hide. */
export const GROUP_ZOOM = 7;

export interface FrameCtx {
  theme: MapTheme;
  atlas: Atlas | null;
  t: number;
  zoom: number;
  pitch: number;
  visible: Record<string, boolean>;
  selected: string | null;
  hovered: string | null;
  highlight: Set<string>;
  beforeId: string | undefined;
  client: MapClient;
  project: (p: [number, number]) => { x: number; y: number };
  /** Screen boxes already taken this frame (shared by every label layer). */
  placed: Array<[number, number, number, number]>;
}

// ------------------------------------------------------------------ areas (built per entity version)

export function areaFor(e: Entity, key: LayerKey, theme: MapTheme): AreaItem | null {
  const shape = e.geo_shape;
  if (!shape) return null;
  const r = theme.rgba;
  const gd = e.geo_details;
  // A restrained palette: neutral by default, amber for warnings, red only for threats; blue is
  // kept for selection. Fills show only on hover or selection (areaLayers), so these are the
  // colours an area takes when it is looked at.
  let fill: RGBA = alpha(r.lineStrong, 0);
  let stroke: RGBA = alpha(r.lineStrong, 200);
  let dashed = false;
  let width = 1;
  switch (key) {
    case 'command.rings':
      stroke = alpha(r.textSubtle, 140);
      dashed = gd?.ring !== 'R4';
      break;
    case 'command.wcs': {
      // Weapons free and tight are warnings (amber, solid and dashed); hold is neutral.
      const tone = gd?.wcs === 'hold' ? r.lineStrong : r.notice;
      fill = alpha(tone, 22);
      stroke = alpha(tone, gd?.wcs === 'hold' ? 170 : 160);
      dashed = gd?.wcs !== 'free';
      break;
    }
    case 'command.restrictions':
      fill = alpha(r.lineStrong, 22);
      stroke = alpha(r.lineStrong, 190);
      dashed = gd?.status !== 'active';
      break;
    case 'command.pickets':
      fill = alpha(r.lineStrong, 24);
      stroke = alpha(r.lineStrong, 200);
      width = 1.5;
      break;
    case 'command.softkill':
      fill = alpha(r.textSubtle, 22);
      stroke = alpha(r.textSubtle, 150);
      dashed = true;
      break;
    case 'command.aimpoints':
      fill = alpha(r.negative, 50);
      stroke = alpha(r.negative, 230);
      width = 1.5;
      break;
    case 'command.axes':
      stroke = alpha(r.negative, 150);
      width = 1.5;
      dashed = true;
      break;
    case 'command.operator':
      // Geofences and operator NFZs are warnings; other operator objects are neutral.
      if (gd?.type === 'geofence' || gd?.type === 'nfz') {
        fill = alpha(r.notice, 20);
        stroke = alpha(r.notice, 230);
        dashed = true;
      } else {
        fill = alpha(r.text, 16);
        stroke = alpha(r.text, 210);
      }
      width = 1.5;
      break;
    case 'reference.vp': {
      // Defended assets: Tier-1 notice, Tier-2 neutral. Red stays reserved for hostile/aimpoints.
      const complex = e.entity_id === 'VP-RIL';
      const tone = gd?.tier === 1 ? r.notice : r.lineStrong;
      fill = alpha(tone, complex ? 0 : 60);
      stroke = alpha(tone, complex ? 150 : 230);
      dashed = complex;
      width = complex ? 1.5 : 1;
      break;
    }
    case 'fused.groups':
      fill = alpha(r.negative, 18);
      stroke = alpha(r.negative, 170);
      dashed = true;
      break;
    case 'observation.fragments':
      fill = alpha(e.fragment?.associated === false ? r.neutral : r.negative, 20);
      stroke = alpha(e.fragment?.associated === false ? r.neutral : r.negative, 180);
      dashed = true;
      break;
    default:
      break;
  }
  if (key === 'fused.groups' && shape.type === 'polygon') {
    const n = e.group?.members.length ?? 0;
    const ring = shape.coordinates[0] ?? [];
    // Label at the northernmost hull vertex.
    const top = ring.reduce<LonLat | undefined>((a, p) => (!a || p[1] > a[1] ? p : a), undefined);
    return { id: e.entity_id, key, polygons: shape.coordinates, label: `${e.aliases?.name ?? e.entity_id} · ${n}`, labelAt: top, fill, stroke, dashed, width: 1 };
  }
  const label = key === 'command.operator' && gd?.type === 'geofence' ? `GF · ${gd.label ?? e.entity_id}` : gd?.label;
  if (shape.type === 'line') {
    return { id: e.entity_id, key, polygons: [], line: shape.coordinates, label, labelAt: shape.coordinates[Math.floor(shape.coordinates.length / 2)], fill, stroke, dashed, width };
  }
  if (shape.type === 'point' && key === 'command.operator') {
    return { id: e.entity_id, key, polygons: [], point: shape.coordinates, label, labelAt: shape.coordinates, fill, stroke, dashed, width };
  }
  if (shape.type === 'point') {
    // Aimpoint: small ring around the point.
    const ring = shapeToPolygon({ type: 'circle', center: shape.coordinates, radius_m: 350 });
    return { id: e.entity_id, key, polygons: ring, label: gd?.label, labelAt: shape.coordinates, fill, stroke, dashed, width };
  }
  const polygons = shapeToPolygon(shape);
  const labelAt = labelPoint(shape, polygons);
  return { id: e.entity_id, key, polygons, label, labelAt, fill, stroke, dashed, width };
}

function labelPoint(shape: NonNullable<Entity['geo_shape']>, polys: LonLat[][]): LonLat | undefined {
  switch (shape.type) {
    case 'circle':
      return destination(shape.center, 330, shape.radius_m);
    case 'sector':
      return destination(shape.center, (shape.az_start + ((((shape.az_end - shape.az_start) % 360) + 360) % 360) / 2) % 360, shape.radius_m * 0.92);
    case 'ellipse':
      return shape.center;
    default: {
      const ring = polys[0];
      if (!ring?.length) return undefined;
      let x = 0;
      let y = 0;
      for (const p of ring) {
        x += p[0];
        y += p[1];
      }
      return [x / ring.length, y / ring.length];
    }
  }
}

// ------------------------------------------------------------------ deck layers

/**
 * Props outside the base layer typings: interleaved `beforeId` (MapLibre stack) and
 * extension props (PathStyle dash, CollisionFilter). Spread as untyped objects.
 */
function before(ctx: FrameCtx): object {
  return ctx.beforeId ? { beforeId: ctx.beforeId } : {};
}
function dashed<T>(get: (d: T) => [number, number], ext: PathStyleExtension): object {
  return { getDashArray: get, dashJustified: true, extensions: [ext] };
}
/**
 * Screen-space label declutter (greedy, by priority). deck.gl's CollisionFilterExtension does
 * not draw under the interleaved MapLibre overlay, so placement is done here on the CPU:
 * cheap for the few hundred labels a picture carries.
 */
export function declutter<T>(
  items: T[],
  pos: (d: T) => [number, number],
  text: (d: T) => string,
  priority: (d: T) => number,
  project: (p: [number, number]) => { x: number; y: number },
  offsetX = 0,
  placed: Array<[number, number, number, number]> = [],
): T[] {
  const CHAR_W = 6.6;
  const H = 13;
  const out: T[] = [];
  const sorted = [...items].sort((a, b) => priority(b) - priority(a));
  for (const d of sorted) {
    const p = project(pos(d));
    const w = text(d).length * CHAR_W;
    const x0 = p.x + offsetX - 2;
    const y0 = p.y - H / 2 - 1;
    const box: [number, number, number, number] = [x0, y0, x0 + w + 4, y0 + H + 2];
    if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) continue;
    placed.push(box);
    out.push(d);
  }
  return out;
}

export function areaLayers(areas: AreaItem[], ctx: FrameCtx): Layer[] {
  // An object in an operator layer follows that layer's toggle; once the layer is withdrawn it
  // falls back to "Operator objects".
  const vis = areas.filter((a) => (a.layer && ctx.client.entities.has(a.layer) ? ctx.visible[operatorLayerKey(a.layer)] !== false : ctx.visible[a.key] !== false));
  const polys = vis.filter((a) => a.polygons.length);
  const lines = vis.filter((a) => a.line);
  const points = vis.filter((a) => a.point);
  const dash = new PathStyleExtension({ dash: true });
  // Labels on demand: the area hovered or selected, or every area once zoomed in.
  const labels = declutter(
    vis.filter((a) => a.label && a.labelAt && (a.id === ctx.selected || a.id === ctx.hovered || ctx.zoom >= labelZoom(a.key))),
    (a) => a.labelAt!,
    (a) => a.label!,
    (a) => (a.id === ctx.selected ? 10 : a.id === ctx.hovered ? 9 : a.key === 'fused.groups' ? 5 : a.key === 'command.aimpoints' ? 4 : a.key === 'command.rings' ? 3 : 1),
    ctx.project,
    0,
    ctx.placed,
  );
  return [
    // Areas are outlines; the fill shows only on the area hovered or selected. Every polygon
    // stays in this layer at a near-zero alpha, since the fill is what makes an area pickable.
    new PolygonLayer<AreaItem>({
      id: 'areas-fill',
      data: polys,
      ...before(ctx),
      getPolygon: (a) => a.polygons,
      getFillColor: (a) => (a.id === ctx.selected ? alpha(a.fill, Math.min(255, a.fill[3] + 40)) : a.id === ctx.hovered ? a.fill : alpha(a.fill, 1)),
      stroked: false,
      filled: true,
      pickable: true,
      updateTriggers: { getFillColor: [ctx.selected, ctx.hovered, ctx.theme] },
    }) as unknown as Layer,
    new PathLayer<{ a: AreaItem; path: LonLat[] }>({
      id: 'areas-stroke',
      data: polys.flatMap((a) => a.polygons.map((p) => ({ a, path: p }))),
      ...before(ctx),
      getPath: (d) => d.path,
      getColor: (d) => (d.a.id === ctx.selected ? ctx.theme.rgba.focus : d.a.stroke),
      getWidth: (d) => (d.a.id === ctx.selected ? d.a.width + 1 : d.a.width),
      widthUnits: 'pixels',
      ...dashed<{ a: AreaItem }>((d) => (d.a.dashed ? [6, 4] : [0, 0]), dash),
      updateTriggers: { getColor: [ctx.selected, ctx.theme], getWidth: [ctx.selected] },
    }) as unknown as Layer,
    new PathLayer<AreaItem>({
      id: 'areas-lines',
      data: lines,
      ...before(ctx),
      getPath: (a) => a.line!,
      getColor: (a) => (a.id === ctx.selected ? ctx.theme.rgba.focus : a.stroke),
      getWidth: (a) => (a.id === ctx.selected ? a.width + 1 : a.width),
      widthUnits: 'pixels',
      ...dashed<AreaItem>((a) => (a.dashed ? [10, 6] : [0, 0]), dash),
      pickable: true,
      updateTriggers: { getColor: [ctx.selected, ctx.theme], getWidth: [ctx.selected] },
    }) as unknown as Layer,
    new ScatterplotLayer<AreaItem>({
      id: 'areas-points',
      data: points,
      getPosition: (a) => a.point!,
      getRadius: (a) => (a.id === ctx.selected ? 7 : 5),
      radiusUnits: 'pixels',
      getFillColor: (a) => alpha(a.stroke, 90),
      getLineColor: (a) => (a.id === ctx.selected ? ctx.theme.rgba.focus : a.stroke),
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      stroked: true,
      pickable: true,
      updateTriggers: { getRadius: [ctx.selected], getLineColor: [ctx.selected, ctx.theme] },
    }) as unknown as Layer,
    // No label layer when nothing is labelled: an empty 'auto' character set gives the text
    // layer an empty font atlas, which WebGL rejects.
    ...(labels.length
      ? [
          new TextLayer<AreaItem>({
            id: 'areas-labels',
            data: labels,
            getPosition: (a) => a.labelAt!,
            getText: (a) => a.label!,
            getPixelOffset: (a) => (a.point ? [9, 0] : [0, 0]),
            getSize: 11,
            getColor: (a) => alpha(a.stroke, 235),
            fontFamily: 'JetBrains Mono Variable, JetBrains Mono, monospace',
            fontWeight: 500,
            characterSet: 'auto',
            getTextAnchor: 'start',
            getAlignmentBaseline: 'center',
            outlineWidth: 3,
            outlineColor: alpha(ctx.theme.rgba.sunken, 230),
            fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          }) as unknown as Layer,
        ]
      : []),
  ];
}

/** The zoom from which an area's label shows without hovering it. */
function labelZoom(key: LayerKey): number {
  if (key === 'reference.vp') return 11;
  if (key === 'command.aimpoints') return 9;
  return 9.5;
}

/** Raid groups at theatre zoom: one marker per group with its member count. */
export function groupMarkerLayers(markers: GroupMarker[], ctx: FrameCtx): Layer[] {
  const r = ctx.theme.rgba;
  return [
    new ScatterplotLayer<GroupMarker>({
      id: 'group-markers',
      data: markers,
      getPosition: (d) => d.pos,
      getRadius: (d) => (d.id === ctx.selected || d.id === ctx.hovered ? 13 : 11),
      radiusUnits: 'pixels',
      getFillColor: alpha(r.negative, 230),
      getLineColor: (d) => (d.id === ctx.selected ? r.focus : alpha(r.sunken, 255)),
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => (d.id === ctx.selected ? 2 : 1.5),
      stroked: true,
      pickable: true,
      updateTriggers: { getRadius: [ctx.selected, ctx.hovered], getLineColor: [ctx.selected, ctx.theme], getLineWidth: [ctx.selected] },
    }) as unknown as Layer,
    new TextLayer<GroupMarker>({
      id: 'group-counts',
      data: markers,
      getPosition: (d) => d.pos,
      getText: (d) => String(d.count),
      getSize: 11,
      getColor: alpha(r.sunken, 255),
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'Inter Variable, Inter, sans-serif',
      fontWeight: 600,
      characterSet: '0123456789',
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
    }) as unknown as Layer,
  ];
}

export function trackLayers(items: TrackItem[], ctx: FrameCtx): Layer[] {
  const r = ctx.theme.rgba;
  const atlas = ctx.atlas;
  const pitched = ctx.pitch > 5;
  const out: Layer[] = [];
  const ageColor = (a: TrackItem['age']): RGBA =>
    a === 'aging' ? r.zoneWarning : a === 'stale' ? r.zoneCritical : a === 'disc' ? r.zoneUnknown : r.zoneNormal;

  if (ctx.visible['track.trails'] !== false) {
    const trails: Array<{ id: string; path: number[][]; hostile: boolean; dim: boolean }> = [];
    for (const it of items) {
      const tr = ctx.client.trails.get(it.id);
      if (!tr || tr.length < 6) continue;
      const path: number[][] = [];
      for (let i = 0; i < tr.length; i += 3) path.push([tr[i]!, tr[i + 1]!]);
      path.push([it.pos[0], it.pos[1]]);
      trails.push({ id: it.id, path, hostile: it.hostile, dim: it.dim });
    }
    out.push(
      new PathLayer<(typeof trails)[number]>({
        id: 'track-trails',
        data: trails,
        getPath: (d) => d.path as unknown as LonLat[],
        getColor: (d) => alpha(d.hostile ? r.negative : r.textSubtle, d.dim ? 40 : 90),
        getWidth: 1,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      }) as unknown as Layer,
    );
  }

  if (ctx.visible['track.leaders'] !== false) {
    out.push(
      new LineLayer<TrackItem>({
        id: 'track-leaders',
        data: items.filter((i) => i.vel[0] !== 0 || i.vel[1] !== 0),
        getSourcePosition: (d) => [d.pos[0], d.pos[1]],
        getTargetPosition: (d) => {
          const p = destination([d.pos[0], d.pos[1]], (Math.atan2(d.vel[0], d.vel[1]) * 180) / Math.PI, Math.hypot(d.vel[0], d.vel[1]) * 60);
          return [p[0], p[1]];
        },
        getColor: (d) => alpha(d.hostile ? r.negative : r.text, 160),
        getWidth: 1,
        widthUnits: 'pixels',
      }) as unknown as Layer,
    );
  }

  if (pitched) {
    out.push(
      new LineLayer<TrackItem>({
        id: 'track-stalks',
        data: items.filter((i) => i.pos[2] > 50),
        getSourcePosition: (d) => [d.pos[0], d.pos[1], 0],
        getTargetPosition: (d) => [d.pos[0], d.pos[1], d.pos[2] * 6],
        getColor: alpha(r.textSubtle, 110),
        getWidth: 1,
        widthUnits: 'pixels',
      }) as unknown as Layer,
    );
  }

  // Age halo: only for tracks that are not CURRENT (glyph-first: colour + ring says "old").
  out.push(
    new ScatterplotLayer<TrackItem>({
      id: 'track-age',
      data: items.filter((i) => i.age !== 'current'),
      getPosition: (d) => (pitched ? [d.pos[0], d.pos[1], d.pos[2] * 6] : [d.pos[0], d.pos[1]]),
      getRadius: (d) => d.size * 0.75,
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: (d) => alpha(ageColor(d.age), 220),
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      updateTriggers: { getLineColor: [ctx.theme] },
    }) as unknown as Layer,
  );

  if (atlas) {
    out.push(
      new IconLayer<TrackItem>({
        id: 'track-icons',
        data: items,
        iconAtlas: atlas.canvas as unknown as string,
        iconMapping: atlas.mapping,
        getIcon: (d) => d.sidc,
        getPosition: (d) => (pitched ? [d.pos[0], d.pos[1], d.pos[2] * 6] : [d.pos[0], d.pos[1]]),
        getSize: (d) => d.size,
        sizeUnits: 'pixels',
        // The RGB is ignored (the symbol carries its 2525 colours); alpha says old or context.
        getColor: (d) => [255, 255, 255, Math.min(d.age === 'stale' ? 120 : d.age === 'disc' ? 90 : 255, d.dim ? 130 : 255)],
        pickable: true,
        billboard: true,
        alphaCutoff: 0.02,
        updateTriggers: { getIcon: [atlas.version] },
      }) as unknown as Layer,
    );
  }

  // Contested marker: a notice-coloured pip to the upper right of the symbol.
  if (ctx.visible['fused.contested'] !== false) {
    out.push(
      new TextLayer<TrackItem>({
        id: 'track-contested',
        data: items.filter((i) => i.contested),
        getPosition: (d) => [d.pos[0], d.pos[1]],
        getText: () => '◆',
        getSize: 9,
        getPixelOffset: (d) => [d.size * 0.62, -d.size * 0.62],
        getColor: r.notice,
        characterSet: ['◆'],
        fontFamily: 'Inter Variable, Inter, sans-serif',
        outlineWidth: 2,
        outlineColor: alpha(r.sunken, 255),
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
      }) as unknown as Layer,
    );
  }

  // As with area labels, no layer when nothing is labelled (an empty font atlas).
  if (ctx.visible['track.labels'] !== false) {
    // Installations are labelled by their area; symbols only label tracks and assets. Labels on
    // demand: the track selected or hovered, or every labelled track once zoomed in (context
    // traffic stays unlabelled).
    const candidates = items.filter((i) => i.key !== 'reference.vp' && (i.id === ctx.selected || i.id === ctx.hovered || (ctx.zoom >= 9 && i.label && !i.dim)));
    const labelled = declutter(
      candidates,
      (d) => [d.pos[0], d.pos[1]],
      (d) => d.label,
      (d) => (d.id === ctx.selected ? 100 : d.id === ctx.hovered ? 90 : d.hostile ? 10 : 1),
      ctx.project,
      12,
      ctx.placed,
    );
    if (labelled.length) {
      out.push(
        new TextLayer<TrackItem>({
          id: 'track-labels',
          data: labelled,
          getPosition: (d) => [d.pos[0], d.pos[1]],
          getText: (d) => d.label,
          getSize: 11,
          getColor: (d) => (d.hostile ? r.text : alpha(r.textSubtle, 235)),
          getPixelOffset: (d) => [d.size * 0.65, 0],
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          fontFamily: 'JetBrains Mono Variable, JetBrains Mono, monospace',
          fontWeight: 500,
          outlineWidth: 3,
          outlineColor: alpha(r.sunken, 235),
          fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
          characterSet: 'auto',
        }) as unknown as Layer,
      );
    }
  }

  // Selection / hover rings on top.
  const sel = items.filter((i) => i.id === ctx.selected || i.id === ctx.hovered || ctx.highlight.has(i.id));
  out.push(
    new ScatterplotLayer<TrackItem>({
      id: 'track-select',
      data: sel,
      getPosition: (d) => (pitched ? [d.pos[0], d.pos[1], d.pos[2] * 6] : [d.pos[0], d.pos[1]]),
      getRadius: (d) => d.size * 0.95,
      radiusUnits: 'pixels',
      stroked: true,
      filled: false,
      getLineColor: (d) => (d.id === ctx.selected ? r.focus : alpha(r.focus, 140)),
      lineWidthUnits: 'pixels',
      getLineWidth: (d) => (d.id === ctx.selected ? 2 : 1.5),
      updateTriggers: { getLineColor: [ctx.selected, ctx.hovered], getLineWidth: [ctx.selected] },
    }) as unknown as Layer,
  );
  return out;
}

export interface PlotItem {
  id: string;
  pos: [number, number];
}

export function plotLayer(plots: PlotItem[], ctx: FrameCtx): Layer {
  return new ScatterplotLayer<PlotItem>({
    id: 'obs-plots',
    data: plots,
    getPosition: (d) => d.pos,
    getRadius: 2,
    radiusUnits: 'pixels',
    getFillColor: alpha(ctx.theme.rgba.zoneUnknown, 170),
    pickable: true,
  }) as unknown as Layer;
}

/** Engagements in the last window: assignment/launch lines and kill markers. */
export function engagementLayers(events: JournalRecord[], ctx: FrameCtx, positions: Map<string, [number, number]>): Layer[] {
  const r = ctx.theme.rgba;
  const recentLines: Array<{ from: [number, number]; to: [number, number]; result: string }> = [];
  const kills: Array<{ at: [number, number]; age: number; result: string }> = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ctx.t - ev.ingest_time > 90_000) break;
    if (ev.kind !== 'engagement') continue;
    const p = ev.payload as EngagementPayload;
    const age = ctx.t - ev.ingest_time;
    if (p.result === 'kill' && p.intercept) kills.push({ at: p.intercept, age, result: p.result });
    else if (p.result === 'refused') {
      const tgt = positions.get(p.target_id);
      if (tgt) kills.push({ at: tgt, age, result: 'refused' });
    } else if ((p.result === 'assigned' || p.result === 'launched') && age < 60_000) {
      const from = positions.get(p.effector_id);
      const to = positions.get(p.target_id);
      if (from && to) recentLines.push({ from, to, result: p.result });
    }
  }
  return [
    new LineLayer<(typeof recentLines)[number]>({
      id: 'eng-lines',
      data: recentLines,
      getSourcePosition: (d) => d.from,
      getTargetPosition: (d) => d.to,
      getColor: (d) => alpha(d.result === 'launched' ? r.zoneInfo : r.textSubtle, 170),
      getWidth: 1,
      widthUnits: 'pixels',
    }) as unknown as Layer,
    new TextLayer<(typeof kills)[number]>({
      id: 'eng-kills',
      data: kills,
      getPosition: (d) => d.at,
      getText: (d) => (d.result === 'refused' ? '⊘' : '✕'),
      getSize: (d) => (d.result === 'refused' ? 18 : 14),
      getColor: (d) => alpha(d.result === 'refused' ? r.notice : r.zoneCritical, Math.max(60, 255 - (d.age / 90_000) * 200)),
      characterSet: ['✕', '⊘'],
      fontFamily: 'Inter Variable, Inter, sans-serif',
      outlineWidth: 2,
      outlineColor: alpha(r.sunken, 200),
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
    }) as unknown as Layer,
  ];
}

export function symbolSize(e: Entity): number {
  const cls = CLASSES[e.ontology?.class ?? ''];
  if (!cls) return 22;
  if (cls.template === 'installation') return 22;
  if (cls.environment === 'surface') return 18;
  if (cls.id === 'civil_air') return 18;
  if (cls.template === 'effector' || cls.template === 'sensor') return 24;
  return 24;
}

// ------------------------------------------------------------------ sketch (draw · measure · geofence)

interface SketchLabel {
  at: LonLat;
  text: string;
  /** The next-step hint beside the cursor (smaller, under the readout). */
  hint?: boolean;
}

const mid = (a: LonLat, b: LonLat): LonLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** What finishes the sketch from here, said where the eye already is. */
function nextStep(s: DrawState): string | null {
  if (s.done || !s.points.length) return null;
  if (s.shape === 'circle') return 'click the edge · Esc cancels';
  if (s.shape === 'polygon') return s.points.length >= 3 ? 'click the first corner or double-click to finish' : 'click the next corner · Esc cancels';
  if (s.shape === 'line') return s.points.length >= 2 ? 'double-click or Enter to finish' : 'click the next point · Esc cancels';
  return null;
}

/** The sketch being drawn, on top of everything: outline, rubber band, vertices, measurements. */
export function sketchLayers(s: DrawState, m: SketchMeasure, ctx: FrameCtx): Layer[] {
  if (!s.tool || !s.points.length) return [];
  const r = ctx.theme.rgba;
  const tone = s.tool === 'geofence' ? r.notice : r.focus;
  const dash = new PathStyleExtension({ dash: true });
  const pts = s.points;
  const live = !s.done && s.cursor ? s.cursor : null;

  const fills: LonLat[][] = [];
  const solid: LonLat[][] = [];
  const band: LonLat[][] = [];
  const labels: SketchLabel[] = [];

  if (s.shape === 'circle') {
    const c = pts[0]!;
    if (s.radius_m > 0) {
      const ring = circle(c, s.radius_m);
      fills.push(ring);
      solid.push(ring);
      const edge = live ?? ring[Math.floor(ring.length / 4)]!;
      band.push([c, edge]);
      labels.push({ at: mid(c, edge), text: `r ${formatDistance(s.radius_m)}` });
    }
  } else if (s.shape !== 'point') {
    const path = live ? [...pts, live] : pts;
    if (s.shape === 'polygon' && path.length >= 3) fills.push([...path, path[0]!]);
    solid.push(s.shape === 'polygon' && s.done ? [...pts, pts[0]!] : pts);
    if (live) band.push(s.shape === 'polygon' && pts.length >= 2 ? [pts[pts.length - 1]!, live, pts[0]!] : [pts[pts.length - 1]!, live]);
    // Segment labels for measuring; one summary label for the other tools.
    if (s.tool === 'measure') for (const g of m.segments) labels.push({ at: mid(g.from, g.to), text: `${formatDistance(g.length_m)} · ${formatBearing(g.bearing_deg)}` });
    const end = live ?? path[path.length - 1]!;
    if (m.area_m2 !== undefined && m.area_m2 > 0) labels.push({ at: end, text: `${formatArea(m.area_m2)} · ${formatDistance(m.perimeter_m ?? 0)} perimeter` });
    else if (m.segments.length > 1 || (s.tool !== 'measure' && m.segments.length)) labels.push({ at: end, text: `Σ ${formatDistance(m.length_m)}` });
  }

  const step = nextStep(s);
  if (step) labels.push({ at: live ?? pts[pts.length - 1]!, text: step, hint: true });

  const vertices = s.shape === 'circle' ? [pts[0]!] : pts;
  return [
    new PolygonLayer<LonLat[]>({
      id: 'sketch-fill',
      data: fills,
      getPolygon: (d) => d,
      getFillColor: alpha(tone, 36),
      stroked: false,
    }) as unknown as Layer,
    new PathLayer<LonLat[]>({
      id: 'sketch-path',
      data: solid,
      getPath: (d) => d,
      getColor: alpha(tone, 240),
      getWidth: 2,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }) as unknown as Layer,
    new PathLayer<LonLat[]>({
      id: 'sketch-band',
      data: band,
      getPath: (d) => d,
      getColor: alpha(tone, 200),
      getWidth: 1.5,
      widthUnits: 'pixels',
      ...dashed<LonLat[]>(() => [6, 4], dash),
    }) as unknown as Layer,
    new ScatterplotLayer<LonLat>({
      id: 'sketch-vertices',
      data: vertices,
      getPosition: (d) => d,
      getRadius: (_d, { index }) => (index === 0 && s.shape === 'polygon' && !s.done && pts.length >= 3 ? 6 : 4),
      radiusUnits: 'pixels',
      getFillColor: r.sunken,
      getLineColor: tone,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      stroked: true,
      updateTriggers: { getRadius: [pts.length, s.done] },
    }) as unknown as Layer,
    new TextLayer<SketchLabel>({
      id: 'sketch-labels',
      data: labels,
      getPosition: (d) => d.at,
      getText: (d) => d.text,
      getSize: (d) => (d.hint ? 11 : 12),
      getColor: (d) => (d.hint ? alpha(r.text, 190) : alpha(r.text, 250)),
      getPixelOffset: (d) => (d.hint ? [10, 10] : [10, -10]),
      fontFamily: 'JetBrains Mono Variable, JetBrains Mono, monospace',
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'start',
      getAlignmentBaseline: 'center',
      outlineWidth: 4,
      outlineColor: alpha(r.sunken, 240),
      fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
    }) as unknown as Layer,
  ];
}
