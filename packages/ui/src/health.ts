import { useEffect, useState } from 'react';

export interface Health {
  ok: boolean;
  records: number;
  head: { seq: number; hash: string; t: number };
  keyframes: number;
  chain: { ok: boolean; checked: number; brokenAt?: number };
  /** The operator chain (objects drawn in the console and their rule firings). */
  operator?: { records: number; head: string };
  serverTime: number;
}

let cache: Promise<Health> | null = null;

/** Server health, fetched once per page (same origin; no outbound requests). */
export function useHealth(): Health | null {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    cache ??= fetch('/api/health').then((r) => r.json() as Promise<Health>);
    let live = true;
    cache.then((v) => live && setH(v)).catch(() => (cache = null));
    return () => {
      live = false;
    };
  }, []);
  return h;
}
