/**
 * MIL-STD-2525D/E 20-digit SIDC helpers.
 * Layout: VV C I SS S H AA EEEEEE M1 M2
 *   1-2 version · 3 context · 4 standard identity · 5-6 symbol set · 7 status · 8 HQ/TF/dummy
 *   9-10 echelon/mobility · 11-16 entity/type/subtype · 17-18 sector-1 mod · 19-20 sector-2 mod
 */
import type { StandardIdentity } from './entity.ts';

const IDENTITY_DIGIT: Record<StandardIdentity, string> = {
  pending: '0',
  unknown: '1',
  assumed_friend: '2',
  friend: '3',
  neutral: '4',
  suspect: '5',
  hostile: '6',
};

const DIGIT_IDENTITY: Record<string, StandardIdentity> = Object.fromEntries(
  Object.entries(IDENTITY_DIGIT).map(([k, v]) => [v, k as StandardIdentity]),
);

const CONTEXT_DIGIT = { reality: '0', exercise: '1', simulation: '2' } as const;

function setAt(sidc: string, index0: number, value: string): string {
  if (sidc.length !== 20) throw new Error(`SIDC must be 20 digits: ${sidc}`);
  return sidc.slice(0, index0) + value + sidc.slice(index0 + value.length);
}

export function sidcWithIdentity(sidc: string, identity: StandardIdentity): string {
  return setAt(sidc, 3, IDENTITY_DIGIT[identity]);
}

export function sidcIdentity(sidc: string): StandardIdentity {
  return DIGIT_IDENTITY[sidc[3] ?? '1'] ?? 'unknown';
}

/** Status digit: present (solid frame) or planned/anticipated (dashed frame). */
export function sidcWithStatus(sidc: string, status: 'present' | 'planned'): string {
  return setAt(sidc, 6, status === 'planned' ? '1' : '0');
}

export function sidcWithContext(sidc: string, context: keyof typeof CONTEXT_DIGIT): string {
  return setAt(sidc, 2, CONTEXT_DIGIT[context]);
}

export function isSidc20(s: string): boolean {
  return /^\d{20}$/.test(s);
}
