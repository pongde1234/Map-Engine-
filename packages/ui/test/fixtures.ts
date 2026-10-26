/** Record and client builders for the ui model tests (synthetic, no server). */
import type { DecisionPayload, Entity, JournalRecord } from '@me/schema';
import { MapClient } from '@me/client';
import type { Derived } from '../src/derived.ts';

export const VP: [number, number] = [69.86, 22.36];
export const T = 1_000_000;
const JOINT = ['JOINT STAFF WEST'];

let seq = 0;

export function fragment(
  id: string,
  t: number,
  cls: string,
  confidence: 'doubtful' | 'possible' | 'likely' | 'confirmed',
  o: { associated?: boolean; rel?: string[]; kind?: string; at?: [number, number]; thread?: string; sensor?: string } = {},
): JournalRecord {
  const at = o.at ?? [69.2, 24.3];
  return {
    seq: ++seq,
    record_id: `fr${seq}`,
    kind: 'fragment',
    layer: 'observation',
    entity_id: id,
    source_time: t,
    ingest_time: t,
    provenance: { integration: 'test', source_feed: 'Intelligence reporting', sensor_class: o.sensor ?? 'space-based imagery (SAR)' },
    thread_id: o.thread ?? 'TH-IW',
    label: 'SYNTHETIC//DEMO',
    releasability: o.rel ?? JOINT,
    payload: {
      ontology: { template: 'fragment', class: cls },
      fragment: { source_kind: o.kind ?? 'space_isr', summary: `${id} report`, confidence, associated: o.associated ?? true },
      location: { lon: at[0], lat: at[1], hae: 0 },
    },
    prev_hash: '',
    hash: `h${seq}`,
  } as JournalRecord;
}

export function decision(
  id: string,
  dp: string,
  t: number,
  o: { layer?: DecisionPayload['layer']; status?: DecisionPayload['status']; rel?: string[]; derived?: string[]; author?: string; options?: DecisionPayload['options'] } = {},
): JournalRecord {
  return {
    seq: ++seq,
    record_id: id,
    kind: 'decision',
    layer: 'event',
    source_time: t,
    ingest_time: t,
    provenance: { integration: 'test', source_feed: 'Command' },
    label: 'SYNTHETIC//DEMO',
    releasability: o.rel ?? JOINT,
    ...(o.derived ? { derived_from: o.derived } : {}),
    ...(o.author ? { author: o.author } : {}),
    payload: { dp, title: `${dp} title`, layer: o.layer ?? 'L2', status: o.status ?? 'approved', authority: `${o.layer ?? 'L2'} authority`, summary: `${dp} summary`, options: o.options ?? [] },
    prev_hash: '',
    hash: `hd${seq}`,
  } as JournalRecord;
}

export function clientWith(entities: Entity[], events: JournalRecord[]): MapClient {
  const c = new MapClient({ url: 'ws://unused' });
  for (const e of entities) (c as unknown as { upsert(e: Entity): void }).upsert(e);
  c.events = [...events].sort((a, b) => a.ingest_time - b.ingest_time);
  return c;
}

export function derivedWith(p: Partial<Derived> = {}): Derived {
  return { t: T, byKey: {}, sources: [], tracks: 0, hostile: 0, contested: 0, stale: 0, rings: { R4: 0, R3: 0, R2: 0, R1: 0 }, groups: [], effectors: [], activeRules: [], center: VP, ...p } as Derived;
}

export function bdaRecord(id: string, target: string, damage: 'none' | 'light' | 'moderate' | 'severe' | 'destroyed', t: number, derived: string[] = []): JournalRecord {
  return {
    seq: ++seq,
    record_id: id,
    kind: 'bda',
    layer: 'event',
    source_time: t,
    ingest_time: t,
    provenance: { integration: 'test', source_feed: 'Plant', sensor_class: 'BDA fused with plant process data' },
    label: 'SYNTHETIC//DEMO',
    releasability: ['JOINT STAFF WEST', 'RIL'],
    ...(derived.length ? { derived_from: derived } : {}),
    payload: { target_id: target, damage, summary: `${target} ${damage}` },
    prev_hash: '',
    hash: `hb${seq}abcdef`,
  } as JournalRecord;
}

export function engagementRecord(id: string, target: string, result: string, t: number, authority?: string, weapon = 'interceptor drone'): JournalRecord {
  return {
    seq: ++seq,
    record_id: id,
    kind: 'engagement',
    layer: 'event',
    source_time: t,
    ingest_time: t,
    provenance: { integration: 'test', source_feed: 'Fire control' },
    label: 'SYNTHETIC//DEMO',
    ...(authority ? { derived_from: [authority] } : {}),
    payload: { effector_id: 'B-IDN', target_id: target, weapon, result, ...(authority ? { authority_record: authority } : {}) },
    prev_hash: '',
    hash: `he${seq}abcdef`,
  } as JournalRecord;
}
