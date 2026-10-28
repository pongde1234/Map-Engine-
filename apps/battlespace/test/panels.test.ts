import { describe, expect, it } from 'vitest';
import { MAP_MIN, PANEL_W, SHELL_W, fitPanels } from '../src/panels.ts';

const both = { leftOpen: true, rightOpen: true };
const mapAt = (w: number, p: { leftOpen: boolean; rightOpen: boolean }) => w - SHELL_W - (p.leftOpen ? PANEL_W : 0) - (p.rightOpen ? PANEL_W : 0);

describe('fitPanels', () => {
  it('keeps both panels where the map stays wide enough', () => {
    expect(fitPanels(both, {}, 1920)).toEqual(both);
    expect(mapAt(1920, both)).toBeGreaterThanOrEqual(MAP_MIN);
  });

  it('starts without the layers panel on a narrow screen', () => {
    // At 1440 both fit exactly (the map is MAP_MIN wide), so the layers panel stays.
    expect(fitPanels(both, {}, 1440)).toEqual(both);
    for (const w of [1280, 1366]) {
      const p = fitPanels(both, {}, w);
      expect(p).toEqual({ leftOpen: false, rightOpen: true });
      expect(mapAt(w, p)).toBeGreaterThanOrEqual(MAP_MIN);
    }
  });

  it('opening one panel closes the other when the map would be too narrow', () => {
    expect(fitPanels({ leftOpen: false, rightOpen: true }, { leftOpen: true }, 1366)).toEqual({ leftOpen: true, rightOpen: false });
    expect(fitPanels({ leftOpen: true, rightOpen: false }, { rightOpen: true }, 1366)).toEqual({ leftOpen: false, rightOpen: true });
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
