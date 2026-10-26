/**
 * Run reads for the debrief and the evidence pack (same origin; nothing leaves the room):
 * the accounting of every threat track and plant unit, and the chain check up to the picture
 * time. Both are read per whole minute of picture time, so playback does not flood the server.
 */
import { useEffect, useState } from 'react';
import type { Accounting } from '@me/schema';

export interface ChainCheck {
  ok: boolean;
  checked: number;
  head: { seq: number; hash: string; t: number } | null;
  /** Measured on the server for this check. */
  ms: number;
  /** The prefix was already verified on this server (at load or an earlier check). */
  cached?: boolean;
}

function useMinuteFetch<T>(path: string | null, t: number): { data: T | null; at: number | null } {
  const minute = Math.floor(t / 60_000) * 60_000;
  const [state, setState] = useState<{ data: T | null; at: number | null }>({ data: null, at: null });
  useEffect(() => {
    if (!path) return;
    const ctl = new AbortController();
    fetch(`${path}${path.includes('?') ? '&' : '?'}t=${minute}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .then((data) => setState({ data, at: minute }))
      .catch(() => {});
    return () => ctl.abort();
  }, [path, minute]);
  return state;
}

/** Every threat track and plant unit, as this role may read them, at the picture minute. */
export function useAccounting(t: number, role: string): { accounting: Accounting | null; at: number | null } {
  const { data, at } = useMinuteFetch<Accounting>(`/api/accounting?role=${encodeURIComponent(role)}`, t);
  return { accounting: data, at };
}

/** The hash chain checked up to the picture minute, with the head at that time. */
export function useChainCheck(t: number, enabled = true): { check: ChainCheck | null; at: number | null } {
  const { data, at } = useMinuteFetch<ChainCheck>(enabled ? '/api/verify' : null, t);
  return { check: data, at };
}
