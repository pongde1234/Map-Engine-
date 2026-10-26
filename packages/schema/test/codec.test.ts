import { describe, expect, it } from 'vitest';
import { POS_STRIDE, decode, encode, type ServerMessage } from '../src/index.ts';

describe('codec', () => {
  it('round-trips pos frames with typed arrays exactly (including subarrays)', () => {
    const data = new Float64Array(3 * POS_STRIDE).map((_, i) => 69.123456789 + i * 0.001);
    const msg: ServerMessage = {
      type: 'pos',
      epoch: 3,
      t: 1_780_000_000_123,
      idx: new Uint32Array([5, 9, 400]).subarray(0, 2),
      data: data.subarray(0, 2 * POS_STRIDE),
      st: new Float64Array([1_780_000_000_000, 1_780_000_000_500]),
    };
    const back = decode<typeof msg>(encode(msg));
    expect(back.idx).toBeInstanceOf(Uint32Array);
    expect(Array.from(back.idx)).toEqual([5, 9]);
    expect(back.data).toBeInstanceOf(Float64Array);
    expect(Array.from(back.data)).toEqual(Array.from(data.subarray(0, 2 * POS_STRIDE)));
    expect(back.st[1]).toBe(1_780_000_000_500);
  });
});
