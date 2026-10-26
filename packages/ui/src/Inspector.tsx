/**
 * Inspector.
 *  - Entity (the selected object, or the current storyboard frame's subject): caption, title
 *    and Badges, then Tabs. Fused tracks: Fusion (hypothesis Cards, kinematics, provenance,
 *    recent activity) · Provenance (source and registration, source, time, record) · Intel
 *    (reported evidence) · Links (linked objects, lineage thread) · Activity. Everything else:
 *    Overview (its own facts) · Provenance · Links · Activity. Actions pin to the foot.
 *  - Nothing selected: theatre summary — ring occupancy (ProgressBar meters), rules fired and
 *    raid groups (ActionList), fire units by defence layer (FireUnits).
 */
import {
  ActionList,
  ActionListItem,
  ActionListItemIcon,
  ActionListItemText,
  ActionListSection,
  Badge,
  Button,
  Card,
  ProgressBar,
  ScrollArea,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
  useToast,
} from '@faclon-labs/fds';
import { Boxes, Crosshair, FileSearch, Gavel, MapPin, Radar, ShieldAlert, Swords, TriangleAlert, Wrench, X } from 'lucide-react';
import { CLASSES, formatZulu, sidcWithIdentity, watchedBy, type EngagementPayload, type Entity, type GeoShape, type JournalRecord } from '@me/schema';
import { distance, formatArea, formatDistance, formatMgrs, formatRangeBearing, headingSpeed, inverse, pathLength, pointInShape, ringArea } from '@me/geo';
import type { MapClient } from '@me/client';
import { useClient, useEngineTime, useEvents, useLineage, useSelectedEntity, useViewStore } from '@me/map-react';
import { SymbolGlyph } from './glyphs.tsx';
import { FireUnits } from './FireUnits.tsx';
import { MAG_COLOR, magState } from './magazine.ts';
import { Facts, type Fact } from './Facts.tsx';
import type { Derived } from './derived.ts';
import { useHealth } from './health.ts';
import { AGE_BADGE, AGE_WORD, ageLabel } from './age.ts';
import { eventSummary, raidLabel, shortHash } from './format.ts';

const IDENTITY_COLOR = { hostile: 'Negative', suspect: 'Notice', unknown: 'Notice', pending: 'Neutral', friend: 'Information', assumed_friend: 'Information', neutral: 'Positive' } as const;

const KIND_ICON = { fragment: FileSearch, decision: Gavel, rule_fire: TriangleAlert, engagement: Crosshair, bda: ShieldAlert, correction: Wrench } as const;

const LIKELIHOOD = (p: number): { word: string; color: 'Notice' | 'Neutral' } =>
  p >= 0.8 ? { word: 'HIGHLY LIKELY', color: 'Notice' } : p >= 0.55 ? { word: 'LIKELY', color: 'Notice' } : p >= 0.3 ? { word: 'POSSIBLE', color: 'Neutral' } : { word: 'UNLIKELY', color: 'Neutral' };

const QUALIFIER: Partial<Record<string, string>> = { suspect: ' (suspected)', unknown: ' (unidentified)', pending: ' (pending)', assumed_friend: ' (assumed friend)' };

type TabId = 'fusion' | 'overview' | 'prov' | 'intel' | 'links' | 'activity';
const TAB_WORD: Record<TabId, string> = { fusion: 'Fusion', overview: 'Overview', prov: 'Provenance', intel: 'Intel', links: 'Links', activity: 'Activity' };

/** Display name: the leading hypothesis (or class) with an identity qualifier for tracks. */
function entityTitle(e: Entity): string {
  const cls = CLASSES[e.ontology?.class ?? ''];
  if (e.ontology?.template === 'track' && cls) {
    const label = e.classification?.hypotheses[0]?.label ?? cls.label;
    return `${label}${QUALIFIER[e.mil_view?.identity ?? ''] ?? ''}`;
  }
  // Command objects read by their map label ("R4 OUTER · 150–60 KM"), not their id.
  return e.aliases?.name ?? e.geo_details?.label ?? cls?.label ?? e.entity_id;
}

/** Hand an object over to another page: the target board, or the assistant with a question. */
export interface InspectorHandover {
  onNominate?: (id: string) => void;
  onAsk?: (question: string) => void;
}

export function Inspector({ derived, onNominate, onAsk }: { derived: Derived } & InspectorHandover) {
  const e = useSelectedEntity();
  return e ? <EntityInspector e={e} derived={derived} {...(onNominate ? { onNominate } : {})} {...(onAsk ? { onAsk } : {})} /> : <TheatreSummary derived={derived} />;
}

function EntityInspector({ e, derived, onNominate, onAsk }: { e: Entity; derived: Derived } & InspectorHandover) {
  const client = useClient();
  const view = useViewStore();
  const toast = useToast();
  const t = useEngineTime();
  const clock = client.scenario?.clock;
  const sidc = e.mil_view ? sidcWithIdentity(e.mil_view.sidc, e.mil_view.identity) : undefined;
  const ageMs = t - e.source_time;
  const age = client.ageState(e.entity_id, t);
  const ref = e.aliases?.track_number ?? e.entity_id;
  const nominable = e.ontology?.template === 'track' || e.ontology?.template === 'fragment' || e.ontology?.template === 'group';
  const operatorObject = e.provenance.integration === 'console';
  const commandObject = !!e.geo_shape && e.layer === 'command';
  const when = (ms: number) => `${raidLabel(ms, clock)} · ${formatZulu(ms).slice(0, 5)}Z`;
  // Fused tracks get the full fusion view; everything else an overview of its own facts.
  const fusedTrack = e.layer === 'fused' && e.ontology?.template === 'track';
  const tabs: TabId[] = fusedTrack ? ['fusion', 'prov', 'intel', 'links', 'activity'] : ['overview', 'prov', 'links', 'activity'];
  const first: TabId = fusedTrack ? 'fusion' : 'overview';
  const loc = e.location ? ([e.location.lon, e.location.lat] as [number, number]) : null;
  const top = e.classification?.hypotheses[0];
  const evidence = e.track?.sensor_classes?.length ? e.track.sensor_classes.join(' + ') : (e.provenance.sensor_class ?? e.provenance.source_feed);
  const withdraw = async () => {
    try {
      await client.publish({ entity_id: e.entity_id, payload: { is_live: false } });
      toast.show({ color: 'Positive', content: `“${e.aliases?.name ?? e.entity_id}” withdrawn.` });
      view.set({ selected: null });
    } catch (err) {
      toast.show({ color: 'Negative', content: (err as Error).message });
    }
  };
  return (
    <div className="bs-insp">
      <div className="bs-insp__head">
        <div className="bs-insp__caption">
          <span className="BodyXSmallMedium bs-muted bs-ellipsis">
            {ref} · {kindWord(e)}
          </span>
          <Button iconOnly variant="ghost" tone="neutral" size="xs" aria-label="Clear selection" onClick={() => view.set({ selected: null, highlight: [] })}>
            <X size={14} />
          </Button>
        </div>
        <div className="bs-insp__title">
          {sidc ? <SymbolGlyph sidc={sidc} size={20} title={CLASSES[e.ontology?.class ?? '']?.label} /> : null}
          <span className="HeadingSmallSemibold bs-ellipsis">{entityTitle(e)}</span>
        </div>
        <div className="bs-insp__chips">
          {e.classification?.contested ? <Badge size="Small" color="Notice" emphasis="Intense" label="CONTESTED" /> : null}
          {e.mil_view ? <Badge size="Small" color={IDENTITY_COLOR[e.mil_view.identity]} emphasis="Subtle" label={e.mil_view.identity.replace('_', ' ').toUpperCase()} /> : null}
          {e.track?.state && e.track.state !== 'detected' && e.track.state !== 'inbound' ? (
            <Badge size="Small" color={e.track.state === 'destroyed' ? 'Positive' : 'Notice'} emphasis="Subtle" label={e.track.state.toUpperCase()} />
          ) : null}
          {commandObject ? (
            // Command objects do not age: they hold until withdrawn or expired.
            <Badge size="Small" color={e.geo_details?.status === 'active' ? 'Positive' : 'Neutral'} emphasis="Subtle" label={(e.geo_details?.status ?? 'active').toUpperCase()} />
          ) : (
            <Badge size="Small" color={AGE_BADGE[age]} emphasis="Subtle" label={age === 'disc' ? 'DISC · NO LINK' : `${AGE_WORD[age]} · ${ageLabel(ageMs)}`} />
          )}
          {operatorObject ? <Badge size="Small" color="Information" emphasis="Subtle" label="DRAWN" /> : null}
        </div>
      </div>
      <Tabs key={tabs.join()} className="bs-tabs-fill" defaultValue={first} size="Small" variant="filled">
        <div className="bs-tabbar bs-tabbar--insp">
          <TabList>
            {tabs.map((id) => (
              <TabItem key={id} value={id}>
                {TAB_WORD[id]}
              </TabItem>
            ))}
          </TabList>
        </div>
        <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
          <TabPanel value={first}>
            <div className="bs-stack">
              {e.classification ? <Hypotheses e={e} /> : null}
              {e.fragment ? <p className="BodySmallRegular bs-pad">{e.fragment.summary}</p> : null}
              <Facts items={overviewFacts(e, client, derived, t)} />
              {fusedTrack ? (
                <Facts
                  title="Provenance"
                  items={[
                    !!e.track?.contributing?.length && ['Contributing', e.track.contributing.map((id) => client.entities.get(id)?.aliases?.name ?? id).join(' · '), 'wide'],
                    ['Sensor class', evidence, 'wide'],
                    e.track?.fusion_method && ['Fusion method', e.track.fusion_method, 'wide'],
                    e.track?.fusion_version && ['Fusion logic', e.track.fusion_version, 'wide'],
                    ['Last update', `${when(e.source_time)} source · ${when(e.ingest_time)} received`, 'wide'],
                    ['Label', <Badge size="Small" color="Notice" emphasis="Subtle" label={e.label} />],
                    ['Signature', <ChainBadge />],
                  ]}
                />
              ) : (
                <div className="bs-sourceline">
                  <span className="BodyXSmallRegular bs-muted bs-ellipsis">
                    {e.provenance.source_feed} · {when(e.ingest_time)}
                  </span>
                  <ChainBadge />
                </div>
              )}
              <EntityActivity id={e.entity_id} limit={5} hideEmpty />
            </div>
          </TabPanel>
          <TabPanel value="prov">
            <Facts
              title="Source and registration"
              items={[
                loc && ['Position', formatMgrs(loc), 'wide'],
                top && ['Confidence', `${LIKELIHOOD(top.p).word} (${top.p.toFixed(2)})`],
                commandObject ? ['Status', (e.geo_details?.status ?? 'active').replace(/^\w/, (c) => c.toUpperCase())] : ['Data age', age === 'disc' ? 'No link' : `${ageLabel(ageMs)} · ${AGE_WORD[age].toLowerCase()}`],
                ['Envelope', 'Provenance · time · label · version · signature', 'wide'],
              ]}
            />
            <Facts
              title="Source"
              items={[
                ['Feed', e.provenance.source_feed],
                ['Integration', e.provenance.integration],
                e.provenance.sensor_class && e.provenance.sensor_class !== e.provenance.source_feed && ['Sensor class', e.provenance.sensor_class],
                e.provenance.agency && ['Agency', e.provenance.agency],
              ]}
            />
            <Facts
              title="Time"
              items={[
                ['Source time', when(e.source_time)],
                ['Received', when(e.ingest_time)],
              ]}
            />
            <Facts
              title="Record"
              items={[
                ['Label', <Badge size="Small" color="Notice" emphasis="Subtle" label={e.label} />],
                ['Chain', <ChainBadge />],
                ['Version', `v${e.version}`],
                ['Record', shortHash(e.last_hash)],
                !!e.releasability?.length && ['Releasable to', e.releasability.join(' · '), 'wide'],
              ]}
            />
          </TabPanel>
          {fusedTrack ? (
            <TabPanel value="intel">
              <Evidence e={e} />
            </TabPanel>
          ) : null}
          <TabPanel value="links">
            <div className="bs-stack">
              <LinkedObjects e={e} t={t} />
              <Lineage id={e.entity_id} />
            </div>
          </TabPanel>
          <TabPanel value="activity">
            <EntityActivity id={e.entity_id} limit={60} />
          </TabPanel>
        </ScrollArea>
      </Tabs>
      {operatorObject ? (
        <div className="bs-insp__foot">
          <div className="bs-insp__footbtns">
            <Button size="sm" variant="secondary" tone="neutral" isFullWidth onClick={() => void withdraw()}>
              Withdraw
            </Button>
            <Button size="sm" variant="secondary" tone="neutral" isFullWidth onClick={() => view.set({ selected: null })}>
              Close
            </Button>
          </div>
          <span className="BodyXSmallRegular bs-muted">Withdrawing removes it from the map. The original stays in the record.</span>
        </div>
      ) : null}
      {nominable ? (
        <div className="bs-insp__foot">
          <div className="bs-insp__footbtns">
            <Button size="sm" variant="primary" tone="brand" isFullWidth isDisabled={!onNominate} onClick={() => onNominate?.(e.entity_id)}>
              Nominate to board
            </Button>
            <Button size="sm" variant="secondary" tone="neutral" isFullWidth isDisabled={!onAsk} onClick={() => onAsk?.(`Explain ${e.aliases?.track_number ?? e.entity_id}`)}>
              Ask the assistant
            </Button>
          </div>
          <span className="BodyXSmallRegular bs-muted">
            {e.classification?.contested ? 'Contested entities can be nominated; hypotheses travel with the card. ' : ''}
            The board shows its pairing options and checks; the assistant explains it from the record.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Hypotheses within margin, with the (not yet live) corrections. */
function Hypotheses({ e }: { e: Entity }) {
  const c = e.classification!;
  const evidence = e.track?.sensor_classes?.length ? e.track.sensor_classes.join(' + ') : (e.provenance.sensor_class ?? e.provenance.source_feed);
  return (
    <section className="bs-stack bs-pad">
      <div className="bs-insp__sechead">
        <span className="BodySmallSemibold">Hypotheses within margin</span>
        <span className="BodyXSmallRegular bs-muted bs-num">margin {c.margin.toFixed(2)}</span>
      </div>
      {c.hypotheses.map((h, i) => {
        const lk = LIKELIHOOD(h.p);
        return (
          <Card key={h.class} padding={12} size="Medium" isSelected={i === 0}>
            <div className="bs-hcard">
              <span className="bs-hcard__text">
                <span className="BodySmallSemibold bs-ellipsis">{h.label}</span>
                <span className="BodyXSmallRegular bs-muted">
                  p {h.p.toFixed(2)} · {evidence}
                </span>
              </span>
              <Badge size="Small" color={lk.color} emphasis={i === 0 ? 'Intense' : 'Subtle'} label={lk.word} />
            </div>
          </Card>
        );
      })}
      <div className="bs-row">
        <Button size="xs" variant="secondary" tone="neutral" isDisabled>
          Reject
        </Button>
        <Button size="xs" variant="secondary" tone="neutral" isDisabled>
          Merge
        </Button>
        <Button size="xs" variant="secondary" tone="neutral" isDisabled>
          Reclassify
        </Button>
      </div>
      <span className="BodyXSmallRegular bs-muted">
        {c.contested ? 'Not merged: hypotheses stay separate until an operator adjudicates. ' : ''}
        Corrections write labelled records to the journal in the next build.
      </span>
    </section>
  );
}

/** Caption word for the entity's kind. */
function kindWord(e: Entity): string {
  if (e.geo_shape && e.layer === 'command') return 'COMMAND OBJECT';
  if (e.layer === 'reference') return 'REFERENCE';
  if (e.fragment) return 'INTEL FRAGMENT';
  return `${e.layer.toUpperCase()} ${(e.ontology?.template ?? 'entity').toUpperCase()}`;
}

const GEO_WORD: Partial<Record<string, string>> = { wcs_sector: 'WCS sector', nfz: 'No-fly zone', sea_restriction: 'Sea restriction', picket_box: 'Picket box', wez: 'Engagement zone', debris_footprint: 'Debris footprint', soft_kill_area: 'Soft-kill area', vp: 'Defended point' };

/** The facts that matter for this kind of entity, most useful first. */
function overviewFacts(e: Entity, client: MapClient, derived: Derived, t: number): Fact[] {
  const loc = e.location ? ([e.location.lon, e.location.lat] as [number, number]) : null;
  const rb = loc ? inverse(derived.center, loc) : null;
  const gd = e.geo_details;
  const vel = e.location?.vel;
  const mag = e.effector?.magazine;
  const cap = mag ? (mag.capacity ?? mag.ready + mag.reserve) : 0;
  return [
    // Kinematics (tracks, assets).
    loc && e.ontology?.template !== 'installation' && !e.geo_shape && ['Position', formatMgrs(loc), 'wide'],
    rb && !e.geo_shape && ['From VP', formatRangeBearing(rb.distance_m, rb.azimuth_deg)],
    e.location?.hae !== undefined && e.ontology?.template === 'track' && ['Altitude', `${Math.round(e.location.hae)} m`],
    !!vel && (vel.e !== 0 || vel.n !== 0) && ['Speed', `${Math.round(Math.hypot(vel.e, vel.n) * 3.6)} km/h`],
    !!vel && (vel.e !== 0 || vel.n !== 0) && ['Heading', `${String(Math.round(headingSpeed(vel).heading) % 360).padStart(3, '0')}°`],
    e.track?.axis && ['Axis · wave', `${e.track.axis} · ${e.track.wave ?? '—'}`],
    // Fire units.
    e.effector && ['Status', <Badge size="Small" color={e.effector.status === 'down' ? 'Negative' : e.effector.status === 'engaging' ? 'Notice' : 'Positive'} emphasis="Subtle" label={e.effector.status.toUpperCase()} />],
    e.effector && ['Channels', `${e.effector.channels.busy} / ${e.effector.channels.total} in use`],
    mag && [
      'Magazine',
      <span className="bs-stack bs-stack--tight">
        <span>
          {mag.ready} / {cap} ready · floor {mag.floor}
        </span>
        <ProgressBar type="meter" color={MAG_COLOR[magState(mag.ready, mag.floor, cap)]} value={mag.ready} max={cap || 1} accessibilityLabel="Magazine" />
      </span>,
      'wide',
    ],
    e.effector?.wez && ['Engagement range', `${e.effector.wez.min_m ? (e.effector.wez.min_m / 1000).toFixed(1) : '0'}–${Math.round(e.effector.wez.max_m / 1000)} km`],
    // Sensors and plant.
    e.sensor && ['Sensor', e.sensor.type.replaceAll('_', ' ')],
    e.sensor && ['Range', `${Math.round((e.sensor.range_m ?? 0) / 1000)} km`],
    e.sensor && ['Status', e.sensor.status],
    e.plant && ['Plant state', e.plant.state.replaceAll('_', ' ')],
    e.plant && ['Tier', `Tier ${e.plant.tier}`],
    // Intel fragments.
    e.fragment && ['Source', e.fragment.source_kind.replaceAll('_', ' ')],
    e.fragment && ['Confidence', <Badge size="Small" color={e.fragment.confidence === 'confirmed' ? 'Positive' : e.fragment.confidence === 'likely' ? 'Notice' : 'Neutral'} emphasis="Subtle" label={e.fragment.confidence.toUpperCase()} />],
    e.fragment && ['Associated', e.fragment.associated ? 'Yes' : <Badge size="Small" color="Neutral" emphasis="Intense" label="UNASSOCIATED" />],
    e.location_uncertainty && ['Uncertainty', `${(e.location_uncertainty.semi_major_m / 1000).toFixed(1)} × ${(e.location_uncertainty.semi_minor_m / 1000).toFixed(1)} km`],
    // Raid groups.
    e.group && ['Members', String(e.group.members.length)],
    e.group?.axis && ['Axis · wave', `${e.group.axis} · ${e.group.wave ?? '—'}`],
    // Command objects.
    gd && e.geo_shape && ['Type', GEO_WORD[gd.type] ?? gd.type.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())],
    e.geo_shape && ['Size', shapeSummary(e.geo_shape)],
    gd?.ring && ['Ring', gd.ring],
    gd?.wcs && ['Weapons control', <Badge size="Small" color={gd.wcs === 'free' ? 'Negative' : gd.wcs === 'tight' ? 'Notice' : 'Positive'} emphasis="Subtle" label={gd.wcs.toUpperCase()} />],
    gd?.tier !== undefined && !e.plant && ['Tier', `Tier ${gd.tier}`],
    gd?.watch && ['Alert on', gd.watch === 'any' ? 'Any track' : `${gd.watch[0]!.toUpperCase()}${gd.watch.slice(1)} tracks`],
    gd?.type === 'geofence' && e.geo_shape && ['Inside now', String(insideNow(client, e.geo_shape, gd.watch ?? 'hostile', t))],
    gd?.author && ['Author', gd.author, 'wide'],
    gd?.note && ['Note', gd.note, 'wide'],
  ];
}

/** Hash-chain status as reported by the server's verification at load (not re-checked here). */
function ChainBadge() {
  const h = useHealth();
  if (!h) return <Badge size="Small" color="Neutral" emphasis="Subtle" label="CHECKING" />;
  return h.chain.ok ? (
    <Tooltip content={`Server verified ${h.chain.checked.toLocaleString('en')} records at load · root ${shortHash(h.head.hash)}`}>
      <span>
        <Badge size="Small" color="Positive" emphasis="Subtle" label="VERIFIED · SERVER" />
      </span>
    </Tooltip>
  ) : (
    <Badge size="Small" color="Negative" emphasis="Intense" label={`BROKEN AT ${h.chain.brokenAt}`} />
  );
}

function Lineage({ id }: { id: string }) {
  const client = useClient();
  const view = useViewStore();
  const { records, loading } = useLineage(id);
  const clock = client.scenario?.clock;
  const meaningful = records.filter((r) => r.kind !== 'observation' && !(r.kind === 'fused' && !r.derived_from?.length));
  return (
    <div className="bs-stack">
      <div className="bs-insp__sechead bs-pad">
        <span className="BodySmallSemibold">Lineage · {loading ? '…' : meaningful.length}</span>
        <Button size="xs" variant="secondary" tone="neutral" onClick={() => view.set({ highlight: meaningful.map((r) => r.entity_id ?? '').filter(Boolean) })}>
          Trace on map
        </Button>
      </div>
      <ActionList accessibilityLabel="Lineage records">
        {meaningful.map((r) => {
          const s = eventSummary(r);
          return (
            <ActionListItem
              key={r.record_id}
              value={r.record_id}
              title={s.title}
              description={`${r.kind} · ${shortHash(r.hash)}`}
              leading={<ActionListItemIcon icon={KIND_ICON[r.kind as keyof typeof KIND_ICON] ?? Boxes} />}
              trailing={<ActionListItemText>{raidLabel(r.ingest_time, clock)}</ActionListItemText>}
              onClick={() => s.subject && s.subject !== id && view.set({ selected: s.subject })}
            />
          );
        })}
      </ActionList>
    </div>
  );
}

/** Reported evidence behind a fused track: its contributing sensors and any intel in its thread. */
function Evidence({ e }: { e: Entity }) {
  const client = useClient();
  const { records, loading } = useLineage(e.entity_id);
  const clock = client.scenario?.clock;
  const sensors = (e.track?.contributing ?? []).map((id) => ({ id, s: client.entities.get(id) }));
  const intel = records.filter((r) => r.kind === 'fragment');
  return (
    <section className="bs-stack bs-pad" aria-label="Reported evidence">
      <span className="BodySmallSemibold">Reported evidence</span>
      {sensors.map(({ id, s }) => (
        <Card key={id} padding={12} size="Medium">
          <span className="bs-hcard__text">
            <span className="BodySmallSemibold bs-ellipsis">{s?.aliases?.name ?? id}</span>
            <span className="BodyXSmallRegular bs-muted">
              {s?.sensor ? `${s.sensor.type.replaceAll('_', ' ')} · ${Math.round((s.sensor.range_m ?? 0) / 1000)} km · ${s.health?.link ?? s.sensor.status}` : 'contributing sensor'}
            </span>
          </span>
        </Card>
      ))}
      {intel.map((r) => {
        const sum = eventSummary(r);
        return (
          <Card key={r.record_id} padding={12} size="Medium">
            <span className="bs-hcard__text">
              <span className="BodySmallSemibold">
                {raidLabel(r.ingest_time, clock)} · {sum.title}
              </span>
              {sum.detail ? <span className="BodyXSmallRegular bs-muted">{sum.detail}</span> : null}
            </span>
          </Card>
        );
      })}
      {!sensors.length && !intel.length ? <span className="BodySmallRegular bs-muted">{loading ? 'Loading…' : 'No reported evidence yet.'}</span> : null}
    </section>
  );
}

type LinkIcon = typeof Boxes;

interface Link {
  key: string;
  text: string;
  ref: string;
  icon: LinkIcon;
}

/** Objects related to e right now: areas it is inside, its group, sensors, nearest fire unit, engagements. */
function linksOf(e: Entity, client: MapClient, events: JournalRecord[], t: number): Link[] {
  const out: Link[] = [];
  const name = (id: string) => {
    const x = client.entities.get(id);
    return x?.aliases?.callsign ?? x?.aliases?.track_number ?? x?.aliases?.name ?? x?.geo_details?.label ?? id;
  };
  const pos = e.location ? client.positionAt(e.entity_id, t) : null;
  const p = pos ? ([pos[0], pos[1]] as [number, number]) : null;
  if (p && !e.geo_shape) {
    for (const x of client.entities.values()) {
      const shape = x.geo_shape;
      if (x.entity_id === e.entity_id || !shape || shape.type === 'line' || shape.type === 'point') continue;
      if (x.layer !== 'command' && x.layer !== 'reference') continue;
      if (pointInShape(p, shape)) out.push({ key: `in:${x.entity_id}`, text: `inside ${x.geo_details?.label ?? x.aliases?.name ?? x.entity_id}`, ref: x.entity_id, icon: MapPin });
    }
  }
  for (const x of client.entities.values()) {
    if (x.group?.members.includes(e.entity_id)) out.push({ key: `grp:${x.entity_id}`, text: `member of ${x.aliases?.name ?? x.entity_id}`, ref: x.entity_id, icon: Boxes });
  }
  for (const id of e.track?.contributing ?? []) out.push({ key: `obs:${id}`, text: `observed by ${name(id)}`, ref: id, icon: Radar });
  if (p && e.ontology?.template === 'track' && e.mil_view?.identity !== 'friend' && e.mil_view?.identity !== 'assumed_friend') {
    let best: { id: string; d: number } | null = null;
    for (const x of client.entities.values()) {
      if (!x.effector || !x.location) continue;
      const d = distance(p, [x.location.lon, x.location.lat]);
      if (!best || d < best.d) best = { id: x.entity_id, d };
    }
    if (best) out.push({ key: `near:${best.id}`, text: `${formatDistance(best.d)} from ${name(best.id)}`, ref: best.id, icon: Crosshair });
  }
  // Engagements: the latest against this track, or the latest few by this fire unit.
  const seen = new Set<string>();
  for (let i = events.length - 1; i >= 0 && seen.size < 5; i--) {
    const r = events[i]!;
    if (r.kind !== 'engagement') continue;
    const g = r.payload as EngagementPayload;
    if (g.target_id === e.entity_id && !seen.has(g.effector_id)) {
      seen.add(g.effector_id);
      out.push({ key: `eng:${g.effector_id}`, text: `${g.result} by ${name(g.effector_id)}`, ref: g.effector_id, icon: Swords });
    } else if (g.effector_id === e.entity_id && !seen.has(g.target_id)) {
      seen.add(g.target_id);
      out.push({ key: `eng:${g.target_id}`, text: `${g.result} ${name(g.target_id)}`, ref: g.target_id, icon: Swords });
    }
  }
  return out.slice(0, 24);
}

function LinkedObjects({ e, t }: { e: Entity; t: number }) {
  const client = useClient();
  const view = useViewStore();
  const events = useEvents();
  const links = linksOf(e, client, events, t);
  return (
    <ActionList accessibilityLabel="Linked objects">
      <ActionListSection title={links.length ? `Linked objects · ${links.length}` : 'Linked objects · none'}>
        {links.map((l) => (
          <ActionListItem
            key={l.key}
            value={l.key}
            title={l.text}
            leading={<ActionListItemIcon icon={l.icon} />}
            trailing={<ActionListItemText>{l.ref}</ActionListItemText>}
            onClick={() => view.set({ selected: l.ref })}
          />
        ))}
      </ActionListSection>
    </ActionList>
  );
}

function EntityActivity({ id, limit, hideEmpty = false }: { id: string; limit: number; hideEmpty?: boolean }) {
  const client = useClient();
  const events = useEvents();
  const clock = client.scenario?.clock;
  const mine: JournalRecord[] = [];
  for (let i = events.length - 1; i >= 0 && mine.length < limit; i--) {
    const r = events[i]!;
    const s = eventSummary(r);
    const p = r.payload as { effector_id?: string; rule_id?: string } | undefined;
    if (r.entity_id === id || s.subject === id || p?.effector_id === id || p?.rule_id === `geofence:${id}`) mine.push(r);
  }
  if (hideEmpty && !mine.length) return null;
  return (
    <ActionList accessibilityLabel="Entity activity">
      <ActionListSection title={mine.length ? 'Activity' : 'Activity · none received yet'}>
        {mine.map((r) => {
          const s = eventSummary(r);
          return (
            <ActionListItem
              key={r.record_id}
              value={r.record_id}
              title={s.title}
              description={s.detail}
              leading={<ActionListItemIcon icon={KIND_ICON[r.kind as keyof typeof KIND_ICON] ?? Boxes} />}
              trailing={<ActionListItemText>{raidLabel(r.ingest_time, clock)}</ActionListItemText>}
            />
          );
        })}
      </ActionListSection>
    </ActionList>
  );
}

function TheatreSummary({ derived }: { derived: Derived }) {
  const client = useClient();
  const view = useViewStore();
  const threshold = client.scenario?.counts.saturationThreshold ?? 0;
  const ringMax = Math.max(1, threshold, ...Object.values(derived.rings));
  const rings: Array<[keyof Derived['rings'], string, 'Information' | 'Notice' | 'Negative']> = [
    ['R4', '150–60 km', 'Information'],
    ['R3', '60–20 km', derived.rings.R3 > threshold ? 'Notice' : 'Information'],
    ['R2', '20–5 km', 'Notice'],
    ['R1', '5–0 km', 'Negative'],
  ];
  return (
    <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
      <div className="bs-stack">
        <section className="bs-stack bs-pad" aria-label="Hostile tracks per ring">
          <span className="BodySmallSemibold">Rings · hostile tracks</span>
          {rings.map(([k, span, color]) => (
            <ProgressBar key={k} type="meter" color={color} value={derived.rings[k]} max={ringMax} label={`${k} · ${span} · ${derived.rings[k]}${k === 'R3' && threshold ? ` / ${threshold} channels` : ''}`} />
          ))}
        </section>
        <ActionList accessibilityLabel="Rules and raid groups">
          {derived.activeRules.length ? (
            <ActionListSection title={`Rules fired · ${derived.activeRules.length}`}>
              {derived.activeRules.map((r) => {
                // A geofence reads as the fence and its count; the latest entry or exit is the detail.
                const fence = r.payload.rule === 'geofence' ? client.entities.get(r.payload.rule_id.slice('geofence:'.length)) : undefined;
                const title = fence ? `${fence.aliases?.name ?? fence.entity_id} · ${r.payload.value ?? 0} inside` : eventSummary(r).title;
                return (
                  <ActionListItem
                    key={r.record_id}
                    value={r.record_id}
                    title={title}
                    description={r.payload.note ?? ''}
                    intent="negative"
                    leading={<ActionListItemIcon icon={TriangleAlert} />}
                    {...(fence ? { onClick: () => view.set({ selected: fence.entity_id }) } : {})}
                  />
                );
              })}
            </ActionListSection>
          ) : null}
          <ActionListSection title={`Raid groups · ${derived.groups.length}`}>
            {derived.groups.map((g) => (
              <ActionListItem
                key={g.entity_id}
                value={g.entity_id}
                title={g.aliases?.name ?? g.entity_id}
                description={`${g.group?.axis ?? ''} · ${g.group?.wave ?? ''}`}
                leading={<ActionListItemIcon icon={Boxes} />}
                trailing={<ActionListItemText>{String(g.group?.members.length ?? 0)}</ActionListItemText>}
                onClick={() => view.set({ selected: g.entity_id, highlight: g.group?.members ?? [] })}
              />
            ))}
          </ActionListSection>
        </ActionList>
        <FireUnits effectors={derived.effectors} />
      </div>
    </ScrollArea>
  );
}

/** Size of a shape in one line: position, length, area and perimeter, or radius. */
function shapeSummary(shape: GeoShape): string {
  switch (shape.type) {
    case 'point':
      return formatMgrs(shape.coordinates);
    case 'line':
      return formatDistance(pathLength(shape.coordinates));
    case 'polygon': {
      const a = ringArea(shape.coordinates[0] ?? []);
      return `${formatArea(a.area_m2)} · ${formatDistance(a.perimeter_m)}`;
    }
    case 'circle':
      return `r ${formatDistance(shape.radius_m)} · ${formatArea(Math.PI * shape.radius_m ** 2)}`;
    default:
      return shape.type;
  }
}

/** Watched tracks inside a geofence at t, from the positions on screen. */
function insideNow(client: MapClient, shape: GeoShape, watch: 'hostile' | 'unidentified' | 'any', t: number): number {
  let n = 0;
  const tmp: [number, number, number] = [0, 0, 0];
  for (const x of client.entities.values()) {
    if (!watchedBy(x, watch)) continue;
    const p = client.positionAt(x.entity_id, t, tmp);
    if (p && pointInShape([p[0], p[1]], shape)) n++;
  }
  return n;
}
