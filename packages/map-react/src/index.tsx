/**
 * React bindings. The map itself never re-renders through React; panels read throttled
 * snapshots (≤4 Hz) so a 60× replay never floods the component tree.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Entity, JournalRecord } from '@me/schema';
import type { MapClient, ViewState, ViewStore } from '@me/client';
import { createMapEngine, type DrawController, type DrawState, type MapEngine, type MapEngineOptions, type SketchMeasure } from '@me/map';

interface Ctx {
  client: MapClient;
  view: ViewStore;
  engine: MapEngine | null;
  setEngine: (e: MapEngine | null) => void;
}

const EngineContext = createContext<Ctx | null>(null);

export function MapEngineProvider({ client, view, children }: { client: MapClient; view: ViewStore; children: ReactNode }) {
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const value = useMemo(() => ({ client, view, engine, setEngine }), [client, view, engine]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(EngineContext);
  if (!c) throw new Error('MapEngineProvider missing');
  return c;
}

export const useClient = () => useCtx().client;
export const useViewStore = () => useCtx().view;
export const useEngine = () => useCtx().engine;

export function MapView(props: Omit<MapEngineOptions, 'container' | 'client' | 'view'> & { className?: string }) {
  const { client, view, setEngine } = useCtx();
  const ref = useRef<HTMLDivElement>(null);
  const { className, ...opts } = props;
  useEffect(() => {
    if (!ref.current) return;
    const engine = createMapEngine({ ...opts, container: ref.current, client, view });
    setEngine(engine);
    return () => {
      setEngine(null);
      engine.destroy();
    };
    // Engine is created once per mount; option changes need a remount (key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, view]);
  return <div ref={ref} className={className ?? 'me-map'} />;
}

/** Throttled subscription to the client: re-renders at most every `ms`. */
export function useClientTick(ms = 250): number {
  const client = useClient();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let pending = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      pending = false;
      last = performance.now();
      setTick((x) => x + 1);
    };
    const unsub = client.subscribe(() => {
      if (pending) return;
      pending = true;
      const wait = Math.max(0, ms - (performance.now() - last));
      timer = setTimeout(fire, wait);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [client, ms]);
  return tick;
}

/** Engine time, ticking smoothly while playing (default 4 Hz). */
export function useEngineTime(ms = 250): number {
  const client = useClient();
  useClientTick(ms);
  const [, force] = useState(0);
  useEffect(() => {
    if (!client.clock.playing) return;
    const id = setInterval(() => force((x) => x + 1), ms);
    return () => clearInterval(id);
  });
  return client.now();
}

export function useView<T>(select: (s: ViewState) => T): T {
  const view = useViewStore();
  return useSyncExternalStore(view.subscribe, () => select(view.get()));
}

export function useSelectedEntity(ms = 250): Entity | null {
  const client = useClient();
  const id = useView((s) => s.selected);
  useClientTick(ms);
  return id ? (client.entities.get(id) ?? null) : null;
}

export function useEvents(ms = 400): JournalRecord[] {
  const client = useClient();
  useClientTick(ms);
  return client.events;
}

/** Lineage for an id, refetched when the id or the cursor epoch changes. */
export function useLineage(id: string | null): { records: JournalRecord[]; loading: boolean } {
  const client = useClient();
  const [state, setState] = useState<{ records: JournalRecord[]; loading: boolean }>({ records: [], loading: false });
  const epoch = client.clock.epoch;
  useEffect(() => {
    if (!id) {
      setState({ records: [], loading: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    // A dropped link ends the wait (the shell says the link is down); the list is then empty, not "Loading…".
    client
      .lineage(id)
      .then((records) => live && setState({ records, loading: false }))
      .catch(() => live && setState({ records: [], loading: false }));
    return () => {
      live = false;
    };
  }, [client, id, epoch]);
  return state;
}

const IDLE_DRAW: DrawState = { tool: null, shape: 'line', points: [], cursor: null, radius_m: 0, done: false };

/** The sketch tools' state, live (it changes with the pointer while a tool is drawing). */
export function useDrawState(): { state: DrawState; measure: SketchMeasure | null; tools: DrawController | null } {
  const tools = useEngine()?.tools ?? null;
  const subscribe = useCallback((l: () => void) => tools?.subscribe(l) ?? (() => {}), [tools]);
  const state = useSyncExternalStore(subscribe, () => tools?.get() ?? IDLE_DRAW);
  const measure = useMemo(() => (tools && state.tool ? tools.measure() : null), [tools, state]);
  return { state, measure, tools };
}
