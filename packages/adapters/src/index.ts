/**
 * Adapter contracts (frozen in Phase 0). The Faclon platform APIs are not available yet; each
 * interface has a stub that serves the scenario bundle so the engine and app run end to end.
 * When the real APIs arrive, only the implementations change — never these shapes.
 *
 * Direction: inbound adapters produce RecordDrafts (the journal assigns seq, hash and
 * ingest_time); outbound links only reference record/entity ids, never copy data out.
 */
import type { Entity, JournalRecord, RecordDraft } from '@me/schema';

// ------------------------------------------------------------------ inbound

export type AdapterState = 'connected' | 'degraded' | 'disconnected' | 'stub';

export interface AdapterStatus {
  id: string;
  /** Neutral on-screen name (never a real system name). */
  name: string;
  state: AdapterState;
  lastRecordAt?: number;
  recordsPerMinute?: number;
  note?: string;
}

/** I/O Connect: external feeds → record drafts (A1 "adapter status" in the storyboard). */
export interface IngestAdapter {
  status(): AdapterStatus;
  /** Push drafts to the engine as they arrive. Returns an unsubscribe. */
  subscribe(onDrafts: (drafts: RecordDraft[]) => void): () => void;
}

/** UNS: node-type ↔ entity template/class mapping and the ontology tree. */
export interface OntologyAdapter {
  status(): AdapterStatus;
  /** Map a UNS node path to an engine class key (CLASSES), or undefined if unmapped. */
  classFor(nodePath: string): string | undefined;
  tree(): Promise<OntologyNode[]>;
}

export interface OntologyNode {
  path: string;
  label: string;
  children?: OntologyNode[];
  entityId?: string;
}

/** I/O Sense: time series (readiness, magazines, sensor health) for an entity. */
export interface TimeSeriesAdapter {
  status(): AdapterStatus;
  series(entityId: string, metric: string, from: number, to: number): Promise<Array<{ t: number; v: number }>>;
}

/** Insights: reports, decision records, SITREPs. */
export interface RecordsAdapter {
  status(): AdapterStatus;
  search(query: string, at: number): Promise<JournalRecord[]>;
}

/** DeepSense: model outputs as hypotheses/forecasts (always labelled with model + version). */
export interface ModelAdapter {
  status(): AdapterStatus;
  classify(entity: Entity): Promise<{ model: string; version: string; hypotheses: Array<{ class: string; p: number }> } | null>;
  forecast(kind: 'readiness' | 'leakers' | 'equipment_fault', subjectId: string, at: number): Promise<{ model: string; version: string; value: number; interval?: [number, number] } | null>;
}

/** Bruce: hand the assistant the context; citations must resolve to record ids. */
export interface AssistantAdapter {
  status(): AdapterStatus;
  ask(question: string, context: { selected?: string; t: number; recordIds: string[] }): Promise<{ answer: string; citations: string[]; model: string }>;
}

// ------------------------------------------------------------------ outbound links

export interface OutboundLinks {
  /** Target Board "Compare on map" and back. */
  targetBoard(entityId: string): string;
  /** Intelligence Engine / simulation run reference. */
  evaluationRun(runId: string): string;
  /** Deep link into the map at time t with a selection and bookmark. */
  map(opts: { t: number; select?: string; bookmark?: string; layers?: string[] }): string;
}

export const links: OutboundLinks = {
  targetBoard: (id) => `#/targets?sel=${encodeURIComponent(id)}`,
  evaluationRun: (id) => `#/evaluation?run=${encodeURIComponent(id)}`,
  map: ({ t, select, bookmark, layers }) => {
    const q = new URLSearchParams({ t: String(Math.round(t)) });
    if (select) q.set('sel', select);
    if (bookmark) q.set('bm', bookmark);
    if (layers?.length) q.set('layers', layers.join(','));
    return `#/battlespace?${q}`;
  },
};

// ------------------------------------------------------------------ stubs

const stubStatus = (id: string, name: string): AdapterStatus => ({ id, name, state: 'stub', note: 'Serving the recorded scenario bundle; live API pending' });

export function createStubAdapters() {
  return {
    ingest: {
      status: () => stubStatus('io-connect', 'Feed ingest'),
      subscribe: () => () => {},
    } satisfies IngestAdapter,
    ontology: {
      status: () => stubStatus('uns', 'Ontology'),
      classFor: () => undefined,
      tree: async () => [],
    } satisfies OntologyAdapter,
    timeseries: {
      status: () => stubStatus('io-sense', 'Force state series'),
      series: async () => [],
    } satisfies TimeSeriesAdapter,
    records: {
      status: () => stubStatus('insights', 'Records'),
      search: async () => [],
    } satisfies RecordsAdapter,
    models: {
      status: () => stubStatus('deepsense', 'Models'),
      classify: async () => null,
      forecast: async () => null,
    } satisfies ModelAdapter,
    assistant: {
      status: () => stubStatus('bruce', 'Assistant'),
      ask: async () => ({ answer: 'Assistant not connected in this build.', citations: [], model: 'stub' }),
    } satisfies AssistantAdapter,
  };
}
