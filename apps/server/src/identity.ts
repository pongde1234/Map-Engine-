/**
 * Local identities and releasability. The air-gapped room cannot depend on a cloud sign-in,
 * so identities are local (file-backed later, argon2 hashes). Filtering happens here, on the
 * server: what an identity may not read never leaves the process. The role table and the rule
 * live in @me/schema so the console can show what each level sees.
 */
import { ROLES, releasable, type Entity, type JournalRecord, type SessionIdentity } from '@me/schema';

export { ROLES };

export function identityFor(role: string | undefined): SessionIdentity {
  return ROLES[role ?? ''] ?? ROLES.l3!;
}

export function canSeeEntity(e: Entity, id: SessionIdentity): boolean {
  return releasable(e.releasability, id.releasability);
}

export function canSeeRecord(r: JournalRecord, id: SessionIdentity): boolean {
  return releasable(r.releasability, id.releasability);
}
