/**
 * Entity → layer-tree key. The layer tree is organised by model (fused / observation /
 * command / reference), as in the concept screens; every entity lands in exactly one key.
 */
import type { Entity } from '@me/schema';
import { CLASSES } from '@me/schema';

export type LayerKey =
  | 'fused.threats'
  | 'fused.blue'
  | 'fused.civil'
  | 'fused.maritime'
  | 'fused.groups'
  | 'observation.plots'
  | 'observation.fragments'
  | 'command.rings'
  | 'command.wcs'
  | 'command.restrictions'
  | 'command.pickets'
  | 'command.softkill'
  | 'command.aimpoints'
  | 'command.axes'
  | 'command.operator'
  | 'command.other'
  | 'reference.vp';

export function categorize(e: Entity): LayerKey {
  const tpl = e.ontology?.template;
  const cls = e.ontology?.class ?? '';
  if (e.layer === 'reference') return 'reference.vp';
  if (e.layer === 'command') {
    // Drawn in the console (annotations, geofences, kept measurements): one toggle for all.
    if (e.provenance?.integration === 'console') return 'command.operator';
    switch (e.geo_details?.type) {
      case 'ring':
        return 'command.rings';
      case 'wcs_sector':
        return 'command.wcs';
      case 'corridor':
      case 'sea_restriction':
      case 'nfz':
        return 'command.restrictions';
      case 'picket_box':
        return 'command.pickets';
      case 'soft_kill_area':
        return 'command.softkill';
      case 'aimpoint':
      case 'debris_footprint':
        return 'command.aimpoints';
      case 'axis':
        return 'command.axes';
      default:
        return 'command.other';
    }
  }
  if (e.layer === 'observation') return tpl === 'fragment' ? 'observation.fragments' : 'observation.plots';
  if (tpl === 'group') return 'fused.groups';
  if (cls === 'civil_air') return 'fused.civil';
  if (cls === 'merchant' || cls === 'tanker') return 'fused.maritime';
  const id = e.mil_view?.identity;
  if (id === 'friend' || id === 'assumed_friend' || tpl === 'sensor' || tpl === 'effector' || tpl === 'asset') return 'fused.blue';
  return 'fused.threats';
}

export function isThreat(e: Entity): boolean {
  return !!CLASSES[e.ontology?.class ?? '']?.threat && (e.mil_view?.identity === 'hostile' || e.mil_view?.identity === 'suspect');
}
