/**
 * The theatre at a glance, first in the panel when nothing is selected (ObjectHead's anatomy):
 * the theatre's state as a coloured word — SATURATED (hostile tracks in R3 past the fire
 * channels), LEAKERS (the forecast past its DP-6 threshold), ENGAGING (channels in use), INBOUND
 * (hostile tracks closing) or CLEAR — with the first impact; then hostile tracks → fire units,
 * closing beneath one and rounds ready beneath the other; the facts no section below carries
 * (who holds engagement authority, the leaker forecast, contested and stale tracks); and, at the
 * foot of the card, the actions.
 * Read from situationOf, the Target Board's own figures, so both pages agree.
 */
import { useMemo } from 'react';
import { Button, Tooltip } from '@faclon-labs/fds';
import { Crosshair, ListChecks, Plane, Shield, Sparkles } from 'lucide-react';
import { useClient, useClientTick, useEngineTime, useViewStore } from '@me/map-react';
import type { Derived } from './derived.ts';
import { deriveTargets } from './targets.ts';
import { situationOf } from './situation.ts';
import { magState, type MagState } from './magazine.ts';
import { ObjectHead } from './ObjectHead.tsx';
import { Facts } from './Facts.tsx';
import { raidLabel } from './format.ts';
import type { Ink } from './type.ts';

// Rounds are a figure, not a state word: grey while ready, coloured only at low or the floor.
type Dot = 'Negative' | 'Notice' | 'Information' | 'Positive';
const MAG_INK: Record<MagState, Ink> = { ok: 'secondary', low: 'notice', floor: 'negative' };

export function TheatreCard({ derived, onOpenBoard, onAsk }: { derived: Derived; onOpenBoard?: () => void; onAsk?: (question: string) => void }) {
  const client = useClient();
  const view = useViewStore();
  const tick = useClientTick(1000);
  const t = useEngineTime(1000);
  // The board's targets, once a second: the situation reads leakers and first impact from them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => deriveTargets(client, t, derived.center), [client, tick, Math.floor(t / 1000)]);
  const sit = situationOf(client, derived, targets);
  const clock = client.scenario?.clock;

  const closing = derived.closing.R4 + derived.closing.R3 + derived.closing.R2 + derived.closing.R1;
  const { word, ink, dot } = theatreState(sit, closing);
  const imp = sit.firstImpactMin;
  // The hard-kill units in the defence layers: the Fire units section's count, and the board's.
  const units = sit.magazines.units;
  const mag = magState(sit.magazines.ready, 0, sit.magazines.capacity);
  const magInk = sit.magazines.atFloor ? 'negative' : MAG_INK[mag];
  // The shield keeps the magazine's state colour (a symbol, not text): green while ready.
  const shieldInk = magInk === 'secondary' ? 'positive' : magInk;
  // The first impact is the figure to act on: in the state's alarm ink, else normal ink.
  const impInk: Ink = ink === 'negative' || ink === 'notice' ? ink : 'normal';

  return (
    <section className="bs-sec" aria-label="Theatre">
      <ObjectHead
        dot={dot}
        title="Theatre"
        aside={clock ? raidLabel(t, clock) : undefined}
        // A clear theatre with nothing inbound says nothing: the line appears only when there is something to read.
        {...(word === 'Clear' && imp === null ? {} : { state: { word, ink } })}
        parts={imp !== null ? [{ text: `first impact ${Math.max(0, Math.round(imp))} min`, ink: impInk }, ...(sit.firstImpactRef ? [sit.firstImpactRef] : [])] : []}
        from={{
          icon: <Plane size={18} className={derived.hostile ? 'bs-ink-negative' : 'bs-muted'} />,
          figure: derived.hostile,
          label: 'hostile',
          sub: { text: closing ? `${closing} closing` : 'none closing', ink: closing ? 'negative' : 'muted' },
        }}
        to={{
          icon: <Shield size={18} className={`bs-ink-${shieldInk}`} />,
          figure: units,
          label: `fire unit${units === 1 ? '' : 's'}`,
          sub: { text: `${sit.magazines.ready} / ${sit.magazines.capacity} rounds`, ink: magInk },
        }}
      />
      <Facts
        flush
        items={[
          // The holder can run to two lines in its half of the grid rather than be cut.
          ['Authority', <span className="bs-wrap">{sit.authority.holder}</span>],
          ['Leakers', sit.leakers.value !== null ? <span className={sit.leakers.fired ? 'bs-ink-negative' : ''}>{`${sit.leakers.value}${sit.leakers.threshold !== null ? ` / ${sit.leakers.threshold}` : ''}`}</span> : 'No forecast'],
          ['Contested', String(derived.contested)],
          ['Stale', String(derived.stale)],
        ]}
      />
      <div className="bs-head__actions">
        <Button size="sm" variant="primary" tone="brand" isFullWidth leadingIcon={<ListChecks size={14} />} isDisabled={!onOpenBoard} onClick={() => onOpenBoard?.()}>
          Board
        </Button>
        <Tooltip content={sit.firstImpactRef ? `First impact: select ${sit.firstImpactRef} and centre the map on it` : 'Nothing inbound'}>
          <Button
            size="sm"
            variant="secondary"
            tone="neutral"
            isFullWidth
            leadingIcon={<Crosshair size={14} />}
            isDisabled={!sit.firstImpactRef}
            onClick={() => sit.firstImpactRef && view.set({ selected: sit.firstImpactRef, locate: sit.firstImpactRef })}
          >
            Locate
          </Button>
        </Tooltip>
        <Tooltip content="The assistant summarises the raid from the record">
          <Button size="sm" variant="secondary" tone="neutral" isFullWidth leadingIcon={<Sparkles size={14} />} isDisabled={!onAsk} onClick={() => onAsk?.('Summarise the raid at this picture time')}>
            Ask
          </Button>
        </Tooltip>
      </div>
    </section>
  );
}

/** The theatre's state, first match wins: the word, its ink and the dot's colour. */
function theatreState(sit: ReturnType<typeof situationOf>, closing: number): { word: string; ink: Ink; dot: Dot } {
  if (sit.saturation.channels > 0 && sit.saturation.hostileR3 > sit.saturation.channels) return { word: 'Saturated', ink: 'negative', dot: 'Negative' };
  if (sit.leakers.fired) return { word: 'Leakers', ink: 'negative', dot: 'Negative' };
  if (sit.saturation.busy > 0) return { word: 'Engaging', ink: 'info', dot: 'Information' };
  if (closing > 0) return { word: 'Inbound', ink: 'notice', dot: 'Notice' };
  return { word: 'Clear', ink: 'positive', dot: 'Positive' };
}
