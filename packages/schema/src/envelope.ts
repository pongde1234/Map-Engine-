/**
 * Record envelope: every journal record carries provenance, both times, label, version and
 * hash chain once. "The record is the product": nothing reaches the picture without it.
 */
import { z } from 'zod';
import { EntityComponents, Hypothesis, Layer, StandardIdentity } from './entity.ts';
import { Provenance } from './provenance.ts';



export const RECORD_KINDS = [
  'observation', // a sensor's report of something (observation layer)
  'fused', // fused picture entity (fused layer)
  'reference', // defended assets, plant units, own sensors/effectors laydown (reference layer)
  'command', // authored command objects: rings, WCS, restrictions, rules, annotations
  'fragment', // intelligence fragment
  'decision', // DP record with authority
  'rule_fire', // spatial rule fired or cleared
  'correction', // operator correction: reject / merge / reclassify
  'engagement', // effector vs target
  'bda', // battle-damage assessment
] as const;
export const RecordKind = z.enum(RECORD_KINDS);
export type RecordKind = z.infer<typeof RecordKind>;

/** Kinds whose payload is an entity patch materialised into the picture. */
export const ENTITY_KINDS: ReadonlySet<RecordKind> = new Set([
  'observation',
  'fused',
  'reference',
  'command',
  'fragment',
]);


export const DecisionLayer = z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'RIL']);
export type DecisionLayer = z.infer<typeof DecisionLayer>;

export const DecisionPayload = z.object({
  dp: z.string(), // "DP-0" .. "DP-12"
  title: z.string(),
  layer: DecisionLayer,
  status: z.enum(['option', 'proposed', 'approved', 'rejected', 'delegated', 'executed']),
  /** Named person or appointment holding the authority. */
  authority: z.string().optional(),
  summary: z.string(),
  /** Options shown; DP-2 and DP-11 are displayed and never selected. */
  options: z.array(z.object({ id: z.string(), label: z.string(), selected: z.boolean() })).default([]),
});
export type DecisionPayload = z.infer<typeof DecisionPayload>;

export const RuleFirePayload = z.object({
  rule_id: z.string(),
  rule: z.enum([
    'saturation',
    'civil_in_engagement_area',
    'debris_on_vp',
    'comms_degraded',
    'missile_appears',
    'leaker_forecast',
    'geofence',
    'custom', // an operator's custom alert (see AlertRule)
  ]),
  state: z.enum(['fired', 'cleared']),
  value: z.number().optional(),
  threshold: z.union([z.number(), z.string()]).optional(),
  subject_ids: z.array(z.string()).default([]),
  note: z.string().optional(),
  /** A custom alert's severity, as its author set it. */
  severity: z.enum(['high', 'medium', 'low']).optional(),
});
export type RuleFirePayload = z.infer<typeof RuleFirePayload>;

export const CorrectionPayload = z.object({
  action: z.enum(['reject', 'merge', 'reclassify', 'mark_missed']),
  target_id: z.string(),
  other_id: z.string().optional(),
  new_identity: StandardIdentity.optional(),
  new_hypothesis: Hypothesis.optional(),
  reason: z.string().optional(),
});
export type CorrectionPayload = z.infer<typeof CorrectionPayload>;

export const EngagementPayload = z.object({
  effector_id: z.string(),
  target_id: z.string(),
  weapon: z.string(),
  result: z.enum(['assigned', 'launched', 'kill', 'miss', 'aborted', 'refused']),
  /** Decision that authorised it (DP-5 / DP-7) — part of the thread. */
  authority_record: z.string().optional(),
  note: z.string().optional(),
  intercept: z.tuple([z.number(), z.number()]).optional(),
});
export type EngagementPayload = z.infer<typeof EngagementPayload>;

export const BdaPayload = z.object({
  target_id: z.string(),
  damage: z.enum(['none', 'light', 'moderate', 'severe', 'destroyed']),
  summary: z.string(),
  location: z.tuple([z.number(), z.number()]).optional(),
});
export type BdaPayload = z.infer<typeof BdaPayload>;

/** Body of a record: everything that is hashed, minus the chain fields. */
export interface RecordBody<P = unknown> {
  seq: number;
  record_id: string;
  kind: RecordKind;
  layer: Layer;
  entity_id?: string;
  source_time: number;
  ingest_time: number;
  provenance: Provenance;
  derived_from?: string[];
  thread_id?: string;
  label: string;
  releasability?: string[];
  author?: string;
  signature?: string;
  payload: P;
}

export interface JournalRecord<P = unknown> extends RecordBody<P> {
  prev_hash: string;
  hash: string;
}

export type EntityRecord = JournalRecord<EntityComponents>;
export type DecisionRecord = JournalRecord<DecisionPayload>;
export type RuleFireRecord = JournalRecord<RuleFirePayload>;
export type CorrectionRecord = JournalRecord<CorrectionPayload>;
export type EngagementRecord = JournalRecord<EngagementPayload>;
export type BdaRecord = JournalRecord<BdaPayload>;

/** A record as submitted for append: the journal assigns seq and the chain fields. */
export type RecordDraft<P = unknown> = Omit<RecordBody<P>, 'seq'>;

export function isEntityRecord(r: JournalRecord): r is EntityRecord {
  return ENTITY_KINDS.has(r.kind);
}

/** Validators per payload kind, used at the ingest boundary. */
export const PAYLOAD_VALIDATORS: Record<RecordKind, z.ZodType> = {
  observation: EntityComponents,
  fused: EntityComponents,
  reference: EntityComponents,
  command: EntityComponents,
  fragment: EntityComponents,
  decision: DecisionPayload,
  rule_fire: RuleFirePayload,
  correction: CorrectionPayload,
  engagement: EngagementPayload,
  bda: BdaPayload,
};

export const GENESIS_HASH = '0'.repeat(64);
export const DEFAULT_LABEL = 'SYNTHETIC//DEMO';
