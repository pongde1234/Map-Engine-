/**
 * Hostile tracks per ring, outer to inner: four Cards, each with the ring's name, the count and a
 * meter for its share of all tracked hostiles (the span is in the tooltip). R3 is read against its
 * fire channels (the saturation rule's own figure): its meter runs against them, and the count and
 * meter turn red when it passes them.
 */
import { Card, CardBody, Metric, ProgressBar, Tooltip } from '@faclon-labs/fds';
import type { Derived } from './derived.ts';
import { Section } from './Section.tsx';

/** Rings, outer to inner, with their span. */
const RINGS: Array<[keyof Derived['rings'], string]> = [
  ['R4', '150–60 km'],
  ['R3', '60–20 km'],
  ['R2', '20–5 km'],
  ['R1', '5–0 km'],
];

export function Rings({ rings, channels }: { rings: Derived['rings']; channels: number }) {
  const total = RINGS.reduce((a, [k]) => a + rings[k], 0);
  return (
    <Section title="Rings · hostile tracks" count={total}>
      <div className="bs-rings">
        {RINGS.map(([k, span]) => {
          const n = rings[k];
          // R3 against its fire channels; the others against all hostile tracks in the rings.
          const limit = k === 'R3' && channels > 0 ? channels : 0;
          const over = limit > 0 && n > limit;
          const max = limit || total || 1;
          return (
            <Tooltip key={k} content={`${k} · ${span}${limit ? ` · ${limit} fire channels` : ''}`}>
              <div className="bs-rings__item" tabIndex={0}>
                <Card padding={0} size="Medium" accessibilityLabel={`${k}: ${n} hostile tracks`}>
                  <CardBody>
                    <div className="bs-rings__cell">
                      <span className="bs-rings__name">
                        <span className="BodyXSmallRegular bs-muted">{k}</span>
                      </span>
                      <span className="bs-rings__value">
                        <Metric type="Heading" size="Small" weight="Semibold" value={n} suffix="none" color={over ? 'Negative' : 'Neutral'} />
                        {limit ? <span className="BodyXSmallRegular bs-muted bs-num">/{limit}</span> : null}
                      </span>
                      <ProgressBar type="meter" size="Large" accessibilityLabel={over ? `${k} over its fire channels` : `${k} share`} value={Math.min(n, max)} max={max} color={over ? 'Negative' : n > 0 ? 'Notice' : 'Neutral'} />
                    </div>
                  </CardBody>
                </Card>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </Section>
  );
}
