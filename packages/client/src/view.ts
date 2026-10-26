/**
 * View state shared by map, panels and pop-out windows: selection, hover, layer visibility,
 * coordinate format, bookmarks. Kept apart from the entity store so UI changes never touch it.
 */
import { createStore, type Store } from './store.ts';

export interface Bookmark {
  id: string;
  label: string;
  /** Engine time. */
  t: number;
  camera?: { center: [number, number]; zoom: number; pitch?: number; bearing?: number };
  layers?: Record<string, boolean>;
  select?: string;
  caption?: string;
  /** The console page the frame opens (default: the map). */
  page?: string;
}

export interface ViewState {
  selected: string | null;
  hovered: string | null;
  layers: Record<string, boolean>;
  coordFormat: string;
  cursor: [number, number] | null;
  /** Lineage highlight: record/entity ids to emphasise on the map. */
  highlight: string[];
}

export const DEFAULT_LAYERS: Record<string, boolean> = {
  'fused.threats': true,
  'fused.blue': true,
  'fused.civil': true,
  'fused.maritime': true,
  'fused.groups': true,
  'fused.contested': true,
  'observation.plots': false,
  'observation.fragments': true,
  'command.rings': true,
  'command.wcs': true,
  'command.restrictions': true,
  'command.pickets': true,
  'command.softkill': true,
  'command.aimpoints': true,
  'command.axes': true,
  'command.operator': true,
  'reference.vp': true,
  'reference.coverage': false,
  'reference.wez': false,
  'event.engagements': true,
  'track.trails': true,
  'track.leaders': true,
  'track.labels': true,
};

export type ViewStore = Store<ViewState>;

export function createViewStore(init: Partial<ViewState> = {}): ViewStore {
  return createStore<ViewState>({
    selected: null,
    hovered: null,
    layers: { ...DEFAULT_LAYERS },
    coordFormat: 'mgrs',
    cursor: null,
    highlight: [],
    ...init,
  });
}

/** Mirror a view store across windows (pop-out panels on other monitors). */
export function syncAcrossWindows(view: ViewStore, channel = 'me-view'): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const bc = new BroadcastChannel(channel);
  let applying = false;
  bc.onmessage = (ev) => {
    applying = true;
    view.set(ev.data as Partial<ViewState>);
    applying = false;
  };
  const unsub = view.subscribe(() => {
    if (applying) return;
    const { selected, layers, coordFormat, highlight } = view.get();
    bc.postMessage({ selected, layers, coordFormat, highlight });
  });
  return () => {
    unsub();
    bc.close();
  };
}
