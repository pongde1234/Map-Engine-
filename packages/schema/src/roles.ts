/**
 * Local identities, the decision layer each acts at, and the releasability rule. Shared by the
 * server (which filters what leaves the process) and the console (which shows what each level
 * would see, never more than the session itself holds). The air-gapped room cannot depend on a
 * cloud sign-in, so identities are local.
 */
import type { DecisionLayer } from './envelope.ts';
import type { SessionIdentity } from './protocol.ts';

export const ROLES: Record<string, SessionIdentity> = {
  planning: { user: 'S2', display: 'Planning staff', role: 'planning', releasability: ['JOINT STAFF WEST'] },
  l1: { user: 'L1', display: 'National level', role: 'l1', releasability: ['NATIONAL', 'JOINT STAFF WEST', 'RIL'] },
  l2: { user: 'L2', display: 'Joint HQ West', role: 'l2', releasability: ['JOINT STAFF WEST', 'RIL'] },
  l3: { user: 'CO', display: 'AD Direction Centre', role: 'l3', releasability: ['JOINT STAFF WEST', 'RIL'] },
  ril: { user: 'RI', display: 'RIL control room', role: 'ril', releasability: ['RIL'] },
};

/** The layer each role decides at: L4 includes the RIL control room; planning staff own none. */
export const ROLE_LAYER: Record<string, DecisionLayer | null> = { planning: null, l1: 'L1', l2: 'L2', l3: 'L3', ril: 'L4' };

/** A record or entity marked `rel` is readable by an identity holding any of its caveats; unmarked is open. */
export function releasable(rel: readonly string[] | undefined, releasability: readonly string[]): boolean {
  return !rel || rel.length === 0 || rel.some((r) => releasability.includes(r));
}
