/**
 * Run accounting (GET /api/accounting): every threat track with what the record says happened to
 * it, and every plant unit's process-state history, as known at a time. Built by the engine's
 * outcome index; read by the debrief and the evidence pack.
 */

/** What happened to a threat track, as recorded. */
export type TrackOutcome = 'destroyed' | 'deflected' | 'leaked' | 'withdrawn' | 'in flight' | 'no outcome recorded';

export interface AccountedTrack {
  id: string;
  cls: string;
  axis?: string;
  wave?: string;
  firstT: number;
  outcome: TrackOutcome;
  /** When the outcome was recorded (or the last state, while in flight). */
  outcomeT: number;
  /** Earlier classes, when the track was reclassified. */
  reclassified: string[];
  releasability?: string[];
}

export interface AccountedPlant {
  id: string;
  unit: string;
  tier: number;
  /** Process states, oldest first: prior states kept beside the revision. */
  history: Array<{ t: number; state: string }>;
  releasability?: string[];
}

export interface Accounting {
  tracks: AccountedTrack[];
  plant: AccountedPlant[];
}
