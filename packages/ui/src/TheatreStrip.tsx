/**
 * The theatre in one line, kept above an object's details: hostile tracks in each ring (R3 against
 * its fire channels), the rules fired and the units engaging. Inspecting an object used to replace
 * the whole theatre summary; this keeps the figures that matter in view, and a click returns to
 * the full summary (it clears the selection).
 */
import { Button, Tooltip } from '@faclon-labs/fds';
import type { Derived } from './derived.ts';
import { typeClass } from './type.ts';

const RINGS: Array<keyof Derived['rings']> = ['R4', 'R3', 'R2', 'R1'];

export function TheatreStrip({ derived, channels, engaging, onOpen }: { derived: Derived; channels: number; engaging: number; onOpen: () => void }) {
  const hostile = RINGS.reduce((a, k) => a + derived.rings[k], 0);
  const over = channels > 0 && derived.rings.R3 > channels;
  return (
    <Tooltip content="The whole theatre: rings, rules, raid groups, fire units. Click to see it (clears the selection).">
      <Button size="xs" variant="ghost" tone="neutral" isFullWidth aria-label={`Theatre: ${hostile} hostile tracks in the rings, ${derived.activeRules.length} rules fired, ${engaging} units engaging. Show the full summary.`} onClick={onOpen}>
        <span className="bs-pin">
          {RINGS.map((k) => (
            <span key={k} className="bs-pin__ring">
              <span className={typeClass('caption', 'muted')}>{k}</span>
              <span className={`${typeClass('value')} ${k === 'R3' && over ? 'bs-ink-negative' : ''}`}>{k === 'R3' && channels ? `${derived.rings[k]}/${channels}` : derived.rings[k]}</span>
            </span>
          ))}
          <span className="bs-pin__sep" aria-hidden />
          <span className={`${typeClass('caption', derived.activeRules.length ? 'normal' : 'muted')} bs-num`}>{derived.activeRules.length} rules</span>
          <span className={`${typeClass('caption', engaging ? 'normal' : 'muted')} bs-num`}>{engaging} engaging</span>
        </span>
      </Button>
    </Tooltip>
  );
}
