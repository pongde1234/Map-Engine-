/**
 * A panel section: a heading (Body Medium Semibold, the panel's one heading level) with its
 * count as a Counter, and an optional control at the end of the heading row, over its content.
 * Sections stacked in a `bs-divided` container are separated by a hairline, so the heading marks
 * where one ends and the next begins and the list text beneath it reads a level lower.
 */
import type { ReactNode } from 'react';
import { Counter } from '@faclon-labs/fds';

export function Section({ title, count, trailing, children }: { title: string; count?: number; trailing?: ReactNode; children: ReactNode }) {
  return (
    <section className="bs-sec" aria-label={title}>
      <div className="bs-sec__head">
        <span className="bs-sec__title">
          <span className="BodyMediumSemibold">{title}</span>
          {count !== undefined ? <Counter value={count} max={999} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${count}`} /> : null}
        </span>
        {trailing}
      </div>
      {children}
    </section>
  );
}
