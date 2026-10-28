/**
 * Entity model. Components are modelled on publicly documented Lattice entity concepts
 * (ontology, location, mil_view, provenance, expiry) plus DSS additions (classification
 * hypotheses, effector magazines, raid groups). Validators are the source of truth; TS
 * types are inferred from them.
 */
import { z } from 'zod';
import type { Provenance } from './provenance.ts';

export const LAYERS = ['reference', 'observation', 'fused', 'command', 'event'] as const;
export const Layer = z.enum(LAYERS);
export type Layer = z.infer<typeof Layer>;

/** MIL-STD-2525 standard identity. */
export const STANDARD_IDENTITIES = [
  'pending',
  'unknown',
  'assumed_friend',
  'friend',
  'neutral',
  'suspect',
  'hostile',
] as const;
export const StandardIdentity = z.enum(STANDARD_IDENTITIES);
export type StandardIdentity = z.infer<typeof StandardIdentity>;

export const Environment = z.enum(['air', 'surface', 'subsurface', 'land', 'space']);
export type Environment = z.infer<typeof Environment>;

export const Template = z.enum([
  'track', // something observed moving or sensed
  'asset', // own-force platform or unit
  'sensor',
  'effector',
  'installation', // defended asset, plant, base
  'geo', // command object or reference geometry
  'fragment', // intelligence fragment (report, imagery change, speech)
  'group', // raid group / formation
]);
export type Template = z.infer<typeof Template>;

const LatLon = z.tuple([z.number(), z.number()]); // [lon, lat], GeoJSON order
export type LonLat = z.infer<typeof LatLon>;

export const Location = z.object({
  lat: z.number(),
  lon: z.number(),
  /** Height above the WGS84 ellipsoid, metres. */
  hae: z.number().default(0),
  /** East/North/Up velocity, m/s. */
  vel: z.object({ e: z.number(), n: z.number(), u: z.number().default(0) }).optional(),
});
export type Location = z.infer<typeof Location>;

export const LocationUncertainty = z.object({
  semi_major_m: z.number(),
  semi_minor_m: z.number(),
  orientation_deg: z.number().default(0),
});
export type LocationUncertainty = z.infer<typeof LocationUncertainty>;

export const MilView = z.object({
  identity: StandardIdentity,
  environment: Environment,
  /** 20-digit MIL-STD-2525D/E symbol identification code. */
  sidc: z.string(),
  context: z.enum(['reality', 'exercise', 'simulation']).default('reality'),
});
export type MilView = z.infer<typeof MilView>;

export const Ontology = z.object({
  template: Template,
  /** Engine class key, e.g. "owa_drone", "sam_mr", "civil_air". Drives SIDC, age thresholds, rules. */
  class: z.string(),
  platform_type: z.string().optional(),
  specific_type: z.string().optional(),
});
export type Ontology = z.infer<typeof Ontology>;

export const Aliases = z.object({
  name: z.string().optional(),
  track_number: z.string().optional(),
  /** Air-defence clearance number for a civil flight correlated with its flight plan. */
  adc_number: z.string().optional(),
  mmsi: z.string().optional(),
  callsign: z.string().optional(),
});
export type Aliases = z.infer<typeof Aliases>;

export const Hypothesis = z.object({
  class: z.string(),
  label: z.string(),
  sidc: z.string(),
  p: z.number().min(0).max(1),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

/** Classification held as competing hypotheses. Contested entities are never auto-merged. */
export const Classification = z.object({
  hypotheses: z.array(Hypothesis),
  contested: z.boolean(),
  /** Gap between the top two hypotheses' probabilities. */
  margin: z.number(),
});
export type Classification = z.infer<typeof Classification>;

export const GeoShape = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), coordinates: LatLon }),
  z.object({ type: z.literal('line'), coordinates: z.array(LatLon) }),
  z.object({ type: z.literal('polygon'), coordinates: z.array(z.array(LatLon)) }),
  z.object({
    type: z.literal('circle'),
    center: LatLon,
    radius_m: z.number(),
    inner_radius_m: z.number().optional(),
  }),
  z.object({
    type: z.literal('sector'),
    center: LatLon,
    radius_m: z.number(),
    inner_radius_m: z.number().optional(),
    /** Degrees true, clockwise from az_start to az_end. */
    az_start: z.number(),
    az_end: z.number(),
  }),
  z.object({
    type: z.literal('ellipse'),
    center: LatLon,
    semi_major_m: z.number(),
    semi_minor_m: z.number(),
    orientation_deg: z.number(),
  }),
]);
export type GeoShape = z.infer<typeof GeoShape>;

export const GeoType = z.enum([
  'ring',
  'wcs_sector',
  'nfz',
  'corridor',
  'sea_restriction',
  'picket_box',
  'wez',
  'debris_footprint',
  'aimpoint',
  'axis',
  'annotation',
  'vp', // vulnerable area / point
  'soft_kill_area',
  'coverage',
  'geofence', // operator-drawn: tracks entering or leaving it fire a rule
  'measure', // operator-drawn: a kept measurement
  'alert', // operator-set: a custom alert rule (no shape); the rules engine fires it
  'source', // operator-set: a registered sensor or feed (no shape, no data)
  'layer', // operator-set: a named layer that drawn objects sit in (no shape)
]);
export type GeoType = z.infer<typeof GeoType>;

/**
 * The colours an operator can give a drawn object. Names, not values: the record stays the same
 * across themes, and the console resolves each to an FDS token. Red is left out (hostile) and so
 * is the blue of selection.
 */
export const OperatorColor = z.enum(['sapphire', 'indigo', 'green', 'teal', 'pink', 'lavender', 'steel', 'amber']);
export type OperatorColor = z.infer<typeof OperatorColor>;

export const GeoDetails = z.object({
  type: GeoType,
  ring: z.enum(['R1', 'R2', 'R3', 'R4']).optional(),
  /** Weapons control status for wcs_sector. */
  wcs: z.enum(['free', 'tight', 'hold']).optional(),
  /** Vulnerable-point tier (1 = most critical). */
  tier: z.number().int().min(1).max(3).optional(),
  status: z.enum(['draft', 'proposed', 'active', 'expired']).default('active'),
  /** Free label shown on the map, e.g. "R3 MIDDLE", "AXIS NORTH". */
  label: z.string().optional(),
  /** Altitude band for airspace shapes, metres. */
  alt_min_m: z.number().optional(),
  alt_max_m: z.number().optional(),
  /** Time on target for aimpoints. */
  tot: z.number().optional(),
  /** Geofence: which tracks fire it. */
  watch: z.enum(['hostile', 'unidentified', 'any']).optional(),
  /** Operator objects: who authored it (set by the server from the session identity). */
  author: z.string().optional(),
  /** Operator objects: free note. */
  note: z.string().optional(),
  /** Operator objects: the operator layer it sits in (that layer's entity id). Without one, or once
   *  that layer is withdrawn, it sits in "Operator objects". */
  layer: z.string().optional(),
  /** Operator objects: the colour the operator chose. Without one, the console picks (its layer's, or its type's). */
  color: OperatorColor.optional(),
});
export type GeoDetails = z.infer<typeof GeoDetails>;

export const LinkState = z.enum(['up', 'degraded', 'down']);
export type LinkState = z.infer<typeof LinkState>;

export const Sensor = z.object({
  type: z.enum([
    'surface_radar',
    'low_level_radar',
    'coastal_radar',
    'aew',
    'aerostat',
    'esm',
    'eo_ir',
    'space_isr',
    'ais_receiver',
    'humint',
  ]),
  /** Detection range against the reference target, metres. */
  range_m: z.number().optional(),
  /** Antenna height above ground, metres (radar horizon). */
  height_m: z.number().optional(),
  status: LinkState.default('up'),
});
export type Sensor = z.infer<typeof Sensor>;

export const Magazine = z.object({
  ready: z.number(),
  reserve: z.number(),
  /** Reserve floor set in the pre-delegation package (DP-0). */
  floor: z.number(),
  /** Full load (ready + reserve) before the first engagement: the meter's scale. */
  capacity: z.number().optional(),
});
export type Magazine = z.infer<typeof Magazine>;

export const Effector = z.object({
  type: z.enum([
    'sam_mr',
    'sam_sr',
    'vshorads',
    'gun',
    'laser_dew',
    'cuas',
    'ew',
    'interceptor_drone',
    'fighter',
  ]),
  channels: z.object({ total: z.number(), busy: z.number() }),
  magazine: Magazine,
  status: z.enum(['ready', 'engaging', 'reloading', 'down']).default('ready'),
  wez: z.object({ min_m: z.number(), max_m: z.number(), max_alt_m: z.number().optional() }).optional(),
});
export type Effector = z.infer<typeof Effector>;

export const Health = z.object({
  link: LinkState,
  last_heard: z.number().optional(),
});
export type Health = z.infer<typeof Health>;

export const TrackState = z.enum([
  'detected',
  'inbound',
  'deflected', // turned away by soft kill
  'engaged',
  'destroyed',
  'leaked', // reached R1 unengaged
  'impact',
  'withdrawn',
  'landed',
]);
export type TrackState = z.infer<typeof TrackState>;

export const Track = z.object({
  state: TrackState.default('detected'),
  /** Contributing sensor ids or observation entity ids. */
  contributing: z.array(z.string()).default([]),
  sensor_classes: z.array(z.string()).default([]),
  fusion_method: z.string().optional(),
  fusion_version: z.string().optional(),
  quality: z.number().min(0).max(1).optional(),
  axis: z.string().optional(),
  wave: z.string().optional(),
});
export type Track = z.infer<typeof Track>;

export const Group = z.object({
  members: z.array(z.string()),
  raid_id: z.string().optional(),
  axis: z.string().optional(),
  wave: z.string().optional(),
});
export type Group = z.infer<typeof Group>;

export const RelationshipType = z.enum([
  'contests',
  'associated_with',
  'observed_by',
  'assigned_to',
  'protects',
  'member_of',
  'derived_from',
  'engaged_by',
]);
export const Relationship = z.object({ type: RelationshipType, target: z.string() });
export type Relationship = z.infer<typeof Relationship>;

export const Indicators = z.object({
  simulated: z.boolean().optional(),
  exercise: z.boolean().optional(),
  notional: z.boolean().optional(),
});
export type Indicators = z.infer<typeof Indicators>;

/** Intelligence fragment content (template "fragment"). */
export const FragmentInfo = z.object({
  source_kind: z.enum(['space_isr', 'esm', 'humint', 'osint', 'sigint', 'contact_report', 'probe']),
  summary: z.string(),
  confidence: z.enum(['confirmed', 'likely', 'possible', 'doubtful']),
  /** Whether the fragment has been associated to an indication or entity. */
  associated: z.boolean().default(false),
});
export type FragmentInfo = z.infer<typeof FragmentInfo>;

/** Plant process unit (synthetic; generic units only). Owned by the plant control room (L4). */
export const PlantUnit = z.object({
  unit: z.string(),
  tier: z.number().int().min(1).max(3),
  /** RIL-reviewed vulnerability rank, set in phase 0 (1 = most vulnerable). */
  rank: z.number().int().min(1).optional(),
  state: z.enum(['running', 'depressurised', 'feed_isolated', 'shutdown', 'restart_assessment']),
  /** The unit's protective interlock: in service, or tripped by a protective action. One generic state, no sequence. */
  interlock: z.enum(['armed', 'tripped']).optional(),
  note: z.string().optional(),
});
export type PlantUnit = z.infer<typeof PlantUnit>;

/**
 * A custom alert an operator sets in the Alerts panel. The rules engine walks the picture from the
 * time it was set and journals each firing and clearing with the operator's severity. Every number
 * here is the operator's own; nothing is supplied by the console.
 *   count_in_ring  watched tracks inside a ring (or the whole picture) reach `count`
 *   near_vp        a watched track comes within `distance_m` of the defended point
 *   magazine_low   a fire unit (`unit`, or any) is at `ready` rounds or fewer (or at its floor)
 *   class_appears  a track of one of `classes` enters the picture
 */
export const AlertRule = z.object({
  condition: z.enum(['count_in_ring', 'near_vp', 'magazine_low', 'class_appears']),
  watch: z.enum(['hostile', 'unidentified', 'any']).optional(),
  ring: z.enum(['R1', 'R2', 'R3', 'R4', 'all']).optional(),
  count: z.number().int().min(1).optional(),
  distance_m: z.number().positive().optional(),
  unit: z.string().optional(),
  ready: z.number().int().min(0).optional(),
  classes: z.array(z.string()).optional(),
  severity: z.enum(['high', 'medium', 'low']).default('high'),
});
export type AlertRule = z.infer<typeof AlertRule>;

/**
 * A source an operator registers in the Sources panel: a sensor or feed the picture does not carry
 * yet. It is a record only: it carries no data, never ages and is listed as planned. The range is
 * the operator's own; none is supplied by the console.
 *   sensor  `sensor_type`, and `range_m` when the operator states it
 *   feed    what it `carries`
 */
export const SourceEntry = z.object({
  kind: z.enum(['sensor', 'feed']),
  sensor_type: Sensor.shape.type.optional(),
  range_m: z.number().positive().optional(),
  carries: z.enum(['tracks', 'intel', 'status']).optional(),
});
export type SourceEntry = z.infer<typeof SourceEntry>;

/**
 * Components an entity record may carry. A record replaces each component it carries
 * (last writer wins on source time); components it omits are left unchanged.
 */
export const EntityComponents = z.object({
  is_live: z.boolean().optional(),
  expiry_time: z.number().optional(),
  ontology: Ontology.optional(),
  aliases: Aliases.optional(),
  location: Location.optional(),
  location_uncertainty: LocationUncertainty.optional(),
  mil_view: MilView.optional(),
  classification: Classification.optional(),
  geo_shape: GeoShape.optional(),
  geo_details: GeoDetails.optional(),
  sensor: Sensor.optional(),
  effector: Effector.optional(),
  health: Health.optional(),
  track: Track.optional(),
  group: Group.optional(),
  relationships: z.array(Relationship).optional(),
  indicators: Indicators.optional(),
  fragment: FragmentInfo.optional(),
  plant: PlantUnit.optional(),
  alert_rule: AlertRule.optional(),
  source_entry: SourceEntry.optional(),
});
export type EntityComponents = z.infer<typeof EntityComponents>;
export type ComponentKey = keyof EntityComponents;

/** Materialised entity state at a point in time. */
export interface Entity extends EntityComponents {
  entity_id: string;
  layer: Layer;
  is_live: boolean;
  /** Source time of the newest accepted record. Data age = now - source_time. */
  source_time: number;
  ingest_time: number;
  /** Count of accepted records for this entity. */
  version: number;
  /** Hash of the newest accepted record (provenance anchor). */
  last_hash: string;
  /** record_ids that contributed, newest last (bounded). */
  history: string[];
  label: string;
  releasability?: string[];
  provenance: Provenance;
}
