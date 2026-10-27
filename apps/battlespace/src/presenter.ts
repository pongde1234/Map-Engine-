/**
 * Presenter flow: storyboard frames stepped from any page (`[` `]`, or PgUp/PgDn from a
 * clicker) and the `?bm=` / `?t=` / `?sel=` deep links. A frame seeks the time, sets the
 * selection and opens its page; the map's camera applies once the map page has its engine
 * (`pending`), so a frame on another page (A2, the Ontology Explorer) steps like any other.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bookmark, MapClient, ViewStore } from '@me/client';
import { storyboardBookmarks } from './bookmarks.ts';

/** The frame whose time the console opens at, and the board falls back to when it is empty. */
export const DEMO_FRAME = 'B4';

export interface Presenter {
  bookmarks: Bookmark[];
  index: number;
  current: Bookmark | undefined;
  go(b: Bookmark): void;
  step(d: 1 | -1): void;
  /** A map frame whose camera is still to be applied. */
  pending: Bookmark | null;
  applied(): void;
}

export function usePresenter(client: MapClient, view: ViewStore, setPage: (page: string) => void): Presenter {
  const s = client.scenario;
  const bookmarks = useMemo(() => (s ? storyboardBookmarks(s) : []), [s]);
  const [index, setIndex] = useState(-1);
  const [pending, setPending] = useState<Bookmark | null>(null);

  const go = useCallback(
    (b: Bookmark) => {
      setIndex(bookmarks.findIndex((x) => x.id === b.id));
      const patch: Partial<ReturnType<ViewStore['get']>> = {};
      if (b.layers) patch.layers = { ...view.get().layers, ...b.layers };
      if (b.select !== undefined) patch.selected = b.select;
      view.set(patch);
      client.seek(b.t);
      const page = b.page ?? 'battlespace';
      setPage(page);
      setPending(page === 'battlespace' && b.camera ? b : null);
    },
    [bookmarks, view, client, setPage],
  );

  const step = useCallback(
    (d: 1 | -1) => {
      if (!bookmarks.length) return;
      const i = index < 0 ? (d > 0 ? 0 : bookmarks.length - 1) : Math.max(0, Math.min(bookmarks.length - 1, index + d));
      go(bookmarks[i]!);
    },
    [bookmarks, index, go],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable || e.ctrlKey || e.metaKey) return;
      if (e.key === ']' || e.key === 'PageDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === '[' || e.key === 'PageUp') {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // Deep links (Target Board "Compare on map", evidence packs) apply once the scenario is known,
  // then leave the URL, so returning to a page keeps the operator's own time and selection.
  // Without one, the console opens at the demo position (frame B4's time, H-15): the busiest
  // moment of the synthetic raid, so every page and panel has data from the first screen.
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    if (linked || !s) return;
    setLinked(true);
    const q = new URLSearchParams(location.search);
    if (![...q.keys()].some((k) => k === 'bm' || k === 't' || k === 'sel')) {
      const demo = bookmarks.find((b) => b.id === DEMO_FRAME);
      if (demo) client.seek(demo.t);
      return;
    }
    const b = q.get('bm') ? bookmarks.find((x) => x.id === q.get('bm')) : undefined;
    if (b) go(b);
    else if (q.get('t')) client.seek(Number(q.get('t')));
    if (q.get('sel')) view.set({ selected: q.get('sel') });
    for (const k of ['bm', 't', 'sel']) q.delete(k);
    const rest = q.toString();
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }, [linked, s, bookmarks, go, client, view]);

  const applied = useCallback(() => setPending(null), []);
  return { bookmarks, index, current: index >= 0 ? bookmarks[index] : undefined, go, step, pending, applied };
}
