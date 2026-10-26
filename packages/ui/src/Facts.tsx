/**
 * Facts: label-over-value pairs in two columns, for the inspector and the promote dialog.
 * Lighter than a Table for a handful of values (no header band, no 40px rows); FDS has no
 * description-list component, so this is markup and FDS type classes only. A wide fact spans
 * both columns (long values: positions, notes, hashes). `flush` drops the panel padding, for
 * use inside a Card that already pads.
 */
import type { ReactNode } from 'react';

/** [label, value, wide?], or a falsy value to skip it (lets callers write `cond && [...]`). */
export type Fact = [string, ReactNode] | [string, ReactNode, 'wide'] | null | false | undefined | '' | 0;

export function Facts({ title, items, flush }: { title?: string; items: Fact[]; flush?: boolean }) {
  const rows = items.filter((f): f is [string, ReactNode] | [string, ReactNode, 'wide'] => Array.isArray(f));
  if (!rows.length) return null;
  return (
    <section className={flush ? 'bs-facts bs-facts--flush' : 'bs-facts'} aria-label={title}>
      {title ? <span className="BodyXSmallMedium bs-muted">{title.toUpperCase()}</span> : null}
      <dl className="bs-facts__grid">
        {rows.map(([k, v, wide], i) => (
          <div key={`${i}:${k}`} className={wide ? 'bs-fact bs-fact--wide' : 'bs-fact'}>
            <dt className="BodyXSmallRegular bs-muted">{k}</dt>
            <dd className="BodySmallMedium bs-num bs-fact__value">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
