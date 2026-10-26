/**
 * Outcome index: for every track, its class over time and its state transitions on the fused
 * layer (destroyed, deflected, impact, withdrawn) and when it left the picture; for every plant
 * unit, its process-state history. A debrief accounts for each threat from these, as known at
 * any cursor, with prior states kept beside revisions. Fused records are not events, so the
 * console cannot assemble this from its event list.
 */
import { CLASSES, type AccountedPlant, type AccountedTrack, type Accounting, type EntityComponents, type JournalRecord, type TrackOutcome } from '@me/schema';

interface Mark {
  seq: number;
  t: number;
  value: string;
}

interface TrackEntry {
  id: string;
  classes: Mark[];
  states: Mark[];
  axis?: string;
  wave?: string;
  releasability?: string[];
  first: { seq: number; t: number };
  ended?: { seq: number; t: number };
}

interface PlantEntry {
  id: string;
  unit: string;
  tier: number;
  releasability?: string[];
  states: Mark[];
}

const at = <T extends { seq: number }>(a: T[], upto: number): T | undefined => {
  let found: T | undefined;
  for (const m of a) {
    if (m.seq > upto) break;
    found = m;
  }
  return found;
};

export class OutcomeIndex {
  private tracks = new Map<string, TrackEntry>();
  private plant = new Map<string, PlantEntry>();

  add(r: JournalRecord): void {
    if (!r.entity_id) return;
    const p = r.payload as EntityComponents;
    let tr = r.layer === 'fused' ? this.tracks.get(r.entity_id) : undefined;
    if (r.layer === 'fused' && !tr && p.ontology?.template === 'track') {
      tr = { id: r.entity_id, classes: [], states: [], first: { seq: r.seq, t: r.ingest_time }, ...(r.releasability ? { releasability: r.releasability } : {}) };
      this.tracks.set(r.entity_id, tr);
    }
    if (tr) {
      const cls = p.ontology?.class;
      if (cls && cls !== tr.classes.at(-1)?.value) tr.classes.push({ seq: r.seq, t: r.ingest_time, value: cls });
      if (p.track?.axis) tr.axis = p.track.axis;
      if (p.track?.wave) tr.wave = p.track.wave;
      const st = p.track?.state;
      if (st && st !== tr.states.at(-1)?.value) tr.states.push({ seq: r.seq, t: r.ingest_time, value: st });
      if (p.is_live === false && !tr.ended) tr.ended = { seq: r.seq, t: r.ingest_time };
    }
    if (p.plant) {
      let pl = this.plant.get(r.entity_id);
      if (!pl) {
        pl = { id: r.entity_id, unit: p.plant.unit, tier: p.plant.tier, states: [], ...(r.releasability ? { releasability: r.releasability } : {}) };
        this.plant.set(r.entity_id, pl);
      }
      if (p.plant.state !== pl.states.at(-1)?.value) pl.states.push({ seq: r.seq, t: r.ingest_time, value: p.plant.state });
    }
  }

  /** Every threat track and plant unit known at `uptoSeq`, with what the record says happened. */
  accounting(uptoSeq: number): Accounting {
    const tracks: AccountedTrack[] = [];
    for (const tr of this.tracks.values()) {
      if (tr.first.seq > uptoSeq) continue;
      const cls = at(tr.classes, uptoSeq)?.value;
      if (!cls || !CLASSES[cls]?.threat) continue;
      const st = at(tr.states, uptoSeq);
      const ended = tr.ended && tr.ended.seq <= uptoSeq;
      const outcome: TrackOutcome =
        st?.value === 'destroyed'
          ? 'destroyed'
          : st?.value === 'impact' || st?.value === 'leaked'
            ? 'leaked'
            : st?.value === 'deflected'
              ? 'deflected'
              : st?.value === 'withdrawn'
                ? 'withdrawn'
                : ended
                  ? 'no outcome recorded'
                  : 'in flight';
      const earlier = tr.classes.filter((m) => m.seq <= uptoSeq).map((m) => m.value);
      tracks.push({
        id: tr.id,
        cls,
        ...(tr.axis ? { axis: tr.axis } : {}),
        ...(tr.wave ? { wave: tr.wave } : {}),
        firstT: tr.first.t,
        outcome,
        outcomeT: st?.t ?? tr.first.t,
        reclassified: earlier.slice(0, -1),
        ...(tr.releasability ? { releasability: tr.releasability } : {}),
      });
    }
    const plant: AccountedPlant[] = [];
    for (const pl of this.plant.values()) {
      const history = pl.states.filter((m) => m.seq <= uptoSeq).map((m) => ({ t: m.t, state: m.value }));
      if (!history.length) continue;
      plant.push({ id: pl.id, unit: pl.unit, tier: pl.tier, history, ...(pl.releasability ? { releasability: pl.releasability } : {}) });
    }
    return { tracks: tracks.sort((a, b) => a.firstT - b.firstT), plant: plant.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id)) };
  }
}
