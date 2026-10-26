/**
 * Binary codec (msgpack). Record hashes are always computed over the stored bytes produced
 * here, never over re-encoded objects, so encoding needs to be stable only per write.
 */
import { Packr, Unpackr } from 'msgpackr';

// moreTypes: typed arrays (pos frames) travel as typed arrays; without it msgpackr truncates
// a Float64Array to bytes. Covered by packages/schema/test/codec.test.ts.
const packr = new Packr({ useRecords: false, variableMapSize: true, moreTypes: true });
const unpackr = new Unpackr({ useRecords: false, moreTypes: true });

export function encode(value: unknown): Uint8Array {
  return packr.pack(value);
}

export function decode<T = unknown>(bytes: Uint8Array): T {
  return unpackr.unpack(bytes) as T;
}

const textEncoder = new TextEncoder();
export function utf8(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
