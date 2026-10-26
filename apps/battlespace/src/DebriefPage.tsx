/**
 * Post-mission debrief (storyboard C1): "Protected Tier-1 units and a complete intelligence
 * record are the two outcomes to inspect."
 *   - Run tallies derived from the records, each beside the run manifest's figure.
 *   - Notional targets: plant-state history (prior beside revised), predicted aimpoint, BDA.
 *   - Accounting: every threat track by outcome, every engagement under its release token,
 *     every injected fragment (unassociated included), every BDA.
 *   - The thread behind a track: received fragment → assessment → DP record → approved envelope
 *     → task → engagement → BDA; a step the record does not link is shown empty.
 *   - DP-9 (restart or continued shutdown, RIL + L2), re-attack and attribution stay visible.
 * Read-only; counts come from the run. FDS components only.
 */
import { useMemo, useState } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListItemText,
  ActionListSection,
  Badge,
  Button,
  Card,
  Counter,
  EmptyState,
  Metric,
  ScrollArea,
  Stepper,
  StepperItem,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
} from '@faclon-labs/fds';
import { History, MapPinned } from 'lucide-react';
import { CLASSES, formatZulu, type RaidClock, type TrackOutcome } from '@me/schema';
import { useClient, useClientTick, useEngineTime, useLineage, useView } from '@me/map-react';
import { Facts, debriefOf, raidLabel, threadOf, useAccounting, useDerived, type Tally } from '@me/ui';
import type { Presenter } from './presenter.ts';

type BadgeColor = 'Positive' | 'Notice' | 'Negative' | 'Neutral' | 'Information';

const OUTCOME: Record<TrackOutcome, { label: string; color: BadgeColor }> = {
  destroyed: { label: 'DESTROYED', color: 'Positive' },
  deflected: { label: 'TURNED AWAY', color: 'Information' },
  withdrawn: { label: 'WITHDREW', color: 'Neutral' },
  leaked: { label: 'LEAKED', color: 'Negative' },
  'in flight': { label: 'IN FLIGHT', color: 'Notice' },
  'no outcome recorded': { label: 'NO OUTCOME', color: 'Negative' },
};
const OUTCOME_ORDER: TrackOutcome[] = ['leaked', 'no outcome recorded', 'in flight', 'destroyed', 'deflected', 'withdrawn'];
const DAMAGE_COLOR: Record<string, BadgeColor> = { none: 'Positive', light: 'Notice', moderate: 'Negative', severe: 'Negative', destroyed: 'Negative', 'no BDA': 'Neutral' };
const RESULT_COLOR: Record<string, BadgeColor> = { kill: 'Positive', assigned: 'Neutral', launched: 'Information', miss: 'Notice', refused: 'Negative', aborted: 'Neutral' };
const PLANT_WORD: Record<string, string> = { running: 'running', depressurised: 'depressurised', feed_isolated: 'feed isolated', shutdown: 'shut down', restart_assessment: 'restart assessment' };

/** Raid-clock time; days out also carry the Zulu time. */
function stamp(ms: number, clock: RaidClock | undefined): string {
  const l = raidLabel(ms, clock);
  return l.startsWith('D') ? `${l} ${formatZulu(ms).slice(0, 5)}Z` : l;
}

export function DebriefPage({ presenter, onOpenOnMap, onReplay }: { presenter: Presenter; onOpenOnMap: (id: string | null, highlight?: string[]) => void; onReplay: (from: number) => void }) {
  const client = useClient();
  const tick = useClientTick(500);
  const t = useEngineTime(1000);
  const derived = useDerived(1000);
  const selected = useView((v) => v.selected);
  const role = client.identity?.role ?? 'l3';
  const clock = client.scenario?.clock;
  const { accounting, at } = useAccounting(t, role);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => debriefOf(client, derived, accounting), [client, tick, derived, accounting]);
  const [picked, setPicked] = useState<string | null>(null);
  const trackIds = useMemo(() => new Set(d.tracks.map((x) => x.id)), [d.tracks]);
  // The thread opens on the operator's pick, else the selection, else the first engaged track.
  const trackId = picked ?? (selected && trackIds.has(selected) ? selected : (d.engagements.find((e) => trackIds.has(e.target))?.target ?? null));
  const frame = presenter.current?.page === 'debrief' ? presenter.current : undefined;
  const firstEngagement = d.engagements[0]?.at;
  const byOutcome = OUTCOME_ORDER.map((o) => ({ o, tracks: d.tracks.filter((x) => x.outcome === o) })).filter((g) => g.tracks.length);
  const byToken = useMemo(() => {
    const m = new Map<string, typeof d.engagements>();
    for (const e of d.engagements) m.set(e.token ?? 'No release token', [...(m.get(e.token ?? 'No release token') ?? []), e]);
    return [...m.entries()];
  }, [d.engagements]);
  const tallies: Tally[] = [...d.tallies.filter((x) => x.id !== 'flight' && x.id !== 'unrecorded'), d.tier1Hits, { id: 'tokens', label: 'Under a release token', recorded: d.withToken }];
  const flight = d.tallies.find((x) => x.id === 'flight')!.recorded;
  const unrecorded = d.tallies.find((x) => x.id === 'unrecorded')!.recorded;

  return (
    <div className="db">
      <div className="sv__bar">
        <Badge size="Small" color="Information" emphasis="Subtle" label={`PICTURE ${clock ? raidLabel(t, clock) : ''} · ${formatZulu(t).slice(0, 5)}Z`} />
        <Badge size="Small" color="Neutral" emphasis="Subtle" label={`VIEW ${(client.identity?.display ?? role).toUpperCase()}`} />
        <Badge size="Small" color="Notice" emphasis="Intense" label="SYNTHETIC" />
        <Badge size="Small" color="Neutral" emphasis="Subtle" label={d.run.toUpperCase()} />
        {frame ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={`${frame.id} · ${frame.caption ?? frame.label}`} /> : null}
        <span className="bs-fill" />
        <span className="BodyXSmallRegular bs-muted">{at !== null ? `Accounting as of ${raidLabel(at, clock)}` : 'Reading the run…'}</span>
        <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<History size={14} />} isDisabled={firstEngagement === undefined} onClick={() => firstEngagement !== undefined && onReplay(firstEngagement - 2 * 60_000)}>
          Replay the raid
        </Button>
      </div>

      <ScrollArea className="sv__main" viewportClassName="bs-scroll__viewport">
        <div className="sv__content">
          <div className="db__tiles" aria-label="Run outcomes">
            {tallies.map((x) => (
              <Card key={x.id} padding={12} size="Medium" accessibilityLabel={x.label}>
                <div className="tb-tile">
                  <div className="tb-tile__head">
                    <span className="BodyXSmallSemibold bs-ellipsis">{x.label.toUpperCase()}</span>
                    {x.run !== undefined ? (
                      <Badge className="bs-tag" size="Small" color={x.recorded === x.run ? 'Positive' : 'Notice'} emphasis="Subtle" label={x.recorded === x.run ? `RUN ${x.run} ✓` : `RUN ${x.run}`} />
                    ) : null}
                  </div>
                  <Metric type="Heading" size="Small" value={x.recorded} unit={x.id === 'tier1' ? 'units' : x.id === 'tokens' ? `of ${d.engagements.length} engagement records` : 'tracks'} suffix="none" color={x.id === 'leaked' && x.recorded ? 'Negative' : 'Neutral'} />
                  <span className="BodyXSmallRegular bs-muted bs-ellipsis">
                    {x.id === 'threats'
                      ? `${flight} in flight · ${unrecorded} with no outcome`
                      : x.id === 'tier1'
                        ? 'From BDA on Tier-1 units'
                        : x.id === 'tokens'
                          ? d.withToken === d.engagements.length ? 'Every engagement names its authority' : 'Engagements without an authority record'
                        : x.run !== undefined && x.recorded !== x.run
                          ? 'Recorded so far · run manifest beside it'
                          : 'Derived from the records'}
                  </span>
                </div>
              </Card>
            ))}
          </div>

          <Card padding={12} size="Medium" accessibilityLabel="Notional targets">
            <div className="tb-check">
              <div className="tb-check__head">
                <span className="BodyXSmallSemibold">NOTIONAL TARGETS · PROTECTED TIER-1 UNITS</span>
                <Badge className="bs-tag" size="Small" color={d.tier1Hits.recorded ? 'Negative' : 'Positive'} emphasis="Subtle" label={d.tier1Hits.recorded ? `${d.tier1Hits.recorded} TIER-1 HIT` : 'NO TIER-1 UNIT HIT'} />
              </div>
              {d.targets.length ? (
                <ActionList accessibilityLabel="Notional targets">
                  {d.targets.map((u) => (
                    <ActionListItem
                      key={u.id}
                      value={u.id}
                      title={`${u.id} · ${u.unit} · Tier ${u.tier}`}
                      description={[
                        u.history.map((h) => PLANT_WORD[h.state] ?? h.state).join(' → '),
                        u.aimpoint ? `${u.aimpoint.label.toLowerCase()}${u.aimpoint.tot ? ` · ToT ${raidLabel(u.aimpoint.tot, clock)}` : ''}` : null,
                        u.bda ? `BDA ${u.bda.target}: ${u.bda.summary}` : 'No BDA yet',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      titleSuffix={
                        <ActionListItemBadge
                          className="bs-tag"
                          size="Small"
                          color={DAMAGE_COLOR[u.damage] ?? 'Neutral'}
                          emphasis="Subtle"
                          label={u.damage === 'none' ? 'PROTECTED' : u.damage === 'no BDA' ? 'NO BDA' : `DAMAGE · ${u.damage.toUpperCase()}`}
                        />
                      }
                      trailing={<ActionListItemText>{u.history.length > 1 ? `${u.history.length} states` : '1 state'}</ActionListItemText>}
                      onClick={() => onOpenOnMap(u.id)}
                    />
                  ))}
                </ActionList>
              ) : (
                <span className="BodySmallRegular bs-muted">No plant record in this view.</span>
              )}
            </div>
          </Card>

          <Card padding={12} size="Medium" accessibilityLabel="Accounting">
            <div className="tb-check">
              <div className="tb-check__head">
                <span className="BodyXSmallSemibold">ACCOUNTING · EVERY TRACK, ENGAGEMENT AND FRAGMENT</span>
                <Badge className="bs-tag" size="Small" color={unrecorded ? 'Negative' : 'Positive'} emphasis="Subtle" label={unrecorded ? `${unrecorded} UNACCOUNTED` : 'ALL ACCOUNTED FOR'} />
              </div>
              <Tabs defaultValue="tracks" size="Small" variant="bordered">
                <TabList>
                  <TabItem value="tracks" trailing={<Counter value={d.tracks.length} max={999} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${d.tracks.length} tracks`} />}>
                    Tracks
                  </TabItem>
                  <TabItem value="engagements" trailing={<Counter value={d.engagements.length} max={999} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${d.engagements.length} engagement records`} />}>
                    Engagements
                  </TabItem>
                  <TabItem value="fragments" trailing={<Counter value={d.fragments.length} max={999} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${d.fragments.length} fragments`} />}>
                    Fragments
                  </TabItem>
                  <TabItem value="bda" trailing={<Counter value={d.bda.length} max={99} size="Small" color="Neutral" emphasis="Subtle" accessibilityLabel={`${d.bda.length} BDA records`} />}>
                    BDA
                  </TabItem>
                </TabList>
                <TabPanel value="tracks">
                  <ActionList accessibilityLabel="Threat tracks by outcome">
                    {byOutcome.map(({ o, tracks }) => (
                      <ActionListSection key={o} title={`${OUTCOME[o].label} · ${tracks.length}`}>
                        {tracks.map((x) => (
                          <ActionListItem
                            key={x.id}
                            value={x.id}
                            title={`${x.id} · ${CLASSES[x.cls]?.label ?? x.cls}`}
                            description={[x.axis, x.wave, `first seen ${raidLabel(x.firstT, clock)}`, x.reclassified.length ? `was ${x.reclassified.map((c) => CLASSES[c]?.abbr ?? c).join(', ')}` : null].filter(Boolean).join(' · ')}
                            isSelected={x.id === trackId}
                            isAction
                            titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={OUTCOME[x.outcome].color} emphasis="Subtle" label={OUTCOME[x.outcome].label} />}
                            trailing={<ActionListItemText>{raidLabel(x.outcomeT, clock)}</ActionListItemText>}
                            onClick={() => setPicked(x.id)}
                          />
                        ))}
                      </ActionListSection>
                    ))}
                  </ActionList>
                </TabPanel>
                <TabPanel value="engagements">
                  <ActionList accessibilityLabel="Engagements by release token">
                    {byToken.map(([token, rows]) => (
                      <ActionListSection key={token} title={`${token} · ${rows.length}`}>
                        {rows.map((e) => (
                          <ActionListItem
                            key={e.id}
                            value={e.id}
                            title={`${e.target} · ${e.effector}`}
                            description={e.weapon}
                            isAction
                            titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={RESULT_COLOR[e.result] ?? 'Neutral'} emphasis="Subtle" label={e.result.toUpperCase()} />}
                            trailing={<ActionListItemText>{raidLabel(e.at, clock)}</ActionListItemText>}
                            onClick={() => trackIds.has(e.target) && setPicked(e.target)}
                          />
                        ))}
                      </ActionListSection>
                    ))}
                  </ActionList>
                </TabPanel>
                <TabPanel value="fragments">
                  <ActionList accessibilityLabel="Every injected fragment">
                    {d.fragments.map((f) => (
                      <ActionListItem
                        key={f.recordId}
                        value={f.recordId}
                        title={`${f.entityId}${f.revision ? ` (revision ${f.revision})` : ''} · ${f.summary}`}
                        description={`${f.sensor} · received ${stamp(f.received, clock)} · ${f.usedBy.length ? `used by ${[...new Set(f.usedBy)].join(', ')}` : 'not used by a decision'}`}
                        isAction
                        titleSuffix={
                          <ActionListItemBadge className="bs-tag" size="Small" color={f.associated ? 'Information' : 'Neutral'} emphasis="Subtle" label={f.associated ? f.confidence.toUpperCase() : 'UNASSOCIATED'} />
                        }
                        onClick={() => onOpenOnMap(f.entityId)}
                      />
                    ))}
                  </ActionList>
                </TabPanel>
                <TabPanel value="bda">
                  {d.bda.length ? (
                    <ActionList accessibilityLabel="Battle-damage assessment">
                      {d.bda.map((b) => (
                        <ActionListItem
                          key={b.id}
                          value={b.id}
                          title={`${b.target} · ${b.summary}`}
                          description={`${b.sources ? `${b.sources} recorded sources` : 'No recorded source'} · received ${raidLabel(b.at, clock)}`}
                          titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={DAMAGE_COLOR[b.damage] ?? 'Neutral'} emphasis="Subtle" label={b.damage.toUpperCase()} />}
                        />
                      ))}
                    </ActionList>
                  ) : (
                    <span className="BodySmallRegular bs-muted">No BDA received yet.</span>
                  )}
                </TabPanel>
              </Tabs>
            </div>
          </Card>
        </div>
      </ScrollArea>

      <aside className="sv__record" aria-label="Thread and decisions">
        <Tabs className="bs-tabs-fill" defaultValue="thread" size="Small" variant="filled">
          <div className="bs-tabbar bs-tabbar--insp">
            <TabList>
              <TabItem value="thread">Thread</TabItem>
              <TabItem value="after">After the raid</TabItem>
            </TabList>
          </div>
          <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
            <TabPanel value="thread">
              <section className="bs-stack bs-pad" aria-label="Thread">
                {trackId ? <Thread trackId={trackId} clock={clock} onReplay={onReplay} onOpenOnMap={onOpenOnMap} /> : <EmptyState title="No track selected" description="Pick a track or an engagement to follow its thread." />}
              </section>
            </TabPanel>
            <TabPanel value="after">
              <section className="bs-stack bs-pad" aria-label="After the raid">
                <Card padding={12} size="Medium" accessibilityLabel="DP-9">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className="BodySmallSemibold">DP-9 · Restart or continued shutdown</span>
                      <Badge className="bs-tag" size="Small" color={d.dp9.status === 'due' ? 'Negative' : d.dp9.status === 'proposed' ? 'Information' : 'Neutral'} emphasis="Intense" label={d.dp9.status.toUpperCase()} />
                    </div>
                    <Facts
                      flush
                      items={[
                        ['Owner', d.dp9.owner],
                        ['Trigger', d.dp9.trigger.met ? 'Met' : 'Not met'],
                        ['Evidence', d.dp9.trigger.note, 'wide'],
                        ['Presentation', d.dp9.presentation, 'wide'],
                      ]}
                    />
                  </div>
                </Card>
                <Card padding={12} size="Medium" accessibilityLabel="Re-attack">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className="BodySmallSemibold">Re-attack</span>
                      <Badge className="bs-tag" size="Small" color={d.reattack.groups.length ? 'Negative' : 'Neutral'} emphasis="Subtle" label={d.reattack.groups.length ? 'IN THE PICTURE' : 'NONE IN THE PICTURE'} />
                    </div>
                    <Facts
                      flush
                      items={[
                        ...d.reattack.groups.map((g): [string, string] => [g.id, `${g.name} · ${g.members} tracks`]),
                        ['Reading', d.reattack.note, 'wide'],
                        ['Probability', 'Not estimated in this run', 'wide'],
                      ]}
                    />
                  </div>
                </Card>
                <Card padding={12} size="Medium" accessibilityLabel="Attribution">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className="BodySmallSemibold">Attribution</span>
                      <Badge className="bs-tag" size="Small" color="Notice" emphasis="Subtle" label="UNRESOLVED" />
                    </div>
                    <span className="BodySmallRegular">{d.attribution}</span>
                  </div>
                </Card>
              </section>
            </TabPanel>
          </ScrollArea>
        </Tabs>
        <div className="bs-insp__foot">
          <span className="BodyXSmallRegular bs-muted">Counts come from the run. A link the record does not make is shown empty, never filled in.</span>
        </div>
      </aside>
    </div>
  );
}

function Thread({ trackId, clock, onReplay, onOpenOnMap }: { trackId: string; clock: RaidClock | undefined; onReplay: (from: number) => void; onOpenOnMap: (id: string | null, highlight?: string[]) => void }) {
  const { records, loading } = useLineage(trackId);
  const steps = useMemo(() => threadOf(records, trackId), [records, trackId]);
  const linked = steps.filter((s) => s.records.length).length;
  const engagedAt = steps.find((s) => s.id === 'Engagement')?.records[0]?.at;
  return (
    <Card padding={12} size="Medium" accessibilityLabel={`Thread for ${trackId}`}>
      <div className="tb-check">
        <div className="tb-check__head">
          <span className="BodySmallSemibold">{trackId} · from first report to outcome</span>
          <Badge className="bs-tag" size="Small" color={linked === steps.length ? 'Positive' : 'Neutral'} emphasis="Subtle" label={loading ? 'READING' : `${linked} OF ${steps.length} LINKED`} />
        </div>
        <Stepper orientation="vertical">
          {steps.map((s) => (
            <StepperItem
              key={s.id}
              title={s.id}
              state={s.records.length ? 'Positive' : 'Neutral'}
              {...(s.records[0] ? { timestamp: raidLabel(s.records[0].at, clock) } : {})}
              description={s.records.length ? `${s.records.length} record${s.records.length === 1 ? '' : 's'}` : 'No recorded link'}
            >
              {s.records.length ? (
                <span className="sv__col">
                  {s.records.slice(0, 4).map((r) => (
                    <span key={r.id} className="BodyXSmallRegular bs-muted">
                      {r.title}
                    </span>
                  ))}
                  {s.records.length > 4 ? <span className="BodyXSmallRegular bs-muted">+{s.records.length - 4} more</span> : null}
                </span>
              ) : null}
            </StepperItem>
          ))}
        </Stepper>
        <div className="sv__btns">
          <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<MapPinned size={14} />} onClick={() => onOpenOnMap(trackId, [trackId])}>
            Open on map
          </Button>
          <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<History size={14} />} isDisabled={engagedAt === undefined} onClick={() => engagedAt !== undefined && onReplay(engagedAt - 2 * 60_000)}>
            Replay the engagement
          </Button>
        </div>
      </div>
    </Card>
  );
}
