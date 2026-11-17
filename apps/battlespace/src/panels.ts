/**
 * Which side panels fit. Both panels stay open together on any desktop screen (user ruling
 * 2026-11-12): the map narrows between them, to 512px at 1280. Only below MAP_MIN, a window too
 * narrow for the two panels and a usable map (under about 1000px), does opening one close the other,
 * and on a resize the layers panel steps aside first. Below STACK_BELOW (a phone) the panels stack under the map
 * instead of beside it (styles.css), so they take no map width and both stay open.
 */
export interface Panels {
  leftOpen: boolean;
  rightOpen: boolean;
}

export const MAP_MIN = 240;
/** Under this window width the panels stack below the map (the media query in styles.css). */
export const STACK_BELOW = 768;
/** A right panel is this share of the screen, within PANEL_MIN and PANEL_MAX (--bs-panel-w in styles.css). */
export const PANEL_SHARE = 0.2;
export const PANEL_MIN = 352;
export const PANEL_MAX = 440;
/** The left panel is the right one's width (--bs-panel-left-w). */
export const LEFT_SHARE = PANEL_SHARE;
export const LEFT_MIN = PANEL_MIN;
export const LEFT_MAX = PANEL_MAX;
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
  if (width < STACK_BELOW) return next;
  const mapWidth = width - SHELL_W - (next.leftOpen ? leftWidth(width) : 0) - (next.rightOpen ? panelWidth(width) : 0);
  if (mapWidth >= MAP_MIN) return next;
  // The panel just asked for stays and the other gives way; on a resize the layers panel goes first.
  if (ask.rightOpen) return { ...next, leftOpen: false };
  if (ask.leftOpen) return { ...next, rightOpen: false };
  return { ...next, leftOpen: false };
}
