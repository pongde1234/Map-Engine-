/**
 * Class registry: one row per engine class. Drives the SIDC, the compact on-screen
 * abbreviation, the data-age profile and grouping in the layer tree. Every SIDC here is
 * checked with milsymbol isValid() in the symbology tests.
 */
import type { Environment, StandardIdentity, Template } from './entity.ts';
import { MINUTE, SECOND, HOUR } from './time.ts';

export type AgeProfileId = 'air' | 'surface' | 'intel' | 'asset' | 'static';

/** Data-age thresholds: CURRENT below `current`, AGING below `aging`, else STALE. DISC comes from link health. */
export interface AgeProfile {
  current: number;
  aging: number;
}

/** Defaults; the commander-set values arrive as a signed command object and override these. */
export const DEFAULT_AGE_PROFILES: Record<AgeProfileId, AgeProfile> = {
  air: { current: 20 * SECOND, aging: 2 * MINUTE },
  // Sparse AIS outside the raid window reports every ~10 min.
  surface: { current: 5 * MINUTE, aging: 15 * MINUTE },
  intel: { current: 2 * MINUTE, aging: 10 * MINUTE },
  // Own sensors / fire units send a health heartbeat every 5 min.
  asset: { current: 6 * MINUTE, aging: 15 * MINUTE },
  static: { current: 365 * 24 * HOUR, aging: 365 * 24 * HOUR },
};

export type AgeState = 'current' | 'aging' | 'stale' | 'disc';

export function ageState(ageMs: number, profile: AgeProfile, linkDown = false): AgeState {
  if (linkDown) return 'disc';
  if (ageMs < profile.current) return 'current';
  if (ageMs < profile.aging) return 'aging';
  return 'stale';
}

export interface ClassDef {
  id: string;
  /** Short on-map/on-row abbreviation (glyph-first UI). */
  abbr: string;
  label: string;
  template: Template;
  environment: Environment;
  identity: StandardIdentity;
  sidc: string;
  age: AgeProfileId;
  /** Counts as a hostile air threat for ring occupancy and saturation. */
  threat?: boolean;
  /** Fast mover (jet drone, missile): routed to SAM in pairing. */
  fast?: boolean;
}

const C = (d: ClassDef): ClassDef => d;

export const CLASSES: Record<string, ClassDef> = Object.fromEntries(
  [
    // Red air
    C({ id: 'owa_drone', abbr: 'OWA', label: 'One-way-attack drone', template: 'track', environment: 'air', identity: 'hostile', sidc: '10060100001103000100', age: 'air', threat: true }),
    C({ id: 'decoy', abbr: 'DCY', label: 'Decoy drone', template: 'track', environment: 'air', identity: 'hostile', sidc: '10060101001103000000', age: 'air', threat: true }),
    C({ id: 'jet_drone', abbr: 'JET', label: 'Jet-powered drone', template: 'track', environment: 'air', identity: 'hostile', sidc: '10060100001103000000', age: 'air', threat: true, fast: true }),
    C({ id: 'cruise_missile', abbr: 'CM', label: 'Cruise missile', template: 'track', environment: 'air', identity: 'hostile', sidc: '10060200001100000702', age: 'air', threat: true, fast: true }),
    C({ id: 'arm', abbr: 'ARM', label: 'Anti-radiation missile', template: 'track', environment: 'air', identity: 'hostile', sidc: '10060200001100000102', age: 'air', threat: true, fast: true }),
    C({ id: 'probe', abbr: 'PRB', label: 'Probe drone', template: 'track', environment: 'air', identity: 'suspect', sidc: '10050100001103000000', age: 'air', threat: true }),
    C({ id: 'unknown_air', abbr: 'UNK', label: 'Unknown air track', template: 'track', environment: 'air', identity: 'unknown', sidc: '10010100001103000000', age: 'air' }),
    // Blue air
    C({ id: 'interceptor_drone', abbr: 'INT', label: 'Interceptor drone', template: 'asset', environment: 'air', identity: 'friend', sidc: '10030100001103000500', age: 'air' }),
    C({ id: 'fighter', abbr: 'FTR', label: 'Fighter', template: 'asset', environment: 'air', identity: 'friend', sidc: '10030100001101040000', age: 'air' }),
    C({ id: 'aew', abbr: 'AEW', label: 'AEW&C aircraft', template: 'sensor', environment: 'air', identity: 'friend', sidc: '10030100001101160000', age: 'air' }),
    C({ id: 'aerostat', abbr: 'AST', label: 'Aerostat radar', template: 'sensor', environment: 'air', identity: 'friend', sidc: '10030100001107000000', age: 'asset' }),
    // Civil
    C({ id: 'civil_air', abbr: 'CIV', label: 'Civil aircraft', template: 'track', environment: 'air', identity: 'neutral', sidc: '10040100001201000000', age: 'air' }),
    C({ id: 'merchant', abbr: 'MER', label: 'Merchant vessel', template: 'track', environment: 'surface', identity: 'neutral', sidc: '10043000001401000000', age: 'surface' }),
    C({ id: 'tanker', abbr: 'TKR', label: 'Tanker', template: 'track', environment: 'surface', identity: 'neutral', sidc: '10043000001401090000', age: 'surface' }),
    // Blue ground
    C({ id: 'sam_mr', abbr: 'MRS', label: 'Medium-range SAM battery', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031000151301003400', age: 'asset' }),
    C({ id: 'sam_sr', abbr: 'SRS', label: 'Short-range SAM', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031000141301003400', age: 'asset' }),
    C({ id: 'vshorads', abbr: 'VSH', label: 'VSHORADS', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031000141301000000', age: 'asset' }),
    C({ id: 'gun', abbr: 'GUN', label: 'Radar-cued gun', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031500001105000000', age: 'asset' }),
    C({ id: 'laser_dew', abbr: 'DEW', label: 'Laser DEW', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031500002010000000', age: 'asset' }),
    C({ id: 'cuas', abbr: 'CUAS', label: 'C-UAS team', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031000001301000000', age: 'asset' }),
    C({ id: 'interceptor_site', abbr: 'IDS', label: 'Interceptor-drone site', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031000001219000000', age: 'asset' }),
    C({ id: 'ew', abbr: 'EW', label: 'EW / GNSS denial', template: 'effector', environment: 'land', identity: 'friend', sidc: '10031000001505000084', age: 'asset' }),
    C({ id: 'surface_radar', abbr: 'SR', label: 'Surface radar', template: 'sensor', environment: 'land', identity: 'friend', sidc: '10031500002203000300', age: 'asset' }),
    C({ id: 'low_level_radar', abbr: 'LLR', label: 'Low-level radar', template: 'sensor', environment: 'land', identity: 'friend', sidc: '10031500002203000000', age: 'asset' }),
    C({ id: 'coastal_radar', abbr: 'CR', label: 'Coastal radar', template: 'sensor', environment: 'land', identity: 'friend', sidc: '10031500002203000000', age: 'asset' }),
    // Installations
    C({ id: 'refinery', abbr: 'VP', label: 'Refinery complex', template: 'installation', environment: 'land', identity: 'friend', sidc: '10032000001203061000', age: 'static' }),
    C({ id: 'process_unit', abbr: 'PU', label: 'Process unit', template: 'installation', environment: 'land', identity: 'friend', sidc: '10032000001203061000', age: 'static' }),
    // Intel fragments (anticipated hostile objects, dashed frames)
    C({ id: 'launch_prep', abbr: 'LCH', label: 'Launch preparation', template: 'fragment', environment: 'land', identity: 'hostile', sidc: '10061510001113000000', age: 'intel' }),
    C({ id: 'emitter', abbr: 'EMT', label: 'New emitter', template: 'fragment', environment: 'land', identity: 'hostile', sidc: '10061500002203000000', age: 'intel' }),
    C({ id: 'hostile_hq', abbr: 'HQ', label: 'Forward headquarters', template: 'fragment', environment: 'land', identity: 'hostile', sidc: '10061002001100000000', age: 'intel' }),
    C({ id: 'report', abbr: 'RPT', label: 'Report', template: 'fragment', environment: 'land', identity: 'unknown', sidc: '10011000001100000000', age: 'intel' }),
    // All-source assessment: what several fragments add up to (fused layer, no position of its own).
    C({ id: 'intel_assessment', abbr: 'IA', label: 'Intel assessment', template: 'fragment', environment: 'land', identity: 'unknown', sidc: '10011000001100000000', age: 'intel' }),
    C({ id: 'io_claim', abbr: 'IO', label: 'Information-operations claim', template: 'fragment', environment: 'land', identity: 'hostile', sidc: '10061000001100000000', age: 'intel' }),
    C({ id: 'debris_report', abbr: 'DEB', label: 'Debris recovery report', template: 'fragment', environment: 'land', identity: 'unknown', sidc: '10011000001100000000', age: 'intel' }),
  ].map((d) => [d.id, d]),
);

export function classDef(id: string | undefined): ClassDef | undefined {
  return id ? CLASSES[id] : undefined;
}
