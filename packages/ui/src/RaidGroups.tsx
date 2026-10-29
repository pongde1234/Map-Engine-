/**
 * Raid groups, largest first, as number tiles in two columns: the group's track count first, in
 * the hostile colour (FDS Metric), then its name (one line; the full name on hover) and its axis
 * and wave. A tile is a button with no fill and a subtle border, every tile the same height;
 * selecting it selects the group on the map and highlights its members.
 */
import { Metric } from '@faclon-labs/fds';
import type { Entity } from '@me/schema';
import { useViewStore } from '@me/map-react';
import { Section } from './Section.tsx';
import { typeClass } from './type.ts';

export function RaidGroups({ groups }: { groups: Entity[] }) {
  const view = useViewStore();
  const size = (g: Entity) => g.group?.members.length ?? 0;
  const total = groups.reduce((a, g) => a + size(g), 0);
  return (
    <Section title="Raid groups" count={groups.length} {...(groups.length ? { trailing: <span className={`${typeClass('caption', 'muted')} bs-num`}>{total} tracks</span> } : {})}>
      {/* The section stays when the picture has no groups (before the raid, after the waves), and says so. */}
      {!groups.length ? <span className={typeClass('empty')}>No raid groups at this picture time</span> : (
      <div className="bs-rg" role="list" aria-label="Raid groups">
        {groups.map((g) => {
          const name = g.aliases?.name ?? g.entity_id;
          const where = [g.group?.axis, g.group?.wave].filter(Boolean).join(' · ');
          return (
            <div key={g.entity_id} role="listitem">
              <button
                type="button"
                className="bs-rg__tile"
                aria-label={`${name}${where ? `, ${where}` : ''}: ${size(g)} tracks`}
                onClick={() => view.set({ selected: g.entity_id, locate: g.entity_id, highlight: g.group?.members ?? [] })}
              >
                {/* The figure alone carries the colour; its unit, the name and the axis step down from it. */}
                <span className="bs-rg__fig">
                  <Metric type="Heading" size="Small" weight="Semibold" value={size(g)} suffix="none" color="Negative" />
                  <span className={typeClass('caption', 'muted')}>tracks</span>
                </span>
                <span className={`${typeClass('subhead')} bs-rg__name`} title={name}>
                  {name}
                </span>
                {where ? <span className={`${typeClass('caption', 'muted')} bs-num`}>{where}</span> : null}
              </button>
            </div>
          );
        })}
      </div>
      )}
    </Section>
  );
}
