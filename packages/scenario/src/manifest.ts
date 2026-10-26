import type { ScenarioInfo } from '@me/schema';

/** Scenario manifest: the single source of on-screen numbers and clock marks. */
export interface ScenarioManifest extends ScenarioInfo {
  conflicts: Array<{ id: string; note: string; owner: string }>;
  threads: Record<string, string>;
  notes: string[];
  /** Filled by the bundle writer. */
  journal?: { records: number; rootHash: string; file: string };
}
