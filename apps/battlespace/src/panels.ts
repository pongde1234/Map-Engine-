/**
 * Which side panels fit. The map keeps at least MAP_MIN px: opening a panel that would leave it
 * narrower closes the other one, and where there is no room for both the layers panel steps aside
 * first. Measured before this rule: with both open the map was 566px wide at 1366 and 480 at 1280.
 */
export interface Panels {
  leftOpen: boolean;
  rightOpen: boolean;
}

export const MAP_MIN = 640;
export const PANEL_W = 369;
/** The shell's own rail and borders. */
export const SHELL_W = 62;

export function fitPanels<P extends Panels>(cur: P, ask: Partial<Panels>, width: number): P {
  const next = { ...cur, ...ask };
  const mapWidth = width - SHELL_W - (next.leftOpen ? PANEL_W : 0) - (next.rightOpen ? PANEL_W : 0);
  if (mapWidth >= MAP_MIN) return next;
  // The panel just asked for stays and the other gives way; on a resize the layers panel goes first.
  if (ask.rightOpen) return { ...next, leftOpen: false };
  if (ask.leftOpen) return { ...next, rightOpen: false };
  return { ...next, leftOpen: false };
}
