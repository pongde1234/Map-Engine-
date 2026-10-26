import { z } from 'zod';

export const Provenance = z.object({
  /** Publishing integration, e.g. "scenario", "io-connect", "operator". */
  integration: z.string(),
  /** Neutral on-screen feed name, e.g. "Air picture network". Never a real system name. */
  source_feed: z.string(),
  /** Sensor class, e.g. "imaging radar", "ground MTI", "human". */
  sensor_class: z.string().optional(),
  /** Agency responsible for the source (synthetic designations). */
  agency: z.string().optional(),
  /** Hash of the upstream source record, when the record is derived. */
  source_record_hash: z.string().optional(),
});
export type Provenance = z.infer<typeof Provenance>;
