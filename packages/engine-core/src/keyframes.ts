/**
 * Keyframes over the ingest axis. A keyframe is the picture after applying records 1..seq.
 * Adaptive policy: one every `everyRecords` records or `everyMs` of ingest time, whichever
 * comes first, so dense raid windows and sparse days both seek fast.
 */
import type { Entity } from '@me/schema';
import { Picture } from './picture.ts';

export interface Keyframe {
  seq: number;
  t: number;
  entities: Map<string, Entity>;
}

export interface KeyframePolicy {
  everyRecords: number;
  everyMs: number;
}

export const DEFAULT_KEYFRAME_POLICY: KeyframePolicy = { everyRecords: 10_000, everyMs: 30 * 60_000 };

export class KeyframeIndex {
  private frames: Keyframe[] = [{ seq: 0, t: 0, entities: new Map() }];

  constructor(readonly policy: KeyframePolicy = DEFAULT_KEYFRAME_POLICY) {}

  get count(): number {
    return this.frames.length;
  }

  last(): Keyframe {
    return this.frames[this.frames.length - 1]!;
  }

  /** Called after applying record `seq` at ingest time `t`; captures a frame when due. */
  maybeCapture(seq: number, t: number, picture: Picture): boolean {
    const last = this.last();
    if (seq - last.seq >= this.policy.everyRecords || (t - last.t >= this.policy.everyMs && seq > last.seq)) {
      this.frames.push({ seq, t, entities: new Map(picture.entities) });
      return true;
    }
    return false;
  }

  /** Latest keyframe with frame.seq <= seq. */
  atOrBefore(seq: number): Keyframe {
    let lo = 0;
    let hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (this.frames[mid]!.seq <= seq) lo = mid;
      else hi = mid - 1;
    }
    return this.frames[lo]!;
  }
}
