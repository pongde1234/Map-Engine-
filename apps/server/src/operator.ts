/**
 * Operator objects on the server: validate what the console publishes, stamp it (author,
 * times, label, releasability), append it to the operator chain, persist it, and run the
 * geofence rule for new geofences.
 *
 * Persistence is one JSON line per record next to the journal. On start the file is replayed
 * and every hash recomputed; a file chained to a different journal root (the journal was
 * regenerated) is set aside rather than trusted.
 */
import { appendFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { type Engine, evaluateGeofence, geofenceRuleId } from '@me/engine-core';
import { DEFAULT_LABEL, EntityComponents, type JournalRecord, type OperatorDraft, type Provenance, type RecordDraft, type ScenarioInfo, type SessionIdentity } from '@me/schema';

/** Console-drawn objects carry their own integration; the scenario's planned command layer uses 'operator'. */
export const CONSOLE_INTEGRATION = 'console';
const PROVENANCE: Provenance = { integration: CONSOLE_INTEGRATION, source_feed: 'Operator console', sensor_class: 'human' };
const RULES: Provenance = { integration: 'rules', source_feed: 'Rules engine', sensor_class: 'geofence' };

/** Shapes an operator may author. */
const OPERATOR_TYPES = new Set(['annotation', 'geofence', 'measure', 'axis', 'nfz']);

export class OperatorDesk {
  constructor(
    private readonly engine: Engine,
    private readonly scenario: ScenarioInfo,
    private readonly file: string,
  ) {}

  /** Replay the persisted chain into the engine. */
  load(): { loaded: number; setAside?: string } {
    if (!existsSync(this.file)) return { loaded: 0 };
    const records = readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as JournalRecord);
    const res = this.engine.operator.load(records);
    if (res.ok) return { loaded: res.checked };
    const aside = `${this.file}.orphan-${Date.now()}`;
    renameSync(this.file, aside);
    return { loaded: 0, setAside: aside };
  }

  /** Validate and stamp one draft at time t (the author's picture time), then append. */
  publish(draft: OperatorDraft, who: SessionIdentity, t: number): JournalRecord {
    const parsed = EntityComponents.safeParse(draft.payload);
    if (!parsed.success) throw new Error(`The object is not valid: ${parsed.error.issues[0]?.message ?? 'check its shape'}.`);
    const payload = parsed.data;
    const existing = draft.entity_id ? this.engine.asOf(t).get(draft.entity_id) : undefined;
    if (draft.entity_id && (!existing || existing.provenance.integration !== CONSOLE_INTEGRATION)) throw new Error('Only objects drawn in the console can be changed here.');
    const withdraw = payload.is_live === false;
    if (!withdraw) {
      if (!payload.geo_shape) throw new Error('Draw a shape first.');
      const type = payload.geo_details?.type;
      if (!type || !OPERATOR_TYPES.has(type)) throw new Error(`A ${type ?? 'shape'} cannot be drawn from the console.`);
      payload.geo_details = { ...payload.geo_details!, author: `${who.display} (${who.role.toUpperCase()})`, status: payload.geo_details!.status ?? 'active' };
      payload.ontology = { template: 'geo', class: type, ...(payload.ontology ?? {}) };
    }
    const entityId = draft.entity_id ?? `OP-${String(this.engine.operator.entityCount() + 1).padStart(3, '0')}`;
    const n = this.engine.operator.length + 1;
    const rec: RecordDraft = {
      record_id: `OPR-${String(n).padStart(5, '0')}`,
      kind: 'command',
      layer: 'command',
      entity_id: entityId,
      source_time: Math.round(t),
      ingest_time: Math.round(t),
      provenance: PROVENANCE,
      label: DEFAULT_LABEL,
      releasability: who.releasability,
      author: `${who.display} (${who.role.toUpperCase()})`,
      payload,
    };
    const drafts: RecordDraft[] = [rec];
    // Withdrawing a geofence also clears its rule, so it stops counting as active.
    if (withdraw && existing?.geo_details?.type === 'geofence') {
      drafts.push({
        record_id: `${rec.record_id}-CLR`,
        kind: 'rule_fire',
        layer: 'event',
        source_time: rec.source_time,
        ingest_time: rec.ingest_time,
        provenance: RULES,
        label: DEFAULT_LABEL,
        releasability: who.releasability,
        author: 'Rules engine · geofence',
        payload: { rule_id: geofenceRuleId(entityId), rule: 'geofence', state: 'cleared', value: 0, subject_ids: [], note: `${existing.aliases?.name ?? existing.geo_details.label ?? entityId} withdrawn` },
      });
    }
    const [record] = this.append(drafts);
    if (!withdraw && payload.geo_details?.type === 'geofence') void this.runGeofence(record!);
    return record!;
  }

  private append(drafts: RecordDraft[]): JournalRecord[] {
    const recs = this.engine.appendOperator(drafts);
    appendFileSync(this.file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return recs;
  }

  private async runGeofence(fence: JournalRecord): Promise<void> {
    const t0 = performance.now();
    const run = await evaluateGeofence(this.engine, fence, {
      endT: this.scenario.t1,
      provenance: RULES,
      label: DEFAULT_LABEL,
      ...(fence.releasability ? { releasability: fence.releasability } : {}),
    });
    if (run.drafts.length) this.append(run.drafts);
    console.log(`geofence ${fence.entity_id}: ${run.drafts.length} firings${run.truncated ? ' (capped)' : ''} · ${(performance.now() - t0).toFixed(0)} ms`);
  }
}
