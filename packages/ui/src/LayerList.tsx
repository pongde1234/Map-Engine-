/**
 * Layer list: FDS TreeView with cascading checkboxes (a section's checkbox shows or hides the
 * whole section), an icon per layer, and trailing newest-data age Badge + Counter. SearchInput
 * filters the rows.
 */
import { useState, type ComponentType } from 'react';
import { Badge, Counter, ScrollArea, SearchInput, TreeView, TreeViewItem } from '@faclon-labs/fds';
import {
  ArrowUpRight,
  Ban,
  Boxes,
  CircleDashed,
  CircleHelp,
  Crosshair,
  Factory,
  FileSearch,
  MoveRight,
  Plane,
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
import { useView, useViewStore } from '@me/map-react';
import type { LayerKey } from '@me/map';
import type { Derived, LayerStat } from './derived.ts';
import { ageLabel, AGE_BADGE } from './age.ts';

type Icon = ComponentType<{ size?: number | string }>;

interface Row {
  key: string;
  title: string;
  icon: Icon;
  stat?: LayerKey;
  count?: (d: Derived) => number;
  /** Newest-data age chip (live layers only; command/reference objects are authored). */
  age?: boolean;
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
  const view = useViewStore();
  const layers = useView((s) => s.layers);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const sections = SECTIONS.map((sec) => ({
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
              key={sec.key}
              title={sec.title}
              value={sec.key}
              defaultIsExpanded={sec.key !== 'display' || !!query}
              trailing={sec.chip ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={sec.chip} /> : undefined}
            >
              {sec.rows.map((r) => (
                <TreeViewItem key={r.key} title={r.title} value={r.key} leading={<r.icon size={12} />} trailing={<RowTrailing row={r} derived={derived} />} />
              ))}
            </TreeViewItem>
          ))}
        </TreeView>
      </ScrollArea>
    </>
  );
}

function RowTrailing({ row, derived }: { row: Row; derived: Derived }) {
  const stat: LayerStat | undefined = row.stat ? derived.byKey[row.stat] : undefined;
  const count = row.count ? row.count(derived) : stat?.count;
  const showAge = row.age && stat && stat.count > 0 && Number.isFinite(stat.newestAge);
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
