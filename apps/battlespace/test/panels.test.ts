import { describe, expect, it } from 'vitest';
import { LEFT_MAX, LEFT_MIN, MAP_MIN, PANEL_MAX, PANEL_MIN, SHELL_W, fitPanels, leftWidth, panelWidth } from '../src/panels.ts';

const both = { leftOpen: true, rightOpen: true };
const mapAt = (w: number, p: { leftOpen: boolean; rightOpen: boolean }) => w - SHELL_W - (p.leftOpen ? leftWidth(w) : 0) - (p.rightOpen ? panelWidth(w) : 0);

describe('panelWidth', () => {
  it('is 20% of the screen, within its floor and cap (plus the border)', () => {
    expect(panelWidth(1366)).toBe(PANEL_MIN + 1);
    expect(panelWidth(1920)).toBeCloseTo(1920 * 0.2 + 1);
    expect(panelWidth(3840)).toBe(PANEL_MAX + 1);
  });
  it('makes the left panel narrower: 18%, within its own floor and cap', () => {
    expect(leftWidth(1366)).toBe(LEFT_MIN + 1);
    expect(leftWidth(1920)).toBeCloseTo(1920 * 0.18 + 1);
    expect(leftWidth(3840)).toBe(LEFT_MAX + 1);
    expect(leftWidth(1920)).toBeLessThan(panelWidth(1920));
  });
});

describe('fitPanels', () => {
  it('keeps both panels where the map stays wide enough', () => {
    expect(fitPanels(both, {}, 1920)).toEqual(both);
    expect(mapAt(1920, both)).toBeGreaterThanOrEqual(MAP_MIN);
  });

  it('starts without the layers panel on a narrow screen', () => {
    // From 1366 both fit (the map just over MAP_MIN there), so the layers panel stays.
    for (const w of [1366, 1440]) {
      expect(fitPanels(both, {}, w)).toEqual(both);
      expect(mapAt(w, both)).toBeGreaterThanOrEqual(MAP_MIN);
    }
    for (const w of [1280]) {
      const p = fitPanels(both, {}, w);
      expect(p).toEqual({ leftOpen: false, rightOpen: true });
      expect(mapAt(w, p)).toBeGreaterThanOrEqual(MAP_MIN);
    }
  });

  it('opening one panel closes the other when the map would be too narrow', () => {
    expect(fitPanels({ leftOpen: false, rightOpen: true }, { leftOpen: true }, 1280)).toEqual({ leftOpen: true, rightOpen: false });
    expect(fitPanels({ leftOpen: true, rightOpen: false }, { rightOpen: true }, 1280)).toEqual({ leftOpen: false, rightOpen: true });
  });

  it('never closes the panel just asked for, and keeps what else the state holds', () => {
    const p = fitPanels({ leftOpen: false, rightOpen: true, leftTab: 'alerts' }, { leftOpen: true }, 1280);
    expect(p.leftOpen).toBe(true);
    expect(p.leftTab).toBe('alerts');
  });

  it('closing a panel never opens another', () => {
    expect(fitPanels(both, { rightOpen: false }, 1920)).toEqual({ leftOpen: true, rightOpen: false });
  });
});
