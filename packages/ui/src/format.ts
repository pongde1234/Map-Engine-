import type { BdaPayload, CorrectionPayload, DecisionPayload, EngagementPayload, EntityComponents, JournalRecord, RaidClock, RuleFirePayload } from '@me/schema';
import { formatRaidClock, formatZulu } from '@me/schema';

export function raidLabel(t: number, clock: RaidClock | undefined): string {
  return clock ? formatRaidClock(t, clock) : formatZulu(t);
}

/** Raid-clock time; days out (a bare "D-3") also carry the Zulu time. */
export function stamp(ms: number, clock: RaidClock | undefined): string {
  const l = raidLabel(ms, clock);
  return l.startsWith('D') ? `${l} ${formatZulu(ms).slice(0, 5)}Z` : l;
}

/** A plant unit's process state, in words. */
export const PLANT_WORD: Record<string, string> = { running: 'running', depressurised: 'depressurised', feed_isolated: 'feed isolated', shutdown: 'shut down', restart_assessment: 'restart assessment' };

const RULE_WORDS: Record<RuleFirePayload['rule'], string> = {
  saturation: 'Saturation',
  civil_in_engagement_area: 'Civil in engagement area',
  debris_on_vp: 'Debris over Tier-1 VP',
  comms_degraded: 'Comms degraded',
  missile_appears: 'Missile appears',
  leaker_forecast: 'Leaker forecast',
  geofence: 'Geofence',
  custom: 'Custom alert',
};

/** A fired rule as a word or two and its figure, for a Badge: "Saturation 24/14". */
export function ruleBadge(p: RuleFirePayload, fenceName?: string): string {
  if (p.rule === 'geofence') return `${fenceName ?? p.note ?? 'Geofence'} ${p.value ?? 0}`;
  if (p.rule === 'custom') return p.note ?? RULE_WORDS.custom;
  const v = p.value !== undefined ? ` ${p.value}${p.threshold !== undefined ? `/${p.threshold}` : ''}` : '';
  return `${RULE_WORDS[p.rule]}${v}`;
}

/** One-line summary of a discrete record for feeds and lanes. */
export function eventSummary(r: JournalRecord): { title: string; detail: string; subject?: string } {
  switch (r.kind) {
    case 'fragment': {
      const p = r.payload as EntityComponents;
      return { title: p.aliases?.name ?? 'Fragment', detail: p.fragment?.summary ?? '', subject: r.entity_id };
    }
    case 'decision': {
      const p = r.payload as DecisionPayload;
      return { title: `${p.dp} ${p.title}`, detail: `${p.layer} · ${p.status} · ${p.authority ?? ''}` };
    }
    case 'rule_fire': {
      const p = r.payload as RuleFirePayload;
      if (p.rule === 'geofence') {
        return { title: p.note ?? 'Geofence', detail: p.state === 'cleared' ? 'Geofence clear' : `${p.value ?? 0} inside`, ...(p.subject_ids[0] ? { subject: p.subject_ids[0] } : {}) };
      }
      if (p.rule === 'custom') {
        // In the operator's own words, as set in the Alerts panel.
        return { title: p.note ?? 'Custom alert', detail: p.state === 'cleared' ? 'Custom alert clear' : 'Custom alert', ...(p.subject_ids[0] ? { subject: p.subject_ids[0] } : {}) };
      }
      const v = p.value !== undefined ? ` ${p.value}${p.threshold !== undefined ? `/${p.threshold}` : ''}` : '';
      return { title: `${RULE_WORDS[p.rule]} ${p.state}${v}`, detail: p.note ?? '', ...(p.subject_ids[0] ? { subject: p.subject_ids[0] } : {}) };
    }
    case 'engagement': {
      const p = r.payload as EngagementPayload;
      return { title: `${p.result.toUpperCase()} ${p.target_id}`, detail: `${p.effector_id} · ${p.weapon}${p.note ? ` · ${p.note}` : ''}`, subject: p.target_id };
    }
    case 'bda': {
      const p = r.payload as BdaPayload;
      return { title: `BDA ${p.target_id} · ${p.damage}`, detail: p.summary, subject: p.target_id };
    }
    case 'correction': {
      const p = r.payload as CorrectionPayload;
      return { title: `Correction · ${p.action}`, detail: p.reason ?? '', subject: p.target_id };
    }
    default:
      return { title: r.kind, detail: r.provenance.source_feed, ...(r.entity_id ? { subject: r.entity_id } : {}) };
  }
}

export function shortHash(h: string | undefined): string {
  return h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '—';
}
