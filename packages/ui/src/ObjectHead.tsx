/**
 * An object's header, read top to bottom: its name, with a status dot before it when it has one (and an aside at the right,
 * such as the picture time); a status line — the state word in its colour, then the figures that
 * qualify it; a relation line, "this → that", each side a figure, its word and one line beneath;
 * then a row of equal-width actions. FDS parts only (Indicator, Metric, lucide icons, Buttons
 * passed in as actions).
 * The Theatre card uses it; an inspector or a target card can take the same anatomy.
 */
import type { ComponentProps, ReactNode } from 'react';
import { Indicator, Metric } from '@faclon-labs/fds';
import { ArrowRight } from 'lucide-react';
import { typeClass, type Ink } from './type.ts';

type DotColor = NonNullable<ComponentProps<typeof Indicator>['color']>;

/** One side of the relation line: an icon, its figure and word, and one line beneath. */
export interface HeadSide {
  icon: ReactNode;
  figure: number;
  label: string;
  sub?: { text: string; ink?: Ink };
}

/** A figure on the status line; with an ink it is set in medium weight, so it reads over the rest. */
export type HeadPart = string | { text: string; ink: Ink };

/** Medium weight in an ink: the alarm role when the ink is an alarm's, else a figure in a dense row. */
const strong = (ink: Ink): string => typeClass(ink === 'negative' || ink === 'notice' ? 'alarm' : 'label', ink);

export function ObjectHead({
  dot,
  title,
  aside,
  state,
  parts = [],
  from,
  to,
  actions,
}: {
  /** A status dot before the name, in the state's colour. */
  dot?: DotColor;
  title: string;
  aside?: ReactNode;
  state?: { word: string; ink: Ink };
  parts?: HeadPart[];
  from?: HeadSide;
  to?: HeadSide;
  actions?: ReactNode;
}) {
  return (
    <div className="bs-head">
      <div className="bs-head__title">
        {dot ? <Indicator color={dot} emphasis="Intense" size="Medium" aria-hidden /> : null}
        <span className={`${typeClass('section')} bs-ellipsis`}>{title}</span>
        {aside ? <span className={`${typeClass('caption', 'muted')} bs-num bs-head__aside`}>{aside}</span> : null}
      </div>
      {state || parts.length ? (
        <p className="bs-head__status">
          {state ? <span className={strong(state.ink)}>{state.word}</span> : null}
          {parts.map((p) => {
            const { text, ink } = typeof p === 'string' ? { text: p, ink: null } : p;
            return (
              <span key={text} className="bs-num">
                <span className={typeClass('caption', 'secondary')}>{' · '}</span>
                <span className={ink ? strong(ink) : typeClass('caption', 'secondary')}>{text}</span>
              </span>
            );
          })}
        </p>
      ) : null}
      {from && to ? (
        <div className="bs-head__rel">
          <Side side={from} />
          <ArrowRight size={16} className="bs-muted" aria-label="to" />
          <Side side={to} />
        </div>
      ) : null}
      {actions ? <div className="bs-head__actions">{actions}</div> : null}
    </div>
  );
}

function Side({ side }: { side: HeadSide }) {
  return (
    <span className="bs-head__side">
      <span className="bs-head__icon" aria-hidden>
        {side.icon}
      </span>
      <span className="bs-head__sidetext">
        {/* The figure leads at Metric Heading Small (the Target Board strip's size); its word stays at row size. */}
        <span className="bs-head__fig">
          <Metric type="Heading" size="Small" weight="Semibold" value={side.figure} suffix="none" color="Neutral" />
          <span className={`${typeClass('row')} bs-ellipsis`}>{side.label}</span>
        </span>
        {side.sub ? <span className={`${typeClass('caption', side.sub.ink ?? 'secondary')} bs-num bs-ellipsis`}>{side.sub.text}</span> : null}
      </span>
    </span>
  );
}
