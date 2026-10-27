/**
 * Rules fired now: one ActionList row each — the rule's name and its figure against its limit
 * ("5 / 4"), written as the fire units' figures are. Selecting a row selects the first subject on
 * the map.
 */
import { ActionList, ActionListItem } from '@faclon-labs/fds';
import type { JournalRecord, RuleFirePayload } from '@me/schema';
import { useClient, useViewStore } from '@me/map-react';
import { ruleParts } from './format.ts';
import { Section } from './Section.tsx';

export function RulesFired({ rules }: { rules: Array<JournalRecord<RuleFirePayload>> }) {
  const client = useClient();
  const view = useViewStore();
  if (!rules.length) return null;
  return (
    <Section title="Rules fired" count={rules.length}>
      <ActionList accessibilityLabel="Rules fired">
        {rules.map((r) => {
          const fence = r.payload.rule === 'geofence' ? client.entities.get(r.payload.rule_id.slice('geofence:'.length)) : undefined;
          const { name, value, threshold } = ruleParts(r.payload, fence?.aliases?.name);
          const subject = r.payload.subject_ids[0];
          return (
            <ActionListItem
              key={r.record_id}
              value={r.record_id}
              title={name}
              {...(value !== undefined
                ? {
                    trailing: (
                      <span className="BodySmallMedium bs-num" aria-label={threshold !== undefined ? `${value} against a limit of ${threshold}` : `${value}`}>
                        {value}
                        {threshold !== undefined ? <span className="BodyXSmallRegular bs-muted"> / {threshold}</span> : null}
                      </span>
                    ),
                  }
                : {})}
              {...(subject ? { onClick: () => view.set({ selected: subject }) } : {})}
            />
          );
        })}
      </ActionList>
    </Section>
  );
}
