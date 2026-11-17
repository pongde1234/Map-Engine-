/**
 * Raid groups, largest first, as the app's one list row (FDS ActionListItem), like the Layers and Alerts lists:
 * the group's name over its axis and wave, and its track count at the end, the figure in the hostile colour (FDS
 * Metric). Selecting a row selects the group on the map and highlights its members.
 */
import { ActionList, ActionListItem, Metric } from '@faclon-labs/fds';
import type { Entity } from '@me/schema';
import { useViewStore } from '@me/map-react';
import { Section } from './Section.tsx';
import { axisWord } from './format.ts';
import { typeClass } from './type.ts';

export function RaidGroups({ groups }: { groups: Entity[] }) {
  const view = useViewStore();
  const size = (g: Entity) => g.group?.members.length ?? 0;
  const total = groups.reduce((a, g) => a + size(g), 0);
  return (
    <Section title="Raid groups" count={groups.length} {...(groups.length ? { trailing: <span className={`${typeClass('caption', 'muted')} bs-num`}>{total} tracks</span> } : {})}>
      {/* The section stays when the picture has no groups (before the raid, after the waves), and says so. */}
      {!groups.length ? <span className={typeClass('empty')}>No raid groups at this picture time</span> : (
        // Flush (ActionList R21), and our wrapper steps out by a row's own 8px inset, so the names line up with the
        // section heading and a row's hover wash reaches into the section's padding.
        <div className="bs-rg">
        <ActionList isFlush accessibilityLabel="Raid groups">
          {groups.map((g) => {
            const name = g.aliases?.name ?? g.entity_id;
            const where = [g.group?.axis && axisWord(g.group.axis), g.group?.wave].filter(Boolean).join(' · ');
            return (
              <ActionListItem
                key={g.entity_id}
                value={g.entity_id}
                title={name}
                {...(where ? { description: where } : {})}
                // The figure alone carries the colour; its unit steps down beside it.
                trailing={
                  <span className="bs-rg__fig">
                    <Metric type="Body" size="Large" weight="Semibold" value={size(g)} suffix="none" color="Negative" />
                    <span className={typeClass('caption', 'muted')}>tracks</span>
                  </span>
                }
                onClick={() => view.set({ selected: g.entity_id, locate: g.entity_id, highlight: g.group?.members ?? [] })}
              />
            );
          })}
        </ActionList>
        </div>
      )}
    </Section>
  );
}
