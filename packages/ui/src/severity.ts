/**
 * Alert severity, derived from the record itself so every console ranks alerts the same way.
 *   high    a rule fired, a track entered a geofence, an engagement was refused or missed,
 *           damage was assessed, a fragment is confirmed
 *   medium  decisions, other intel fragments, BDA with no damage, corrections
 *   low     routine engagement traffic, rules clearing, tracks leaving a geofence
 * A custom alert fires at the severity its author set.
 */
import type { BdaPayload, EngagementPayload, EntityComponents, JournalRecord, RuleFirePayload } from '@me/schema';

export type Severity = 'high' | 'medium' | 'low';

export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function severityOf(r: JournalRecord): Severity {
  switch (r.kind) {
    case 'rule_fire': {
      const p = r.payload as RuleFirePayload;
      if (p.state === 'cleared') return 'low';
      if (p.rule === 'custom') return p.severity ?? 'high';
      if (p.rule === 'geofence') return / entered |at activation/.test(p.note ?? '') ? 'high' : 'low';
      return 'high';
    }
    case 'engagement': {
      const res = (r.payload as EngagementPayload).result;
      return res === 'refused' || res === 'miss' || res === 'aborted' ? 'high' : 'low';
    }
    case 'bda':
      return (r.payload as BdaPayload).damage === 'none' ? 'medium' : 'high';
    case 'fragment':
      return (r.payload as EntityComponents).fragment?.confidence === 'confirmed' ? 'high' : 'medium';
    case 'decision':
    case 'correction':
      return 'medium';
    default:
      return 'low';
  }
}

/** A firing of an operator's custom alert. */
export function isCustomAlert(r: JournalRecord): boolean {
  return r.kind === 'rule_fire' && (r.payload as RuleFirePayload).rule === 'custom';
}

/** Alert types an operator filters by. */
export const ALERT_TYPES: Array<{ id: string; label: string; kinds: Array<JournalRecord['kind']>; match?: (r: JournalRecord) => boolean }> = [
  { id: 'rules', label: 'Rule firings', kinds: ['rule_fire'], match: (r) => !isCustomAlert(r) },
  { id: 'custom', label: 'Custom alerts', kinds: ['rule_fire'], match: isCustomAlert },
  { id: 'intel', label: 'Intel fragments', kinds: ['fragment'] },
  { id: 'decisions', label: 'Decisions', kinds: ['decision', 'correction'] },
  { id: 'engagements', label: 'Engagements', kinds: ['engagement'] },
  { id: 'bda', label: 'Damage assessment', kinds: ['bda'] },
];
