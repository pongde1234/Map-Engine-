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
/** A right panel is this share of the screen, within PANEL_MIN and PANEL_MAX (--bs-panel-w in styles.css). */
export const PANEL_SHARE = 0.2;
export const PANEL_MIN = 352;
export const PANEL_MAX = 440;
/** A left panel, narrower: lists and three tabs (--bs-panel-left-w). */
export const LEFT_SHARE = 0.18;
export const LEFT_MIN = 304;
export const LEFT_MAX = 400;
/** The shell's own rail and borders. */
export const SHELL_W = 62;

/** The right panel's width on a screen this wide, with its 1px border. */
export function panelWidth(width: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, width * PANEL_SHARE)) + 1;
}

/** The left panel's width on a screen this wide, with its 1px border. */
export function leftWidth(width: number): number {
  return Math.min(LEFT_MAX, Math.max(LEFT_MIN, width * LEFT_SHARE)) + 1;
}

export function fitPanels<P extends Panels>(cur: P, ask: Partial<Panels>, width: number): P {
  const next = { ...cur, ...ask };
  const mapWidth = width - SHELL_W - (next.leftOpen ? leftWidth(width) : 0) - (next.rightOpen ? panelWidth(width) : 0);
  if (mapWidth >= MAP_MIN) return next;
  // The panel just asked for stays and the other gives way; on a resize the layers panel goes first.
  if (ask.rightOpen) return { ...next, leftOpen: false };
  if (ask.leftOpen) return { ...next, rightOpen: false };
  return { ...next, leftOpen: false };
}
