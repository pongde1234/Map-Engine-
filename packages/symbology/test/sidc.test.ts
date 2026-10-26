import { describe, expect, it } from 'vitest';
import { CLASSES, STANDARD_IDENTITIES, isSidc20, sidcWithIdentity, sidcWithStatus } from '@me/schema';
import { isValidSidc } from '../src/index.ts';

describe('SIDC table', () => {
  it.each(Object.values(CLASSES).map((c) => [c.id, c.sidc]))('%s uses a valid 20-digit 2525D/E code', (_id, sidc) => {
    expect(isSidc20(sidc)).toBe(true);
    expect(isValidSidc(sidc)).toBe(true);
  });

  it('identity and status rewrites stay valid', () => {
    for (const c of Object.values(CLASSES)) {
      for (const id of STANDARD_IDENTITIES) expect(isValidSidc(sidcWithIdentity(c.sidc, id))).toBe(true);
      expect(isValidSidc(sidcWithStatus(c.sidc, 'planned'))).toBe(true);
    }
  });
});
