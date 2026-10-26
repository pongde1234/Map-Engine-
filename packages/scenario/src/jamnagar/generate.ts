/**
 * Jamnagar raid generator. Deterministic for a given seed. Produces the journal drafts plus a
 * manifest whose counts and clock marks are computed from the generated data (captions on
 * screen must come from here, never be typed in by hand).
 *
 * Fusion note: fused tracks are generated as truth + small noise (the documented fallback).
 * Each fused record says so in track.fusion_version; the real fusion step replaces it later.
 */
import {
  type EntityComponents,
  type LonLat,
  type Provenance,
  type RecordDraft,
  type StandardIdentity,
  type DecisionPayload,
  type EngagementPayload,
  type RuleFirePayload,
  type BdaPayload,
  CLASSES,
  HOUR,
  MINUTE,
  SECOND,
  sidcWithIdentity,
  sidcWithStatus,
} from '@me/schema';
import { destination, distance, inverse } from '@me/geo';
import { Emitter, Path, Rand, enu } from '../util.ts';
import {
  AEW_ORBIT,
  AXES,
  CIVIL_CORRIDOR,
  CIVIL_CORRIDOR_HALF_WIDTH,
  CONFLICTS,
  COUNTS,
  D0,
  EFFECTORS,
  FIGHTER_BASE,
  FIGHTER_CAP,
  H,
  PROCESS_UNITS,
  RINGS,
  SCENARIO_ID,
  SCENARIO_NAME,
  SENSORS,
  T0,
  T1,
  TANKER_HOLD,
  VP,
  type EffectorDef,
} from './config.ts';
import type { ScenarioManifest } from '../manifest.ts';

// ---------------------------------------------------------------- provenance presets

const P = {
  fused: { integration: 'fusion', source_feed: 'Fused picture', sensor_class: 'multi-sensor' },
  air: { integration: 'scenario', source_feed: 'Air picture network', agency: 'Air HQ (synthetic)' },
  armyAd: { integration: 'scenario', source_feed: 'Army AD control & reporting', agency: 'AD Direction Centre (synthetic)' },
  coastal: { integration: 'scenario', source_feed: 'Coastal surveillance chain', agency: 'Coastal command (synthetic)' },
  ais: { integration: 'scenario', source_feed: 'Ports / AIS', sensor_class: 'AIS', agency: 'Ports (synthetic)' },
  civil: { integration: 'scenario', source_feed: 'Civil aviation (DGCA/AAI)', sensor_class: 'flight plan + SSR', agency: 'Civil ATC (synthetic)' },
  intel: { integration: 'scenario', source_feed: 'Intelligence reporting', agency: 'Joint intelligence (synthetic)' },
  force: { integration: 'scenario', source_feed: 'Force state', agency: 'Joint HQ (synthetic)' },
  plant: { integration: 'scenario', source_feed: 'RIL plant tags', agency: 'RIL control room (synthetic)' },
  command: { integration: 'operator', source_feed: 'Command layer' },
  rules: { integration: 'rules', source_feed: 'Rules engine' },
  ref: { integration: 'scenario', source_feed: 'Reference data' },
} satisfies Record<string, Provenance>;

const REL_JOINT = ['JOINT STAFF WEST'];
const REL_PLANT = ['JOINT STAFF WEST', 'RIL'];

// ---------------------------------------------------------------- threats

type Fate =
  | { kind: 'deflect'; atRemaining: number }
  | { kind: 'kill'; atRemaining: number; effector: string; weapon: string }
  | { kind: 'leak'; impact: LonLat; damage: 'none' | 'light' }
  | { kind: 'withdraw' }
  | { kind: 'emcon'; atTime: number };

interface Threat {
  id: string;
  cls: string;
  wave: string;
  axis: 'north' | 'west';
  group: string;
  path: Path;
  speed: number;
  alt: number;
  tStart: number;
  tDetect: number;
  fate: Fate;
  /** Filled during simulation. */
  tEnd?: number;
  endPos?: LonLat;
  /** The impact record of a leaker (BDA derives from it). */
  impactRec?: string;
  contestedUntil?: number;
  refusedGun?: boolean;
}

/** Distance left along the path at time t (ms → s conversion explicit). */
function remainingAt(th: Threat, t: number): number {
  return th.path.total - (th.speed * (t - th.tStart)) / 1000;
}
function timeAtRemaining(th: Threat, r: number): number {
  return th.tStart + ((th.path.total - r) / th.speed) * 1000;
}

// ---------------------------------------------------------------- generator

export interface GenerateOptions {
  seed?: number;
  /** Fused-track update interval (ms). */
  fusedEvery?: number;
}

export function generateJamnagar(opts: GenerateOptions = {}): { drafts: RecordDraft[]; manifest: ScenarioManifest } {
  const seed = opts.seed ?? 7;
  const fusedEvery = opts.fusedEvery ?? 2 * SECOND;
  const R = new Rand(seed);
  const E = new Emitter();
  const ids = { track: 400, int: 0 };
  const nextTrackId = () => `F-${String(++ids.track).padStart(4, '0')}`;

  // Record ids we need to reference later (lineage).
  const refs = {
    f1: '', f2: '', f3: '', f4: '', f5: '', f6: '', f7: '',
    dp0: '', dp1: '', dp2: '', dp3: '', dp4: '', dp6: '', dp7: '', dp8: '',
    raidDetected: '', missileRule: '', leakRule: '', satRule: '', emcon: '', classify: '',
  };

  // ============================================================ reference: VP + plant units
  E.emit('reference', 'reference', {
    entity_id: 'VP-RIL',
    source_time: T0,
    provenance: P.ref,
    releasability: REL_PLANT,
    payload: {
      ontology: { template: 'installation', class: 'refinery' },
      aliases: { name: 'Refinery complex (notional)' },
      location: { lon: VP[0], lat: VP[1], hae: 0 },
      mil_view: { identity: 'friend', environment: 'land', sidc: CLASSES.refinery!.sidc, context: 'reality' },
      geo_shape: { type: 'circle', center: VP, radius_m: 3200 },
      geo_details: { type: 'vp', tier: 1, label: 'VP · REFINERY COMPLEX', status: 'active' },
      indicators: { notional: true },
    } satisfies EntityComponents,
  });
  for (const u of PROCESS_UNITS) {
    E.emit('reference', 'reference', {
      entity_id: u.id,
      source_time: T0,
      provenance: P.plant,
      releasability: REL_PLANT,
      payload: {
        ontology: { template: 'installation', class: 'process_unit' },
        aliases: { name: u.name },
        location: { lon: u.at[0], lat: u.at[1], hae: 0 },
        mil_view: { identity: 'friend', environment: 'land', sidc: CLASSES.process_unit!.sidc, context: 'reality' },
        geo_shape: { type: 'circle', center: u.at, radius_m: u.halfSizeM },
        geo_details: { type: 'vp', tier: u.tier, label: u.name.toUpperCase(), status: 'active' },
        plant: { unit: u.name, tier: u.tier, state: 'running' },
        indicators: { notional: true },
      } satisfies EntityComponents,
    });
  }

  // ============================================================ command: rings, axes, corridor
  for (const ring of RINGS) {
    E.emit('command', 'command', {
      entity_id: `CM-${ring.id}`,
      source_time: T0,
      provenance: P.command,
      payload: {
        ontology: { template: 'geo', class: 'ring' },
        geo_shape: { type: 'circle', center: VP, radius_m: ring.outer, ...(ring.inner ? { inner_radius_m: ring.inner } : {}) },
        geo_details: { type: 'ring', ring: ring.id, label: `${ring.label} · ${ring.outer / 1000}–${ring.inner / 1000} KM`, status: 'active' },
      } satisfies EntityComponents,
    });
  }
  for (const ax of [AXES.north, AXES.west]) {
    E.emit('command', 'command', {
      entity_id: `CM-AXIS-${ax.id}`,
      source_time: T0,
      provenance: P.command,
      payload: {
        ontology: { template: 'geo', class: 'axis' },
        geo_shape: { type: 'line', coordinates: [ax.launch, ...ax.via, VP] },
        geo_details: { type: 'axis', label: ax.label, status: 'active' },
        indicators: { notional: true },
      } satisfies EntityComponents,
    });
  }
  const corridorPoly = corridorPolygon();
  const corridorRec = (status: 'active' | 'expired', label: string, t: number, derived?: string[]) =>
    E.emit('command', 'command', {
      entity_id: 'CM-CORRIDOR',
      source_time: t,
      provenance: P.civil,
      ...(derived ? { derived_from: derived } : {}),
      payload: {
        ontology: { template: 'geo', class: 'corridor' },
        geo_shape: { type: 'polygon', coordinates: [corridorPoly] },
        geo_details: { type: 'corridor', label, status },
      } satisfies EntityComponents,
    });
  corridorRec('active', 'CIVIL CORRIDOR · OPEN', T0);

  const pickets: Array<[string, LonLat, string]> = [
    ['CM-PK-N', EFFECTORS.find((e) => e.id === 'B-IDN')!.at, 'INTERCEPTOR PICKET N'],
    ['CM-PK-W', EFFECTORS.find((e) => e.id === 'B-IDW')!.at, 'INTERCEPTOR PICKET W'],
    ['CM-PK-R3', EFFECTORS.find((e) => e.id === 'B-ID3')!.at, 'INTERCEPTOR FLIGHTS · R3 BOX'],
  ];
  for (const [id, at, label] of pickets) {
    E.emit('command', 'command', {
      entity_id: id,
      source_time: T0,
      provenance: P.command,
      payload: {
        ontology: { template: 'geo', class: 'picket_box' },
        geo_shape: { type: 'polygon', coordinates: [box(at, 9000, 6000)] },
        geo_details: { type: 'picket_box', label, status: 'active' },
        indicators: { notional: true },
      } satisfies EntityComponents,
    });
  }

  // ============================================================ blue sensors
  const llrFaultT = T0 + 12 * HOUR; // D-3 12:00 forecast
  const radarSwapT = T0 + DAYS(1) + 9 * HOUR; // D-2 09:00
  for (const s of SENSORS) {
    const def = CLASSES[s.cls]!;
    const grounded = s.cls === 'aerostat';
    E.emit('fused', 'fused', {
      entity_id: s.id,
      source_time: T0,
      provenance: P.armyAd,
      releasability: REL_JOINT,
      payload: {
        ontology: { template: 'sensor', class: s.cls },
        aliases: { name: s.name },
        location: { lon: s.at[0], lat: s.at[1], hae: grounded ? 0 : s.heightM },
        mil_view: { identity: 'friend', environment: def.environment, sidc: def.sidc, context: 'reality' },
        sensor: { type: s.cls, range_m: s.range, height_m: grounded ? 0 : s.heightM, status: grounded ? 'down' : 'up' },
        health: { link: grounded ? 'degraded' : 'up' },
        indicators: { notional: true },
      } satisfies EntityComponents,
    });
  }
  // Fault forecast, swap after DP-1.
  E.emit('fused', 'fused', {
    entity_id: 'S-LLR1',
    source_time: llrFaultT,
    provenance: { ...P.force, sensor_class: 'predictive maintenance (DeepSense stub)' },
    releasability: REL_JOINT,
    payload: { health: { link: 'degraded' }, sensor: { type: 'low_level_radar', range_m: 60_000, height_m: 15, status: 'degraded' } },
  });

  // ============================================================ blue effectors (peacetime)
  // `mags` is the planner's running count, used to choose interceptor sites as threats are
  // simulated (in threat order). What the picture shows comes from `ledger`, replayed in time
  // order at the end, so magazines and channels only ever move forward with the clock.
  const mags = new Map<string, { ready: number; reserve: number; floor: number }>();
  const ledger: Array<{ t: number; id: string; ready?: number; busy?: number; release?: true; derived: string[] }> = [];
  const effectorPayload = (e: EffectorDef, at: LonLat): EntityComponents => {
    const def = CLASSES[e.cls]!;
    return {
      ontology: { template: 'effector', class: e.cls },
      aliases: { name: e.name, callsign: e.callsign },
      location: { lon: at[0], lat: at[1], hae: 0 },
      mil_view: { identity: 'friend', environment: 'land', sidc: def.sidc, context: 'reality' },
      effector: {
        type: e.cls === 'interceptor_site' ? 'interceptor_drone' : e.cls,
        channels: { total: e.channels, busy: 0 },
        magazine: { ready: e.ready, reserve: e.reserve, floor: e.floor, capacity: e.ready + e.reserve },
        status: 'ready',
        wez: e.wez,
      },
      health: { link: 'up' },
      indicators: { notional: true },
    };
  };
  for (const e of EFFECTORS) {
    mags.set(e.id, { ready: e.ready, reserve: e.reserve, floor: e.floor });
    E.emit('fused', 'fused', {
      entity_id: e.id,
      source_time: T0,
      provenance: P.force,
      releasability: REL_JOINT,
      payload: effectorPayload(e, e.peace ?? e.at),
    });
  }
  const fighterIds = ['B-FTR1', 'B-FTR2'];
  fighterIds.forEach((id, i) => {
    E.emit('fused', 'fused', {
      entity_id: id,
      source_time: T0,
      provenance: P.air,
      releasability: REL_JOINT,
      payload: {
        ontology: { template: 'asset', class: 'fighter' },
        aliases: { name: `Fighter ${i + 1}`, callsign: `KESTREL ${i + 1}` },
        location: { lon: FIGHTER_BASE[0] + i * 0.01, lat: FIGHTER_BASE[1], hae: 0 },
        mil_view: { identity: 'friend', environment: 'air', sidc: CLASSES.fighter!.sidc, context: 'reality' },
        health: { link: 'up' },
        indicators: { notional: true },
      },
    });
  });

  // ============================================================ intelligence fragments (D-3 .. D-1)
  const TH_IW = 'TH-IW-0001';
  const TH_RAID = 'TH-RAID-0001';
  const frag = (o: {
    id: string;
    cls: string;
    st: number;
    it: number;
    at?: LonLat;
    unc?: [number, number, number];
    kind: 'space_isr' | 'esm' | 'humint' | 'osint' | 'contact_report' | 'probe';
    summary: string;
    conf: 'confirmed' | 'likely' | 'possible' | 'doubtful';
    associated?: boolean;
    sensorClass: string;
    planned?: boolean;
  }) => {
    const def = CLASSES[o.cls]!;
    const payload: EntityComponents = {
      ontology: { template: 'fragment', class: o.cls },
      aliases: { name: o.summary.split('.')[0]! },
      mil_view: {
        identity: def.identity,
        environment: def.environment,
        sidc: o.planned === false ? sidcWithStatus(def.sidc, 'present') : def.sidc,
        context: 'reality',
      },
      fragment: { source_kind: o.kind, summary: o.summary, confidence: o.conf, associated: o.associated ?? true },
      expiry_time: o.st + 9 * DAYS(1),
      indicators: { notional: true },
    };
    if (o.at) payload.location = { lon: o.at[0], lat: o.at[1], hae: 0 };
    if (o.unc) payload.location_uncertainty = { semi_major_m: o.unc[0], semi_minor_m: o.unc[1], orientation_deg: o.unc[2] };
    return E.emit('fragment', 'observation', {
      entity_id: o.id,
      source_time: o.st,
      ingest_time: o.it,
      provenance: { ...P.intel, sensor_class: o.sensorClass },
      thread_id: TH_IW,
      releasability: REL_JOINT,
      payload,
    });
  };
  const d3 = T0;
  refs.f1 = frag({ id: 'X-LCH-N', cls: 'launch_prep', st: d3 + 3 * HOUR + 10 * MINUTE, it: d3 + 7 * HOUR + 40 * MINUTE, at: AXES.north.launch, unc: [16_000, 8_000, 20], kind: 'space_isr', summary: 'Launch preparations, launch area N. Imagery change detection; vehicle and canister activity.', conf: 'possible', sensorClass: 'space-based imagery (SAR)' });
  refs.f2 = frag({ id: 'X-LCH-W', cls: 'launch_prep', st: d3 + 3 * HOUR + 12 * MINUTE, it: d3 + 7 * HOUR + 55 * MINUTE, at: AXES.west.launch, unc: [18_000, 9_000, 120], kind: 'space_isr', summary: 'Launch preparations, launch area W. Imagery change detection near coast.', conf: 'possible', sensorClass: 'space-based imagery (EO)' });
  const emitters: LonLat[] = [[69.3, 24.3], [69.47, 24.12], [69.04, 24.42]];
  refs.f3 = '';
  emitters.forEach((at, i) => {
    const r = frag({ id: `X-EMT-${i + 1}`, cls: 'emitter', st: d3 + 9 * HOUR + i * 35 * MINUTE, it: d3 + 9 * HOUR + i * 35 * MINUTE + 4 * MINUTE, at, unc: [4000, 2500, 40 * i], kind: 'esm', summary: `New emitter ${i + 1} on north-west axis. Not previously catalogued.`, conf: 'likely', sensorClass: 'electronic support measures', planned: false });
    if (i === 0) refs.f3 = r;
  });
  refs.f4 = frag({ id: 'X-HQ-1', cls: 'hostile_hq', st: d3 + 14 * HOUR, it: d3 + 21 * HOUR + 30 * MINUTE, at: [69.38, 24.88], unc: [6000, 6000, 0], kind: 'humint', summary: 'Senior rocket-force officer reported at forward headquarters.', conf: 'possible', sensorClass: 'human reporting', planned: false });
  refs.f5 = frag({ id: 'X-OSINT-1', cls: 'report', st: d3 + DAYS(1) + 11 * HOUR, it: d3 + DAYS(1) + 11 * HOUR + 20 * MINUTE, at: VP, kind: 'osint', summary: 'Adversary speech names the refinery as a target.', conf: 'confirmed', sensorClass: 'open source (speech)', planned: false });
  // Unassociated fragment (must stay visible).
  frag({ id: 'X-RPT-DHOW', cls: 'report', st: d3 + 18 * HOUR, it: d3 + 18 * HOUR + 50 * MINUTE, at: [68.9, 22.55], unc: [3000, 3000, 0], kind: 'contact_report', summary: 'Unidentified dhow loitering near coastal picket. Not associated.', conf: 'doubtful', associated: false, sensorClass: 'contact report', planned: false });
  // D-1 repeat imagery: same entities, higher confidence, tighter ellipses.
  const d1 = T0 + 2 * DAYS(1);
  refs.f6 = frag({ id: 'X-LCH-N', cls: 'launch_prep', st: d1 + 4 * HOUR, it: d1 + 8 * HOUR + 30 * MINUTE, at: AXES.north.launch, unc: [8000, 5000, 20], kind: 'space_isr', summary: 'Launch preparations, launch area N (repeat). Canister count rising.', conf: 'likely', sensorClass: 'space-based imagery (SAR)' });
  refs.f7 = frag({ id: 'X-LCH-W', cls: 'launch_prep', st: d1 + 4 * HOUR + 3 * MINUTE, it: d1 + 8 * HOUR + 40 * MINUTE, at: AXES.west.launch, unc: [9000, 5000, 120], kind: 'space_isr', summary: 'Launch preparations, launch area W (repeat).', conf: 'likely', sensorClass: 'space-based imagery (EO)' });

  // ============================================================ decisions before the raid
  const decision = (o: {
    t: number;
    payload: DecisionPayload;
    derived?: string[];
    thread?: string;
    author?: string;
    rel?: string[];
  }) =>
    E.emit('decision', 'event', {
      source_time: o.t,
      ingest_time: o.t,
      provenance: P.command,
      payload: o.payload,
      ...(o.derived ? { derived_from: o.derived } : {}),
      thread_id: o.thread ?? TH_RAID,
      ...(o.author ? { author: o.author } : {}),
      releasability: o.rel ?? REL_JOINT,
    });

  // DP-0 is the prior package (storyboard: "prior illustrative approval record"): on file
  // before the first indication, so every later action traces back to human approval.
  const dp0T = d3 + MINUTE;
  refs.dp0 = decision({
    t: dp0T,
    thread: TH_IW,
    author: 'National level · L1 (CCS)',
    payload: {
      dp: 'DP-0',
      title: 'Pre-delegation package approved',
      layer: 'L1',
      status: 'approved',
      authority: 'L1 approves · L2 drafted',
      summary: 'ROE by ring and threat class; WCS by sector; missile reserve floors; five delegation triggers enforced by the rules engine under pre-approved conditions.',
      options: [],
    },
  });
  // Rules + thresholds as a signed command object (N and T remain symbolic).
  E.emit('command', 'command', {
    entity_id: 'CM-RULES',
    source_time: dp0T + MINUTE,
    provenance: P.command,
    derived_from: [refs.dp0],
    author: 'L2 · Joint HQ West',
    payload: {
      ontology: { template: 'geo', class: 'rule_set' },
      aliases: { name: 'Delegation triggers (DP-0)' },
      geo_details: { type: 'annotation', label: 'DELEGATION TRIGGERS · N, T UNSPECIFIED', status: 'active' },
    } satisfies EntityComponents,
  });

  // DP-1: posture raised under the package, on the indications.
  const dp1T = d3 + 11 * HOUR + 30 * MINUTE;
  refs.dp1 = decision({
    t: dp1T,
    thread: TH_IW,
    derived: [refs.f1, refs.f2, refs.f3, refs.dp0].filter(Boolean),
    author: 'Joint HQ West · L2 duty officer',
    payload: {
      dp: 'DP-1',
      title: 'Alert posture: raise sector and refinery readiness',
      layer: 'L2',
      status: 'approved',
      authority: 'L2 · Joint HQ West',
      summary: 'Aerostat up; AEW&C to airborne alert; fighters forward; missile units to war locations; failing radar swapped; state and refinery alerted.',
      options: [],
    },
  });
  // Consequences of DP-1: aerostat up, units move, radar swapped.
  E.emit('fused', 'fused', {
    entity_id: 'S-AST1',
    source_time: dp1T + 2 * HOUR,
    provenance: P.armyAd,
    derived_from: [refs.dp1],
    releasability: REL_JOINT,
    payload: { location: { lon: 70.02, lat: 22.48, hae: 1500 }, sensor: { type: 'aerostat', range_m: 300_000, height_m: 1500, status: 'up' }, health: { link: 'up' } },
  });
  for (const e of EFFECTORS) {
    if (!e.peace) continue;
    E.emit('fused', 'fused', {
      entity_id: e.id,
      source_time: d3 + DAYS(1) + 6 * HOUR + R.int(0, 90) * MINUTE,
      provenance: P.force,
      derived_from: [refs.dp1],
      releasability: REL_JOINT,
      payload: { location: { lon: e.at[0], lat: e.at[1], hae: 0 } },
    });
  }
  E.emit('fused', 'fused', {
    entity_id: 'S-LLR1',
    source_time: radarSwapT,
    provenance: P.force,
    derived_from: [refs.dp1],
    releasability: REL_JOINT,
    payload: { health: { link: 'up' }, sensor: { type: 'low_level_radar', range_m: 60_000, height_m: 15, status: 'up' }, aliases: { name: 'Low-level radar 1 (spare)' } },
  });
  const dp2T = d3 + 22 * HOUR;
  refs.dp2 = decision({
    t: dp2T,
    thread: TH_IW,
    derived: [refs.f1, refs.f2, refs.f4],
    author: 'National level · L1',
    rel: ['NATIONAL'],
    payload: {
      dp: 'DP-2',
      title: 'Pre-emption / left-of-launch',
      layer: 'L1',
      status: 'option',
      authority: 'L1 only',
      summary: 'Displayed as an option with confidence and escalation inputs. Never selected.',
      options: [
        { id: 'pre-empt', label: 'Strike launch areas', selected: false },
        { id: 'hold', label: 'Hold; defend', selected: false },
      ],
    },
  });

  // ============================================================ AEW orbit (airborne alert)
  const aewUp = H - 12 * HOUR - 45 * MINUTE;
  const aewDown = H + 3 * HOUR;
  const aewPos = (t: number): { pos: LonLat; az: number } => {
    // Racetrack approximated as an ellipse around the orbit centre.
    const period = (2 * AEW_ORBIT.legM * 2.4) / AEW_ORBIT.speed;
    const ph = (((t - aewUp) / 1000) % period) / period;
    const th = ph * 2 * Math.PI;
    const along = AEW_ORBIT.legM * Math.cos(th);
    const across = 14_000 * Math.sin(th);
    const p1 = destination(AEW_ORBIT.center, AEW_ORBIT.axisAz, along);
    const pos = destination(p1, AEW_ORBIT.axisAz + 90, across);
    const az = AEW_ORBIT.axisAz + (Math.sin(th) >= 0 ? 180 : 0);
    return { pos, az };
  };
  E.emit('fused', 'fused', {
    entity_id: 'S-AEW1',
    source_time: aewUp,
    provenance: P.air,
    derived_from: [refs.dp1],
    releasability: REL_JOINT,
    payload: {
      ontology: { template: 'sensor', class: 'aew' },
      aliases: { name: 'AEW&C 1', callsign: 'AEW 1' },
      location: { lon: AEW_ORBIT.center[0], lat: AEW_ORBIT.center[1], hae: AEW_ORBIT.altM },
      mil_view: { identity: 'friend', environment: 'air', sidc: CLASSES.aew!.sidc, context: 'reality' },
      sensor: { type: 'aew', range_m: 350_000, height_m: AEW_ORBIT.altM, status: 'up' },
      health: { link: 'up' },
      indicators: { notional: true },
    },
  });
  for (let t = aewUp + 10 * SECOND; t < aewDown; t += 10 * SECOND) {
    const { pos, az } = aewPos(t);
    E.emit('fused', 'fused', {
      entity_id: 'S-AEW1',
      source_time: t,
      ingest_time: t + 800,
      provenance: P.air,
      payload: { location: { lon: pos[0], lat: pos[1], hae: AEW_ORBIT.altM, vel: enu(az, AEW_ORBIT.speed) } },
    });
  }
  E.emit('fused', 'fused', { entity_id: 'S-AEW1', source_time: aewDown, provenance: P.air, payload: { is_live: false } });

  // ============================================================ build threats
  const threats: Threat[] = [];
  const north = AXES.north;
  const west = AXES.west;
  const jitter = (p: LonLat, m: number): LonLat => destination(p, R.range(0, 360), R.range(0, m));
  const aimpoints = PROCESS_UNITS.filter((u) => u.tier === 1).map((u) => u.at);
  const pathFor = (axis: 'north' | 'west', end: LonLat, launchJ = 8000, viaJ = 6000): Path => {
    const ax = axis === 'north' ? north : west;
    return new Path([jitter(ax.launch, launchJ), ...ax.via.map((v) => jitter(v, viaJ)), end]);
  };

  // --- Wave 2: main OWA strike on both axes.
  // Lead reaches R1 at H; others follow with a margin larger than the aimpoint offset from VP
  // (≤1.2 km ≈ 25 s), so no other drone crosses the R1 ring before H.
  const owaArrivals = Array.from({ length: COUNTS.owa }, (_, i) => (i === 0 ? H : H + R.range(35, 300) * SECOND)).sort((a, b) => a - b);
  const owaFates: Fate['kind'][] = [];
  const owaPlan = [
    ...Array<string>(24).fill('deflect'),
    ...Array<string>(26).fill('int'),
    ...Array<string>(8).fill('vsh'),
    ...Array<string>(6).fill('r1'),
    ...Array<string>(2).fill('leak'),
  ];
  // Lead (index 0) is an R1 gun kill: it defines H by entering R1.
  const restPlan = R.shuffle(owaPlan.filter((_, i) => i !== owaPlan.indexOf('r1')));
  const plan = ['r1', ...restPlan];
  let leakN = 0;
  owaArrivals.forEach((arr, i) => {
    const axis: 'north' | 'west' = i % 11 < 6 ? 'north' : 'west';
    const kind = plan[i]!;
    let end = R.pick(aimpoints);
    let fate: Fate;
    if (kind === 'deflect') fate = { kind: 'deflect', atRemaining: R.range(80_000, 96_000) };
    else if (kind === 'int') fate = { kind: 'kill', atRemaining: R.range(26_000, 55_000), effector: axis === 'north' ? 'B-IDN' : 'B-ID3', weapon: 'interceptor drone' };
    else if (kind === 'vsh') fate = { kind: 'kill', atRemaining: R.range(5_400, 7_800), effector: R.u() < 0.5 ? 'B-VSH1' : 'B-VSH2', weapon: 'VSHORADS missile' };
    else if (kind === 'r1') fate = { kind: 'kill', atRemaining: R.range(1_800, 4_200), effector: R.pick(['B-GUN1', 'B-GUN2', 'B-DEW1', 'B-CUAS1']), weapon: 'close-in' };
    else {
      leakN += 1;
      end = leakN === 1 ? destination(VP, 265, 2600) : destination(PROCESS_UNITS.find((u) => u.id === 'PU-TNK')!.at, 200, 180);
      fate = { kind: 'leak', impact: end, damage: leakN === 1 ? 'none' : 'light' };
    }
    if (i === 0) {
      fate = { kind: 'kill', atRemaining: 3_400, effector: 'B-GUN1', weapon: 'radar-cued gun' };
      end = VP; // lead aims at the VP centre so path-remaining equals range to the R1 ring centre
    }
    const path = pathFor(axis, end);
    const speed = R.range(48, 54);
    const tStart = arr - ((path.total - 5000) / speed) * 1000;
    owaFates.push(fate.kind);
    threats.push({
      id: '',
      cls: 'owa_drone',
      wave: 'W2',
      axis,
      group: axis === 'north' ? 'G-W2N' : 'G-W2W',
      path,
      speed,
      alt: R.range(90, 160),
      tStart,
      tDetect: 0,
      fate,
    });
  });
  // One R1 gun kill near the crude unit is refused for debris and taken by the laser instead.
  const debrisCase = threats.find((t, i) => i > 0 && t.fate.kind === 'kill' && t.fate.weapon === 'close-in');
  if (debrisCase && debrisCase.fate.kind === 'kill') {
    debrisCase.refusedGun = true;
    debrisCase.fate = { ...debrisCase.fate, effector: 'B-DEW1', weapon: 'laser DEW' };
  }
  // Remaining close-in kills get a concrete weapon label.
  for (const t of threats) if (t.fate.kind === 'kill' && t.fate.weapon === 'close-in') t.fate.weapon = weaponFor(t.fate.effector);

  // --- Wave 1: 40 decoys on NORTH, entering R4 (150 km) at H-30.
  for (let i = 0; i < COUNTS.decoys; i++) {
    const path = pathFor('north', R.pick(aimpoints), 12_000);
    const speed = R.range(52, 58);
    const tR4 = H - 30 * MINUTE + R.range(-90, 240) * SECOND;
    const tStart = tR4 - ((path.total - 150_000) / speed) * 1000;
    let fate: Fate;
    if (i < 16) fate = { kind: 'deflect', atRemaining: R.range(84_000, 100_000) };
    else if (i < 34) fate = { kind: 'kill', atRemaining: R.range(62_000, 105_000), effector: 'B-IDN', weapon: 'interceptor drone' };
    else fate = { kind: 'kill', atRemaining: R.range(30_000, 48_000), effector: 'B-ID3', weapon: 'interceptor drone' };
    threats.push({ id: '', cls: 'decoy', wave: 'W1', axis: 'north', group: 'G-W1N', path, speed, alt: R.range(700, 1100), tStart, tDetect: 0, fate, contestedUntil: H - 25 * MINUTE });
  }

  // --- Jet drones timed with Wave 2.
  for (let i = 0; i < COUNTS.jets; i++) {
    const axis: 'north' | 'west' = i < 6 ? 'north' : 'west';
    const path = pathFor(axis, R.pick(aimpoints));
    const speed = R.range(135, 145);
    const arr = H + R.range(40, 200) * SECOND;
    const tStart = arr - ((path.total - 5000) / speed) * 1000;
    let fate: Fate;
    if (i < 2) fate = { kind: 'kill', atRemaining: R.range(110_000, 125_000), effector: fighterIds[i]!, weapon: 'air-to-air missile' };
    else if (i < 6) fate = { kind: 'kill', atRemaining: R.range(34_000, 52_000), effector: axis === 'north' ? 'B-MRS2' : 'B-MRS1', weapon: 'MR SAM' };
    else fate = { kind: 'kill', atRemaining: R.range(9_000, 21_000), effector: i % 2 ? 'B-SRS1' : 'B-SRS2', weapon: 'SR SAM' };
    threats.push({ id: '', cls: 'jet_drone', wave: 'W2', axis, group: axis === 'north' ? 'G-W2N' : 'G-W2W', path, speed, alt: R.range(250, 400), tStart, tDetect: 0, fate });
  }

  // --- Cruise missiles: appear at H-15 on axis one (NORTH).
  for (let i = 0; i < COUNTS.cruise; i++) {
    const path = pathFor('north', R.pick(aimpoints), 20_000);
    const speed = R.range(225, 235);
    const tAppear = H - 15 * MINUTE + i * 9 * SECOND;
    const appearRemaining = 112_000 - i * 1500;
    const tStart = tAppear - ((path.total - appearRemaining) / speed) * 1000;
    const fate: Fate =
      i < 3
        ? { kind: 'kill', atRemaining: R.range(40_000, 54_000), effector: i % 2 ? 'B-MRS1' : 'B-MRS2', weapon: 'MR SAM' }
        : { kind: 'kill', atRemaining: R.range(14_000, 18_000), effector: 'B-SRS1', weapon: 'SR SAM' };
    threats.push({ id: '', cls: 'cruise_missile', wave: 'CM', axis: 'north', group: 'G-CM', path, speed, alt: R.range(30, 50), tStart, tDetect: tAppear, fate });
  }

  // --- Anti-radiation missiles: appear with the salvo; defeated by emission control.
  for (let i = 0; i < COUNTS.arms; i++) {
    const target = SENSORS[i === 0 ? 0 : 2]!.at;
    const start = destination(target, R.range(330, 350), 95_000);
    const path = new Path([start, target]);
    const speed = 480;
    const tAppear = H - 15 * MINUTE + 20 * SECOND + i * 15 * SECOND;
    threats.push({ id: '', cls: 'arm', wave: 'CM', axis: 'north', group: 'G-CM', path, speed, alt: 5000, tStart: tAppear, tDetect: tAppear, fate: { kind: 'emcon', atTime: H - 13 * MINUTE - 30 * SECOND + i * 10 * SECOND } });
  }

  // --- Wave 0 probes: three sorties approach coastal pickets over the sea and withdraw.
  const sorties = [H - 5 * HOUR, H - 3 * HOUR, H - 90 * MINUTE];
  let probeN = 0;
  sorties.forEach((ts, s) => {
    const n = s < 2 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const start = destination(VP, R.range(238, 252), 160_000);
      const turn = destination(VP, R.range(236, 254), R.range(72_000, 80_000));
      const path = new Path([start, turn, start]);
      threats.push({ id: '', cls: 'probe', wave: 'W0', axis: 'west', group: `G-W0-${s + 1}`, path, speed: R.range(32, 36), alt: 400, tStart: ts + k * 70 * SECOND, tDetect: ts + k * 70 * SECOND, fate: { kind: 'withdraw' } });
      probeN++;
    }
  });

  // --- Wave 3 re-attack at H+30 on NORTH.
  for (let i = 0; i < COUNTS.wave3; i++) {
    const path = pathFor('north', R.pick(aimpoints));
    const speed = R.range(48, 54);
    const tAt160 = H + 30 * MINUTE + R.range(-60, 240) * SECOND;
    const tStart = tAt160 - ((path.total - 160_000) / speed) * 1000;
    let fate: Fate;
    if (i < 7) fate = { kind: 'deflect', atRemaining: R.range(80_000, 95_000) };
    else if (i < 15) fate = { kind: 'kill', atRemaining: R.range(26_000, 55_000), effector: i % 2 ? 'B-IDN' : 'B-ID3', weapon: 'interceptor drone' };
    else if (i < 18) fate = { kind: 'kill', atRemaining: R.range(5_400, 7_600), effector: i % 2 ? 'B-VSH1' : 'B-VSH2', weapon: 'VSHORADS missile' };
    else fate = { kind: 'kill', atRemaining: R.range(1_800, 3_800), effector: i % 2 ? 'B-GUN1' : 'B-GUN2', weapon: 'radar-cued gun' };
    threats.push({ id: '', cls: 'owa_drone', wave: 'W3', axis: 'north', group: 'G-W3N', path, speed, alt: R.range(90, 160), tStart, tDetect: 0, fate });
  }

  // Detection times (raid detected about an hour out for the main drones).
  const detectRange: Record<string, number> = { owa_drone: 192_000, decoy: 215_000, jet_drone: 200_000, probe: 160_000 };
  for (const th of threats) {
    if (th.tDetect === 0) {
      const r = th.wave === 'W3' ? 160_000 : (detectRange[th.cls] ?? 150_000);
      th.tDetect = r >= th.path.total ? th.tStart + 60 * SECOND : timeAtRemaining(th, r);
    }
  }
  // Track numbers by detection order.
  [...threats].sort((a, b) => a.tDetect - b.tDetect).forEach((th) => (th.id = nextTrackId()));

  // ============================================================ raid-phase decisions (times first; records reference them)
  const tRaidDetected = Math.min(...threats.filter((t) => t.wave === 'W2' || t.wave === 'W1').map((t) => t.tDetect));
  const raidCount = threats.filter((t) => t.wave !== 'W0').length;

  // Raid detection marker record (thread anchor for the raid).
  refs.raidDetected = E.emit('fragment', 'observation', {
    entity_id: 'X-RAID-1',
    source_time: tRaidDetected,
    ingest_time: tRaidDetected + 20 * SECOND,
    provenance: { ...P.air, sensor_class: 'airborne + surface radar' },
    thread_id: TH_RAID,
    derived_from: [refs.dp0, refs.dp1],
    releasability: REL_JOINT,
    payload: {
      ontology: { template: 'fragment', class: 'report' },
      aliases: { name: 'Raid detected' },
      mil_view: { identity: 'hostile', environment: 'air', sidc: '10060100001103000000', context: 'reality' },
      location: { lon: VP[0] - 0.5, lat: VP[1] + 1.2, hae: 0 },
      fragment: { source_kind: 'contact_report', summary: `Raid detected about an hour out: ${raidCount} tracks expected on two axes, one over the sea.`, confidence: 'likely', associated: true },
      expiry_time: H + 2 * HOUR,
    } satisfies EntityComponents,
  });

  const dp3T = tRaidDetected + 3 * MINUTE;
  refs.dp3 = decision({
    t: dp3T,
    derived: [refs.raidDetected, refs.dp0],
    author: 'Joint HQ West · L2',
    payload: { dp: 'DP-3', title: 'Weapons control status by sector', layer: 'L2', status: 'approved', authority: 'L2 · Joint HQ West', summary: 'Sea sector FREE for drones; land corridor TIGHT.', options: [] },
  });
  for (const [id, az0, az1, wcs, label] of [
    ['CM-WCS-SEA', 200, 300, 'free', 'WCS FREE · SEA SECTOR (DRONES)'],
    ['CM-WCS-LAND', 300, 40, 'tight', 'WCS TIGHT · LAND CORRIDOR'],
  ] as const) {
    E.emit('command', 'command', {
      entity_id: id,
      source_time: dp3T + 20 * SECOND,
      provenance: P.command,
      derived_from: [refs.dp3],
      thread_id: TH_RAID,
      payload: {
        ontology: { template: 'geo', class: 'wcs_sector' },
        geo_shape: { type: 'sector', center: VP, radius_m: 150_000, inner_radius_m: 5_000, az_start: az0, az_end: az1 },
        geo_details: { type: 'wcs_sector', wcs, label, status: 'active' },
      } satisfies EntityComponents,
    });
  }
  const dp4T = dp3T + 4 * MINUTE;
  refs.dp4 = decision({
    t: dp4T,
    derived: [refs.raidDetected, refs.dp3],
    author: 'L2 + civil aviation + ports',
    payload: { dp: 'DP-4', title: 'Airspace and sea restrictions', layer: 'L2', status: 'approved', authority: 'L2 with DGCA/AAI and ports', summary: 'Civil corridor closed; tankers held offshore; identification responsibility agreed.', options: [] },
  });
  corridorRec('expired', 'CIVIL CORRIDOR · CLOSED', dp4T + 30 * SECOND, [refs.dp4]);
  E.emit('command', 'command', {
    entity_id: 'CM-SEA-HOLD',
    source_time: dp4T + 45 * SECOND,
    provenance: P.ais,
    derived_from: [refs.dp4],
    thread_id: TH_RAID,
    payload: {
      ontology: { template: 'geo', class: 'sea_restriction' },
      geo_shape: { type: 'circle', center: TANKER_HOLD, radius_m: 9000 },
      geo_details: { type: 'sea_restriction', label: 'TANKER HOLD AREA', status: 'active' },
    } satisfies EntityComponents,
  });
  // Soft-kill (EW / GNSS denial) areas active once the raid is detected.
  for (const [id, eid, az0, az1] of [['CM-EW-N', 'B-EW1', 320, 30], ['CM-EW-W', 'B-EW2', 225, 290]] as const) {
    E.emit('command', 'command', {
      entity_id: id,
      source_time: dp3T + 2 * MINUTE,
      provenance: P.command,
      derived_from: [refs.dp3],
      thread_id: TH_RAID,
      payload: {
        ontology: { template: 'geo', class: 'soft_kill_area' },
        geo_shape: { type: 'sector', center: VP, radius_m: 100_000, inner_radius_m: 78_000, az_start: az0, az_end: az1 },
        geo_details: { type: 'soft_kill_area', label: `RF/GNSS DENIAL · ${eid}`, status: 'active' },
      } satisfies EntityComponents,
    });
  }

  // Pairing approvals (DP-5) in batches; delegation window (DP-7) computed below.
  const dp5Times = [H - 28 * MINUTE, H - 22 * MINUTE, H - 16 * MINUTE, H - 12 * MINUTE + 30 * SECOND, H - 3 * MINUTE, H + 31 * MINUTE, H + 37 * MINUTE];
  const dp5Ids: Array<{ t: number; id: string }> = dp5Times.map((t, i) => ({
    t,
    id: decision({
      t,
      derived: [refs.dp0, refs.raidDetected],
      author: i === 0 ? 'Col. R. Rathi · releasing officer (L3)' : 'AD Direction Centre · L3',
      payload: {
        dp: 'DP-5',
        title: `Weapon–target pairing · batch ${i + 1}`,
        layer: 'L3',
        status: 'approved',
        authority: i === 0 ? 'Col. R. Rathi (named release)' : 'L3 · AD Direction Centre',
        summary: i === 0 ? 'Interceptor drones first; missiles held for the fast threats. One pairing released by a named officer.' : 'Batch approval within the approved envelope.',
        options: [],
      },
    }),
  }));

  // DP-6 reserve, missile-appears and leaker-forecast rules at the salvo.
  const salvoT = H - 15 * MINUTE;
  const ruleFire = (t: number, p: RuleFirePayload, derived: string[] = []) =>
    E.emit('rule_fire', 'event', { source_time: t, ingest_time: t, provenance: P.rules, payload: p, thread_id: TH_RAID, derived_from: [...derived] });
  refs.missileRule = ruleFire(salvoT + 5 * SECOND, { rule_id: 'R-MISSILE', rule: 'missile_appears', state: 'fired', value: COUNTS.cruise, subject_ids: [], note: 'Cruise salvo on axis one: upper tier re-prioritises; L2 alerted.' }, [refs.dp0]);
  refs.leakRule = ruleFire(salvoT + 40 * SECOND, { rule_id: 'R-LEAK', rule: 'leaker_forecast', state: 'fired', value: 5, threshold: 4, subject_ids: [], note: 'Leaker forecast passes 4.' }, [refs.dp0]);
  refs.dp6 = decision({
    t: salvoT + 55 * SECOND,
    derived: [refs.leakRule, refs.dp0],
    author: 'Rules engine under DP-0 condition (L2 pre-delegated)',
    payload: { dp: 'DP-6', title: 'Missile reserve release', layer: 'L2', status: 'delegated', authority: 'Condition written by L2 at DP-0', summary: 'Reserve floor opens: leaker forecast passed 4.', options: [] },
  });
  for (const id of ['B-MRS1', 'B-MRS2']) {
    const m = mags.get(id)!;
    m.ready += m.reserve;
    m.reserve = 0;
    ledger.push({ t: salvoT + 70 * SECOND, id, release: true, derived: [refs.dp6] });
  }
  // ARM warning → emission control (order recorded as a decision, not invented).
  refs.emcon = decision({
    t: salvoT + 50 * SECOND,
    derived: [refs.missileRule],
    author: 'AD Direction Centre · L3',
    payload: { dp: 'DP-5', title: 'Emission control on axis one radars', layer: 'L3', status: 'approved', authority: 'L3 · AD Direction Centre', summary: 'Anti-radiation threat: radars on axis one to emission control.', options: [] },
  });

  // ============================================================ simulate threats → fused/observation/engagement records
  const sensorsForObs = [
    ...SENSORS.filter((s) => s.cls !== 'aerostat'),
    { id: 'S-AST1', cls: 'aerostat' as const, name: 'Aerostat 1', at: [70.02, 22.48] as LonLat, range: 300_000, heightM: 1500 },
  ];
  const horizon = (hr: number, ht: number) => 4120 * (Math.sqrt(hr) + Math.sqrt(Math.max(1, ht)));
  // DP-7 delegates the drone class only; fast movers stay under the L3 batch approval.
  const engagementAuthority = (t: number, cls: string): string => {
    if (delegation && t >= delegation.start && t < delegation.end && !CLASSES[cls]?.fast) return delegation.id;
    let best = dp5Ids[0]!.id;
    for (const d of dp5Ids) if (d.t <= t) best = d.id;
    return best;
  };
  let delegation: { start: number; end: number; id: string } | undefined;

  // Compute delegation window from data: hostile R3 count vs interceptor channels.
  const r3Channels = EFFECTORS.filter((e) => e.cls === 'interceptor_site').reduce((a, e) => a + e.channels, 0);
  const aliveAt = (th: Threat, t: number): boolean => {
    if (t < th.tDetect) return false;
    const end = endTime(th);
    return t < end;
  };
  const r3CountAt = (t: number) =>
    threats.filter((th) => CLASSES[th.cls]!.threat && th.fate.kind !== 'withdraw' && aliveAt(th, t) && !deflectedBy(th, t) && inBand(remainingAt(th, t), 20_000, 60_000)).length;
  const satStart = H - 8 * MINUTE;
  const satValue = r3CountAt(satStart);
  let satEnd = satStart + 4 * MINUTE + 12 * SECOND;
  for (let t = satStart + 30 * SECOND; t < H + 10 * MINUTE; t += SECOND) {
    if (r3CountAt(t) <= r3Channels) {
      satEnd = t;
      break;
    }
  }
  refs.satRule = ruleFire(satStart, { rule_id: 'R-SAT', rule: 'saturation', state: 'fired', value: satValue, threshold: r3Channels, subject_ids: [], note: 'Hostile R3 tracks exceed fire-unit channels (drone class).' }, [refs.dp0]);
  refs.dp7 = decision({
    t: satStart + 2 * SECOND,
    derived: [refs.satRule, refs.dp0],
    author: 'Rules engine under DP-0 trigger',
    payload: { dp: 'DP-7', title: 'Inner-ring weapons free (drone class)', layer: 'L3', status: 'delegated', authority: 'Pre-authorised at DP-0 · L3 → L4/L5', summary: 'Engagement authority drops to fire units and bounded autonomy for the drone class in the inner rings.', options: [] },
  });
  delegation = { start: satStart, end: satEnd, id: refs.dp7 };
  ruleFire(satEnd, { rule_id: 'R-SAT', rule: 'saturation', state: 'cleared', value: r3CountAt(satEnd), threshold: r3Channels, subject_ids: [], note: 'Count fell; authority returns to L3.' }, [refs.satRule]);
  decision({
    t: satEnd + SECOND,
    derived: [refs.dp7],
    author: 'Rules engine',
    payload: { dp: 'DP-7', title: 'Delegation returned to L3', layer: 'L3', status: 'executed', authority: 'L3 · AD Direction Centre', summary: `Delegated window ${Math.round((satEnd - satStart) / 1000)} s, logged.`, options: [] },
  });

  // Plant advisory, aimpoints, protective action (DP-8).
  const advisoryT = H - 12 * MINUTE;
  const cdu = PROCESS_UNITS.find((u) => u.id === 'PU-CDU')!;
  const fcc = PROCESS_UNITS.find((u) => u.id === 'PU-FCC')!;
  const aim1 = E.emit('command', 'command', {
    entity_id: 'CM-AIM-1',
    source_time: advisoryT,
    provenance: P.armyAd,
    thread_id: TH_RAID,
    derived_from: [refs.raidDetected],
    releasability: REL_PLANT,
    payload: { ontology: { template: 'geo', class: 'aimpoint' }, geo_shape: { type: 'point', coordinates: cdu.at }, geo_details: { type: 'aimpoint', label: 'PREDICTED AIMPOINT · CRUDE UNIT', tot: H + MINUTE, status: 'active' } } satisfies EntityComponents,
  });
  E.emit('command', 'command', {
    entity_id: 'CM-AIM-2',
    source_time: advisoryT,
    provenance: P.armyAd,
    thread_id: TH_RAID,
    derived_from: [refs.raidDetected],
    releasability: REL_PLANT,
    payload: { ontology: { template: 'geo', class: 'aimpoint' }, geo_shape: { type: 'point', coordinates: fcc.at }, geo_details: { type: 'aimpoint', label: 'PREDICTED AIMPOINT · CATALYTIC CRACKER', tot: H + 8 * MINUTE, status: 'active' } } satisfies EntityComponents,
  });
  refs.dp8 = decision({
    t: advisoryT + 75 * SECOND,
    derived: [aim1],
    author: 'RIL control room · shift in-charge (L4)',
    rel: REL_PLANT,
    payload: { dp: 'DP-8', title: 'Plant protective action', layer: 'RIL', status: 'executed', authority: 'RIL L4 · L3 advisory', summary: 'Crude unit depressurised; catalytic cracker feed isolated under the pre-agreed trigger.', options: [] },
  });
  plantState('PU-CDU', 'depressurised', advisoryT + 3 * MINUTE, refs.dp8);
  plantState('PU-FCC', 'feed_isolated', advisoryT + 3 * MINUTE + 40 * SECOND, refs.dp8);

  // Interceptor ISR sortie that classifies the leading decoy group (B2).
  const decoys = threats.filter((t) => t.cls === 'decoy');
  const leadDecoy = decoys.reduce((a, b) => (timeAtRemaining(a, 150_000) < timeAtRemaining(b, 150_000) ? a : b));
  const classifyT = H - 25 * MINUTE;
  {
    const site = EFFECTORS.find((e) => e.id === 'B-IDN')!.at;
    const meet = destination(posOf(leadDecoy, classifyT).pos, 180, 3000);
    const launchT = classifyT - (distance(site, meet) / 65) * 1000;
    const intId = 'B-INT-ISR';
    flyInterceptor(intId, site, meet, launchT, classifyT, 'Interceptor (ISR)', false);
    refs.classify = E.emit('observation', 'observation', {
      entity_id: `O:${intId}:${leadDecoy.id}`,
      source_time: classifyT,
      ingest_time: classifyT + 2 * SECOND,
      provenance: { integration: 'scenario', source_feed: 'Interceptor autonomy (Hivemind)', sensor_class: 'EO/IR onboard classifier' },
      thread_id: TH_RAID,
      payload: {
        ontology: { template: 'track', class: 'decoy' },
        aliases: { name: `Lead group classified: decoys (${leadDecoy.group})` },
        location: { lon: meet[0], lat: meet[1], hae: 900 },
        mil_view: { identity: 'hostile', environment: 'air', sidc: CLASSES.decoy!.sidc, context: 'reality' },
        classification: { hypotheses: [{ class: 'decoy', label: 'Decoy', sidc: CLASSES.decoy!.sidc, p: 0.86 }, { class: 'owa_drone', label: 'OWA drone', sidc: CLASSES.owa_drone!.sidc, p: 0.14 }], contested: false, margin: 0.72 },
        expiry_time: classifyT + 10 * MINUTE,
      } satisfies EntityComponents,
    });
  }

  // Simulate every threat.
  const engagements: Array<{ t: number; target: string; effector: string; result: string }> = [];
  const kills: Array<{ th: Threat; t: number; at: LonLat }> = [];
  const intSiteFor = (preferred: string, t: number): string => {
    const order = [preferred, 'B-ID3', 'B-IDN', 'B-IDW'];
    for (const id of order) if ((mags.get(id)?.ready ?? 0) > (mags.get(id)?.floor ?? 0)) return id;
    void t;
    return preferred;
  };

  const obsSeen = new Map<string, number>();
  for (const th of threats) {
    const end = endTime(th);
    th.tEnd = end;
    const step = th.cls === 'probe' || th.wave === 'W0' ? 4 * SECOND : fusedEvery;
    let identity: StandardIdentity = 'pending';
    const idSteps: Array<[number, StandardIdentity]> =
      th.cls === 'probe'
        ? [[th.tDetect, 'pending'], [th.tDetect + 60 * SECOND, 'unknown'], [th.tDetect + 150 * SECOND, 'suspect']]
        : th.cls === 'cruise_missile' || th.cls === 'arm'
          ? [[th.tDetect, 'unknown'], [th.tDetect + 25 * SECOND, 'hostile']]
          : [[th.tDetect, 'pending'], [th.tDetect + 45 * SECOND, 'unknown'], [th.tDetect + 100 * SECOND, 'suspect'], [th.tDetect + 170 * SECOND, 'hostile']];
    const contested = th.contestedUntil !== undefined || (th.cls === 'owa_drone' && th.wave === 'W2' && th.axis === 'west' && R.u() < 0.18);
    const contestedUntil = th.contestedUntil ?? (contested ? end : 0);
    let lastSentClass = '';
    let lastState = '';
    let lastObs = 0;
    const firstRec = { id: '' };

    for (let t = th.tDetect; t <= end; t += step) {
      const { pos, az, speed, alt } = posOf(th, t);
      for (const [ts, idv] of idSteps) if (t >= ts) identity = idv;
      const isContested = contested && t < contestedUntil;
      const state = stateOf(th, t);
      const classKey = `${identity}|${isContested}|${state}`;
      const attr = classKey !== lastSentClass || state !== lastState;
      const noise = () => R.normal(25);
      const p2 = destination(pos, R.range(0, 360), Math.abs(noise()));
      const sensorsNow = sensorsForObs.filter((s) => {
        if (s.id === 'S-AEW1' && (t < aewUp || t > aewDown)) return false;
        const sp: LonLat = s.id === 'S-AEW1' ? aewPos(t).pos : s.at;
        const h = s.id === 'S-AEW1' ? AEW_ORBIT.altM : s.heightM;
        const range = Math.min(s.range, horizon(h, alt));
        return distance(sp, pos) <= range;
      });
      const contributing = [...sensorsNow.map((s) => s.id), ...(t >= aewUp && t <= aewDown ? ['S-AEW1'] : [])];
      const payload: EntityComponents = {
        location: { lon: p2[0], lat: p2[1], hae: alt, vel: enu(az, speed) },
        expiry_time: t + 30 * SECOND,
      };
      if (attr) {
        const classification = classificationFor(th.cls, isContested)!;
        // Contested entities display their top hypothesis, never the hidden truth.
        const shownCls = isContested ? classification.hypotheses[0]!.class : th.cls;
        const known = identity === 'hostile' || identity === 'suspect';
        const sidc = sidcWithIdentity(known ? CLASSES[shownCls]!.sidc : CLASSES.unknown_air!.sidc, identity);
        payload.ontology = { template: 'track', class: known ? shownCls : 'unknown_air' };
        payload.mil_view = { identity, environment: 'air', sidc, context: 'reality' };
        payload.classification = classification;
        payload.track = {
          state,
          contributing: [...new Set(contributing)],
          sensor_classes: [...new Set(contributing.map(sensorClassOf))],
          fusion_method: 'track-to-track · GNN / CV-Kalman',
          fusion_version: 'fallback:truth+noise v0',
          quality: 0.9,
          axis: th.axis.toUpperCase(),
          wave: th.wave,
        };
        payload.aliases = { track_number: th.id };
        payload.relationships = [{ type: 'member_of', target: th.group }];
        lastSentClass = classKey;
        lastState = state;
      }
      const rid = E.emit('fused', 'fused', {
        entity_id: th.id,
        source_time: t,
        ingest_time: t + 1500,
        provenance: P.fused,
        ...(attr && t === th.tDetect ? { thread_id: TH_RAID, derived_from: [refs.raidDetected] } : {}),
        ...(attr && th.cls === 'decoy' && t >= classifyT && t < classifyT + step ? { derived_from: [refs.classify!] } : {}),
        releasability: REL_JOINT,
        payload,
      });
      if (!firstRec.id) firstRec.id = rid;

      // Observations every ~12 s per contributing sensor (observation layer).
      if (t - lastObs >= 12 * SECOND) {
        lastObs = t;
        for (const s of sensorsNow.slice(0, 2)) {
          const op = destination(pos, R.range(0, 360), Math.abs(R.normal(220)));
          const oid = `O:${s.id}:${th.id}`;
          // Full record on first contact (or after the observation expired); kinematics after.
          const full = t - (obsSeen.get(oid) ?? -Infinity) > 30 * SECOND;
          obsSeen.set(oid, t);
          const payload: EntityComponents = { location: { lon: op[0], lat: op[1], hae: alt }, expiry_time: t + 40 * SECOND };
          if (full) {
            payload.ontology = { template: 'track', class: 'unknown_air' };
            payload.mil_view = { identity: 'unknown', environment: 'air', sidc: CLASSES.unknown_air!.sidc, context: 'reality' };
            payload.track = { state: 'detected', contributing: [s.id], sensor_classes: [sensorClassOf(s.id)] };
            payload.relationships = [{ type: 'associated_with', target: th.id }];
          }
          E.emit('observation', 'observation', {
            entity_id: oid,
            source_time: t,
            ingest_time: t + R.range(400, 1800),
            provenance: { ...(s.cls === 'coastal_radar' ? P.coastal : s.cls === 'low_level_radar' ? P.armyAd : P.air), sensor_class: sensorClassOf(s.id) },
            releasability: REL_JOINT,
            payload,
          });
        }
      }
    }

    // Fate records.
    const f = th.fate;
    if (f.kind === 'kill') {
      const tk = timeAtRemaining(th, f.atRemaining);
      const at = posOf(th, tk).pos;
      kills.push({ th, t: tk, at });
      let effector = f.effector;
      if (f.weapon === 'interceptor drone') effector = intSiteFor(effector, tk);
      const auth = engagementAuthority(tk - 120 * SECOND, th.cls);
      if (th.refusedGun) {
        const tr = tk - 45 * SECOND;
        const fp = E.emit('command', 'command', {
          entity_id: 'CM-DEBRIS-1',
          source_time: tr - 5 * SECOND,
          provenance: P.rules,
          thread_id: TH_RAID,
          payload: { ontology: { template: 'geo', class: 'debris_footprint' }, geo_shape: { type: 'ellipse', center: destination(at, inverse(at, cdu.at).azimuth_deg, distance(at, cdu.at) * 0.85), semi_major_m: 1400, semi_minor_m: 600, orientation_deg: posOf(th, tr).az }, geo_details: { type: 'debris_footprint', label: 'PREDICTED DEBRIS · OVER CRUDE UNIT', status: 'active' }, expiry_time: tk + 3 * MINUTE } satisfies EntityComponents,
        });
        const rf = ruleFire(tr, { rule_id: 'R-DEBRIS', rule: 'debris_on_vp', state: 'fired', subject_ids: [th.id, 'PU-CDU'], note: 'Gun engagement refused: debris footprint covers a Tier-1 VP. Not the last chance to engage.' }, [fp]);
        engagement(tr, { effector_id: 'B-GUN1', target_id: th.id, weapon: 'radar-cued gun', result: 'refused', authority_record: auth, note: 'Debris would fall on the crude unit.' }, [rf]);
      }
      const assignT = tk - 120 * SECOND;
      const launchT = tk - (f.weapon === 'interceptor drone' ? 150 : 40) * SECOND;
      const assignRec = engagement(assignT, { effector_id: effector, target_id: th.id, weapon: f.weapon, result: 'assigned', authority_record: auth }, [auth]);
      const launchRec = engagement(launchT, { effector_id: effector, target_id: th.id, weapon: f.weapon, result: 'launched', authority_record: auth }, [auth]);
      const killRec = engagement(tk, { effector_id: effector, target_id: th.id, weapon: f.weapon, result: 'kill', authority_record: auth, intercept: at }, [auth]);
      engagements.push({ t: tk, target: th.id, effector, result: 'kill' });
      const m = mags.get(effector);
      if (m) {
        m.ready = Math.max(0, m.ready - 1);
        // A channel is held from the first of assignment or launch until the kill.
        ledger.push({ t: Math.min(assignT, launchT), id: effector, busy: 1, derived: [assignRec] });
        ledger.push({ t: launchT, id: effector, ready: -1, derived: [launchRec] });
        ledger.push({ t: tk, id: effector, busy: -1, derived: [killRec] });
      }
      if (f.weapon === 'interceptor drone') {
        const site = EFFECTORS.find((e) => e.id === effector)!.at;
        const launchT = tk - 150 * SECOND;
        flyInterceptor(`B-INT-${String(++ids.int).padStart(2, '0')}`, site, at, launchT, tk, 'Interceptor drone', true);
      }
      E.emit('fused', 'fused', {
        entity_id: th.id,
        source_time: tk + 500,
        ingest_time: tk + 2000,
        provenance: P.fused,
        derived_from: [killRec],
        thread_id: TH_RAID,
        releasability: REL_JOINT,
        payload: { location: { lon: at[0], lat: at[1], hae: th.alt }, track: { state: 'destroyed', contributing: [], sensor_classes: [], wave: th.wave, axis: th.axis.toUpperCase() }, expiry_time: tk + 60 * SECOND },
      });
      E.emit('fused', 'fused', { entity_id: th.id, source_time: tk + 45 * SECOND, ingest_time: tk + 46 * SECOND, provenance: P.fused, payload: { is_live: false } });
    } else if (f.kind === 'leak') {
      const ti = end;
      th.impactRec = E.emit('fused', 'fused', {
        entity_id: th.id,
        source_time: ti,
        ingest_time: ti + 1500,
        provenance: P.fused,
        thread_id: TH_RAID,
        releasability: REL_JOINT,
        payload: { location: { lon: f.impact[0], lat: f.impact[1], hae: 0 }, track: { state: 'impact', contributing: [], sensor_classes: [], wave: th.wave, axis: th.axis.toUpperCase() }, expiry_time: ti + 10 * MINUTE },
      });
      th.endPos = f.impact;
    } else if (f.kind === 'deflect' || f.kind === 'emcon' || f.kind === 'withdraw') {
      if (f.kind === 'withdraw')
        E.emit('fused', 'fused', { entity_id: th.id, source_time: end, ingest_time: end + SECOND, provenance: P.fused, releasability: REL_JOINT, payload: { track: { state: 'withdrawn', contributing: [], sensor_classes: [], wave: th.wave, axis: th.axis.toUpperCase() } } });
      E.emit('fused', 'fused', { entity_id: th.id, source_time: end + SECOND, ingest_time: end + 2 * SECOND, provenance: P.fused, payload: { is_live: false } });
    }
    void firstRec;
  }

  // ============================================================ groups (raid group estimates)
  const groups = new Map<string, Threat[]>();
  for (const th of threats) groups.set(th.group, [...(groups.get(th.group) ?? []), th]);
  const groupNames: Record<string, string> = { 'G-W2N': 'Wave 2 · North', 'G-W2W': 'Wave 2 · West', 'G-W1N': 'Wave 1 · decoys North', 'G-CM': 'Missile salvo · CM + ARM', 'G-W3N': 'Wave 3 · re-attack' };
  for (const [gid, members] of groups) {
    if (gid.startsWith('G-W0')) continue;
    const t0g = Math.min(...members.map((m) => m.tDetect));
    const t1g = Math.max(...members.map((m) => m.tEnd ?? m.tDetect));
    let first = true;
    for (let t = t0g; t <= t1g + 10 * SECOND; t += 10 * SECOND) {
      const live = members.filter((m) => t >= m.tDetect && t < (m.tEnd ?? 0) && !deflectedBy(m, t));
      if (!live.length) {
        if (!first) E.emit('fused', 'fused', { entity_id: gid, source_time: t, provenance: P.fused, payload: { is_live: false } });
        break;
      }
      const pts = live.map((m) => posOf(m, t).pos);
      const c: LonLat = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      E.emit('fused', 'fused', {
        entity_id: gid,
        source_time: t,
        ingest_time: t + 2 * SECOND,
        provenance: P.fused,
        releasability: REL_JOINT,
        ...(first ? { thread_id: TH_RAID, derived_from: [refs.raidDetected] } : {}),
        payload: {
          ontology: { template: 'group', class: 'raid_group' },
          aliases: { name: groupNames[gid] ?? gid },
          location: { lon: c[0], lat: c[1], hae: 0 },
          group: { members: live.map((m) => m.id), axis: members[0]!.axis.toUpperCase(), wave: members[0]!.wave, raid_id: 'RAID-1' },
          geo_shape: { type: 'polygon', coordinates: [hull(pts)] },
          expiry_time: t + 40 * SECOND,
        },
      });
      first = false;
    }
  }

  // ============================================================ civil air traffic
  const civilIds: string[] = [];
  const civilFlights: Array<{ id: string; start: number; dir: 1 | -1; speed: number; offset: number }> = [];
  let fn = 0;
  const addFlights = (from: number, to: number) => {
    for (let t = from; t < to; t += R.range(5, 9) * MINUTE) {
      fn += 1;
      civilFlights.push({ id: `C-${String(100 + fn)}`, start: t, dir: fn % 2 ? 1 : -1, speed: R.range(220, 240), offset: R.range(-5000, 5000) });
    }
  };
  addFlights(H - 4 * HOUR, dp4T);
  addFlights(H + 3 * HOUR, H + 6 * HOUR);
  const corridorPath = new Path(CIVIL_CORRIDOR);
  let civilRuleFired = false;
  for (const fl of civilFlights) {
    const path = fl.dir === 1 ? corridorPath : new Path([...CIVIL_CORRIDOR].reverse());
    const tEnd = fl.start + (path.total / fl.speed) * 1000;
    civilIds.push(fl.id);
    let first = true;
    let inWcs = false;
    for (let t = fl.start; t <= tEnd; t += 8 * SECOND) {
      const d = (fl.speed * (t - fl.start)) / 1000;
      const { pos, az } = path.at(d);
      const p = destination(pos, az + 90, fl.offset);
      const payload: EntityComponents = { location: { lon: p[0], lat: p[1], hae: 10_500, vel: enu(az, fl.speed) }, expiry_time: t + 60 * SECOND };
      if (first) {
        payload.ontology = { template: 'track', class: 'civil_air' };
        payload.mil_view = { identity: 'neutral', environment: 'air', sidc: CLASSES.civil_air!.sidc, context: 'reality' };
        payload.aliases = { name: `Civil flight ${fl.id}`, callsign: `CIV${400 + Number(fl.id.slice(2))}`, adc_number: `ADC-${7000 + Number(fl.id.slice(2))}` };
        payload.track = { state: 'detected', contributing: ['S-SR1'], sensor_classes: ['flight plan + SSR'] };
        first = false;
      }
      E.emit('fused', 'fused', { entity_id: fl.id, source_time: t, ingest_time: t + 1200, provenance: P.civil, payload });
      // Civil track inside the land WCS-tight engagement area after DP-3 → block automatic engagement.
      const { distance_m, azimuth_deg } = inverse(VP, p);
      const inside = t > dp3T && distance_m < 150_000 && distance_m > 5000 && (azimuth_deg >= 300 || azimuth_deg <= 40);
      if (inside && !inWcs && !civilRuleFired) {
        ruleFire(t, { rule_id: 'R-CIVIL', rule: 'civil_in_engagement_area', state: 'fired', subject_ids: [fl.id], note: 'Civil track in engagement area: automatic engagement blocked; escalated to L3.' }, [refs.dp3]);
        inWcs = true;
      } else if (!inside && inWcs) {
        ruleFire(t, { rule_id: 'R-CIVIL', rule: 'civil_in_engagement_area', state: 'cleared', subject_ids: [fl.id], note: 'Civil track left engagement area.' });
        inWcs = false;
        civilRuleFired = true;
      }
    }
    E.emit('fused', 'fused', { entity_id: fl.id, source_time: tEnd + SECOND, provenance: P.civil, payload: { is_live: false } });
  }
  corridorRec('active', 'CIVIL CORRIDOR · OPEN', H + 3 * HOUR - 5 * MINUTE);

  // ============================================================ AIS shipping
  const lanes: Array<[LonLat, LonLat]> = [
    [[68.6, 22.65], [70.3, 22.65]],
    [[68.8, 22.85], [70.0, 22.55]],
    [[66.9, 21.6], [68.9, 23.6]],
    [[67.2, 22.8], [69.2, 21.3]],
    [[68.2, 21.9], [69.0, 22.4]],
  ];
  const aisDense = (t: number) => t > H - 4 * HOUR && t < H + 4 * HOUR;
  const vessels: Array<{ id: string; cls: 'merchant' | 'tanker' }> = [];
  for (let v = 0; v < 28; v++) {
    const id = `V-${String(201 + v)}`;
    const cls = v % 5 === 0 ? 'tanker' : 'merchant';
    vessels.push({ id, cls });
    const lane = lanes[v % lanes.length]!;
    const path = new Path(lane);
    const speed = R.range(5, 8);
    const phase = R.range(0, path.total * 2);
    let first = true;
    for (let t = T0 + R.range(0, 600) * SECOND; t < T1; t += aisDense(t) ? 60 * SECOND : 10 * MINUTE) {
      const s = (phase + (speed * (t - T0)) / 1000) % (path.total * 2);
      const forward = s <= path.total;
      const { pos, az } = path.at(forward ? s : path.total * 2 - s);
      const heading = forward ? az : (az + 180) % 360;
      const payload: EntityComponents = { location: { lon: pos[0], lat: pos[1], hae: 0, vel: enu(heading, speed) }, expiry_time: t + 25 * MINUTE };
      if (first) {
        payload.ontology = { template: 'track', class: cls };
        payload.mil_view = { identity: 'neutral', environment: 'surface', sidc: CLASSES[cls]!.sidc, context: 'reality' };
        payload.aliases = { name: `${cls === 'tanker' ? 'Tanker' : 'Merchant'} ${id}`, mmsi: `SYN-${419000000 + v}` };
        first = false;
      }
      E.emit('fused', 'fused', { entity_id: id, source_time: t, ingest_time: t + 3 * SECOND, provenance: P.ais, payload });
    }
  }
  // Two tankers due at the jetty: inbound, held offshore after DP-4, then proceed.
  const jetty = PROCESS_UNITS.find((u) => u.id === 'PU-JTY')!.at;
  for (const [k, start] of [[1, [68.3, 22.2]], [2, [68.1, 22.5]]] as const) {
    const id = `V-TKR${k}`;
    const due = H + (k === 1 ? 40 : 70) * MINUTE;
    const pathIn = new Path([start as LonLat, jetty]);
    const speed = 6;
    const tStart = due - (pathIn.total / speed) * 1000;
    let first = true;
    let holdFrom: LonLat | undefined;
    for (let t = Math.max(T0, tStart); t < H + 6 * HOUR; t += aisDense(t) ? 60 * SECOND : 10 * MINUTE) {
      let pos: LonLat;
      let heading: number;
      if (t < dp4T) {
        const r = pathIn.at(((t - tStart) / 1000) * speed);
        pos = r.pos;
        heading = r.az;
      } else if (t < H + 3 * HOUR) {
        holdFrom ??= pathIn.at(((dp4T - tStart) / 1000) * speed).pos;
        const toHold = new Path([holdFrom, TANKER_HOLD]);
        const r = toHold.at(((t - dp4T) / 1000) * speed);
        pos = r.pos;
        heading = r.az;
      } else {
        const toJetty = new Path([TANKER_HOLD, jetty]);
        const r = toJetty.at(((t - H - 3 * HOUR) / 1000) * speed);
        pos = r.pos;
        heading = r.az;
      }
      const payload: EntityComponents = { location: { lon: pos[0], lat: pos[1], hae: 0, vel: enu(heading, speed) }, expiry_time: t + 25 * MINUTE };
      if (first) {
        payload.ontology = { template: 'track', class: 'tanker' };
        payload.mil_view = { identity: 'neutral', environment: 'surface', sidc: CLASSES.tanker!.sidc, context: 'reality' };
        payload.aliases = { name: `Tanker ${k} (due at jetty)`, mmsi: `SYN-41910000${k}` };
        first = false;
      }
      E.emit('fused', 'fused', { entity_id: id, source_time: t, ingest_time: t + 3 * SECOND, provenance: P.ais, payload });
    }
  }

  // ============================================================ Blue heartbeats (force state every 5 min)
  for (const id of [...SENSORS.map((s) => s.id), ...EFFECTORS.map((e) => e.id)]) {
    for (let t = T0 + 5 * MINUTE; t < T1; t += 5 * MINUTE) {
      if (id === 'B-GUN2' && Math.abs(t - (H + 34 * MINUTE)) < 3 * MINUTE) continue;
      // Keep the recorded faults honest: LLR1 degraded until swapped; aerostat grounded until DP-1.
      const degraded = (id === 'S-LLR1' && t >= llrFaultT && t < radarSwapT) || (id === 'S-AST1' && t < dp1T + 2 * HOUR);
      E.emit('fused', 'fused', { entity_id: id, source_time: t, ingest_time: t + 2 * SECOND, provenance: P.force, payload: { health: { link: degraded ? 'degraded' : 'up', last_heard: t } } });
    }
  }

  // ============================================================ comms-degraded blip during Wave 3
  const commsT = H + 34 * MINUTE;
  E.emit('fused', 'fused', { entity_id: 'B-GUN2', source_time: commsT, provenance: P.force, payload: { health: { link: 'down', last_heard: commsT } } });
  ruleFire(commsT + 20 * SECOND, { rule_id: 'R-COMMS', rule: 'comms_degraded', state: 'fired', subject_ids: ['B-GUN2'], threshold: 'T', note: 'L3 link lost: last valid envelope stays in force.' });
  E.emit('fused', 'fused', { entity_id: 'B-GUN2', source_time: commsT + 70 * SECOND, provenance: P.force, payload: { health: { link: 'up', last_heard: commsT + 70 * SECOND } } });
  ruleFire(commsT + 71 * SECOND, { rule_id: 'R-COMMS', rule: 'comms_degraded', state: 'cleared', subject_ids: ['B-GUN2'] });

  // ============================================================ fighters (CAP)
  const capStart = tRaidDetected + 2 * MINUTE;
  fighterIds.forEach((id, i) => {
    const out = new Path([[FIGHTER_BASE[0] + i * 0.01, FIGHTER_BASE[1]], destination(FIGHTER_CAP, 90 * i, 8000)]);
    const speed = 240;
    const tCap = capStart + (out.total / speed) * 1000;
    const tRtb = H + 20 * MINUTE;
    const back = new Path([destination(FIGHTER_CAP, 90 * i, 8000), FIGHTER_BASE]);
    for (let t = capStart; t < tRtb + (back.total / speed) * 1000; t += 4 * SECOND) {
      let pos: LonLat;
      let az: number;
      let alt = 7000;
      if (t < tCap) ({ pos, az } = out.at(((t - capStart) / 1000) * speed));
      else if (t < tRtb) {
        const th = (((t - tCap) / 1000) * 0.012) % (2 * Math.PI);
        pos = destination(destination(FIGHTER_CAP, 90 * i, 8000), (th * 180) / Math.PI, 15_000);
        az = ((th * 180) / Math.PI + 90) % 360;
      } else {
        ({ pos, az } = back.at(((t - tRtb) / 1000) * speed));
        alt = 3000;
      }
      E.emit('fused', 'fused', { entity_id: id, source_time: t, ingest_time: t + 1200, provenance: P.air, payload: { location: { lon: pos[0], lat: pos[1], hae: alt, vel: enu(az, speed) } } });
    }
  });

  // ============================================================ after the raid: BDA, DP-9..12
  const killIds = engagements.map((e) => e.target);
  const bda = (t: number, p: BdaPayload, derived: string[]) =>
    E.emit('bda', 'event', { source_time: t, ingest_time: t + 2 * MINUTE, provenance: { ...P.plant, sensor_class: 'BDA fused with plant process data' }, payload: p, thread_id: TH_RAID, derived_from: derived, releasability: REL_PLANT });
  const leakers = threats.filter((t) => t.fate.kind === 'leak');
  const bdaTank = bda(H + 15 * MINUTE, { target_id: 'PU-TNK', damage: 'light', summary: 'Fragment strike on a tank-farm roof. Fire water used for eighteen minutes.', location: leakers[1]?.endPos ?? PROCESS_UNITS[4]!.at }, [refs.dp8, ...(leakers[1]?.impactRec ? [leakers[1].impactRec] : [])]);
  const bdaUnits = bda(H + 16 * MINUTE, { target_id: 'VP-RIL', damage: 'none', summary: 'No process-unit damage. No Tier-1 unit hit.' }, [refs.dp8, ...leakers.flatMap((l) => (l.impactRec ? [l.impactRec] : []))]);
  bda(H + 17 * MINUTE, { target_id: leakers[0]?.id ?? 'VP-RIL', damage: 'none', summary: 'Leaker impact on open ground inside R1.', location: leakers[0]?.endPos ?? VP }, leakers[0]?.impactRec ? [leakers[0].impactRec] : []);

  // C2 inputs (CONOP: "the adversary's false claims with counter-facts", "debris attribution with its
  // confidence"). Synthetic injects; the counter-fact is the recorded BDA, not a number made up here.
  E.emit('fragment', 'observation', {
    entity_id: 'X-IO-1',
    source_time: H + 28 * MINUTE,
    ingest_time: H + 29 * MINUTE,
    provenance: { ...P.intel, sensor_class: 'open source (adversary media)' },
    thread_id: TH_RAID,
    releasability: REL_JOINT,
    payload: {
      ontology: { template: 'fragment', class: 'io_claim' },
      aliases: { name: 'Adversary claim: refinery units destroyed' },
      mil_view: { identity: 'hostile', environment: 'land', sidc: CLASSES.io_claim!.sidc, context: 'reality' },
      fragment: { source_kind: 'osint', summary: 'Adversary channels claim the crude unit and the catalytic cracker were destroyed.', confidence: 'confirmed', associated: true },
      relationships: [
        { type: 'associated_with', target: 'PU-CDU' },
        { type: 'associated_with', target: 'PU-FCC' },
      ],
      indicators: { notional: true },
      expiry_time: H + 2 * DAYS(1),
    } satisfies EntityComponents,
  });
  const tankLeaker = leakers[1];
  E.emit('fragment', 'observation', {
    entity_id: 'X-DEB-1',
    source_time: H + 34 * MINUTE,
    ingest_time: H + 36 * MINUTE,
    provenance: { ...P.plant, sensor_class: 'ground recovery team' },
    thread_id: TH_RAID,
    derived_from: [bdaTank],
    releasability: REL_PLANT,
    payload: {
      ontology: { template: 'fragment', class: 'debris_report' },
      aliases: { name: 'Debris recovered at the tank farm' },
      location: { lon: (tankLeaker?.endPos ?? PROCESS_UNITS[4]!.at)[0], lat: (tankLeaker?.endPos ?? PROCESS_UNITS[4]!.at)[1], hae: 0 },
      mil_view: { identity: 'unknown', environment: 'land', sidc: CLASSES.debris_report!.sidc, context: 'reality' },
      fragment: {
        source_kind: 'contact_report',
        summary: `Debris recovered at the tank farm: one-way-attack drone airframe, consistent with Wave 2 ${tankLeaker?.axis === 'west' ? 'West' : 'North'}.`,
        confidence: 'likely',
        associated: true,
      },
      relationships: [...(tankLeaker ? [{ type: 'associated_with' as const, target: tankLeaker.id }] : []), { type: 'associated_with', target: 'PU-TNK' }],
      indicators: { notional: true },
      expiry_time: H + 2 * DAYS(1),
    } satisfies EntityComponents,
  });
  plantState('PU-CDU', 'restart_assessment', H + 50 * MINUTE, bdaUnits);
  plantState('PU-FCC', 'restart_assessment', H + 50 * MINUTE, bdaUnits);
  decision({ t: H + 50 * MINUTE, derived: [bdaTank, bdaUnits], author: 'RIL L4 + L2', rel: REL_PLANT, payload: { dp: 'DP-9', title: 'Restart / continued shutdown', layer: 'RIL', status: 'proposed', authority: 'RIL L4 + L2', summary: 'Restart assessment opened; re-attack risk still visible.', options: [] } });
  decision({ t: H + 42 * MINUTE, derived: [bdaTank, bdaUnits], author: 'L1 (MoD / PIB / MEA) with state', rel: ['NATIONAL'], payload: { dp: 'DP-10', title: 'Public narrative support', layer: 'L1', status: 'proposed', authority: 'L1 + state', summary: 'Verified events separated from unverified claims; unverified items held back.', options: [] } });
  decision({ t: H + 42 * MINUTE + 30 * SECOND, derived: [bdaUnits], author: 'L1 only', rel: ['NATIONAL'], payload: { dp: 'DP-11', title: 'Counter-strike / response', layer: 'L1', status: 'option', authority: 'L1 only', summary: 'Labelled as options with escalation estimates. Attribution pending; no response approved.', options: [{ id: 'respond', label: 'Response options (labelled)', selected: false }] } });
  decision({ t: H + 60 * MINUTE, derived: [bdaUnits], author: 'L2 / L3', payload: { dp: 'DP-12', title: 'Reconstitution', layer: 'L2', status: 'proposed', authority: 'L2/L3', summary: 'Radar swap confirmed; interceptor flight to re-arm; ROE amendment for the sea sector; what the adversary learned about the pickets.', options: [] } });
  // Wave 0 pattern flag.
  E.emit('fragment', 'observation', {
    entity_id: 'X-PROBE-PATTERN',
    source_time: sorties[2]! + 25 * MINUTE,
    ingest_time: sorties[2]! + 26 * MINUTE,
    provenance: { ...P.intel, sensor_class: 'pattern analysis (DeepSense stub)' },
    thread_id: TH_RAID,
    releasability: REL_JOINT,
    payload: {
      ontology: { template: 'fragment', class: 'report' },
      aliases: { name: 'Probe pattern flagged' },
      location: { lon: destination(VP, 245, 76_000)[0], lat: destination(VP, 245, 76_000)[1], hae: 0 },
      mil_view: { identity: 'suspect', environment: 'air', sidc: CLASSES.probe!.sidc, context: 'reality' },
      fragment: { source_kind: 'probe', summary: 'Wave 0 probes approached coastal pickets and withdrew: pattern consistent with locating radars and measuring response time.', confidence: 'likely', associated: true },
      expiry_time: H + 3 * HOUR,
    } satisfies EntityComponents,
  });

  // ============================================================ manifest
  const defeated = threats.filter((t) => t.fate.kind !== 'leak').length;
  const counts: Record<string, number> = {
    threats: threats.length,
    defeated,
    leakers: threats.length - defeated,
    hardKills: kills.length,
    softKill: threats.filter((t) => t.fate.kind === 'deflect').length,
    emcon: threats.filter((t) => t.fate.kind === 'emcon').length,
    probesWithdrawn: probeN,
    tier1Hits: 0,
    civilFlights: civilFlights.length,
    vessels: vessels.length + 2,
    raidTracksAtDetection: raidCount,
    saturationValue: satValue,
    saturationThreshold: r3Channels,
    delegationWindowS: Math.round((satEnd - satStart) / 1000),
    interceptorsExpended: ids.int,
  };
  void killIds;
  void owaFates;

  const manifest: ScenarioManifest = {
    id: SCENARIO_ID,
    name: SCENARIO_NAME,
    seed,
    clock: {
      d0: D0,
      h: H,
      marks: [
        { id: 'DP-0', label: 'DP-0 package on file', t: dp0T },
        { id: 'D-3', label: 'D-3 · warnings begin', t: T0 + 7 * HOUR + 40 * MINUTE },
        { id: 'DP-1', label: 'DP-1 alert posture', t: dp1T },
        { id: 'DP-2', label: 'DP-2 option (L1)', t: dp2T },
        { id: 'W0', label: 'Wave 0 probes', t: sorties[0]! },
        { id: 'H-60', label: 'Raid detected', t: tRaidDetected },
        { id: 'H-30', label: 'Wave 1 enters R4', t: H - 30 * MINUTE },
        { id: 'H-15', label: 'Cruise salvo', t: salvoT },
        { id: 'H-12', label: 'Aimpoints predicted', t: advisoryT },
        { id: 'H-8', label: 'Saturation', t: satStart },
        { id: 'H', label: 'H · first Wave 2 drone at R1', t: H },
        { id: 'H+5', label: 'Main wave spent', t: H + 5 * MINUTE },
        { id: 'H+30', label: 'Wave 3', t: H + 30 * MINUTE },
        { id: 'H+42', label: 'Evidence pack', t: H + 42 * MINUTE },
        { id: 'D+1', label: 'D+1', t: D0 + DAYS(1) },
      ],
    },
    t0: T0,
    t1: T1,
    center: VP,
    zoom: 7.2,
    counts,
    conflicts: CONFLICTS,
    threads: { iw: TH_IW, raid: TH_RAID },
    notes: ['All force numbers, placements and raid timelines are notional.', 'Fused tracks are truth + noise (fallback) until the fusion step lands.'],
  };

  replayLedger();
  return { drafts: E.sorted(), manifest };

  // ---------------------------------------------------------------- local helpers (hoisted)

  function DAYS(n: number): number {
    return n * 24 * HOUR;
  }

  /** Apply the effector ledger in time order and journal each unit's state as it changes. */
  function replayLedger(): void {
    const state = new Map(EFFECTORS.map((e) => [e.id, { ready: e.ready, reserve: e.reserve, floor: e.floor, busy: 0 }]));
    const order = ledger.map((x, i) => ({ x, i })).sort((a, b) => a.x.t - b.x.t || a.i - b.i);
    for (const { x } of order) {
      const def = EFFECTORS.find((e) => e.id === x.id);
      const st = state.get(x.id);
      if (!def || !st) continue;
      if (x.release) {
        st.ready += st.reserve;
        st.reserve = 0;
      }
      if (x.ready) st.ready = Math.max(0, st.ready + x.ready);
      if (x.busy) st.busy = Math.max(0, Math.min(def.channels, st.busy + x.busy));
      E.emit('fused', 'fused', {
        entity_id: x.id,
        source_time: x.t,
        provenance: P.force,
        derived_from: x.derived,
        releasability: REL_JOINT,
        payload: {
          effector: {
            type: def.cls === 'interceptor_site' ? 'interceptor_drone' : def.cls,
            channels: { total: def.channels, busy: st.busy },
            magazine: { ready: st.ready, reserve: st.reserve, floor: st.floor, capacity: def.ready + def.reserve },
            status: st.ready === 0 ? 'reloading' : st.busy > 0 ? 'engaging' : 'ready',
            wez: def.wez,
          },
        },
      });
    }
  }

  function engagement(t: number, p: EngagementPayload, derived: string[]): string {
    return E.emit('engagement', 'event', { source_time: t, ingest_time: t + 500, provenance: P.armyAd, payload: p, thread_id: TH_RAID, derived_from: derived, releasability: REL_JOINT });
  }

  function plantState(id: string, state: 'depressurised' | 'feed_isolated' | 'restart_assessment', t: number, derivedFrom: string): void {
    const u = PROCESS_UNITS.find((p) => p.id === id)!;
    E.emit('reference', 'reference', {
      entity_id: id,
      source_time: t,
      provenance: P.plant,
      derived_from: [derivedFrom],
      thread_id: TH_RAID,
      releasability: REL_PLANT,
      payload: { plant: { unit: u.name, tier: u.tier, state } },
    });
  }

  function flyInterceptor(id: string, from: LonLat, to: LonLat, t0: number, t1: number, name: string, expend: boolean): void {
    const path = new Path([from, to]);
    const dur = (t1 - t0) / 1000;
    const speed = path.total / Math.max(1, dur);
    let first = true;
    for (let t = t0; t <= t1; t += 2 * SECOND) {
      const { pos, az } = path.at(speed * ((t - t0) / 1000));
      const payload: EntityComponents = { location: { lon: pos[0], lat: pos[1], hae: 300, vel: enu(az, speed) }, expiry_time: t + 30 * SECOND };
      if (first) {
        payload.ontology = { template: 'asset', class: 'interceptor_drone' };
        payload.mil_view = { identity: 'friend', environment: 'air', sidc: CLASSES.interceptor_drone!.sidc, context: 'reality' };
        payload.aliases = { name };
        payload.health = { link: 'up' };
        first = false;
      }
      E.emit('fused', 'fused', { entity_id: id, source_time: t, ingest_time: t + 1000, provenance: { integration: 'scenario', source_feed: 'Interceptor autonomy (Hivemind)' }, payload, releasability: REL_JOINT });
    }
    if (expend) E.emit('fused', 'fused', { entity_id: id, source_time: t1 + 3 * SECOND, provenance: P.fused, payload: { is_live: false } });
    else E.emit('fused', 'fused', { entity_id: id, source_time: t1 + 10 * MINUTE, provenance: P.fused, payload: { is_live: false } });
  }

  function endTime(th: Threat): number {
    const f = th.fate;
    switch (f.kind) {
      case 'kill':
        return timeAtRemaining(th, f.atRemaining);
      case 'deflect':
        return timeAtRemaining(th, f.atRemaining) + 150 * SECOND;
      case 'emcon':
        return f.atTime + 40 * SECOND;
      case 'leak':
        return th.tStart + (th.path.total / th.speed) * 1000;
      case 'withdraw':
        return th.tStart + (th.path.total / th.speed) * 1000;
    }
  }
}

// ------------------------------------------------------------------ pure helpers

function deflectedBy(th: Threat, t: number): boolean {
  return th.fate.kind === 'deflect' && t >= timeAtRemaining(th, th.fate.atRemaining);
}

function stateOf(th: Threat, t: number): 'detected' | 'inbound' | 'deflected' | 'engaged' | 'leaked' {
  if (deflectedBy(th, t)) return 'deflected';
  if (th.fate.kind === 'emcon' && t >= th.fate.atTime) return 'deflected';
  if (th.fate.kind === 'withdraw') return 'detected';
  if (th.fate.kind === 'kill' && t >= timeAtRemaining(th, th.fate.atRemaining) - 120 * SECOND) return 'engaged';
  if (th.fate.kind === 'leak' && remainingAt(th, t) <= 5000) return 'leaked';
  return 'inbound';
}

function posOf(th: Threat, t: number): { pos: LonLat; az: number; speed: number; alt: number } {
  const f = th.fate;
  if (f.kind === 'deflect' && t >= timeAtRemaining(th, f.atRemaining)) {
    const td = timeAtRemaining(th, f.atRemaining);
    const at = th.path.at(th.path.total - f.atRemaining);
    const az = (at.az + 150) % 360;
    return { pos: destination(at.pos, az, (th.speed * 0.8 * (t - td)) / 1000), az, speed: th.speed * 0.8, alt: th.alt * 0.6 };
  }
  if (f.kind === 'emcon' && t >= f.atTime) {
    const at = th.path.at(th.speed * ((f.atTime - th.tStart) / 1000));
    const az = (at.az + 40) % 360;
    return { pos: destination(at.pos, az, (220 * (t - f.atTime)) / 1000), az, speed: 220, alt: Math.max(0, th.alt - 120 * ((t - f.atTime) / 1000)) };
  }
  const d = (th.speed * (t - th.tStart)) / 1000;
  const { pos, az } = th.path.at(d);
  return { pos, az, speed: th.speed, alt: th.alt };
}

function classificationFor(cls: string, contested: boolean): EntityComponents['classification'] {
  const h = (c: string, label: string, p: number) => ({ class: c, label, sidc: CLASSES[c]!.sidc, p });
  if (cls === 'decoy') {
    return contested
      ? { hypotheses: [h('owa_drone', 'OWA drone', 0.52), h('decoy', 'Decoy', 0.4), h('unknown_air', 'Unknown', 0.08)], contested: true, margin: 0.12 }
      : { hypotheses: [h('decoy', 'Decoy', 0.86), h('owa_drone', 'OWA drone', 0.14)], contested: false, margin: 0.72 };
  }
  if (cls === 'owa_drone') {
    return contested
      ? { hypotheses: [h('owa_drone', 'OWA drone', 0.5), h('decoy', 'Decoy', 0.38), h('unknown_air', 'Unknown', 0.12)], contested: true, margin: 0.12 }
      : { hypotheses: [h('owa_drone', 'OWA drone', 0.78), h('decoy', 'Decoy', 0.14), h('unknown_air', 'Unknown', 0.08)], contested: false, margin: 0.64 };
  }
  if (cls === 'jet_drone') return { hypotheses: [h('jet_drone', 'Jet drone', 0.82), h('cruise_missile', 'Cruise missile', 0.12), h('unknown_air', 'Unknown', 0.06)], contested: false, margin: 0.7 };
  if (cls === 'cruise_missile') return { hypotheses: [h('cruise_missile', 'Cruise missile', 0.9), h('jet_drone', 'Jet drone', 0.1)], contested: false, margin: 0.8 };
  if (cls === 'arm') return { hypotheses: [h('arm', 'Anti-radiation missile', 0.85), h('cruise_missile', 'Cruise missile', 0.15)], contested: false, margin: 0.7 };
  return { hypotheses: [h('probe', 'Probe drone', 0.7), h('unknown_air', 'Unknown', 0.3)], contested: false, margin: 0.4 };
}

function sensorClassOf(id: string): string {
  if (id.includes('AEW')) return 'airborne radar';
  if (id.includes('AST')) return 'aerostat radar';
  if (id.includes('CR')) return 'coastal radar';
  if (id.includes('LLR')) return 'low-level radar';
  return 'surface radar';
}

function weaponFor(effector: string): string {
  if (effector.includes('GUN')) return 'radar-cued gun';
  if (effector.includes('DEW')) return 'laser DEW';
  if (effector.includes('CUAS')) return 'C-UAS';
  return 'close-in';
}

function inBand(r: number, lo: number, hi: number): boolean {
  return r >= lo && r < hi;
}

function corridorPolygon(): LonLat[] {
  const [a, b] = CIVIL_CORRIDOR as [LonLat, LonLat];
  const az = inverse(a, b).azimuth_deg;
  const w = CIVIL_CORRIDOR_HALF_WIDTH;
  const ring = [destination(a, az - 90, w), destination(b, az - 90, w), destination(b, az + 90, w), destination(a, az + 90, w)];
  ring.push(ring[0]!);
  return ring;
}

function box(center: LonLat, halfW: number, halfH: number): LonLat[] {
  const n = destination(center, 0, halfH);
  const s = destination(center, 180, halfH);
  const ring: LonLat[] = [destination(n, 270, halfW), destination(n, 90, halfW), destination(s, 90, halfW), destination(s, 270, halfW)];
  ring.push(ring[0]!);
  return ring;
}

/** Convex hull (monotone chain) on lon/lat, buffered slightly for display. */
function hull(points: LonLat[]): LonLat[] {
  if (points.length < 3) {
    const c = points[0]!;
    return [...box(c, 2500, 2500)];
  }
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: LonLat, a: LonLat, b: LonLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LonLat[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LonLat[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  const h = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const cx = h.reduce((a, p) => a + p[0], 0) / h.length;
  const cy = h.reduce((a, p) => a + p[1], 0) / h.length;
  const out = h.map((p): LonLat => [cx + (p[0] - cx) * 1.15 + Math.sign(p[0] - cx) * 0.01, cy + (p[1] - cy) * 1.15 + Math.sign(p[1] - cy) * 0.01]);
  out.push(out[0]!);
  return out;
}
