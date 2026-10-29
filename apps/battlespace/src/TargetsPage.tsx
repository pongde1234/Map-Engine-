/**
 * Target board: a decision aid for the engagement chain at the picture time.
 *   - Situation strip: saturation (DP-7), leaker forecast (DP-6), who holds engagement
 *     authority, magazine depth, time to the first impact.
 *   - Board: seven stages, Nominated to Assessed, each column naming the gate a target passes
 *     to enter it; columns are subtractive by role. Cards carry the three gates
 *     (identification, doctrine, civilian harm), the countdown and what the target waits on.
 *   - Detail: Overview (release token: the named authority on the order) · Pairing (every fire
 *     unit through the gates; a gated option is never recommended) · Dossier (gates, the six
 *     admission checks of tasking, the checklist) · History.
 *   - With no target selected: the decision record and delegation console (storyboard B5).
 * The machine recommends; the record identifies the approving authority. FDS components only;
 * the composites are layout around them.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import {
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListSection,
  Badge,
  Button,
  Card,
  Counter,
  Divider,
  DropdownMenu,
  DropdownMenuOverlay,
  DropdownMenuTrigger,
  EmptyState,
  Metric,
  ProgressBar,
  ScrollArea,
  SearchInput,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
} from '@faclon-labs/fds';
import { ChevronDown, ListFilter, Map as MapIcon, MapPinned, X } from 'lucide-react';
import { formatZulu, type RaidClock } from '@me/schema';
import { useClient, useClientTick, useEngineTime, useView, useViewStore } from '@me/map-react';
import {
  Facts,
  STAGES,
  decisionBook,
  deriveTargets,
  eventSummary,
  raidLabel,
  shortHash,
  situationOf,
  useDerived,
  viewFor,
  type Check,
  type DecisionBook,
  type Envelope,
  type PairingOption,
  type ReleaseToken,
  type Stage,
  type Target,
  type ThreatKind,
  typeClass,
} from '@me/ui';
import { DEMO_FRAME, type Presenter } from './presenter.ts';

type BadgeColor = 'Positive' | 'Notice' | 'Negative' | 'Neutral' | 'Information';

const CHECK_COLOR: Record<Check['state'], BadgeColor> = { pass: 'Positive', pending: 'Neutral', fail: 'Negative' };
const CHECK_MARK: Record<Check['state'], string> = { pass: '✓', pending: '?', fail: '✕' };
const PRIORITY_COLOR = { P1: 'Negative', P2: 'Notice', P3: 'Neutral' } as const;
const IDENTITY_COLOR: Record<string, BadgeColor> = { hostile: 'Negative', suspect: 'Notice', unknown: 'Notice', pending: 'Neutral' };
const RESULT_COLOR: Record<string, BadgeColor> = { kill: 'Positive', destroyed: 'Positive', deflected: 'Information', withdrawn: 'Neutral', miss: 'Notice', leaked: 'Negative', impact: 'Negative' };
const KINDS: Array<{ id: ThreatKind; label: string }> = [
  { id: 'drone', label: 'Drones' },
  { id: 'fast', label: 'Fast movers' },
  { id: 'decoy', label: 'Decoys' },
];
/** What a stage waits on: the gate into the next one (the last stage is closed). */
function nextOf(id: Stage): string {
  const next = STAGES[STAGES.findIndex((x) => x.id === id) + 1];
  return next ? `Next: ${next.gate.charAt(0).toLowerCase()}${next.gate.slice(1)}` : 'Closed';
}

const etaColor = (min: number | undefined): BadgeColor => (min === undefined ? 'Neutral' : min <= 5 ? 'Negative' : min <= 15 ? 'Notice' : 'Neutral');
const minutes = (m: number) => `${Math.max(0, Math.round(m))} min`;
const check = (x: Target, id: string) => [...x.gates, ...x.admission].find((c) => c.id === id);

/** One line under the card: what the target waits on, or what happened. */
function statusLine(t: Target): string {
  switch (t.stage) {
    case 'nominated':
      return t.contested ? 'Identification contested' : 'Awaiting identification';
    case 'identified':
      return t.recommended ? `→ ${t.recommended.name} · ${t.recommended.toEnvelopeMin ? `envelope in ${minutes(t.recommended.toEnvelopeMin)}` : 'in envelope'}` : 'Outside the window';
    case 'prioritized':
      return t.saturated ? 'Saturated: no channel left' : check(t, 'doc')?.state === 'fail' ? 'Gated: refer to L3' : check(t, 'civ')?.state === 'fail' ? 'Civilian-harm gate holds' : 'No fire unit in reach';
    case 'paired':
      return t.recommended ? `→ ${t.recommended.name}${t.recommended.followOn ? `, then ${t.recommended.followOn}` : ''} · pending approval` : 'Pending approval';
    case 'approved':
      return t.token ? `${t.token.code} · ${t.token.authority}` : 'Order without a release token';
    case 'executing':
      return `Released by ${t.effector ?? 'fire unit'}${t.token ? ` · ${t.token.code}` : ''}`;
    case 'assessed':
      return t.result === 'kill' ? `Kill by ${t.effector ?? 'fire unit'}` : (t.result ?? 'Outcome recorded');
  }
}

/** The gate the target waits on next. */
function nextGate(t: Target): string {
  switch (t.stage) {
    case 'nominated':
      return 'Identification';
    case 'identified':
      return 'Time to VP';
    case 'prioritized':
      return 'Doctrine';
    case 'paired':
      return check(t, 'ladder')?.state === 'pass' ? 'Release token · L4/L5 under DP-7' : 'Release token · L3 approval';
    case 'approved':
      return 'Release by the fire unit';
    case 'executing':
      return 'Outcome';
    case 'assessed':
      return 'None: closed';
  }
}

export function TargetsPage({ presenter, onOpenOnMap }: { presenter: Presenter; onOpenOnMap: (id: string | null, highlight?: string[]) => void }) {
  const client = useClient();
  const view = useViewStore();
  const tick = useClientTick(500);
  const t = useEngineTime(1000);
  const derived = useDerived(1000);
  const [q, setQ] = useState('');
  const [axes, setAxes] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  // Opening from the map's "Nominate to board" lands on that target, and so does a storyboard
  // frame (B3, B4) stepped while the board is open; B5's frame clears it for the console.
  const viewSel = useView((v) => v.selected);
  const [sel, setSel] = useState<string | null>(viewSel);
  useEffect(() => setSel(viewSel), [viewSel]);
  const s = client.scenario;
  const center = (s?.center ?? [69.86, 22.36]) as [number, number];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const targets = useMemo(() => deriveTargets(client, t, center), [client, tick, Math.floor(t / 1000)]);
  const sit = situationOf(client, derived, targets);
  const book = decisionBook(client, sit);
  const board = viewFor(client.identity?.role);
  const columns = STAGES.filter((st) => board.stages.includes(st.id));
  const visible = targets.filter((x) => board.stages.includes(x.stage));
  const query = q.trim().toLowerCase();
  const shown = visible.filter(
    (x) =>
      (!axes.length || (x.axis && axes.includes(x.axis))) &&
      (!kinds.length || kinds.includes(x.kind)) &&
      (!query || `${x.ref} ${x.title} ${x.effector ?? ''} ${x.priority ?? ''} ${x.recommended?.name ?? ''} ${x.token?.code ?? ''}`.toLowerCase().includes(query)),
  );
  const selected = visible.find((x) => x.id === sel) ?? null;
  const select = (id: string) => {
    setSel(id);
    view.set({ selected: id });
  };
  const clockLabel = (ms: number) => (s ? raidLabel(ms, s.clock) : formatZulu(ms));
  // Before the raid the board is empty, so it shows the demo picture (frame B4, H-15) instead: the
  // picture moves to that time, as it does when the console opens. Never while the timeline plays
  // (a replay from the start runs through the empty board), and once per visit to the empty board.
  const demoFrame = presenter.bookmarks.find((b) => b.id === DEMO_FRAME);
  const empty = !!s && !targets.length;
  const sought = useRef(false);
  useEffect(() => {
    if (!empty) {
      sought.current = false;
      return;
    }
    if (sought.current || !demoFrame || client.clock.playing) return;
    sought.current = true;
    client.seek(demoFrame.t);
  }, [empty, demoFrame, client]);

  return (
    <div className="tb">
      <div className="tb__bar">
        <div className="tb__filter">
          <SearchInput accessibilityLabel="Filter targets" placeholder="Search…" value={q} onChange={({ value }) => setQ(value ?? '')} onClearButtonClick={() => setQ('')} size="Small" />
        </div>
        <DropdownMenu
          selectionType="multiple"
          value={[...axes.map((v) => `axis:${v}`), ...kinds.map((v) => `kind:${v}`)]}
          onChange={({ values }) => {
            setAxes(values.filter((v) => v.startsWith('axis:')).map((v) => v.slice(5)));
            setKinds(values.filter((v) => v.startsWith('kind:')).map((v) => v.slice(5)));
          }}
        >
          <DropdownMenuTrigger>
            <Button size="sm" variant="secondary" tone="neutral" leadingIcon={<ListFilter size={14} />} trailingIcon={<ChevronDown size={14} />} aria-label={`Filters${axes.length + kinds.length ? `, ${axes.length + kinds.length} on` : ''}`}>
              {axes.length + kinds.length ? `Filter · ${axes.length + kinds.length}` : 'Filter'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuOverlay placement="bottom-start">
            <ActionList accessibilityLabel="Filters">
              <ActionListSection title="Axis">
                <ActionListItem value="axis:NORTH" title="North axis" />
                <ActionListItem value="axis:WEST" title="West axis" />
              </ActionListSection>
              <ActionListSection title="Threat type">
                {KINDS.map((k) => (
                  <ActionListItem key={k.id} value={`kind:${k.id}`} title={k.label} />
                ))}
              </ActionListSection>
            </ActionList>
          </DropdownMenuOverlay>
        </DropdownMenu>
        <span className="bs-fill" />
        <span className="BodySmallRegular bs-muted bs-num">{shown.length === visible.length ? `${visible.length} targets` : `${shown.length} of ${visible.length} targets`}</span>
        {/* The identity's view is named only when it hides stages. */}
        {columns.length < STAGES.length ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={`VIEW ${board.label} · ${columns.length}/${STAGES.length} STAGES`} /> : null}
        <Badge size="Small" color="Information" emphasis="Subtle" label={`PICTURE ${s ? raidLabel(t, s.clock) : formatZulu(t).slice(0, 5)}`} />
        <Badge size="Small" color="Neutral" emphasis="Intense" label="SYNTHETIC" />
      </div>

      <SituationStrip sit={sit} clockLabel={clockLabel} consoleOpen={!selected} onShow={(id) => select(id)} onConsole={() => setSel(null)} />

      {!targets.length ? (
        <div className="tb__board tb__empty">
          <EmptyState title="No targets at this picture time" description="The board fills once the raid is in the picture." />
        </div>
      ) : (
        <ScrollArea axis="x" className="tb__board" viewportClassName="tb__board-viewport">
          <div className="tb__cols">
            {columns.map((st) => {
              const items = shown.filter((x) => x.stage === st.id);
              return (
                <section key={st.id} className="tb__col" aria-label={`${st.label}, ${items.length} targets`}>
                  {/* The stage and its count, then what it waits on; the cards scroll under it. */}
                  <div className="tb__colhead">
                    <span className="tb__coltitle">
                      <span className={typeClass('section')}>{st.label}</span>
                      <span className={`${typeClass('section')} bs-num`}>{items.length}</span>
                    </span>
                    <span className={`${typeClass('caption', 'muted')} tb__colgate`}>{nextOf(st.id)}</span>
                  </div>
                  <Divider className="bs-divider" />
                  <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
                    <div className="tb__cards">
                      {items.slice(0, 80).map((x) => (
                        <TargetCard key={x.id} x={x} isSelected={x.id === sel} onSelect={() => select(x.id)} />
                      ))}
                      {items.length > 80 ? <span className="BodySmallRegular bs-muted">{items.length - 80} more · filter to narrow</span> : null}
                      {!items.length ? <span className="BodySmallRegular bs-muted tb__none">{shown.length < visible.length ? 'None match the filter' : 'None at this time'}</span> : null}
                    </div>
                  </ScrollArea>
                </section>
              );
            })}
          </div>
        </ScrollArea>
      )}
      <aside className="tb__detail" aria-label={selected ? 'Target details' : 'Decision record'}>
        {selected ? <TargetDetail x={selected} onOpenOnMap={onOpenOnMap} onClose={() => setSel(null)} /> : <DecisionConsole book={book} clock={s?.clock} known={new Set(visible.map((x) => x.id))} onSelect={select} />}
      </aside>
    </div>
  );
}

/** The five things a watch officer reads first. */
function SituationStrip({
  sit,
  clockLabel,
  consoleOpen,
  onShow,
  onConsole,
}: {
  sit: ReturnType<typeof situationOf>;
  clockLabel: (ms: number) => string;
  consoleOpen: boolean;
  onShow: (id: string) => void;
  onConsole: () => void;
}) {
  const satOver = sit.saturation.hostileR3 > sit.saturation.channels;
  const leak = sit.leakers;
  const imp = sit.firstImpactMin;
  return (
    <div className="tb__strip" aria-label="Situation">
      <Card padding={0} size="Medium" accessibilityLabel="Saturation">
        <div className="tb-tile">
          <div className="tb-tile__head">
            <span className={typeClass('subhead')}>Saturation · R3</span>
            {sit.saturation.fired || satOver ? <Badge size="Small" color={sit.saturation.fired ? 'Negative' : 'Notice'} emphasis="Subtle" label={sit.saturation.fired ? 'RULE FIRED' : 'OVER'} /> : null}
          </div>
          <ProgressBar
            type="meter"
            label={`${sit.saturation.hostileR3} hostile / ${sit.saturation.channels} channels`}
            value={sit.saturation.hostileR3}
            max={Math.max(sit.saturation.channels, sit.saturation.hostileR3, 1)}
            color={satOver ? 'Negative' : sit.saturation.hostileR3 >= sit.saturation.channels * 0.8 ? 'Notice' : 'Information'}
          />
          <span className="BodySmallRegular bs-ink-secondary">{sit.saturation.busy} interceptor channels engaging</span>
        </div>
      </Card>
      <Card padding={0} size="Medium" accessibilityLabel="Leaker forecast">
        <div className="tb-tile">
          <div className="tb-tile__head">
            <span className={typeClass('subhead')}>Leaker forecast</span>
            {leak.fired ? <Badge size="Small" color="Negative" emphasis="Subtle" label="DP-6 TRIGGER" /> : null}
          </div>
          {leak.value !== null ? (
            <Metric type="Heading" size="Small" value={leak.value} unit={leak.threshold !== null ? `/ ${leak.threshold}` : 'forecast'} suffix="none" color="Neutral" />
          ) : (
            <span className={typeClass('row')}>No forecast yet</span>
          )}
          <span className={typeClass('caption', 'secondary')}>{leak.fired ? 'Above threshold: missile reserve release condition met' : 'Threshold set at DP-0'}</span>
        </div>
      </Card>
      <Card padding={0} size="Medium" accessibilityLabel="Engagement authority: open the delegation console" isSelected={consoleOpen} onClick={onConsole}>
        <div className="tb-tile">
          <div className="tb-tile__head">
            <span className={typeClass('subhead')}>Engagement authority</span>
            {sit.authority.delegated ? <Badge size="Small" color="Notice" emphasis="Subtle" label="DELEGATED" /> : null}
          </div>
          <span className={`${typeClass('row')} bs-ellipsis`}>{sit.authority.holder}</span>
          <span className="BodySmallRegular bs-muted bs-ellipsis">
            {sit.authority.dp ? `${sit.authority.dp} · ` : ''}
            {sit.authority.detail}
            {sit.authority.since ? ` · since ${clockLabel(sit.authority.since)}` : ''}
          </span>
        </div>
      </Card>
      <Card padding={0} size="Medium" accessibilityLabel="Magazines">
        <div className="tb-tile">
          <div className="tb-tile__head">
            <span className={typeClass('subhead')}>Magazines</span>
            {sit.magazines.atFloor ? <Badge size="Small" color="Negative" emphasis="Subtle" label={`${sit.magazines.atFloor} AT FLOOR`} /> : null}
          </div>
          <ProgressBar
            type="meter"
            label={`${sit.magazines.ready} / ${sit.magazines.capacity} rounds ready`}
            value={sit.magazines.ready}
            max={sit.magazines.capacity || 1}
            color={sit.magazines.atFloor ? 'Notice' : 'Positive'}
          />
          <span className="BodySmallRegular bs-ink-secondary">{sit.magazines.units} hard-kill units</span>
        </div>
      </Card>
      <Card padding={0} size="Medium" accessibilityLabel="Time to first impact" {...(sit.firstImpactRef ? { onClick: () => onShow(sit.firstImpactRef!) } : {})}>
        <div className="tb-tile">
          <div className="tb-tile__head">
            <span className={typeClass('subhead')}>First impact</span>
            {imp !== null ? <Badge size="Small" color={etaColor(imp)} emphasis="Subtle" label={`${sit.firstImpactRef ?? ''}${sit.firstImpactIdentity && sit.firstImpactIdentity !== 'hostile' ? ` · ${sit.firstImpactIdentity.toUpperCase()}` : ''}`} /> : null}
          </div>
          {imp !== null ? <Metric type="Heading" size="Small" value={Math.max(0, Math.round(imp))} unit="min" suffix="none" color="Neutral" /> : <span className={typeClass('row')}>None inbound</span>}
          <span className={sit.firstImpactIdentity && sit.firstImpactIdentity !== 'hostile' ? typeClass("alarm", "notice") : typeClass("caption", "secondary")}>{sit.firstImpactIdentity && sit.firstImpactIdentity !== 'hostile' ? 'Not yet identified: raise identification' : 'to the defended point at current speed'}</span>
        </div>
      </Card>
    </div>
  );
}

function TargetCard({ x, isSelected, onSelect }: { x: Target; isSelected: boolean; onSelect: () => void }) {
  const active = x.stage !== 'assessed';
  // Only what sets this target apart: the usual (hostile, ring) is not tagged.
  const odd = x.identity && x.identity !== 'hostile' ? IDENTITY_COLOR[x.identity] : undefined;
  const tags = !!(x.priority || odd || x.contested || x.result);
  return (
    <Card padding={0} size="Medium" isSelected={isSelected} onClick={onSelect} accessibilityLabel={`${x.ref} ${x.title}`}>
      <div className="tb-card">
        {/* Reference and time to the VP; the name; what sets it apart; its gates; where it stands. */}
        <div className="tb-card__head">
          <span className={`${typeClass('caption', 'muted')} bs-num`}>{x.ref}</span>
          {active && x.etaMin !== undefined ? <Badge size="Small" color={etaColor(x.etaMin)} emphasis="Subtle" label={`T-${minutes(x.etaMin)}`} /> : null}
        </div>
        <span className={`${typeClass('row')} tb-card__title`}>{x.title}</span>
        {tags ? (
          <div className="tb-card__checks">
            {x.priority ? <Badge size="Small" color={PRIORITY_COLOR[x.priority]} emphasis={x.priority === 'P1' ? 'Intense' : 'Subtle'} label={x.priority} /> : null}
            {odd ? <Badge size="Small" color={odd} emphasis="Subtle" label={x.identity!.toUpperCase()} /> : null}
            {x.contested ? <Badge size="Small" color="Notice" emphasis="Subtle" label="CONTESTED" /> : null}
            {x.result ? <Badge size="Small" color={RESULT_COLOR[x.result] ?? 'Neutral'} emphasis="Subtle" label={x.result.toUpperCase()} /> : null}
          </div>
        ) : null}
        {x.gates.length ? (
          <div className="tb-card__checks" aria-label="Gates">
            {x.gates.map((c) => (
              <Badge key={c.id} size="Small" color={CHECK_COLOR[c.state]} emphasis="Subtle" label={`${c.code} ${CHECK_MARK[c.state]}`} />
            ))}
          </div>
        ) : null}
        {/* Where it stands, read after the name: normal ink, above the muted reference. */}
        <span className={`${typeClass('caption', 'normal')} tb-card__note`}>{statusLine(x)}</span>
      </div>
    </Card>
  );
}

const VERDICT: Record<PairingOption['verdict'], { color: BadgeColor; label: string }> = {
  recommended: { color: 'Positive', label: 'RECOMMENDED' },
  alternative: { color: 'Information', label: 'IN ENVELOPE' },
  'not-yet': { color: 'Neutral', label: 'NOT YET' },
  unavailable: { color: 'Notice', label: 'UNAVAILABLE' },
  gated: { color: 'Negative', label: 'GATED' },
};

/** The order's authority: who released it, under which record, when. */
function TokenCard({ token, clock }: { token: ReleaseToken; clock: RaidClock | undefined }) {
  return (
    <Card padding={0} size="Medium" accessibilityLabel="Release token">
      <div className="tb-check">
        <div className="tb-check__head">
          <span className={typeClass('subhead')}>Release token</span>
          <Badge size="Small" color="Information" emphasis="Subtle" label={token.code} />
        </div>
        <Facts
          flush
          items={[
            ['Authority', token.authority, 'wide'],
            token.author && ['Signed', token.author, 'wide'],
            ['Decision', `${token.dp} · ${token.title}`, 'wide'],
            ['Layer', token.delegated ? `${token.layer} → L4/L5` : token.layer],
            ['Issued', raidLabel(token.at, clock)],
            ['Record', shortHash(token.hash), 'wide'],
          ]}
        />
      </div>
    </Card>
  );
}

function CheckList({ title, items }: { title: string; items: Check[] }) {
  return (
    <ActionListSection title={title}>
      {items.map((c) => (
        <ActionListItem
          key={c.id}
          value={c.id}
          title={c.name}
          description={c.note}
          titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={CHECK_COLOR[c.state]} emphasis={c.state === 'fail' ? 'Intense' : 'Subtle'} label={c.state.toUpperCase()} />}
        />
      ))}
    </ActionListSection>
  );
}

function TargetDetail({ x, onOpenOnMap, onClose }: { x: Target; onOpenOnMap: (id: string | null, highlight?: string[]) => void; onClose: () => void }) {
  const client = useClient();
  const clock = client.scenario?.clock;
  const stage = STAGES.find((s) => s.id === x.stage)!;
  const ordered = x.stage === 'approved' || x.stage === 'executing' || x.stage === 'assessed';
  const pairing = x.pairing ?? null;
  const through = pairing?.options.filter((o) => o.verdict !== 'unavailable' && o.verdict !== 'gated') ?? [];
  const holds = [...x.gates, ...x.admission].filter((c) => c.state === 'fail').length;
  const done = x.dossier.filter((c) => c.state === 'pass').length;
  const last = x.history.filter((r) => r.kind === 'engagement').slice(-1)[0];
  return (
    <div className="bs-insp">
      <div className="bs-insp__head">
        <div className="bs-insp__caption">
          <span className="BodySmallMedium bs-muted bs-ellipsis">
            {x.ref} · {stage.label}
          </span>
          <Tooltip content="Close">
            <Button iconOnly variant="ghost" tone="neutral" size="xs" aria-label="Close target details" onClick={onClose}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
        <span className={typeClass('title')}>{x.title}</span>
        <div className="bs-insp__chips">
          {x.priority ? <Badge size="Small" color={PRIORITY_COLOR[x.priority]} emphasis={x.priority === "P1" ? "Intense" : "Subtle"} label={x.priority} /> : null}
          {x.identity && x.identity !== 'hostile' && IDENTITY_COLOR[x.identity] ? <Badge size="Small" color={IDENTITY_COLOR[x.identity]!} emphasis="Subtle" label={x.identity.toUpperCase()} /> : null}
          {x.contested ? <Badge size="Small" color="Notice" emphasis="Subtle" label="CONTESTED" /> : null}
          {x.etaMin !== undefined && x.stage !== 'assessed' ? <Badge size="Small" color={etaColor(x.etaMin)} emphasis="Subtle" label={`IMPACT T-${minutes(x.etaMin)}`} /> : null}
          {x.token ? <Badge size="Small" color="Information" emphasis="Subtle" label={x.token.code} /> : null}
          {!x.live ? <Badge size="Small" color="Neutral" emphasis="Subtle" label="LEFT THE PICTURE" /> : null}
          {/* The open gates in the same row: one line of tags, wrapping only when the panel is narrow. */}
          {x.gates
            .filter((c) => c.state !== 'pass')
            .map((c) => (
              <Badge key={c.id} size="Small" color={CHECK_COLOR[c.state]} emphasis="Subtle" label={`${c.code} ${CHECK_MARK[c.state]}`} />
            ))}
        </div>
      </div>
      <Tabs key={x.id} className="bs-tabs-fill" defaultValue={pairing ? 'pairing' : 'overview'} size="Small" variant="filled">
        <div className="bs-tabbar bs-tabbar--insp">
          <TabList>
            <TabItem value="overview">Overview</TabItem>
            <TabItem value="pairing" trailing={through.length ? <Counter value={through.length} size="Medium" color="Neutral" emphasis="Subtle" accessibilityLabel={`${through.length} options through the gates`} /> : undefined}>
              Pairing
            </TabItem>
            <TabItem value="dossier" trailing={holds ? <Counter value={holds} size="Medium" color="Negative" emphasis="Subtle" accessibilityLabel={`${holds} checks holding`} /> : undefined}>
              Dossier
            </TabItem>
            <TabItem value="history">History</TabItem>
          </TabList>
        </div>
        <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
          <TabPanel value="overview">
            <section className="bs-stack bs-pad" aria-label="Overview">
              {x.token ? <TokenCard token={x.token} clock={clock} /> : null}
              <Facts
                flush
                items={[
                  ['Stage', stage.label],
                  ['Next gate', nextGate(x)],
                  x.ring && ['Ring', x.ring],
                  x.rangeKm !== undefined && ['From VP', `${x.rangeKm.toFixed(1)} km`],
                  x.etaMin !== undefined && x.stage !== 'assessed' && ['Time to VP', minutes(x.etaMin)],
                  x.axis && ['Axis · wave', `${x.axis} · ${x.wave ?? '—'}`],
                  x.effector && ['Fire unit', x.effector],
                  x.result && ['Outcome', x.result],
                  x.recommended && ['Recommended', `${x.recommended.name} · ${x.recommended.inEnvelope ? 'in envelope' : x.recommended.toEnvelopeMin !== null ? `envelope in ${minutes(x.recommended.toEnvelopeMin)}` : 'waiting'}`, 'wide'],
                  ['Last change', clock ? `${raidLabel(x.updated, clock)} · ${formatZulu(x.updated).slice(0, 5)}Z` : formatZulu(x.updated), 'wide'],
                ]}
              />
            </section>
          </TabPanel>
          <TabPanel value="pairing">
            {pairing ? (
              <section className="bs-stack bs-pad" aria-label="Pairing options">
                <Card padding={0} size="Medium" accessibilityLabel="Machine recommendation">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className={typeClass('subhead')}>Machine recommendation</span>
                      <Badge size="Small" color={pairing.recommended ? 'Positive' : 'Negative'} emphasis="Subtle" label={pairing.recommended ? pairing.recommended.name.toUpperCase() : 'NONE'} />
                    </div>
                    <span className="BodySmallRegular bs-ink-secondary">{pairing.rationale}</span>
                    <span className={pairing.recommended ? typeClass("alarm", "notice") : typeClass("caption", "secondary")}>{pairing.recommended ? `Pending approval: ${nextGate({ ...x, stage: 'paired' })}. The board recommends; it never releases.` : 'Nothing is recommended past a gate. Approval rests with L3.'}</span>
                  </div>
                </Card>
                {pairing.options.slice(0, 8).map((o) => (
                  <Card key={o.effector} padding={0} size="Medium" accessibilityLabel={`${o.name} option`}>
                    <div className="tb-check">
                      <div className="tb-check__head">
                        <span className={`${typeClass('row')} bs-ellipsis`}>{o.name}</span>
                        <Badge size="Small" color={VERDICT[o.verdict].color} emphasis={o.verdict === 'gated' ? 'Intense' : 'Subtle'} label={o.gate ? `GATED · ${o.gate === 'doctrine' ? 'DOCTRINE' : 'CIV HARM'}` : VERDICT[o.verdict].label} />
                      </div>
                      <span className="BodySmallRegular bs-ink-secondary bs-num">
                        {o.costWord} · {o.rangeKm.toFixed(1)} km · {o.channelsFree} ch free · {Number.isFinite(o.ready) ? `${o.ready} rds (floor ${o.floor})` : 'no magazine limit'}
                      </span>
                      {o.reasons.length ? <span className="BodySmallRegular bs-ink-secondary">{o.reasons.join(' · ')}</span> : null}
                    </div>
                  </Card>
                ))}
              </section>
            ) : ordered && last ? (
              <section className="bs-stack bs-pad" aria-label="Order">
                <Card padding={0} size="Medium" accessibilityLabel="Order on record">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className={typeClass('subhead')}>Order on record</span>
                      <Badge size="Small" color={x.token ? 'Information' : 'Negative'} emphasis="Subtle" label={x.token ? x.token.dp : 'NO TOKEN'} />
                    </div>
                    <Facts
                      flush
                      items={[
                        ['Fire unit', x.effector ?? '—'],
                        ['Weapon', (last.payload as { weapon?: string }).weapon ?? '—'],
                        ['Checker', check(x, 'checker')?.note ?? '—', 'wide'],
                      ]}
                    />
                  </div>
                </Card>
              </section>
            ) : (
              <p className="BodySmallRegular bs-muted bs-pad">{x.stage === 'nominated' ? 'Pairing runs once identification passes.' : 'No position: pairing waits for a fix.'}</p>
            )}
          </TabPanel>
          <TabPanel value="dossier">
            <div className="bs-pad">
              <ProgressBar type="meter" label={`Dossier ${done} / ${x.dossier.length}`} value={done} max={x.dossier.length} color={holds ? 'Negative' : done === x.dossier.length ? 'Positive' : 'Information'} />
            </div>
            <ActionList accessibilityLabel="Dossier">
              <CheckList title="Gates" items={x.gates} />
              <CheckList title="Admission" items={x.admission} />
              <CheckList title="Checklist" items={x.dossier} />
            </ActionList>
          </TabPanel>
          <TabPanel value="history">
            {x.history.length ? (
              <ActionList accessibilityLabel="Journal history">
                {[...x.history].reverse().map((r) => {
                  const sum = eventSummary(r);
                  return <ActionListItem key={r.record_id} value={r.record_id} title={sum.title} description={sum.detail ? `${raidLabel(r.ingest_time, clock)} · ${sum.detail}` : raidLabel(r.ingest_time, clock)} />;
                })}
              </ActionList>
            ) : (
              <p className="BodySmallRegular bs-muted bs-pad">No engagement or rule has named this target yet.</p>
            )}
          </TabPanel>
        </ScrollArea>
      </Tabs>
      {/* The map actions, side by side: the pairing compared (while there are options), then the target alone. */}
      <div className="bs-insp__foot">
        <div className={pairing ? 'bs-insp__footbtns' : undefined}>
          {pairing ? (
            <Button size="sm" variant="secondary" tone="neutral" leadingIcon={<MapIcon size={14} />} isFullWidth isDisabled={!x.live} onClick={() => onOpenOnMap(x.id, [x.id, ...through.slice(0, 4).map((o) => o.effector)])}>
              Compare on map
            </Button>
          ) : null}
          <Button size="sm" variant="primary" tone="brand" leadingIcon={<MapPinned size={14} />} isFullWidth isDisabled={!x.live} onClick={() => onOpenOnMap(x.id)}>
            Open on map
          </Button>
        </div>
      </div>
    </div>
  );
}

const ENVELOPE_STATE: Record<Envelope['state'], { color: BadgeColor; label: string }> = {
  standing: { color: 'Neutral', label: 'STANDING' },
  unseen: { color: 'Neutral', label: 'NOT IN VIEW' },
  delegated: { color: 'Notice', label: 'DELEGATED' },
  released: { color: 'Notice', label: 'RELEASED' },
  returned: { color: 'Positive', label: 'RETURNED TO L3' },
};
const STATUS_COLOR: Record<string, BadgeColor> = { approved: 'Positive', delegated: 'Notice', executed: 'Neutral', proposed: 'Information', option: 'Neutral', rejected: 'Negative' };

/** Storyboard B5: each envelope beside its condition, current state and execution log. */
function DecisionConsole({ book, clock, known, onSelect }: { book: DecisionBook; clock: RaidClock | undefined; known: Set<string>; onSelect: (id: string) => void }) {
  const executions = book.envelopes.reduce((a, e) => a + e.log.length, 0);
  return (
    <div className="bs-insp">
      <div className="bs-insp__head">
        <span className="BodySmallMedium bs-muted">Decision record</span>
        <span className={typeClass('title')}>Delegation console</span>
        <div className="bs-insp__chips">
          {book.envelopes.map((e) => (
            <Badge key={e.dp} size="Small" color={ENVELOPE_STATE[e.state].color} emphasis="Subtle" label={`${e.dp} ${ENVELOPE_STATE[e.state].label}`} />
          ))}
        </div>
      </div>
      <Tabs className="bs-tabs-fill" defaultValue="envelopes" size="Small" variant="filled">
        <div className="bs-tabbar bs-tabbar--insp">
          <TabList>
            <TabItem value="envelopes" trailing={executions ? <Counter value={executions} size="Medium" color="Neutral" emphasis="Subtle" accessibilityLabel={`${executions} engagements under delegation`} /> : undefined}>
              Envelopes
            </TabItem>
            <TabItem value="record" trailing={<Counter value={book.rows.length} max={99} size="Medium" color="Neutral" emphasis="Subtle" accessibilityLabel={`${book.rows.length} decisions`} />}>
              Record
            </TabItem>
          </TabList>
        </div>
        <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
          <TabPanel value="envelopes">
            <section className="bs-stack bs-pad" aria-label="Delegation envelopes">
              {book.envelopes.map((env) => (
                <Card key={env.dp} padding={0} size="Medium" accessibilityLabel={`${env.dp} envelope`}>
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className={`${typeClass('row')} bs-ellipsis`}>
                        {env.dp} · {env.title}
                      </span>
                      <Badge className="bs-tag" size="Small" color={ENVELOPE_STATE[env.state].color} emphasis={ENVELOPE_STATE[env.state].color === "Neutral" ? "Intense" : "Subtle"} label={ENVELOPE_STATE[env.state].label} />
                    </div>
                    <Facts
                      flush
                      items={[
                        ['Condition', env.condition, 'wide'],
                        ['Now', <Badge key="now" size="Small" color={env.now.met ? 'Notice' : 'Positive'} emphasis="Subtle" label={env.now.met ? 'CONDITION MET' : 'NOT MET'} />],
                        ['Reading', env.now.text],
                        ['Holder', env.holder, 'wide'],
                        env.record && ['Opened', `${raidLabel(env.record.at, clock)} · ${shortHash(env.record.hash)}`, 'wide'],
                        env.record?.author && ['Signed', env.record.author, 'wide'],
                        env.closed && ['Closed', `${raidLabel(env.closed.at, clock)} · ${env.closed.summary}`, 'wide'],
                      ]}
                    />
                  </div>
                </Card>
              ))}
            </section>
            {book.envelopes.map((env) =>
              env.log.length ? (
                <ActionList key={env.dp} accessibilityLabel={`${env.dp} execution log`}>
                  <ActionListSection title={`${env.dp} · ${env.logLabel} · ${env.log.length}`}>
                    {env.log.map((r) => (
                      <ActionListItem
                        key={r.id}
                        value={r.id}
                        title={`${r.target} · ${r.effector}`}
                        description={`${raidLabel(r.at, clock)} · ${r.weapon}`}
                        isDisabled={!known.has(r.target)}
                        titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={RESULT_COLOR[r.result] ?? (r.result === 'launched' ? 'Information' : 'Neutral')} emphasis="Subtle" label={r.result.toUpperCase()} />}
                        onClick={() => onSelect(r.target)}
                      />
                    ))}
                  </ActionListSection>
                </ActionList>
              ) : null,
            )}
          </TabPanel>
          <TabPanel value="record">
            {book.rows.length ? (
              <ActionList accessibilityLabel="Decisions on record">
                {book.rows.map((r) => (
                  <ActionListItem
                    key={r.id}
                    value={r.id}
                    title={`${r.dp} · ${r.title}`}
                    description={`${raidLabel(r.at, clock)} · ${r.layer} · ${r.authority ?? r.author ?? '—'}${r.executions ? ` · ${r.executions} engaged` : ''}`}
                    titleSuffix={<ActionListItemBadge className="bs-tag" size="Small" color={STATUS_COLOR[r.status] ?? 'Neutral'} emphasis="Subtle" label={r.status.toUpperCase()} />}
                  />
                ))}
              </ActionList>
            ) : (
              <p className="BodySmallRegular bs-muted bs-pad">No decision on record at this time.</p>
            )}
          </TabPanel>
        </ScrollArea>
      </Tabs>
      <div className="bs-insp__foot">
        <span className="BodySmallRegular bs-muted">The system carries orders; it never originates authority. Open thresholds stay as written (N, T).</span>
      </div>
    </div>
  );
}
