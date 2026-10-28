/**
 * Layer list: FDS TreeView with cascading checkboxes (a section's checkbox shows or hides the
 * whole section), an icon per layer, and a trailing Counter, with a newest-data age Badge only
 * when that data is no longer current. Sections start collapsed; SearchInput filters the rows.
 * The operator's own layers sit under Command, each with its own toggle; "New layer" makes one
 * (OperatorLayers.tsx).
 */
import { useState, type ComponentType } from 'react';
import { Badge, Button, Counter, IconButton, ScrollArea, SearchInput, Tooltip, TreeView, TreeViewItem } from '@faclon-labs/fds';
import {
  ArrowUpRight,
  Ban,
  Boxes,
  CircleDashed,
  CircleHelp,
  Crosshair,
  Ellipsis,
  Factory,
  FileSearch,
  Layers,
  MoveRight,
  Plane,
  Plus,
  Radar,
  Route,
  Shield,
  Ship,
  Square,
  Swords,
  Tag,
  Target,
  Zap,
 PenLine } from 'lucide-react';
import type { AgeState } from '@me/schema';
import { useClient, useView, useViewStore } from '@me/map-react';
import { layerTone, operatorLayerKey, toneCss, type LayerKey, type OperatorTone } from '@me/map';
import type { Derived, LayerStat } from './derived.ts';
import { ageLabel, AGE_BADGE } from './age.ts';
import { LayerEntryModal, operatorLayers, operatorObjectCounts } from './OperatorLayers.tsx';

type Icon = ComponentType<{ size?: number | string }>;

interface Row {
  key: string;
  title: string;
  icon: Icon;
  stat?: LayerKey;
  count?: (d: Derived) => number;
  /** Newest-data age chip (live layers only; command/reference objects are authored). */
  age?: boolean;
  /** An operator layer: the row offers its details (review, withdraw). */
  layerId?: string;
  /** An operator layer: the colour its objects take on the map, shown on its icon. */
  tone?: OperatorTone;
}

interface Section {
  key: string;
  title: string;
  chip?: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    key: 'fused',
    title: 'Fused picture',
    chip: 'truth + noise',
    rows: [
      { key: 'fused.threats', title: 'Air threats', icon: Plane, stat: 'fused.threats', age: true },
      { key: 'fused.groups', title: 'Raid groups', icon: Boxes, stat: 'fused.groups', age: true },
      { key: 'fused.contested', title: 'Contested entities', icon: CircleHelp, count: (d) => d.contested },
      { key: 'fused.blue', title: 'Blue force', icon: Shield, stat: 'fused.blue', age: true },
      { key: 'fused.civil', title: 'Civil air', icon: Plane, stat: 'fused.civil', age: true },
      { key: 'fused.maritime', title: 'Maritime (AIS)', icon: Ship, stat: 'fused.maritime', age: true },
    ],
  },
  {
    key: 'observation',
    title: 'Observations',
    rows: [
      { key: 'observation.fragments', title: 'Intel fragments', icon: FileSearch, stat: 'observation.fragments', age: true },
      { key: 'observation.plots', title: 'Sensor plots', icon: Radar, stat: 'observation.plots', age: true },
    ],
  },
  {
    key: 'command',
    title: 'Command',
    rows: [
      { key: 'command.operator', title: 'Operator objects', icon: PenLine, stat: 'command.operator' },
      { key: 'command.rings', title: 'Rings R4–R1', icon: CircleDashed, stat: 'command.rings' },
      { key: 'command.wcs', title: 'Weapons control', icon: Crosshair, stat: 'command.wcs' },
      { key: 'command.restrictions', title: 'Civil restrictions', icon: Ban, stat: 'command.restrictions' },
      { key: 'command.softkill', title: 'Soft-kill areas', icon: Zap, stat: 'command.softkill' },
      { key: 'command.pickets', title: 'Interceptor pickets', icon: Square, stat: 'command.pickets' },
      { key: 'command.aimpoints', title: 'Aimpoints · debris', icon: Target, stat: 'command.aimpoints' },
      { key: 'command.axes', title: 'Axes', icon: ArrowUpRight, stat: 'command.axes' },
    ],
  },
  {
    key: 'reference',
    title: 'Reference',
    rows: [{ key: 'reference.vp', title: 'VA/VP · plant units', icon: Factory, stat: 'reference.vp' }],
  },
  {
    key: 'display',
    title: 'Display',
    rows: [
      { key: 'event.engagements', title: 'Engagements', icon: Swords },
      { key: 'track.trails', title: 'Trails', icon: Route },
      { key: 'track.leaders', title: 'Speed leaders', icon: MoveRight },
      { key: 'track.labels', title: 'Labels', icon: Tag },
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
                    icon: Layers,
                    count: () => counts.get(l.entity_id) ?? 0,
                    layerId: l.entity_id,
                    tone: layerTone(l.entity_id),
                  })),
                ],
          ),
        },
  );
  const sections = withOperatorLayers.map((sec) => ({
    ...sec,
    rows: sec.rows.filter((r) => !query || r.title.toLowerCase().includes(query) || sec.title.toLowerCase().includes(query)),
  })).filter((sec) => sec.rows.length);
  const shown = sections.flatMap((sec) => sec.rows.map((r) => r.key));
  const value = shown.filter((k) => layers[k] !== false);

  return (
    <>
      <div className="bs-filter">
        <SearchInput size="Small" accessibilityLabel="Filter layers" placeholder="Filter layers" value={q} onChange={({ value }) => setQ(value ?? '')} onClearButtonClick={() => setQ('')} />
      </div>
      <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
        {!sections.length ? <p className="BodySmallRegular bs-muted bs-pad">{`No layer matches “${q.trim()}”.`}</p> : null}
        <TreeView
          selectionType="multiple"
          size="Small"
          value={value}
          accessibilityLabel="Map layers"
          onChange={(ev) => {
            // Only rows on screen change; rows hidden by the filter keep their state.
            const next: Record<string, boolean> = { ...view.get().layers };
            for (const k of shown) next[k] = ev.values.includes(k);
            view.set({ layers: next });
          }}
        >
          {sections.map((sec) => (
            <TreeViewItem
              // Sections start collapsed, so their checkboxes come first; filtering opens them.
              key={query ? `${sec.key}:q` : sec.key}
              title={sec.title}
              value={sec.key}
              defaultIsExpanded={!!query}
              trailing={sec.chip ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={sec.chip} /> : undefined}
            >
              {sec.rows.map((r) => (
                <TreeViewItem
                  key={r.key}
                  title={r.title}
                  value={r.key}
                  leading={<r.icon size={12} {...(r.tone ? { color: toneCss(r.tone) } : {})} />}
                  trailing={<RowTrailing row={r} derived={derived} />}
                  {...(r.layerId
                    ? {
                        actions: (
                          <Tooltip content="Layer details">
                            <IconButton data-bs-tip icon={Ellipsis} size="Small" isHighlighted accessibilityLabel={`${r.title} details`} onClick={() => setDialog({ open: true, id: r.layerId! })} />
                          </Tooltip>
                        ),
                      }
                    : {})}
                />
              ))}
            </TreeViewItem>
          ))}
        </TreeView>
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
    <>
      {showAge ? <AgeBadge state={stat!.newestState} ageMs={stat!.newestAge} /> : null}
      {count !== undefined ? <Counter value={count} max={999} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${count} ${row.title}`} /> : null}
    </>
  );
}

export function AgeBadge({ state, ageMs }: { state: AgeState; ageMs: number }) {
  return <Badge size="Small" color={AGE_BADGE[state]} emphasis="Subtle" label={ageLabel(ageMs, state)} />;
}
