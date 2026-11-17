import { describe, expect, it } from 'vitest';
import { LEFT_MAX, LEFT_MIN, MAP_MIN, PANEL_MAX, PANEL_MIN, SHELL_W, STACK_BELOW, fitPanels, leftWidth, panelWidth } from '../src/panels.ts';

const both = { leftOpen: true, rightOpen: true };
const mapAt = (w: number, p: { leftOpen: boolean; rightOpen: boolean }) => w - SHELL_W - (p.leftOpen ? leftWidth(w) : 0) - (p.rightOpen ? panelWidth(w) : 0);

describe('panelWidth', () => {
  it('is 20% of the screen, within its floor and cap (plus the border)', () => {
    expect(panelWidth(1366)).toBe(PANEL_MIN + 1);
    expect(panelWidth(1920)).toBeCloseTo(1920 * 0.2 + 1);
    expect(panelWidth(3840)).toBe(PANEL_MAX + 1);
  });
  it('gives the left panel the same width as the right', () => {
    expect(leftWidth(1366)).toBe(LEFT_MIN + 1);
    expect(leftWidth(3840)).toBe(LEFT_MAX + 1);
    for (const w of [1024, 1366, 1920, 3840]) expect(leftWidth(w)).toBe(panelWidth(w));
  });
});

describe('fitPanels', () => {
  it('keeps both panels open on every desktop width', () => {
    for (const w of [1024, 1280, 1366, 1440, 1920]) {
      expect(fitPanels(both, {}, w)).toEqual(both);
      expect(mapAt(w, both)).toBeGreaterThanOrEqual(MAP_MIN);
    }
  });

  it('opening one panel keeps the other on a desktop screen', () => {
    expect(fitPanels({ leftOpen: false, rightOpen: true }, { leftOpen: true }, 1280)).toEqual(both);
    expect(fitPanels({ leftOpen: true, rightOpen: false }, { rightOpen: true }, 1280)).toEqual(both);
  });

  it('closes the other panel only where the window is too narrow for both and a map', () => {
    expect(fitPanels({ leftOpen: false, rightOpen: true }, { leftOpen: true }, 900)).toEqual({ leftOpen: true, rightOpen: false });
    expect(fitPanels({ leftOpen: true, rightOpen: false }, { rightOpen: true }, 900)).toEqual({ leftOpen: false, rightOpen: true });
    expect(fitPanels(both, {}, 900)).toEqual({ leftOpen: false, rightOpen: true });
  });

  it('never closes the panel just asked for, and keeps what else the state holds', () => {
    const p = fitPanels({ leftOpen: false, rightOpen: true, leftTab: 'alerts' }, { leftOpen: true }, 900);
    expect(p.leftOpen).toBe(true);
    expect(p.leftTab).toBe('alerts');
  });

  it('keeps both open on a phone, where the panels stack under the map', () => {
    expect(fitPanels(both, {}, 390)).toEqual(both);
    expect(fitPanels({ leftOpen: false, rightOpen: true }, { leftOpen: true }, STACK_BELOW - 1)).toEqual(both);
  });

  it('closing a panel never opens another', () => {
    expect(fitPanels(both, { rightOpen: false }, 1920)).toEqual({ leftOpen: true, rightOpen: false });
  });
});
