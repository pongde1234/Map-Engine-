/**
 * Sketch vocabulary for the annotate tools: tool and shape words, hints, the types a sketch may
 * be promoted to, and the one-line readout. Kept apart from the components so the tool
 * components hot-reload (a module mixing components and other exports cannot).
 */
import type { DrawState, SketchMeasure, SketchShape, ToolKind } from '@me/map';
import type { GeoType, GeofenceWatch } from '@me/schema';
import { formatArea, formatBearing, formatDistance, formatMgrs } from '@me/geo';

export const TOOL_WORD: Record<ToolKind, string> = { draw: 'Draw', measure: 'Measure', geofence: 'Geofence' };

export const SHAPES: Record<ToolKind, Array<{ id: SketchShape; label: string }>> = {
  draw: [
    { id: 'point', label: 'Point' },
    { id: 'line', label: 'Line' },
    { id: 'polygon', label: 'Area' },
    { id: 'circle', label: 'Circle' },
  ],
  measure: [
    { id: 'line', label: 'Path' },
    { id: 'polygon', label: 'Area' },
    { id: 'circle', label: 'Range' },
  ],
  geofence: [
    { id: 'polygon', label: 'Area' },
    { id: 'circle', label: 'Circle' },
  ],
};

/** Shape each tool starts with. */
export const DEFAULT_SHAPE: Record<ToolKind, SketchShape> = { draw: 'polygon', measure: 'line', geofence: 'polygon' };

export const HINT: Record<SketchShape, string> = {
  point: 'Click to place it',
  line: 'Click the points, then Finish',
  polygon: 'Click the corners, then Finish',
  circle: 'Click the centre, then the edge',
};

export const TYPE_WORD: Partial<Record<GeoType, string>> = { annotation: 'Annotation', axis: 'Axis', nfz: 'No-fly zone', measure: 'Measurement', geofence: 'Geofence' };

export const WATCH: Array<{ id: GeofenceWatch; label: string }> = [
  { id: 'hostile', label: 'Hostile' },
  { id: 'unidentified', label: 'Unidentified' },
  { id: 'any', label: 'Any track' },
];

/** Types an operator may give a sketch, by tool and shape. */
export function typesFor(tool: ToolKind, shape: SketchShape): GeoType[] {
  if (tool === 'geofence') return ['geofence'];
  if (tool === 'measure') return ['measure'];
  if (shape === 'line') return ['annotation', 'axis'];
  if (shape === 'polygon' || shape === 'circle') return ['annotation', 'nfz'];
  return ['annotation'];
}

/** The sketch's headline number: position, length and bearing, area or radius. */
export function sketchReadout(s: DrawState, m: SketchMeasure | null): string {
  if (!m || !s.points.length) return '—';
  if (s.shape === 'point') return formatMgrs(s.points[0]!);
  if (s.shape === 'circle') return m.radius_m ? `r ${formatDistance(m.radius_m)} · ${formatArea(m.area_m2 ?? 0)}` : 'Centre placed';
  if (s.shape === 'polygon' && m.area_m2) return `${formatArea(m.area_m2)} · ${formatDistance(m.perimeter_m ?? 0)}`;
  const last = m.segments[m.segments.length - 1];
  return last ? `${formatDistance(m.length_m)} · ${formatBearing(last.bearing_deg)}` : '—';
}
