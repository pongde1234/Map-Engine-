import { describe, expect, it } from 'vitest';
import { entityCenter } from '../src/locate.ts';

describe('entityCenter', () => {
  it('uses a track position first', () => {
    expect(entityCenter({ location: { lon: 70, lat: 22 } } as never)).toEqual([70, 22]);
  });
  it('uses a point, and the centre of a circle', () => {
    expect(entityCenter({ geo_shape: { type: 'point', coordinates: [71, 23] } } as never)).toEqual([71, 23]);
    expect(entityCenter({ geo_shape: { type: 'circle', center: [69, 21], radius_m: 5000 } } as never)).toEqual([69, 21]);
  });
  it('uses the middle of a polygon, without counting its closing vertex twice', () => {
    const ring = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    expect(entityCenter({ geo_shape: { type: 'polygon', coordinates: [ring] } } as never)).toEqual([2, 2]);
  });
  it('uses the middle vertex of a line', () => {
    expect(entityCenter({ geo_shape: { type: 'line', coordinates: [[0, 0], [1, 1], [2, 2]] } } as never)).toEqual([1, 1]);
  });
  it('has no place for what has no position or shape', () => {
    expect(entityCenter({} as never)).toBeNull();
  });
});
