/**
 * Raid groups, largest first: one ActionList row each — the name, its axis and wave beneath, and
 * on the right the track count with a meter for its share of all tracks in the groups.
 * Selecting a row selects the group on the map and highlights its members.
 */
import { ActionList, ActionListItem, ProgressBar } from '@faclon-labs/fds';
import type { Entity } from '@me/schema';
import { useViewStore } from '@me/map-react';
import { Section } from './Section.tsx';

export function RaidGroups({ groups }: { groups: Entity[] }) {
  const view = useViewStore();
  if (!groups.length) return null;
  const size = (g: Entity) => g.group?.members.length ?? 0;
  const total = groups.reduce((a, g) => a + size(g), 0);
  return (
    <Section title="Raid groups" count={groups.length} trailing={<span className="BodyXSmallRegular bs-muted bs-num">{total} tracks</span>}>
      <ActionList accessibilityLabel="Raid groups">
        {groups.map((g) => (
          <ActionListItem
            key={g.entity_id}
            value={g.entity_id}
            title={g.aliases?.name ?? g.entity_id}
            titleSuffix={<span className="BodyXSmallRegular bs-muted bs-num bs-rg__sfx">{[g.group?.axis, g.group?.wave].filter(Boolean).join(' · ')}</span>}
            trailing={
              <span className="bs-rg__end">
                <ProgressBar type="meter" size="Large" accessibilityLabel={`${g.aliases?.name ?? g.entity_id} share of tracks`} value={size(g)} max={total || 1} color="Negative" />
                <span className="BodySmallMedium bs-num" aria-label={`${size(g)} tracks`}>
                  {size(g)}
                </span>
              </span>
            }
            onClick={() => view.set({ selected: g.entity_id, highlight: g.group?.members ?? [] })}
          />
        ))}
      </ActionList>
    </Section>
  );
}
