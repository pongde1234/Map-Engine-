/**
 * Sources: sensors (status per sensor), feeds (rate, objects in the picture and status per
 * feed, neutral names only) and the journal this picture is replayed from. FDS ActionList with
 * its slot components (titleSuffix badges, trailing text). Selecting a sensor selects it.
 * Sources the operator registered sit in their section as planned; "New source" registers one
 * (SourceEntry.tsx).
 */
import { useState } from 'react';
import { ActionList, ActionListItem, ActionListItemBadge, ActionListItemIcon, ActionListItemText, ActionListSection, Button, ScrollArea } from '@faclon-labs/fds';
import { Database, Plus, Radar, Wifi, WifiOff } from 'lucide-react';
import type { AgeState, Entity } from '@me/schema';
import { useClient, useViewStore } from '@me/map-react';
import type { Derived } from './derived.ts';
import { ageLabel } from './age.ts';
import { useHealth } from './health.ts';
import { raidLabel, shortHash } from './format.ts';
import { SourceEntryModal, registeredSources, sourceSummary } from './SourceEntry.tsx';

/** A feed's state from the age of its newest update. */
const FEED_STATUS: Record<AgeState, { color: 'Positive' | 'Notice' | 'Negative'; label: string }> = {
  current: { color: 'Positive', label: 'UP' },
  aging: { color: 'Notice', label: 'AGING' },
  stale: { color: 'Negative', label: 'STALE' },
  disc: { color: 'Negative', label: 'DOWN' },
};

const SENSOR_STATUS = { up: { color: 'Positive', label: 'UP' }, degraded: { color: 'Notice', label: 'DEGRADED' }, down: { color: 'Negative', label: 'DOWN' } } as const;

const PLANNED = <ActionListItemBadge className="bs-tag" color="Neutral" emphasis="Subtle" label="PLANNED" />;

export function SourceList({ derived }: { derived: Derived }) {
  const client = useClient();
  const view = useViewStore();
  const health = useHealth();
  // The source dialog: a new source (id null) or one to review and withdraw.
  const [dialog, setDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const s = client.scenario;
  const clock = s?.clock;
  const sensors: Entity[] = [];
  for (const e of client.entities.values()) if (e.ontology?.template === 'sensor' && e.sensor) sensors.push(e);
  sensors.sort((a, b) => (a.aliases?.name ?? a.entity_id).localeCompare(b.aliases?.name ?? b.entity_id));
  const registered = registeredSources(client.entities.values());
  const plannedSensors = registered.filter((r) => r.src.kind === 'sensor');
  const plannedFeeds = registered.filter((r) => r.src.kind === 'feed');
  const plannedRow = ({ e, src }: (typeof registered)[number]) => (
    <ActionListItem
      key={e.entity_id}
      value={e.entity_id}
      title={e.aliases?.name ?? e.entity_id}
      description={`${sourceSummary(src)} · registered ${raidLabel(e.ingest_time, clock)}`}
      leading={<ActionListItemIcon icon={src.kind === 'sensor' ? Radar : Wifi} />}
      titleSuffix={PLANNED}
      onClick={() => setDialog({ open: true, id: e.entity_id })}
    />
  );
  const sensorCount = sensors.length + plannedSensors.length;
  const feedCount = derived.sources.length + plannedFeeds.length;

  return (
    <>
      <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
        <ActionList accessibilityLabel="Sources">
          {sensorCount ? (
          <ActionListSection title={`Sensors · ${sensorCount}`}>
            {sensors.map((e) => {
              const link = e.health?.link ?? e.sensor!.status;
              const st = SENSOR_STATUS[link];
              return (
                <ActionListItem
                  key={e.entity_id}
                  value={e.entity_id}
                  title={e.aliases?.name ?? e.entity_id}
                  description={`${e.sensor!.type.replaceAll('_', ' ')} · ${Math.round((e.sensor!.range_m ?? 0) / 1000)} km`}
                  leading={<ActionListItemIcon icon={link === 'down' ? WifiOff : Radar} />}
                  titleSuffix={<ActionListItemBadge className="bs-tag" color={st.color} emphasis="Subtle" label={st.label} />}
                  onClick={() => view.set({ selected: e.entity_id, locate: e.entity_id })}
                />
              );
            })}
            {plannedSensors.map(plannedRow)}
          </ActionListSection>
          ) : null}
          {feedCount ? (
          <ActionListSection title={`Feeds · ${feedCount}`}>
            {derived.sources.map((f) => {
              const st = f.planned ? { color: 'Neutral' as const, label: 'STATIC' } : FEED_STATUS[f.newestState];
              return (
                <ActionListItem
                  key={f.feed}
                  value={f.feed}
                  title={f.feed}
                  description={f.planned ? `${f.count} planned objects` : `${f.perMin}/min · ${f.count} in picture · newest ${ageLabel(f.newestAge, f.newestState).toLowerCase()}${f.linkIssues ? ` · ${f.linkIssues} link issues` : ''}`}
                  leading={<ActionListItemIcon icon={f.newestState === 'disc' && !f.planned ? WifiOff : Wifi} />}
                  titleSuffix={<ActionListItemBadge className="bs-tag" color={st.color} emphasis="Subtle" label={st.label} />}
                />
              );
            })}
            {plannedFeeds.map(plannedRow)}
          </ActionListSection>
          ) : null}
          <ActionListSection title="Journal">
            <ActionListItem
              value="journal"
              title={s ? `${s.id}-${s.seed}` : 'Journal'}
              description={health ? `${health.records.toLocaleString('en')} records · root ${shortHash(health.head.hash)}${health.operator?.records ? ` · ${health.operator.records} drawn` : ''}` : 'Checking…'}
              leading={<ActionListItemIcon icon={Database} />}
              {...(health ? { titleSuffix: <ActionListItemBadge className="bs-tag" color={health.chain.ok ? 'Positive' : 'Negative'} emphasis="Subtle" label={health.chain.ok ? 'VERIFIED' : 'BROKEN'} /> } : {})}
              trailing={<ActionListItemText>{health ? `${Math.round(health.records / 1000)}k` : '—'}</ActionListItemText>}
            />
          </ActionListSection>
        </ActionList>
      </ScrollArea>
      <div className="bs-insp__foot">
        <Button size="sm" variant="secondary" tone="neutral" isFullWidth leadingIcon={<Plus size={14} />} onClick={() => setDialog({ open: true, id: null })}>
          New source
        </Button>
      </div>
      <SourceEntryModal isOpen={dialog.open} sourceId={dialog.id} onClose={() => setDialog({ open: false, id: null })} />
    </>
  );
}
