/**
 * Received alerts and events (newest first): fragments, decisions, rule firings, engagements,
 * BDA. Only what has been received by the current time is listed (bitemporal). Filter by
 * severity (all · medium and up · high and up) and by type; each row carries its severity.
 * The operator's custom alerts sit above the feed; "New alert" sets one (AlertRules.tsx).
 */
import { useState } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListItemIcon,
  Button,
  DropdownMenu,
  DropdownMenuOverlay,
  DropdownMenuTrigger,
  ScrollArea,
} from '@faclon-labs/fds';
import { BellPlus, ChevronDown, Crosshair, FileSearch, Gavel, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react';
import type { JournalRecord } from '@me/schema';
import { useClient, useEvents, useView, useViewStore } from '@me/map-react';
import { eventSummary, raidLabel } from './format.ts';
import { ALERT_TYPES, SEVERITY_RANK, severityOf, type Severity } from './severity.ts';
import { AlertRuleModal, CustomAlertList } from './AlertRules.tsx';

const ICON = {
  fragment: FileSearch,
  decision: Gavel,
  rule_fire: TriangleAlert,
  engagement: Crosshair,
  bda: ShieldAlert,
  correction: Wrench,
} as const;

const SEVERITY_FILTERS: Array<{ id: Severity; label: string; short: string }> = [
  { id: 'low', label: 'All', short: 'All' },
  { id: 'medium', label: 'Medium and up', short: 'Medium+' },
  { id: 'high', label: 'High and up', short: 'High+' },
];

// Low carries no tag: routine traffic stays quiet and the tagged rows stand out.
const SEVERITY_BADGE = { high: { color: 'Negative', label: 'HIGH' }, medium: { color: 'Notice', label: 'MEDIUM' } } as const;

interface Filter {
  min: Severity;
  /** Type ids shown; empty = all. */
  types: string[];
}

const KEY = 'bs-alerts-filter';

/** The filter is a per-viewer convenience: remembered in this browser, never required. */
function useAlertFilter(): [Filter, (f: Filter) => void] {
  const [f, setF] = useState<Filter>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Filter | null;
      if (v && v.min in SEVERITY_RANK && Array.isArray(v.types)) return v;
    } catch {
      /* storage blocked or empty: use the default */
    }
    return { min: 'low', types: [] };
  });
  const set = (next: Filter) => {
    setF(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* not remembered this time */
    }
  };
  return [f, set];
}

export function EventFeed({ limit = 200 }: { limit?: number }) {
  const client = useClient();
  const events = useEvents();
  const view = useViewStore();
  const selected = useView((s) => s.selected);
  const [filter, setFilter] = useAlertFilter();
  // The custom-alert dialog: a new alert (id null) or one to review and withdraw.
  const [alertDialog, setAlertDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const types = filter.types.length ? ALERT_TYPES.filter((x) => filter.types.includes(x.id)) : null;
  const floor = SEVERITY_RANK[filter.min];
  const list: Array<{ r: JournalRecord; sev: Severity }> = [];
  let received = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const r = events[i]!;
    // Engagement noise: launches are implied by the assignment and the result.
    if (r.kind === 'engagement' && (r.payload as { result: string }).result === 'launched') continue;
    received++;
    if (types && !types.some((x) => x.kinds.includes(r.kind) && (!x.match || x.match(r)))) continue;
    const sev = severityOf(r);
    if (SEVERITY_RANK[sev] < floor) continue;
    if (list.length < limit) list.push({ r, sev });
  }
  const clock = client.scenario?.clock;
  const sev = SEVERITY_FILTERS.find((x) => x.id === filter.min)!;
  const typeLabel = filter.types.length === 0 ? 'All types' : filter.types.length === 1 ? ALERT_TYPES.find((x) => x.id === filter.types[0])!.label : `${filter.types.length} types`;

  return (
    <>
      <div className="bs-feedbar">
        <DropdownMenu selectionType="single" value={[filter.min]} onChange={({ values }) => values[0] && setFilter({ ...filter, min: values[0] as Severity })}>
          <DropdownMenuTrigger>
            <Button size="xs" variant="secondary" tone="neutral" trailingIcon={<ChevronDown size={14} />} aria-label={`Severity: ${sev.label}`}>
              {sev.short}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="bottom-start">
            <ActionList accessibilityLabel="Severity">
              {SEVERITY_FILTERS.map((x) => (
                <ActionListItem key={x.id} value={x.id} title={x.label} />
              ))}
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
        <DropdownMenu selectionType="multiple" value={filter.types} onChange={({ values }) => setFilter({ ...filter, types: values })}>
          <DropdownMenuTrigger>
            <Button size="xs" variant="secondary" tone="neutral" trailingIcon={<ChevronDown size={14} />} aria-label={`Alert types: ${typeLabel}`}>
              {typeLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="bottom-start">
            <ActionList accessibilityLabel="Alert types">
              {ALERT_TYPES.map((x) => (
                <ActionListItem key={x.id} value={x.id} title={x.label} leading={<ActionListItemIcon icon={x.id === 'custom' ? BellPlus : (ICON[x.kinds[0] as keyof typeof ICON] ?? FileSearch)} />} />
              ))}
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
      </div>
      <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
        <CustomAlertList onOpen={(id) => setAlertDialog({ open: true, id })} />
        {list.length ? (
          <ActionList accessibilityLabel="Received alerts and events">
            {list.map(({ r, sev }) => {
              const s = eventSummary(r);
              const badge = sev === 'low' ? undefined : SEVERITY_BADGE[sev];
              return (
                <ActionListItem
                  key={r.record_id}
                  value={r.record_id}
                  title={s.title}
                  // The time leads the second line, so the title and its tag keep the row's width.
                  description={s.detail ? `${raidLabel(r.ingest_time, clock)} · ${s.detail}` : raidLabel(r.ingest_time, clock)}
                  isSelected={!!s.subject && s.subject === selected}
                  intent={r.kind === 'rule_fire' && sev === 'high' ? 'negative' : undefined}
                  {...(r.kind === 'rule_fire' && sev === 'high' ? { className: 'bs-alert--high' } : {})}
                  leading={<ActionListItemIcon icon={ICON[r.kind as keyof typeof ICON] ?? FileSearch} />}
                  {...(badge ? { titleSuffix: <ActionListItemBadge className="bs-tag" size="Small" color={badge.color} emphasis="Subtle" label={badge.label} /> } : {})}
                  onClick={() => s.subject && view.set({ selected: s.subject, locate: s.subject })}
                />
              );
            })}
          </ActionList>
        ) : (
          <p className="BodySmallRegular bs-muted bs-pad">{received ? 'No alerts match the filter.' : 'No alerts received yet.'}</p>
        )}
      </ScrollArea>
      <div className="bs-insp__foot">
        <Button size="sm" variant="secondary" tone="neutral" isFullWidth leadingIcon={<BellPlus size={14} />} onClick={() => setAlertDialog({ open: true, id: null })}>
          New custom alert
        </Button>
      </div>
      <AlertRuleModal isOpen={alertDialog.open} alertId={alertDialog.id} onClose={() => setAlertDialog({ open: false, id: null })} />
    </>
  );
}
