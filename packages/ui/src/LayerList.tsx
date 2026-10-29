/**
 * Layer list, flat: each section a heading over its layers, one row each — a swatch in the colour
 * the layer takes on the map, the name, and at the right the newest-data age (only when that data
 * is no longer current), the count and an eye showing its state. The whole row is the toggle
 * (hover wash, keyboard focus); a hidden layer's row is dimmed. SearchInput filters the rows. The
 * operator's own layers sit under Command, each with a details button after its row; "New layer"
 * makes one (OperatorLayers.tsx).
 */
import { Fragment, useState } from 'react';
import { Badge, Button, Divider, IconButton, ScrollArea, SearchInput, Tooltip } from '@faclon-labs/fds';
import { Ellipsis, Eye, EyeOff, Plus } from 'lucide-react';
import type { AgeState } from '@me/schema';
import { useClient, useView, useViewStore } from '@me/map-react';
import { layerTone, operatorLayerKey, toneCss, type LayerKey } from '@me/map';
import type { Derived, LayerStat } from './derived.ts';
import { ageLabel, AGE_BADGE } from './age.ts';
import { LayerEntryModal, operatorLayers, operatorObjectCounts } from './OperatorLayers.tsx';
import { typeClass } from './type.ts';

/** Swatch colours: the theme tokens the map draws each layer in (packages/map/src/layers.ts). */
const RED = 'var(--background-negative-default)';
const BLUE = 'var(--background-info-default)';
const AMBER = 'var(--background-notice-default)';
const GREY = 'var(--border-neutral-highlighted)';
const QUIET = 'var(--text-neutral-subtle)';

interface Row {
  key: string;
  title: string;
  /** Its colour on the map. */
  color: string;
  stat?: LayerKey;
  count?: (d: Derived) => number;
  /** Newest-data age chip (live layers only; command/reference objects are authored). */
  age?: boolean;
  /** An operator layer: the row offers its details (review, withdraw). */
  layerId?: string;
}

interface Section {
  key: string;
  title: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    key: 'fused',
    title: 'Fused picture',
    rows: [
      { key: 'fused.threats', title: 'Air threats', color: RED, stat: 'fused.threats', age: true },
      { key: 'fused.groups', title: 'Raid groups', color: RED, stat: 'fused.groups', age: true },
      { key: 'fused.contested', title: 'Contested entities', color: AMBER, count: (d) => d.contested },
      { key: 'fused.blue', title: 'Blue force', color: BLUE, stat: 'fused.blue', age: true },
      { key: 'fused.civil', title: 'Civil air', color: GREY, stat: 'fused.civil', age: true },
      { key: 'fused.maritime', title: 'Maritime (AIS)', color: GREY, stat: 'fused.maritime', age: true },
    ],
  },
  {
    key: 'observation',
    title: 'Observations',
    rows: [
      { key: 'observation.fragments', title: 'Intel fragments', color: RED, stat: 'observation.fragments', age: true },
      { key: 'observation.plots', title: 'Sensor plots', color: QUIET, stat: 'observation.plots', age: true },
    ],
  },
  {
    key: 'command',
    title: 'Command',
    rows: [
      { key: 'command.operator', title: 'Operator objects', color: AMBER, stat: 'command.operator' },
      { key: 'command.rings', title: 'Rings R4–R1', color: QUIET, stat: 'command.rings' },
      { key: 'command.wcs', title: 'Weapons control', color: AMBER, stat: 'command.wcs' },
      { key: 'command.restrictions', title: 'Civil restrictions', color: GREY, stat: 'command.restrictions' },
      { key: 'command.softkill', title: 'Soft-kill areas', color: QUIET, stat: 'command.softkill' },
      { key: 'command.pickets', title: 'Interceptor pickets', color: GREY, stat: 'command.pickets' },
      { key: 'command.aimpoints', title: 'Aimpoints · debris', color: RED, stat: 'command.aimpoints' },
      { key: 'command.axes', title: 'Axes', color: RED, stat: 'command.axes' },
    ],
  },
  {
    key: 'reference',
    title: 'Reference',
    rows: [{ key: 'reference.vp', title: 'VA/VP · plant units', color: AMBER, stat: 'reference.vp' }],
  },
  {
    key: 'display',
    title: 'Display',
    rows: [
      { key: 'event.engagements', title: 'Engagements', color: RED },
      { key: 'track.trails', title: 'Trails', color: QUIET },
      { key: 'track.leaders', title: 'Speed leaders', color: QUIET },
      { key: 'track.labels', title: 'Labels', color: QUIET },
    ],
  },
];

export function LayerList({ derived }: { derived: Derived }) {
  const client = useClient();
  const view = useViewStore();
  const layers = useView((s) => s.layers);
  const [q, setQ] = useState('');
  // The layer dialog: a new layer (id null) or one to review and withdraw.
  const [dialog, setDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const query = q.trim().toLowerCase();
  // "Operator objects" counts drawn objects in no layer; each operator layer follows it.
  const counts = operatorObjectCounts(client);
  const withOperatorLayers = SECTIONS.map((sec) =>
    sec.key !== 'command'
      ? sec
      : {
          ...sec,
          rows: sec.rows.flatMap((r): Row[] =>
            r.key !== 'command.operator'
              ? [r]
              : [
                  { ...r, count: () => counts.get(null) ?? 0 },
                  ...operatorLayers(client.entities.values()).map((l) => ({
                    key: operatorLayerKey(l.entity_id),
                    title: l.aliases?.name ?? l.entity_id,
                    color: toneCss(layerTone(l.entity_id)),
                    count: () => counts.get(l.entity_id) ?? 0,
                    layerId: l.entity_id,
                  })),
                ],
          ),
        },
  );
  const sections = withOperatorLayers.map((sec) => ({
    ...sec,
    rows: sec.rows.filter((r) => !query || r.title.toLowerCase().includes(query) || sec.title.toLowerCase().includes(query)),
  })).filter((sec) => sec.rows.length);
  const isOn = (k: string) => layers[k] !== false;
  const setOn = (keys: string[], on: boolean) => {
    const next: Record<string, boolean> = { ...view.get().layers };
    for (const k of keys) next[k] = on;
    view.set({ layers: next });
  };

  return (
    <>
      <div className="bs-filter">
        <SearchInput size="Small" accessibilityLabel="Filter layers" placeholder="Search…" value={q} onChange={({ value }) => setQ(value ?? '')} onClearButtonClick={() => setQ('')} />
      </div>
      <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
        {!sections.length ? <p className="BodySmallRegular bs-muted bs-pad">{`No layer matches “${q.trim()}”.`}</p> : null}
        <div className="bs-ll" aria-label="Map layers">
          {sections.map((sec, i) => {
            return (
              <Fragment key={sec.key}>
                {i ? <Divider className="bs-divider" /> : null}
                <section className="bs-ll__sec" aria-label={sec.title}>
                  <div className="bs-ll__head">
                    <span className={`${typeClass('label')} bs-ellipsis`}>{sec.title}</span>
                  </div>
                  <ul className="bs-ll__rows">
                    {sec.rows.map((r) => {
                      const on = isOn(r.key);
                      return (
                        <li key={r.key} className={on ? 'bs-ll__row' : 'bs-ll__row bs-ll__row--off'}>
                          {/* The whole row is the toggle; the eye at its end shows the state. */}
                          <button type="button" className="bs-ll__hit" aria-pressed={on} aria-label={`${r.title}: ${on ? 'shown, click to hide' : 'hidden, click to show'}`} onClick={() => setOn([r.key], !on)}>
                            <span className="bs-ll__swatch" style={{ background: r.color }} aria-hidden />
                            <span className={`${typeClass('label', on ? 'normal' : 'muted')} bs-ellipsis bs-ll__name`} title={r.title}>
                              {r.title}
                            </span>
                            <RowTrailing row={r} derived={derived} />
                            <span className="bs-ll__icon" aria-hidden>
                              {on ? <Eye size={16} /> : <EyeOff size={16} />}
                            </span>
                          </button>
                          {r.layerId ? (
                            <Tooltip content="Layer details">
                              <IconButton data-bs-tip icon={Ellipsis} size="Small" accessibilityLabel={`${r.title} details`} onClick={() => setDialog({ open: true, id: r.layerId! })} />
                            </Tooltip>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </Fragment>
            );
          })}
        </div>
      </ScrollArea>
      <div className="bs-insp__foot">
        <Button size="sm" variant="secondary" tone="neutral" isFullWidth leadingIcon={<Plus size={14} />} onClick={() => setDialog({ open: true, id: null })}>
          New layer
        </Button>
      </div>
      <LayerEntryModal isOpen={dialog.open} layerId={dialog.id} onClose={() => setDialog({ open: false, id: null })} />
    </>
  );
}

function RowTrailing({ row, derived }: { row: Row; derived: Derived }) {
  const stat: LayerStat | undefined = row.stat ? derived.byKey[row.stat] : undefined;
  const count = row.count ? row.count(derived) : stat?.count;
  // Age shows only when it matters: aging, stale or disconnected. Current data carries none.
  const showAge = row.age && stat && stat.count > 0 && Number.isFinite(stat.newestAge) && stat.newestState !== 'current';
  if (count === undefined && !showAge) return null;
  return (
    <span className="bs-trail">
      {showAge ? <AgeBadge state={stat!.newestState} ageMs={stat!.newestAge} /> : null}
      {count !== undefined ? <span className={`${typeClass('caption', 'muted')} bs-num`} aria-label={`${count} ${row.title}`}>{count}</span> : null}
    </span>
  );
}

export function AgeBadge({ state, ageMs }: { state: AgeState; ageMs: number }) {
  return <Badge size="Small" color={AGE_BADGE[state]} emphasis="Subtle" label={ageLabel(ageMs, state)} />;
}
