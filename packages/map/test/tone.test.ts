import { describe, expect, it } from 'vitest';
import { OperatorColor } from '@me/schema';
import { COLOR_TONE, LAYER_TONES, OPERATOR_COLORS, defaultTone, layerHash, layerTone, operatorTone, toneColor } from '../src/tone.ts';

describe('operatorTone', () => {
  it('keeps geofences and no-fly zones amber, in a layer or not', () => {
    expect(operatorTone({ type: 'geofence' }, false)).toBe('notice');
    expect(operatorTone({ type: 'nfz', layer: 'L-1' }, true)).toBe('notice');
  });

  it('gives an object in a live layer that layer’s colour, shared by everything in it', () => {
    const a = operatorTone({ type: 'annotation', layer: 'L-1' }, true);
    const b = operatorTone({ type: 'measure', layer: 'L-1' }, true);
    expect(a).toBe(b);
    expect(a).toBe(layerTone('L-1'));
    expect(LAYER_TONES).toContain(a);
  });

  it('falls back to the type when the layer is withdrawn or there is none', () => {
    expect(operatorTone({ type: 'annotation', layer: 'L-1' }, false)).toBe('info');
    expect(operatorTone({ type: 'measure', layer: 'L-1' }, false)).toBe('cat2');
    expect(operatorTone({ type: 'annotation' }, false)).toBe('info');
    expect(operatorTone({ type: 'axis' }, true)).toBe('info');
    expect(operatorTone(undefined, false)).toBe('info');
  });

  it('never uses red (hostile), focus blue (selection) or the amber of a warning for a layer', () => {
    for (const t of LAYER_TONES) expect(['negative', 'focus', 'brand', 'notice', 'cat3', 'cat7']).not.toContain(t);
  });

  it('is stable: a layer keeps its colour whatever else exists', () => {
    expect(layerHash('LAYER-7')).toBe(layerHash('LAYER-7'));
    expect(layerTone('LAYER-7')).toBe(layerTone('LAYER-7'));
  });

  it('spreads layers over the palette rather than piling on one colour', () => {
    const used = new Set(Array.from({ length: 24 }, (_, i) => layerTone(`OP-LAYER-${i + 1}`)));
    expect(used.size).toBeGreaterThanOrEqual(4);
  });
});

describe('the operator’s own choice', () => {
  it('wins over the layer, the type and even a warning', () => {
    expect(operatorTone({ type: 'annotation', layer: 'L-1', color: 'pink' }, true)).toBe('cat5');
    expect(operatorTone({ type: 'measure', color: 'sapphire' }, false)).toBe('info');
    expect(operatorTone({ type: 'geofence', color: 'teal' }, false)).toBe('cat6');
  });

  it('leaves the default alone when none is chosen', () => {
    expect(operatorTone({ type: 'annotation', layer: 'L-1' }, true)).toBe(defaultTone({ type: 'annotation', layer: 'L-1' }, true));
  });

  it('offers exactly the colours the record allows, and every default is among them', () => {
    expect([...OPERATOR_COLORS].sort()).toEqual([...OperatorColor.options].sort());
    for (const t of [...LAYER_TONES, 'notice', 'info', 'cat2'] as const) expect(COLOR_TONE[toneColor(t)]).toBe(t);
  });

  it('offers no red and no selection blue', () => {
    for (const tone of Object.values(COLOR_TONE)) expect(['negative', 'focus', 'brand']).not.toContain(tone);
  });
});
