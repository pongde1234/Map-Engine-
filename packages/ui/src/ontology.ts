/**
 * Ontology Explorer (storyboard A2), in the documents' words. The Theater State Model's five
 * layers (reference, observation, fused, command, event); one envelope per record (provenance,
 * time, label, version, signature); nodes coloured by permission for the identity viewed as;
 * artifacts beside; everything at the replay position. The lineage graph links A1's source
 * record to the phase-0 preparation records (fire units and magazines, sensors, VA/VP, process
 * units, control measures, DP-0 and its delegation triggers) only through what the records
 * carry: thread, derived from, protects, member of. The rehearsal inset reads the separately
 * labelled rehearsal track by its thread. Words on screen: permission, never releasability.
 */
import { CLASSES, ROLES, releasable, type Entity, type EntityComponents, type JournalRecord, type LonLat } from '@me/schema';
import { distance } from '@me/geo';
import type { MapClient } from '@me/client';

export type OntologyLayer = 'reference' | 'observation' | 'fused' | 'command' | 'event';
export const ONTOLOGY_LAYERS: OntologyLayer[] = ['reference', 'observation', 'fused', 'command', 'event'];
export const LAYER_WORD: Record<OntologyLayer, string> = { reference: 'Reference', observation: 'Observation', fused: 'Fused', command: 'Command', event: 'Event' };

/** Control measures on the command layer (the deck's "Layers, control measures, annotation"). */
const CONTROL_MEASURES = new Set(['ring', 'axis', 'picket_box', 'corridor', 'wcs_sector', 'restriction', 'engagement_zone', 'kill_box']);
const EVENT_WORD: Record<string, string> = { decision: 'DP records', engagement: 'Engagements', bda: 'BDA', rule_fire: 'Rules engine', correction: 'Corrections' };

export interface LayerGroup {
  id: string;
  label: string;
  count: number;
}

export interface LayerRow {
  layer: OntologyLayer;
  label: string;
  count: number;
  groups: LayerGroup[];
}

/** The group an object belongs to on its layer, in the documents' words. */
export function groupOf(e: Entity): LayerGroup & { layer: OntologyLayer } {
  const t = e.ontology?.template;
  const cls = e.ontology?.class ?? '';
  const layer = e.layer as OntologyLayer;
  if (e.plant) return { layer, id: 'process-units', label: 'Process units', count: 0 };
  if (e.geo_details?.type === 'vp') return { layer, id: 'va-vp', label: 'VA/VP', count: 0 };
  if (t === 'fragment') return { layer, id: 'fragments', label: 'Fragments', count: 0 };
  if (t === 'sensor') return { layer, id: 'sensors', label: 'Sensors', count: 0 };
  if (t === 'effector') return { layer, id: 'fire-units', label: 'Fire units', count: 0 };
  if (cls === 'fighter') return { layer, id: 'fighters', label: 'Fighters', count: 0 };
  if (t === 'group') return { layer, id: 'groups', label: 'Groups', count: 0 };
  if (cls === 'rule_set') return { layer, id: 'triggers', label: 'Delegation triggers', count: 0 };
  if (e.geo_details?.type === 'aimpoint') return { layer, id: 'aimpoints', label: 'Predicted aimpoints', count: 0 };
  if (CONTROL_MEASURES.has(cls) || CONTROL_MEASURES.has(e.geo_details?.type ?? '')) return { layer, id: 'control-measures', label: 'Control measures', count: 0 };
  if (t === 'geo') return { layer, id: 'annotation', label: 'Annotation', count: 0 };
  if (layer === 'observation') return { layer, id: 'reports', label: 'Radar reports', count: 0 };
  return { layer, id: 'tracks', label: 'Tracks', count: 0 };
}

/** The Theater State Model at the position: each layer's objects (or records, for events) by group. */
export function theaterState(client: MapClient): LayerRow[] {
  const rows = new Map<OntologyLayer, Map<string, LayerGroup>>(ONTOLOGY_LAYERS.map((l) => [l, new Map()]));
  const add = (layer: OntologyLayer, id: string, label: string) => {
    const m = rows.get(layer);
    if (!m) return;
    const g = m.get(id) ?? { id, label, count: 0 };
    g.count += 1;
    m.set(id, g);
  };
  for (const e of client.entities.values()) {
    const g = groupOf(e);
    add(g.layer, g.id, g.label);
  }
  for (const r of client.events) if (r.layer === 'event') add('event', r.kind, EVENT_WORD[r.kind] ?? r.kind);
  return ONTOLOGY_LAYERS.map((layer) => {
    const groups = [...rows.get(layer)!.values()].sort((a, b) => b.count - a.count);
    return { layer, label: LAYER_WORD[layer], count: groups.reduce((n, g) => n + g.count, 0), groups };
  });
}

export type Permission = 'all' | 'some' | 'none';
export type EdgeType = 'thread' | 'derived from' | 'protects' | 'member of';

export interface GraphNode {
  id: string;
  layer: OntologyLayer;
  label: string;
  detail: string;
  /** A record, one object, or a group of objects shown as one node. */
  kind: 'record' | 'object' | 'group';
  members: string[];
  focus: boolean;
  permitted: Permission;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface OntologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Whether `rel` is permitted to an identity holding `seat`; a group is permitted to all, some or none. */
function permission(rels: Array<readonly string[] | undefined>, seat: readonly string[]): Permission {
  const ok = rels.filter((r) => releasable(r, seat)).length;
  return ok === rels.length ? 'all' : ok ? 'some' : 'none';
}

const recordTitle = (r: JournalRecord): string => {
  if (r.kind === 'decision') {
    const p = r.payload as { dp: string; title: string };
    return `${p.dp} ${p.title}`;
  }
  const p = r.payload as EntityComponents;
  return p.aliases?.name ?? p.geo_details?.label ?? r.entity_id ?? r.record_id;
};

/**
 * The lineage graph around `focusId` at the position: the focus, the records its lineage reaches
 * (same thread, derived from), and the phase-0 preparation records, linked only by what the
 * records carry. `lineage` is the focus's trace; `prepared` the records derived from the
 * preparation decisions in it (DP-0's delegation triggers and magazine floors). `seat` is the
 * permission of the identity viewed as.
 */
export function ontologyGraph(client: MapClient, focusId: string | null, lineage: JournalRecord[], prepared: JournalRecord[], seat: readonly string[]): OntologyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edge = (from: string, to: string, type: EdgeType) => {
    if (from !== to && nodes.has(from) && nodes.has(to) && !edges.some((e) => e.from === from && e.to === to && e.type === type)) edges.push({ from, to, type });
  };
  const objectNode = (e: Entity, focus = false): GraphNode => ({
    id: e.entity_id,
    layer: e.layer as OntologyLayer,
    label: e.aliases?.name ?? e.geo_details?.label ?? e.entity_id,
    detail: groupOf(e).label,
    kind: 'object',
    members: [e.entity_id],
    focus,
    permitted: permission([e.releasability], seat),
  });

  // The phase-0 preparation records, grouped as the speaker names them.
  const groupNode = (id: string, label: string, layer: OntologyLayer, members: Entity[], detail: string) => {
    if (members.length) nodes.set(id, { id, layer, label, detail, kind: 'group', members: members.map((m) => m.entity_id), focus: false, permitted: permission(members.map((m) => m.releasability), seat) });
  };
  const entities = [...client.entities.values()];
  const fireUnits = entities.filter((e) => e.ontology?.template === 'effector');
  groupNode('grp:fire-units', 'Fire units', 'fused', fireUnits, `${fireUnits.length} · magazines, readiness`);
  const sensors = entities.filter((e) => e.ontology?.template === 'sensor');
  groupNode('grp:sensors', 'Sensors', 'fused', sensors, `${sensors.length} · ${sensors.filter((s) => s.sensor?.status === 'up').length} up`);
  const units = entities.filter((e) => e.plant);
  groupNode('grp:process-units', 'Process units', 'reference', units, `${units.length} · generic units`);
  const measures = entities.filter((e) => groupOf(e).id === 'control-measures');
  groupNode('grp:control-measures', 'Control measures', 'command', measures, `${measures.length} · rings, axes, pickets, corridor`);
  for (const vp of entities.filter((e) => e.geo_details?.type === 'vp' && !e.plant)) nodes.set(vp.entity_id, { ...objectNode(vp), label: 'VA/VP', detail: vp.geo_details?.label ?? vp.entity_id });
  const triggers = entities.find((e) => e.ontology?.class === 'rule_set');
  if (triggers) nodes.set(triggers.entity_id, { ...objectNode(triggers), label: 'Delegation triggers', detail: triggers.geo_details?.label ?? triggers.entity_id });

  // The focus and the records its lineage reaches.
  const focus = focusId ? client.entities.get(focusId) : undefined;
  if (focus) nodes.set(focus.entity_id, objectNode(focus, true));
  const own = lineage.filter((r) => r.entity_id === focusId);
  const ownIds = new Set(own.map((r) => r.record_id));
  const threads = new Set(own.map((r) => r.thread_id).filter(Boolean));
  const byRecord = new Map<string, string>();
  for (const r of lineage) {
    if (r.entity_id === focusId) continue;
    const id = r.entity_id && client.entities.has(r.entity_id) ? r.entity_id : r.record_id;
    byRecord.set(r.record_id, id);
    if (!nodes.has(id)) {
      const e = r.entity_id ? client.entities.get(r.entity_id) : undefined;
      nodes.set(id, e ? objectNode(e) : { id, layer: r.layer as OntologyLayer, label: recordTitle(r), detail: r.kind === 'decision' ? 'DP record' : r.kind, kind: 'record', members: [], focus: false, permitted: permission([r.releasability], seat) });
    }
    if (focus && r.thread_id && threads.has(r.thread_id)) edge(focus.entity_id, id, 'thread');
    if (focus && own.some((o) => o.derived_from?.includes(r.record_id))) edge(id, focus.entity_id, 'derived from');
    if (focus && r.derived_from?.some((p) => ownIds.has(p))) edge(focus.entity_id, id, 'derived from');
  }
  // Within the lineage: record → record.
  for (const r of lineage) for (const p of r.derived_from ?? []) if (byRecord.has(p) && byRecord.has(r.record_id)) edge(byRecord.get(p)!, byRecord.get(r.record_id)!, 'derived from');

  // Preparation records derived from a decision in the graph: the triggers and the magazine floors.
  for (const r of prepared) {
    const parent = (r.derived_from ?? []).map((p) => byRecord.get(p) ?? (nodes.has(p) ? p : undefined)).find(Boolean);
    if (!parent || !r.entity_id) continue;
    const target = nodes.has(r.entity_id) ? r.entity_id : fireUnits.some((e) => e.entity_id === r.entity_id) ? 'grp:fire-units' : undefined;
    if (target) edge(parent, target, 'derived from');
  }
  // Relationships the records carry.
  for (const e of entities) {
    for (const rel of e.relationships ?? []) {
      const from = nodes.has(e.entity_id) ? e.entity_id : e.plant ? 'grp:process-units' : e.ontology?.template === 'effector' ? 'grp:fire-units' : undefined;
      if (!from || !nodes.has(rel.target)) continue;
      if (rel.type === 'protects') edge(from, rel.target, 'protects');
      else if (rel.type === 'member_of') edge(from, rel.target, 'member of');
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Identities permitted to read something marked `rel` (the five identities of this build). */
export function permittedTo(rel: readonly string[] | undefined): string[] {
  return Object.values(ROLES)
    .filter((r) => releasable(rel, r.releasability))
    .map((r) => r.display);
}

export interface RecordEnvelope {
  feed: string;
  agency?: string;
  sensor?: string;
  integration: string;
  source: number;
  receipt: number;
  label: string;
  /** Records accepted for the object; a single record has none. */
  version: number | null;
  hash: string;
  signature: string | null;
  permitted: string[];
}

/** One envelope for every node kind: an object (its newest record) or a single record. */
export function envelopeOf(x: Entity | JournalRecord): RecordEnvelope {
  const isRecord = 'record_id' in x;
  return {
    feed: x.provenance.source_feed,
    ...(x.provenance.agency ? { agency: x.provenance.agency } : {}),
    ...(x.provenance.sensor_class ? { sensor: x.provenance.sensor_class } : {}),
    integration: x.provenance.integration,
    source: x.source_time,
    receipt: x.ingest_time,
    label: x.label,
    version: isRecord ? null : x.version,
    hash: isRecord ? x.hash : x.last_hash,
    signature: isRecord ? (x.signature ?? null) : null,
    permitted: permittedTo(x.releasability),
  };
}

export interface RehearsalReport {
  id: string;
  entityId: string;
  sensor: string;
  feed: string;
  at: number;
  report: string;
  identity: string;
  position: LonLat | null;
  heightM: number | null;
  hash: string;
}

export interface Rehearsal {
  reports: RehearsalReport[];
  assessment: { id: string; at: number; hypotheses: Array<{ label: string; p: number }>; contested: boolean; margin: number; derivedFrom: string[]; hash: string } | null;
  /** How far apart the reports put the track, and at what heights. */
  apartM: number | null;
  label: string | null;
}

/** The rehearsal track from its thread's records: the radar reports and the assessment from them. */
export function rehearsalOf(records: JournalRecord[]): Rehearsal {
  const reports: RehearsalReport[] = records
    .filter((r) => r.kind === 'observation')
    .map((r) => {
      const p = r.payload as EntityComponents;
      const cls = p.ontology?.class ?? '';
      return {
        id: r.record_id,
        entityId: r.entity_id ?? r.record_id,
        sensor: r.provenance.sensor_class ?? r.provenance.source_feed,
        feed: r.provenance.agency ?? r.provenance.source_feed,
        at: r.source_time,
        report: CLASSES[cls]?.label ?? cls,
        identity: p.mil_view?.identity ?? 'unknown',
        position: p.location ? ([p.location.lon, p.location.lat] as LonLat) : null,
        heightM: p.location?.hae ?? null,
        hash: r.hash,
      };
    })
    .sort((a, b) => a.at - b.at);
  const a = records.find((r) => r.kind === 'fused');
  const c = a ? (a.payload as EntityComponents).classification : undefined;
  const [p0, p1] = reports;
  return {
    reports,
    assessment: a
      ? {
          id: a.record_id,
          at: a.source_time,
          hypotheses: (c?.hypotheses ?? []).map((h) => ({ label: h.label, p: h.p })),
          contested: !!c?.contested,
          margin: c?.margin ?? 0,
          derivedFrom: a.derived_from ?? [],
          hash: a.hash,
        }
      : null,
    apartM: p0?.position && p1?.position ? Math.round(distance(p0.position, p1.position)) : null,
    label: a?.label ?? records[0]?.label ?? null,
  };
}
