/**
 * Sketch tools: draw, measure, geofence. One controller per map; it owns the sketch while a
 * tool is active and turns it into a GeoShape the console can promote to a command object.
 *
 *   point    one click
 *   line     click per vertex · double-click or Enter finishes
 *   polygon  click per vertex · click the first vertex, double-click or Enter closes it
 *   circle   click the centre · click again at the radius
 *
 * Backspace removes the last vertex, Escape cancels. Picking and double-click zoom are off
 * while a sketch is being drawn.
 */
import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import type { GeoShape, LonLat } from '@me/schema';
import { distance, inverse, pathLength, ringArea } from '@me/geo';

export type ToolKind = 'draw' | 'measure' | 'geofence';
export type SketchShape = 'point' | 'line' | 'polygon' | 'circle';

export interface DrawState {
  tool: ToolKind | null;
  shape: SketchShape;
  /** Committed vertices; a circle keeps its centre here. */
  points: LonLat[];
  /** Pointer position while drawing (the rubber band). */
  cursor: LonLat | null;
  /** Circle radius: live while drawing, fixed once done. */
  radius_m: number;
  done: boolean;
}

export interface SketchMeasure {
  /** Per segment: length and initial bearing. */
  segments: Array<{ from: LonLat; to: LonLat; length_m: number; bearing_deg: number }>;
  length_m: number;
  area_m2?: number;
  perimeter_m?: number;
  radius_m?: number;
}

/** Points a shape needs before it can be finished. */
const MIN_POINTS: Record<SketchShape, number> = { point: 1, line: 2, polygon: 3, circle: 1 };
const CLOSE_PX = 10;

const IDLE: DrawState = { tool: null, shape: 'line', points: [], cursor: null, radius_m: 0, done: false };

export class DrawController {
  private s: DrawState = IDLE;
  private listeners = new Set<() => void>();

  constructor(private readonly map: MlMap) {
    map.on('click', this.onClick);
    map.on('mousemove', this.onMove);
    map.on('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKey);
  }

  get(): DrawState {
    return this.s;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** True while clicks on the map belong to the sketch (not to selection). */
  capturing(): boolean {
    return this.s.tool !== null && !this.s.done;
  }

  start(tool: ToolKind, shape: SketchShape): void {
    this.set({ ...IDLE, tool, shape });
  }

  setShape(shape: SketchShape): void {
    if (!this.s.tool) return;
    this.set({ ...IDLE, tool: this.s.tool, shape });
  }

  undo(): void {
    if (!this.s.tool) return;
    if (this.s.done) {
      this.set({ ...this.s, done: false });
      return;
    }
    this.set({ ...this.s, points: this.s.points.slice(0, -1), radius_m: 0 });
  }

  canFinish(): boolean {
    const { shape, points, radius_m } = this.s;
    if (shape === 'circle') return points.length === 1 && radius_m > 0;
    return points.length >= MIN_POINTS[shape];
  }

  finish(): void {
    if (!this.s.tool || this.s.done || !this.canFinish()) return;
    this.set({ ...this.s, cursor: null, done: true });
  }

  /** Start the same tool again from an empty sketch. */
  restart(): void {
    if (this.s.tool) this.set({ ...IDLE, tool: this.s.tool, shape: this.s.shape });
  }

  cancel(): void {
    if (this.s.tool) this.set(IDLE);
  }

  /** The finished (or in-progress) sketch as a shape; null until it has enough points. */
  geometry(): GeoShape | null {
    const { shape, points, radius_m } = this.s;
    if (shape === 'circle') return points[0] && radius_m > 0 ? { type: 'circle', center: points[0], radius_m: Math.round(radius_m) } : null;
    if (points.length < MIN_POINTS[shape]) return null;
    if (shape === 'point') return { type: 'point', coordinates: points[0]! };
    if (shape === 'line') return { type: 'line', coordinates: points };
    return { type: 'polygon', coordinates: [[...points, points[0]!]] };
  }

  /** Lengths, bearings and areas of the sketch, including the rubber band while drawing. */
  measure(): SketchMeasure {
    const { shape, points, cursor, radius_m, done } = this.s;
    const live = !done && cursor && shape !== 'point' && shape !== 'circle' ? [...points, cursor] : points;
    const path = shape === 'polygon' && live.length >= 3 ? [...live, live[0]!] : live;
    const segments = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const inv = inverse(a, b);
      segments.push({ from: a, to: b, length_m: inv.distance_m, bearing_deg: inv.azimuth_deg });
    }
    const out: SketchMeasure = { segments, length_m: pathLength(path) };
    if (shape === 'polygon' && live.length >= 3) Object.assign(out, ringArea(live));
    if (shape === 'circle' && radius_m > 0) Object.assign(out, { radius_m, area_m2: Math.PI * radius_m * radius_m, perimeter_m: 2 * Math.PI * radius_m });
    return out;
  }

  destroy(): void {
    this.map.off('click', this.onClick);
    this.map.off('mousemove', this.onMove);
    this.map.off('dblclick', this.onDblClick);
    window.removeEventListener('keydown', this.onKey);
    this.map.doubleClickZoom.enable();
  }

  // ---------------------------------------------------------------- input

  private set(next: DrawState): void {
    this.s = next;
    if (this.capturing()) this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();
    for (const l of this.listeners) l();
  }

  private onClick = (e: MapMouseEvent): void => {
    if (!this.capturing()) return;
    const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
    const { shape, points } = this.s;
    if (shape === 'point') {
      this.set({ ...this.s, points: [p], cursor: null, done: true });
      return;
    }
    if (shape === 'circle') {
      if (!points.length) this.set({ ...this.s, points: [p], cursor: p, radius_m: 0 });
      else {
        const radius_m = distance(points[0]!, p);
        if (radius_m > 0) this.set({ ...this.s, radius_m, cursor: null, done: true });
      }
      return;
    }
    // Clicking the first vertex closes a polygon.
    if (shape === 'polygon' && points.length >= 3) {
      const first = this.map.project(points[0]!);
      if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX) {
        this.set({ ...this.s, cursor: null, done: true });
        return;
      }
    }
    this.set({ ...this.s, points: [...points, p] });
  };

  private onMove = (e: MapMouseEvent): void => {
    if (!this.capturing()) return;
    const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
    const { shape, points } = this.s;
    this.set({ ...this.s, cursor: p, radius_m: shape === 'circle' && points[0] ? distance(points[0], p) : this.s.radius_m });
  };

  /** A double-click lands as two clicks first: drop the duplicate vertex, then finish. */
  private onDblClick = (e: MapMouseEvent): void => {
    if (!this.capturing() || (this.s.shape !== 'line' && this.s.shape !== 'polygon')) return;
    e.preventDefault();
    const pts = this.s.points;
    if (pts.length >= 2) {
      const a = this.map.project(pts[pts.length - 1]!);
      const b = this.map.project(pts[pts.length - 2]!);
      if (Math.hypot(a.x - b.x, a.y - b.y) <= CLOSE_PX) this.s = { ...this.s, points: pts.slice(0, -1) };
    }
    this.finish();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.s.tool) return;
    const el = e.target as HTMLElement | null;
    if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
    if (e.key === 'Escape') {
      // A dialog open over a finished sketch (the promote form) takes its own Escape.
      if (this.s.done && document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      this.cancel();
    } else if (!this.s.done && e.key === 'Enter') {
      e.preventDefault();
      this.finish();
    } else if (!this.s.done && e.key === 'Backspace') {
      e.preventDefault();
      this.undo();
    }
  };
}
