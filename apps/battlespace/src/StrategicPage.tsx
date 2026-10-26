/**
 * Strategic View (storyboard A4): decision authority at the indication stage.
 *   - Role and authority rail: L1–L5, the decisions each owns, view as a level.
 *   - Current plan · New event (the indication thread, revisions, unassociated reports) ·
 *     Impact · Suggested next actions for the selected role (staged, not tasked).
 *   - The same indication at L3, L2 and L1: each level's plan, the change and the decisions
 *     it owns; what this view may not read is said, never shown.
 *   - Record: the prior DP-0 package and what was carried under it, the DP-2 option (L1 view
 *     only, never selectable), every decision with role, person, time and inputs; Coverage:
 *     DP-0 to DP-12 with trigger, status and delegation.
 * Read-only: the page records nothing. Humans set the rules in advance. FDS components only.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListItemBadgeGroup,
  ActionListItemText,
  ActionListSection,
  Badge,
  Button,
  Card,
  Divider,
  DropdownMenu,
  DropdownMenuOverlay,
  DropdownMenuTrigger,
  EmptyState,
  ProgressBar,
  Radio,
  RadioGroup,
  ScrollArea,
  Spinner,
  Stepper,
  StepperItem,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
} from '@faclon-labs/fds';
import { ChevronDown, Map as MapIcon, MapPinned, MessageSquare } from 'lucide-react';
import { formatZulu, type JournalRecord, type RaidClock } from '@me/schema';
import { formatBearing, formatDistance } from '@me/geo';
import { useClient, useClientTick, useEngineTime, useView, useViewStore } from '@me/map-react';
import {
  DECISION_POINTS,
  Facts,
  LAYERS,
  PACKAGE_DELEGATIONS,
  groupConsequences,
  raidLabel,
  shortHash,
  strategicPicture,
  useDerived,
  type Action,
  type DecisionItem,
  type Indication,
  type Layer,
} from '@me/ui';
import type { Presenter } from './presenter.ts';

type BadgeColor = 'Positive' | 'Notice' | 'Negative' | 'Neutral' | 'Information';

const CONF_COLOR: Record<string, BadgeColor> = {
  confirmed: 'Negative',
  likely: 'Notice',
  possible: 'Information',
  doubtful: 'Neutral',
};
const STATUS_COLOR: Record<string, BadgeColor> = {
  approved: 'Positive',
  delegated: 'Notice',
  executed: 'Neutral',
  proposed: 'Information',
  option: 'Neutral',
  rejected: 'Negative',
};
const ACTION: Record<Action['state'], { color: BadgeColor; label: string }> = {
  done: { color: 'Positive', label: 'DONE' },
  due: { color: 'Negative', label: 'DUE' },
  review: { color: 'Notice', label: 'REVIEW' },
  open: { color: 'Neutral', label: 'OPEN' },
};
const ROLE_OF_LAYER: Partial<Record<Layer, string>> = {
  L1: 'l1',
  L2: 'l2',
  L3: 'l3',
  L4: 'ril',
};
/** Raid-clock time; days out (a bare "D-3") also carry the Zulu time. */
function stamp(ms: number, clock: RaidClock | undefined): string {
  const l = raidLabel(ms, clock);
  return l.startsWith('D') ? `${l} ${formatZulu(ms).slice(0, 5)}Z` : l;
}

const LADDER_STEP: Record<string, string> = {
  L3: 'L3 reviews and elevates',
  L2: 'L2 assesses posture',
  L1: 'L1 national posture',
};

/** Records derived from a decision, as this identity may read them at t (REST, same origin). */
function useConsequences(recordId: string | undefined, t: number, role: string): JournalRecord[] {
  const [records, setRecords] = useState<JournalRecord[]>([]);
  const minute = Math.floor(t / 60_000);
  useEffect(() => {
    if (!recordId) {
      setRecords([]);
      return;
    }
    const ctl = new AbortController();
    fetch(`/api/consequences/${encodeURIComponent(recordId)}?t=${(minute + 1) * 60_000}&role=${role}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((rs: JournalRecord[]) => setRecords(rs.filter((r) => r.ingest_time <= t)))
      .catch(() => {});
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, minute, role]);
  return records;
}

/** Below 1600 px the rail shows titles only (plan v1: compact 1280–1600). */
function useCompact(): boolean {
  const q = '(max-width: 1599px)';
  const [compact, setCompact] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setCompact(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return compact;
}

export function StrategicPage({ presenter, onOpenOnMap, onAsk }: { presenter: Presenter; onOpenOnMap: (id: string | null, highlight?: string[]) => void; onAsk: (question: string) => void }) {
  const client = useClient();
  const view = useViewStore();
  const tick = useClientTick(500);
  const t = useEngineTime(1000);
  const derived = useDerived(1000);
  const selected = useView((v) => v.selected);
  const compact = useCompact();
  const role = client.identity?.role ?? 'l3';
  const clock = client.scenario?.clock;
  const [switching, setSwitching] = useState<string | null>(null);
  useEffect(() => {
    if (switching && client.identity?.role === switching) setSwitching(null);
  }, [switching, tick, client.identity?.role]);

  const fragmentIds = useMemo(() => new Set(client.events.filter((r) => r.kind === 'fragment').map((r) => r.entity_id)), [client, tick]);
  const indicationId = selected && fragmentIds.has(selected) ? selected : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p = useMemo(() => strategicPicture(client, derived, role, indicationId), [client, tick, Math.floor(t / 1000), role, indicationId, derived]);
  const dp1 = p.plan.find((d) => d.dp === 'DP-1') ?? p.dps.find((s) => s.def.dp === 'DP-1')?.latest ?? null;
  const carried = groupConsequences(useConsequences(p.dp0?.id, t, role));
  const activation = groupConsequences(useConsequences(p.layer === 'L1' ? dp1?.id : undefined, t, role).filter((r) => r.kind === 'fused'));

  const viewAs = (r: string) => {
    if (r === role) return;
    setSwitching(r);
    client.setRole(r);
  };
  const pick = (id: string) => view.set({ selected: id });
  const fragments = useMemo(() => {
    const latest = new Map<string, Indication>();
    for (const i of [...p.thread.items, ...p.thread.unassociated]) latest.set(i.entityId, i);
    return [...latest.values()].sort((a, b) => b.received - a.received);
  }, [p.thread]);
  const frame = presenter.current?.page === 'strategic' ? presenter.current : undefined;

  return (
    <div className="sv">
      <div className="sv__bar">
        <Badge size="Small" color="Information" emphasis="Subtle" label={`PICTURE ${clock ? raidLabel(t, clock) : ''} · ${formatZulu(t).slice(0, 5)}Z`} />
        <Badge size="Small" color="Neutral" emphasis="Subtle" label={`VIEW ${p.layer ?? 'NO LAYER'} · ${(client.identity?.display ?? role).toUpperCase()}`} />
        <Badge size="Small" color="Notice" emphasis="Intense" label="SYNTHETIC" />
        {frame ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={`${frame.id} · ${frame.caption ?? frame.label}`} /> : null}
        <span className="bs-fill" />
        <DropdownMenu selectionType="single" value={p.event ? [p.event.entityId] : []} onChange={({ values }) => values[0] && pick(values[0])}>
          <DropdownMenuTrigger>
            <Button size="xs" variant="secondary" tone="neutral" trailingIcon={<ChevronDown size={14} />} aria-label="Indication" isDisabled={!fragments.length}>
              {p.event ? `Indication ${p.event.entityId}` : 'No indication'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="bottom-end">
            <ActionList accessibilityLabel="Received indications">
              {fragments.map((i) => (
                <ActionListItem
                  key={i.entityId}
                  value={i.entityId}
                  title={`${i.entityId} · ${i.summary}`}
                  description={`${i.sensor} · received ${stamp(i.received, clock)}`}
                  titleSuffix={
                    <ActionListItemBadge
                      className="bs-tag"
                      size="Small"
                      color={i.associated ? (CONF_COLOR[i.confidence] ?? 'Neutral') : 'Neutral'}
                      emphasis="Subtle"
                      label={i.associated ? i.confidence.toUpperCase() : 'UNASSOCIATED'}
                    />
                  }
                />
              ))}
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
      </div>

      <aside className="sv__rail" aria-label="Role and authority rail">
        <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
          <div className="sv__railbody">
            <span className="BodyXSmallSemibold bs-muted">ROLE AND AUTHORITY</span>
            <Stepper orientation="vertical">
              {LAYERS.map((l) => {
                const owned = DECISION_POINTS.filter((d) => d.owners.includes(l.id));
                const due = p.dps.filter((s) => s.def.owners.includes(l.id) && !s.def.optionOnly && s.trigger.met === true && !s.records).length;
                const recorded = p.dps.filter((s) => s.def.owners.includes(l.id) && s.records > 0).length;
                const r = ROLE_OF_LAYER[l.id];
                return (
                  <StepperItem
                    key={l.id}
                    title={`${l.id} · ${l.name}`}
                    {...(compact
                      ? {}
                      : {
                          description: owned.length ? owned.map((d) => d.dp).join(' · ') : l.meaning,
                        })}
                    state={l.id === p.layer ? 'Brand' : due ? 'Negative' : recorded ? 'Positive' : 'Neutral'}
                    isSelected={l.id === p.layer}
                    isDisabled={!r}
                    {...(r && r !== role ? { onClick: () => viewAs(r) } : {})}
                    {...(switching === r
                      ? { trailing: <Spinner size="Medium" accessibilityLabel={`Opening the ${l.id} view`} /> }
                      : due
                        ? { trailing: <Badge size="Small" color="Negative" emphasis="Subtle" label={`${due} DUE`} /> }
                        : {})}
                  />
                );
              })}
            </Stepper>
            <span className="BodyXSmallRegular bs-muted">{p.layer ? 'Select a level to view as that identity.' : 'Planning staff own no decision point.'}</span>
          </div>
        </ScrollArea>
      </aside>

      <ScrollArea className="sv__main" viewportClassName="bs-scroll__viewport">
        <div className="sv__content">
          {/* Three summary cards share one row and one height; the event and the ladder run full width. */}
          <div className="sv__row3">
            <Card padding={12} size="Medium" accessibilityLabel="Current plan">
              <div className="tb-check">
                <div className="tb-check__head">
                  <span className="BodyXSmallSemibold">CURRENT PLAN</span>
                  <Badge className="bs-tag" size="Small" color="Positive" emphasis="Subtle" label={`${p.plan.length} IN FORCE`} />
                </div>
                {p.plan.length ? (
                  <ActionList accessibilityLabel="Decisions in force">
                    {p.plan.map((d) => (
                      <DecisionRow key={d.id} d={d} clock={clock} />
                    ))}
                  </ActionList>
                ) : (
                  <span className="BodySmallRegular bs-muted">No decision in force in this view.</span>
                )}
                {p.intent.length ? <Facts flush items={p.intent.map((s, i) => [i === 0 ? 'Intent, as recorded' : ' ', s, 'wide'])} /> : null}
              </div>
            </Card>

            <Card padding={12} size="Medium" accessibilityLabel="Impact">
              <div className="tb-check">
                <div className="tb-check__head">
                  <span className="BodyXSmallSemibold">IMPACT</span>
                  {p.impact?.atDefendedPoint ? <Badge className="bs-tag" size="Small" color="Negative" emphasis="Subtle" label="AT THE DEFENDED POINT" /> : null}
                </div>
                {p.impact ? (
                  <>
                    <Facts
                      flush
                      items={[
                        p.impact.rangeKm !== null && ['From the VP', `${formatDistance(p.impact.rangeKm * 1000)} · ${formatBearing(p.impact.bearing ?? 0)}`, 'wide'],
                        ['Bears on', p.impact.evidences.length ? p.impact.evidences.join(' · ') : 'No decision trigger', 'wide'],
                        ['Decided on it', p.impact.decidedOn.length ? p.impact.decidedOn.map((d) => `${d.dp} · ${d.author ?? d.authority ?? d.layer}`).join('; ') : 'No decision yet', 'wide'],
                        ['Evaluated branches', p.branches, 'wide'],
                      ]}
                    />
                    <ProgressBar
                      type="meter"
                      label={`Sensors up ${p.impact.readiness.sensorsUp} / ${p.impact.readiness.sensors}`}
                      value={p.impact.readiness.sensorsUp}
                      max={p.impact.readiness.sensors || 1}
                      color={p.impact.readiness.sensorsUp < p.impact.readiness.sensors ? 'Notice' : 'Positive'}
                    />
                    <ProgressBar
                      type="meter"
                      label={`Fire units ready ${p.impact.readiness.unitsReady} / ${p.impact.readiness.units}`}
                      value={p.impact.readiness.unitsReady}
                      max={p.impact.readiness.units || 1}
                      color={p.impact.readiness.unitsReady < p.impact.readiness.units ? 'Notice' : 'Positive'}
                    />
                  </>
                ) : (
                  <span className="BodySmallRegular bs-muted">Impact is read once an indication is received.</span>
                )}
              </div>
            </Card>

            <Card padding={12} size="Medium" accessibilityLabel="Suggested next actions">
              <div className="tb-check">
                <div className="tb-check__head">
                  <span className="BodyXSmallSemibold">SUGGESTED NEXT ACTIONS · {p.layer ?? '—'}</span>
                  <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label="STAGED, NOT TASKED" />
                </div>
                {p.actions.length ? (
                  <ActionList accessibilityLabel="Permitted actions">
                    {p.actions.map((a) => (
                      <ActionListItem
                        key={a.id}
                        value={a.id}
                        title={a.title}
                        description={a.detail}
                        titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={ACTION[a.state].color} emphasis="Subtle" label={ACTION[a.state].label} />}
                        {...(a.dp
                          ? {
                              trailing: <ActionListItemText>{a.dp}</ActionListItemText>,
                            }
                          : {})}
                      />
                    ))}
                  </ActionList>
                ) : (
                  <span className="BodySmallRegular bs-muted">No decisions owned at this view.</span>
                )}
                <span className="BodyXSmallRegular bs-muted">The view suggests; nothing is recorded or sent from here.</span>
              </div>
            </Card>
          </div>

          <Card padding={12} size="Medium" accessibilityLabel="New event">
            {p.event ? (
              <div className="tb-check">
                <div className="tb-check__head">
                  <span className="BodyXSmallSemibold">NEW EVENT · {p.event.entityId}</span>
                  <span className="bs-row">
                    {p.event.notional ? <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label="NOTIONAL" /> : null}
                    <Badge className="bs-tag" size="Small" color={CONF_COLOR[p.event.confidence] ?? 'Neutral'} emphasis="Subtle" label={p.event.confidence.toUpperCase()} />
                  </span>
                </div>
                <div className="sv__split">
                  <div className="sv__col">
                    <span className="BodySmallSemibold">{p.event.summary}</span>
                    <Facts
                      flush
                      items={[
                        ['Source', p.event.sensor, 'wide'],
                        ['Observed', stamp(p.event.observed, clock)],
                        ['Received', stamp(p.event.received, clock)],
                        p.event.ellipseKm && ['Uncertainty', `${p.event.ellipseKm[0].toFixed(0)} × ${p.event.ellipseKm[1].toFixed(0)} km`],
                        ['Association', p.event.associated ? 'Associated' : 'Not associated'],
                      ]}
                    />
                    <div className="sv__btns">
                      <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<MapPinned size={14} />} onClick={() => onOpenOnMap(p.event!.entityId)}>
                        Open
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        tone="neutral"
                        leadingIcon={<MapIcon size={14} />}
                        onClick={() =>
                          onOpenOnMap(
                            p.event!.entityId,
                            p.thread.items.map((i) => i.entityId),
                          )
                        }
                      >
                        Show thread on map
                      </Button>
                      <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<MessageSquare size={14} />} onClick={() => onAsk(`Explain ${p.event!.entityId}`)}>
                        Ask
                      </Button>
                    </div>

                    <Facts
                      flush
                      items={[
                        ...p.thread.revisions.map((r): [string, string, 'wide'] => [
                          `Revisions · ${r.entityId}`,
                          r.items.map((i) => `${i.confidence} · ${stamp(i.received, clock)}`).join('  →  '),
                          'wide',
                        ]),
                        [
                          'Disagreements',
                          p.thread.disagreements.length ? p.thread.disagreements.map((d) => `${d.entityId}: ${d.sources.join(' vs ')}`).join('; ') : 'None between sources on record',
                          'wide',
                        ],
                      ]}
                    />
                  </div>
                  <ActionList accessibilityLabel="Indication thread">
                    <ActionListSection title={`Supporting reports · ${p.thread.items.length}`}>
                      {p.thread.items.map((i) => (
                        <FragmentRow key={i.entityId} i={i} clock={clock} active={i.entityId === p.event?.entityId} onPick={pick} />
                      ))}
                    </ActionListSection>
                    {p.thread.unassociated.length ? (
                      <ActionListSection title={`Not associated · ${p.thread.unassociated.length}`}>
                        {p.thread.unassociated.map((i) => (
                          <FragmentRow key={i.entityId} i={i} clock={clock} active={i.entityId === p.event?.entityId} onPick={pick} />
                        ))}
                      </ActionListSection>
                    ) : null}
                  </ActionList>
                </div>
              </div>
            ) : (
              <div className="tb__empty">
                <EmptyState title="No indication received yet" description="Fragments appear here on receipt; later material stays hidden until it arrives." />
              </div>
            )}
          </Card>

          <Card padding={12} size="Medium" accessibilityLabel="Same indication at L3, L2 and L1">
            <div className="tb-check">
              <span className="BodyXSmallSemibold">SAME INDICATION AT L3 · L2 · L1</span>
              <Stepper orientation="horizontal">
                {p.ladder.map((c) => (
                  <StepperItem key={c.layer} title={LADDER_STEP[c.layer] ?? c.layer} state={c.layer === p.layer ? 'Brand' : 'Neutral'} isSelected={c.layer === p.layer} />
                ))}
              </Stepper>
              <div className="sv__ladder">
                {p.ladder.map((c) => (
                  <section key={c.layer} className="sv__level" aria-label={`${c.layer} view`}>
                    <div className="tb-check__head">
                      <span className="BodySmallSemibold bs-ellipsis">
                        {c.layer} · {c.name}
                      </span>
                      {c.layer === p.layer ? <Badge className="bs-tag" size="Small" color="Information" emphasis="Subtle" label="THIS VIEW" /> : null}
                    </div>
                    <span className="BodyXSmallRegular bs-muted">{c.duty}</span>
                    <Facts
                      flush
                      items={[
                        ['Its plan', c.plan.length ? c.plan.map((d) => d.dp).join(' · ') : 'None in force', 'wide'],
                        ['The change', c.change.length ? `${c.change.length} reports · newest ${c.change[0]!.entityId}` : 'Nothing releasable at this level', 'wide'],
                        c.layer === 'L1' && p.dp0?.author && ['CCS context', `Package approved by ${p.dp0.author}`, 'wide'],
                      ]}
                    />
                    <ActionList accessibilityLabel={`${c.layer} decisions`}>
                      {c.owns.map((o) => (
                        <ActionListItem
                          key={o.dp}
                          value={`${c.layer}-${o.dp}`}
                          title={`${o.dp} · ${o.decision}`}
                          titleSuffix={
                            <ActionListItemBadge
                              className="bs-tag"
                              size="Small"
                              color={STATUS_COLOR[o.status] ?? 'Neutral'}
                              emphasis="Subtle"
                              label={o.optionOnly && o.status === 'option' ? 'OPTION · NEVER SELECTED' : o.status.toUpperCase()}
                            />
                          }
                        />
                      ))}
                    </ActionList>
                    {c.layer === 'L1' && activation.length ? (
                      <Facts flush title="Service activation (DP-1)" items={activation.map((g): [string, string, 'wide'] => [g.group, g.items.map((x) => x.title).join(' · '), 'wide'])} />
                    ) : null}
                    {c.beyond.length ? <span className="BodyXSmallRegular bs-muted">Reads {c.beyond.join(', ')} material not releasable to this view.</span> : null}
                  </section>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </ScrollArea>

      <aside className="sv__record" aria-label="Decision record">
        <Tabs className="bs-tabs-fill" defaultValue="record" size="Small" variant="filled">
          <div className="bs-tabbar bs-tabbar--insp">
            <TabList>
              <TabItem value="record">Record</TabItem>
              <TabItem value="coverage">Coverage</TabItem>
            </TabList>
          </div>
          <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
            <TabPanel value="record">
              <section className="bs-stack bs-pad" aria-label="Decision record">
                {p.dp0 ? (
                  <Card padding={12} size="Medium" accessibilityLabel="DP-0 package">
                    <div className="tb-check">
                      <div className="tb-check__head">
                        <span className="BodySmallSemibold">DP-0 · Pre-delegation package</span>
                        <Badge className="bs-tag" size="Small" color={STATUS_COLOR[p.dp0.status] ?? 'Neutral'} emphasis="Intense" label={p.dp0.status.toUpperCase()} />
                      </div>
                      <div className="sv__sections">
                        <Facts
                          flush
                          items={[
                            ['Approved by', p.dp0.author ?? p.dp0.authority ?? p.dp0.layer, 'wide'],
                            ['Authority', p.dp0.authority ?? '—'],
                            ['On record', stamp(p.dp0.at, clock)],
                            ['Contents', p.dp0.summary, 'wide'],
                            ['Package changes', 'None pending; changes remain pending L1 approval', 'wide'],
                            ['Record', shortHash(p.dp0.hash)],
                          ]}
                        />
                        <Divider />
                        <Facts
                          flush
                          title="Delegation under the package · N, T unspecified"
                          items={PACKAGE_DELEGATIONS.map((dp): [string, string, 'wide'] => {
                            const d = DECISION_POINTS.find((x) => x.dp === dp)!;
                            return [`${d.dp} · ${d.decision}`, d.delegation, 'wide'];
                          })}
                        />
                        {carried.length ? (
                          <>
                            <Divider />
                            <Facts
                              flush
                              title="Carried under this package"
                              items={carried.map((g): [string, string, 'wide'] => [
                                `${g.group} · ${g.items.length}`,
                                g.items
                                  .map((x) => x.title)
                                  .slice(0, 6)
                                  .join(' · ') + (g.items.length > 6 ? ' …' : ''),
                                'wide',
                              ])}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                ) : (
                  <span className="BodySmallRegular bs-muted">No DP-0 record in this view.</span>
                )}

                {p.dp2 ? (
                  <Card padding={12} size="Medium" accessibilityLabel="DP-2 option">
                    <div className="tb-check">
                      <div className="tb-check__head">
                        <span className="BodySmallSemibold">DP-2 · Pre-emption / left-of-launch</span>
                        <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Intense" label="L1 ONLY · OPTION" />
                      </div>
                      <RadioGroup label="Recorded options" isDisabled size="Small">
                        {p.dp2Options.map((o) => (
                          <Radio key={o.id} value={o.id}>
                            {o.label}
                          </Radio>
                        ))}
                      </RadioGroup>
                      <Facts
                        flush
                        items={[
                          ['Presentation', 'Option only, never selected or executed', 'wide'],
                          ['On record', `${stamp(p.dp2.at, clock)} · ${p.dp2.author ?? p.dp2.authority ?? 'L1'}`, 'wide'],
                          ['Inputs', p.dp2.inputs.map((i) => i.title).join(' · ') || '—', 'wide'],
                        ]}
                      />
                    </div>
                  </Card>
                ) : null}

                <Card padding={12} size="Medium" accessibilityLabel="Every decision">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className="BodyXSmallSemibold">EVERY DECISION</span>
                      <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label={`${p.dps.filter((x) => x.latest).length} ON RECORD`} />
                    </div>
                    <span className="BodyXSmallRegular bs-muted">Role, person, time and inputs, newest first.</span>
                    <ActionList accessibilityLabel="Decisions on record">
                      {p.dps
                        .flatMap((s) => (s.latest ? [s.latest] : []))
                        .sort((a, b) => b.at - a.at)
                        .map((d) => (
                          <DecisionRow key={d.id} d={d} clock={clock} withInputs />
                        ))}
                    </ActionList>
                  </div>
                </Card>
              </section>
            </TabPanel>
            <TabPanel value="coverage">
              <ActionList accessibilityLabel="Decision-point coverage">
                {p.dps.map((s) => (
                  <ActionListItem
                    key={s.def.dp}
                    value={s.def.dp}
                    title={`${s.def.dp} · ${s.def.decision}`}
                    description={`${s.def.owner} · ${s.def.trigger}: ${s.trigger.note} · Delegation: ${s.def.delegation}`}
                    titleSuffix={
                      <ActionListItemBadgeGroup>
                        <ActionListItemBadge
                          className="bs-tag"
                          size="Small"
                          color={s.trigger.met === true ? 'Notice' : 'Neutral'}
                          emphasis="Subtle"
                          label={s.trigger.met === null ? 'N/A' : s.trigger.met ? 'MET' : 'NOT MET'}
                        />
                        <ActionListItemBadge
                          className="bs-tag"
                          size="Small"
                          color={s.latest ? (STATUS_COLOR[s.latest.status] ?? 'Neutral') : 'Neutral'}
                          emphasis="Subtle"
                          label={s.latest ? s.latest.status.toUpperCase() : 'NONE'}
                        />
                      </ActionListItemBadgeGroup>
                    }
                  />
                ))}
              </ActionList>
            </TabPanel>
          </ScrollArea>
        </Tabs>
        <div className="bs-insp__foot">
          <span className="BodyXSmallRegular bs-muted">Humans set the rules in advance. Decisions are recorded with role, person, time and inputs.</span>
        </div>
      </aside>
    </div>
  );
}

function DecisionRow({ d, clock, withInputs }: { d: DecisionItem; clock: RaidClock | undefined; withInputs?: boolean }) {
  const who = d.author ?? d.authority ?? d.layer;
  return (
    <ActionListItem
      value={d.id}
      title={`${d.dp} · ${d.title}`}
      description={`${stamp(d.at, clock)} · ${d.layer} · ${who}${withInputs && d.inputs.length ? ` · inputs: ${d.inputs.map((i) => i.title).join(', ')}` : ''}${d.earlier ? ` · ${d.earlier} earlier` : ''}`}
      titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={STATUS_COLOR[d.status] ?? 'Neutral'} emphasis="Subtle" label={d.status.toUpperCase()} />}
    />
  );
}

function FragmentRow({ i, clock, active, onPick }: { i: Indication; clock: RaidClock | undefined; active: boolean; onPick: (id: string) => void }) {
  return (
    <ActionListItem
      value={i.entityId}
      title={`${i.entityId} · ${i.summary}`}
      description={`${i.sensor} · received ${stamp(i.received, clock)}`}
      isSelected={active}
      isAction
      titleSuffix={
        <ActionListItemBadge
          className="bs-tag"
          size="Small"
          color={i.associated ? (CONF_COLOR[i.confidence] ?? 'Neutral') : 'Neutral'}
          emphasis="Subtle"
          label={i.associated ? i.confidence.toUpperCase() : 'UNASSOCIATED'}
        />
      }
      onClick={() => onPick(i.entityId)}
    />
  );
}
