/**
 * Jamnagar refinery air defence — NOTIONAL laydown and timeline (CONOP per Surendra Ahuja,
 * 2026-10-19; storyboard v0.7). Every force number, placement and time here is synthetic.
 *
 * Open source conflicts are configuration, not code: see CONFLICTS.
 */
import type { LonLat } from '@me/schema';
import { DAY, HOUR, MINUTE } from '@me/schema';

export const SCENARIO_ID = 'jamnagar-raid';
export const SCENARIO_NAME = 'Jamnagar refinery defence (notional)';

/** Defended point: refinery complex centre (notional). */
export const VP: LonLat = [69.86, 22.36];

export const RINGS = [
  { id: 'R4', inner: 60_000, outer: 150_000, label: 'R4 OUTER' },
  { id: 'R3', inner: 20_000, outer: 60_000, label: 'R3 MIDDLE' },
  { id: 'R2', inner: 5_000, outer: 20_000, label: 'R2 KEEP-OUT' },
  { id: 'R1', inner: 0, outer: 5_000, label: 'R1 TERMINAL' },
] as const;

/** Raid day D (midnight UTC) and H (first Wave 2 drone reaches R1). */
export const D0 = Date.UTC(2026, 10, 6); // 2026-11-06
export const H = D0 + 6 * HOUR + 45 * MINUTE;
export const T0 = D0 - 3 * DAY; // D-3 00:00Z
export const T1 = D0 + DAY + 6 * HOUR; // D+1 06:00Z

export const AXES = {
  north: {
    id: 'NORTH',
    label: 'AXIS NORTH · MAIN WAVE OVER LAND',
    launch: [69.15, 24.7] as LonLat,
    via: [] as LonLat[],
  },
  west: {
    id: 'WEST',
    label: 'AXIS WEST · MAIN WAVE OVER SEA',
    launch: [67.6, 24.0] as LonLat,
    via: [[67.85, 22.6], [68.65, 22.0]] as LonLat[],
  },
};

export interface ProcessUnitDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  at: LonLat;
  halfSizeM: number;
}

/** Generic process units only (no unit-level operating sequences). */
export const PROCESS_UNITS: ProcessUnitDef[] = [
  { id: 'PU-CDU', name: 'Crude unit', tier: 1, at: [69.852, 22.364], halfSizeM: 260 },
  { id: 'PU-FCC', name: 'Catalytic cracker', tier: 1, at: [69.867, 22.356], halfSizeM: 240 },
  { id: 'PU-HCU', name: 'Hydrocracker', tier: 1, at: [69.876, 22.367], halfSizeM: 200 },
  { id: 'PU-UTL', name: 'Utilities', tier: 1, at: [69.881, 22.351], halfSizeM: 180 },
  { id: 'PU-TNK', name: 'Tank farm', tier: 2, at: [69.838, 22.349], halfSizeM: 420 },
  { id: 'PU-JTY', name: 'Marine jetty', tier: 2, at: [69.83, 22.44], halfSizeM: 150 },
];

export interface SensorDef {
  id: string;
  cls: 'surface_radar' | 'low_level_radar' | 'coastal_radar' | 'aerostat' | 'aew';
  name: string;
  at: LonLat;
  range: number;
  heightM: number;
}

export const SENSORS: SensorDef[] = [
  { id: 'S-SR1', cls: 'surface_radar', name: 'Surface radar 1', at: [70.25, 22.7], range: 250_000, heightM: 12 },
  { id: 'S-CR1', cls: 'coastal_radar', name: 'Coastal radar 1', at: [69.1, 22.36], range: 120_000, heightM: 40 },
  { id: 'S-LLR1', cls: 'low_level_radar', name: 'Low-level radar 1', at: [69.95, 22.05], range: 60_000, heightM: 15 },
  { id: 'S-LLR2', cls: 'low_level_radar', name: 'Low-level radar 2', at: [69.55, 22.62], range: 60_000, heightM: 15 },
  { id: 'S-AST1', cls: 'aerostat', name: 'Aerostat 1', at: [70.02, 22.48], range: 300_000, heightM: 1500 },
];

export const AEW_ORBIT = { center: [69.0, 23.35] as LonLat, legM: 60_000, axisAz: 315, altM: 9000, speed: 150 };

export interface EffectorDef {
  id: string;
  cls: 'sam_mr' | 'sam_sr' | 'vshorads' | 'gun' | 'laser_dew' | 'cuas' | 'ew' | 'interceptor_site';
  name: string;
  /** Short call sign for dense lists (aliases.callsign). */
  callsign: string;
  at: LonLat;
  /** Peacetime location before DP-1 moves units to war locations. */
  peace?: LonLat;
  channels: number;
  ready: number;
  reserve: number;
  floor: number;
  wez: { min_m: number; max_m: number; max_alt_m?: number };
}

export const EFFECTORS: EffectorDef[] = [
  { id: 'B-MRS1', cls: 'sam_mr', name: 'MR SAM 1', callsign: 'MR SAM 1', at: [70.03, 22.3], peace: [70.62, 22.42], channels: 4, ready: 16, reserve: 8, floor: 8, wez: { min_m: 3000, max_m: 60_000 } },
  { id: 'B-MRS2', cls: 'sam_mr', name: 'MR SAM 2', callsign: 'MR SAM 2', at: [69.7, 22.52], peace: [70.55, 22.2], channels: 4, ready: 16, reserve: 8, floor: 8, wez: { min_m: 3000, max_m: 60_000 } },
  { id: 'B-SRS1', cls: 'sam_sr', name: 'SR SAM 1', callsign: 'SR SAM 1', at: [69.97, 22.42], peace: [70.48, 22.5], channels: 3, ready: 12, reserve: 4, floor: 4, wez: { min_m: 1000, max_m: 25_000 } },
  { id: 'B-SRS2', cls: 'sam_sr', name: 'SR SAM 2', callsign: 'SR SAM 2', at: [69.75, 22.3], peace: [70.45, 22.3], channels: 3, ready: 12, reserve: 4, floor: 4, wez: { min_m: 1000, max_m: 25_000 } },
  { id: 'B-VSH1', cls: 'vshorads', name: 'VSHORADS 1', callsign: 'VSH 1', at: [69.8, 22.4], channels: 2, ready: 12, reserve: 4, floor: 2, wez: { min_m: 300, max_m: 6000 } },
  { id: 'B-VSH2', cls: 'vshorads', name: 'VSHORADS 2', callsign: 'VSH 2', at: [69.92, 22.33], channels: 2, ready: 12, reserve: 4, floor: 2, wez: { min_m: 300, max_m: 6000 } },
  { id: 'B-GUN1', cls: 'gun', name: 'Radar-cued guns 1', callsign: 'Gun 1', at: [69.86, 22.385], channels: 2, ready: 40, reserve: 20, floor: 10, wez: { min_m: 0, max_m: 4000 } },
  { id: 'B-GUN2', cls: 'gun', name: 'Radar-cued guns 2', callsign: 'Gun 2', at: [69.85, 22.335], channels: 2, ready: 40, reserve: 20, floor: 10, wez: { min_m: 0, max_m: 4000 } },
  { id: 'B-DEW1', cls: 'laser_dew', name: 'Laser DEW 1', callsign: 'DEW 1', at: [69.875, 22.345], channels: 1, ready: 60, reserve: 0, floor: 0, wez: { min_m: 0, max_m: 3000 } },
  { id: 'B-CUAS1', cls: 'cuas', name: 'CISF C-UAS', callsign: 'C-UAS', at: [69.845, 22.372], channels: 2, ready: 20, reserve: 0, floor: 0, wez: { min_m: 0, max_m: 3000 } },
  { id: 'B-EW1', cls: 'ew', name: 'EW/GNSS denial N', callsign: 'EW N', at: [69.62, 22.78], channels: 6, ready: 999, reserve: 0, floor: 0, wez: { min_m: 0, max_m: 110_000 } },
  { id: 'B-EW2', cls: 'ew', name: 'EW/GNSS denial W', callsign: 'EW W', at: [69.35, 22.18], channels: 6, ready: 999, reserve: 0, floor: 0, wez: { min_m: 0, max_m: 110_000 } },
  { id: 'B-IDN', cls: 'interceptor_site', name: 'Interceptor picket N', callsign: 'Picket N', at: [69.55, 23.18], channels: 4, ready: 16, reserve: 4, floor: 2, wez: { min_m: 0, max_m: 70_000 } },
  { id: 'B-IDW', cls: 'interceptor_site', name: 'Interceptor picket W', callsign: 'Picket W', at: [68.92, 22.05], channels: 4, ready: 16, reserve: 4, floor: 2, wez: { min_m: 0, max_m: 70_000 } },
  { id: 'B-ID3', cls: 'interceptor_site', name: 'Interceptor flights R3 box', callsign: 'R3 flights', at: [69.6, 22.15], channels: 6, ready: 24, reserve: 6, floor: 4, wez: { min_m: 0, max_m: 50_000 } },
];

export const FIGHTER_BASE: LonLat = [70.4, 22.6];
export const FIGHTER_CAP: LonLat = [69.45, 23.4];

/** Civil air corridor (west–east), notional. */
export const CIVIL_CORRIDOR: LonLat[] = [
  [66.8, 22.95],
  [72.6, 22.55],
];
export const CIVIL_CORRIDOR_HALF_WIDTH = 9000;

/** Tanker hold area after DP-4 (offshore, notional). */
export const TANKER_HOLD: LonLat = [69.05, 22.72];

/** Counts (sum = 150 airborne threats, CONOP §5.2 "about 150"). */
export const COUNTS = {
  probes: 8,
  decoys: 40,
  arms: 2,
  owa: 66,
  jets: 10,
  cruise: 4,
  wave3: 20,
};

/** Source conflicts carried as data and shown on screen, never silently resolved. */
export const CONFLICTS = [
  { id: 'cruise-count', note: 'CONOP §5.2: 2–4 cruise missiles; chapter 2 text: six. Generator uses 4.', owner: 'Surendra Ahuja' },
  { id: 'salvo-time', note: 'Salvo appears at H-15 (story) vs §5.2 H-5. Generator uses H-15.', owner: 'Surendra Ahuja' },
  { id: 'dp8-phase', note: 'Plant advisory at H-12 (story); §7.4 lists DP-8 under phase 4 (H-8 to H+5).', owner: 'Surendra Ahuja' },
  { id: 'n-t', note: 'Delegation trigger thresholds N and T are unspecified in the CONOP.', owner: 'Surendra Ahuja' },
];
