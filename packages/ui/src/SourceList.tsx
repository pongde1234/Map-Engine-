/**
 * Sources: sensors (status per sensor), feeds (rate, objects in the picture and status per
 * feed, neutral names only) and the journal this picture is replayed from. FDS ActionList with
 * its slot components (titleSuffix badges, trailing text). Selecting a sensor selects it.
 */
import { ActionList, ActionListItem, ActionListItemBadge, ActionListItemIcon, ActionListItemText, ActionListSection, ScrollArea } from '@faclon-labs/fds';
import { Database, Radar, Wifi, WifiOff } from 'lucide-react';
import type { AgeState, Entity } from '@me/schema';
import { useClient, useViewStore } from '@me/map-react';
import type { Derived } from './derived.ts';
import { ageLabel } from './age.ts';
import { useHealth } from './health.ts';
import { shortHash } from './format.ts';

/** A feed's state from the age of its newest update. */
const FEED_STATUS: Record<AgeState, { color: 'Positive' | 'Notice' | 'Negative'; label: string }> = {
  current: { color: 'Positive', label: 'UP' },
  aging: { color: 'Notice', label: 'AGING' },
  stale: { color: 'Negative', label: 'STALE' },
  disc: { color: 'Negative', label: 'DOWN' },
};

const SENSOR_STATUS = { up: { color: 'Positive', label: 'UP' }, degraded: { color: 'Notice', label: 'DEGRADED' }, down: { color: 'Negative', label: 'DOWN' } } as const;

export function SourceList({ derived }: { derived: Derived }) {
  const client = useClient();
  const view = useViewStore();
  const health = useHealth();
  const s = client.scenario;
  const sensors: Entity[] = [];
  for (const e of client.entities.values()) if (e.ontology?.template === 'sensor' && e.sensor) sensors.push(e);
  sensors.sort((a, b) => (a.aliases?.name ?? a.entity_id).localeCompare(b.aliases?.name ?? b.entity_id));

  return (
    <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
      <ActionList accessibilityLabel="Sources">
        <ActionListSection title={`Sensors · ${sensors.length}`}>
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
                onClick={() => view.set({ selected: e.entity_id })}
              />
            );
          })}
        </ActionListSection>
        <ActionListSection title={`Feeds · ${derived.sources.length}`}>
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
        </ActionListSection>
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
  );
}
