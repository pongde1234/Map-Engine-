/**
 * Inspector.
 *  - Entity (the selected object, or the current storyboard frame's subject): caption, title
 *    and Badges, then Tabs. Fused tracks: Fusion (hypothesis Cards, kinematics, provenance,
 *    recent activity) · Provenance (source and registration, source, time, record) · Intel
 *    (reported evidence) · Links (linked objects, lineage thread) · Activity. Everything else:
 *    Overview (its own facts) · Provenance · Links · Activity. Actions pin to the foot.
 *  - Nothing selected: theatre summary — hostile tracks per ring (Rings), raid groups
 *    (RaidGroups), fire units by defence layer (FireUnits). Rule firings are in the Alerts feed
 *    and on the timeline.
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
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ProgressBar,
  ScrollArea,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
  Tooltip,
  useToast,
} from '@faclon-labs/fds';
import { useState } from 'react';
import { Boxes, Crosshair, FileSearch, Gavel, MapPin, Radar, ShieldAlert, Swords, TriangleAlert, Wrench, X } from 'lucide-react';
import { CLASSES, formatZulu, sidcWithIdentity, watchedBy, type EngagementPayload, type Entity, type GeoShape, type JournalRecord, type OperatorColor } from '@me/schema';
import { distance, formatArea, formatDistance, formatMgrs, formatRangeBearing, headingSpeed, inverse, pathLength, pointInShape, ringArea } from '@me/geo';
import type { MapClient } from '@me/client';
import { operatorTone, toneColor, toneCss } from '@me/map';
import { useClient, useEngineTime, useEvents, useLineage, useSelectedEntity, useViewStore } from '@me/map-react';
import { ColorPicker } from './ColorPicker.tsx';
import { SymbolGlyph } from './glyphs.tsx';
import { FireUnits } from './FireUnits.tsx';
import { Rings } from './Rings.tsx';
import { TheatreStrip } from './TheatreStrip.tsx';
import { RaidGroups } from './RaidGroups.tsx';
import { MAG_COLOR, magState } from './magazine.ts';
import { Facts, type Fact } from './Facts.tsx';
import { Section } from './Section.tsx';
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
export function entityTitle(e: Entity): string {
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
  const [confirming, setConfirming] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const name = e.aliases?.name ?? e.entity_id;
  // A withdrawn object leaves the picture, and the engine does not take its id back: restoring it
  // draws the same shape again as a new object (its layer, colour and note kept).
  const restore = async () => {
    if (!e.geo_shape || !e.geo_details) return;
    const { author: _author, ...details } = e.geo_details;
    try {
      const rec = await client.publish({ payload: { ...(e.aliases ? { aliases: e.aliases } : {}), geo_shape: e.geo_shape, geo_details: details } });
      toast.show({ color: 'Positive', content: `“${name}” is back on the map.` });
      view.set({ selected: rec.entity_id ?? null });
    } catch (err) {
      toast.show({ color: 'Negative', content: (err as Error).message });
    }
  };
  const withdraw = async () => {
    setWithdrawing(true);
    try {
      await client.publish({ entity_id: e.entity_id, payload: { is_live: false } });
      setConfirming(false);
      toast.show({ color: 'Neutral', content: `“${name}” withdrawn.`, ...(e.geo_shape ? { action: { text: 'Undo', onClick: () => void restore() }, duration: 8000 } : {}) });
      view.set({ selected: null });
    } catch (err) {
      toast.show({ color: 'Negative', content: (err as Error).message });
    } finally {
      setWithdrawing(false);
    }
  };
  return (
    <div className="bs-insp">
      {/* The theatre stays in view while an object is inspected; a click returns to the full summary. */}
      <div className="bs-insp__pin">
        <TheatreStrip
          derived={derived}
          channels={client.scenario?.counts.saturationThreshold ?? 0}
          engaging={derived.effectors.filter((x) => (x.effector?.channels.busy ?? 0) > 0).length}
          onOpen={() => view.set({ selected: null, highlight: [] })}
        />
      </div>
      <div className="bs-insp__head">
        <div className="bs-insp__caption">
          <span className="BodySmallMedium bs-muted bs-ellipsis">
            {ref} · {kindWord(e)}
          </span>
          <Tooltip content="Clear selection (Esc)">
            <Button iconOnly variant="ghost" tone="neutral" size="xs" aria-label="Clear selection" onClick={() => view.set({ selected: null, highlight: [] })}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
        <div className="bs-insp__title">
          {sidc ? <SymbolGlyph sidc={sidc} size={20} title={CLASSES[e.ontology?.class ?? '']?.label} /> : null}
          {operatorObject && e.geo_shape ? (
            <span className="bs-swatch" role="img" aria-label="Its colour on the map" style={{ background: toneCss(operatorTone(e.geo_details, !!(e.geo_details?.layer && client.entities.has(e.geo_details.layer)))) }} />
          ) : null}
          <span className="HeadingSmallSemibold bs-ellipsis">{entityTitle(e)}</span>
        </div>
        <div className="bs-insp__chips">
          {e.classification?.contested ? <Badge size="Medium" color="Neutral" emphasis="Intense" label="CONTESTED" /> : null}
          {e.mil_view ? <Badge size="Medium" color={IDENTITY_COLOR[e.mil_view.identity]} emphasis="Subtle" label={e.mil_view.identity.replace('_', ' ').toUpperCase()} /> : null}
          {e.track?.state && e.track.state !== 'detected' && e.track.state !== 'inbound' ? (
            <Badge size="Medium" color={e.track.state === 'destroyed' ? 'Positive' : 'Notice'} emphasis="Subtle" label={e.track.state.toUpperCase()} />
          ) : null}
          {commandObject ? (
            // Command objects do not age: they hold until withdrawn or expired.
            <Badge size="Medium" color={e.geo_details?.status === 'active' ? 'Positive' : 'Neutral'} emphasis="Subtle" label={(e.geo_details?.status ?? 'active').toUpperCase()} />
          ) : (
            <Badge size="Medium" color={AGE_BADGE[age]} emphasis="Subtle" label={age === 'disc' ? 'DISC · NO LINK' : `${AGE_WORD[age]} · ${ageLabel(ageMs)}`} />
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
            <div className="bs-divided">
              {e.classification ? <Hypotheses e={e} /> : null}
              {e.fragment ? <p className="BodySmallRegular bs-pad">{e.fragment.summary}</p> : null}
              <Facts items={overviewFacts(e, client, derived, t)} />
              {operatorObject && e.geo_shape && e.geo_details ? <ObjectColor e={e} /> : null}
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
                  <span className="BodySmallRegular bs-muted bs-ellipsis">
                    {e.provenance.source_feed} · {when(e.ingest_time)}
                  </span>
                  <ChainBadge />
                </div>
              )}
              <EntityActivity id={e.entity_id} limit={5} hideEmpty />
            </div>
          </TabPanel>
          <TabPanel value="prov">
            <div className="bs-divided">
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
            </div>
          </TabPanel>
          {fusedTrack ? (
            <TabPanel value="intel">
              <Evidence e={e} />
            </TabPanel>
          ) : null}
          <TabPanel value="links">
            <LinksTab e={e} t={t} />
          </TabPanel>
          <TabPanel value="activity">
            <EntityActivity id={e.entity_id} limit={60} />
          </TabPanel>
        </ScrollArea>
      </Tabs>
      {/* One footer band, one line above it, whatever it holds. */}
      {operatorObject || nominable ? (
        <div className="bs-insp__foot">
          {operatorObject ? (
            <div className="bs-insp__footbtns">
              {/* Close, then the withdrawal: the order and tones of the alert and source dialogs. */}
              <Button size="sm" variant="secondary" tone="neutral" isFullWidth onClick={() => view.set({ selected: null })}>
                Close
              </Button>
              <Tooltip content="Removes it from the map; the original stays in the record">
                <Button size="sm" variant="primary" tone="negative" isFullWidth onClick={() => setConfirming(true)}>
                  Withdraw
                </Button>
              </Tooltip>
            </div>
          ) : null}
          {nominable ? (
            <div className="bs-insp__footbtns">
              <Tooltip content={`${e.classification?.contested ? 'Hypotheses travel with the card. ' : ''}The board shows its pairing options and checks`}>
                <Button size="sm" variant="primary" tone="brand" isFullWidth isDisabled={!onNominate} onClick={() => onNominate?.(e.entity_id)}>
                  Nominate to board
                </Button>
              </Tooltip>
              <Tooltip content="The assistant explains it from the record">
                <Button size="sm" variant="secondary" tone="neutral" isFullWidth isDisabled={!onAsk} onClick={() => onAsk?.(`Explain ${e.aliases?.track_number ?? e.entity_id}`)}>
                  Ask the assistant
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </div>
      ) : null}
      <Modal isOpen={confirming} onDismiss={() => setConfirming(false)} size="sm" accessibilityLabel="Withdraw object">
        <ModalHeader title={`Withdraw “${name}”?`} />
        <ModalBody>
          <p className="BodyMediumRegular">It leaves the map from this time on. The original stays in the record{e.geo_shape ? ', and Undo in the notice that follows draws it again' : ''}.</p>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="secondary" tone="neutral" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" tone="negative" isLoading={withdrawing} onClick={() => void withdraw()}>
            Withdraw
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

/** Hypotheses within margin, the leading one selected. */
function Hypotheses({ e }: { e: Entity }) {
  const c = e.classification!;
  const evidence = e.track?.sensor_classes?.length ? e.track.sensor_classes.join(' + ') : (e.provenance.sensor_class ?? e.provenance.source_feed);
  return (
    <Section title="Hypotheses within margin" trailing={<span className="BodySmallRegular bs-ink-secondary bs-num">margin {c.margin.toFixed(2)}</span>}>
      {c.hypotheses.map((h, i) => {
        const lk = LIKELIHOOD(h.p);
        return (
          <Card key={h.class} padding={12} size="Medium" isSelected={i === 0}>
            <div className="bs-hcard">
              <span className="bs-hcard__text">
                <span className="BodyMediumMedium bs-ellipsis">{h.label}</span>
                <span className="BodySmallRegular bs-ink-secondary">
                  p {h.p.toFixed(2)} · {evidence}
                </span>
              </span>
              <Badge size="Medium" color={lk.color} emphasis="Subtle" label={lk.word} />
            </div>
          </Card>
        );
      })}
    </Section>
  );
}

/** Caption word for the entity's kind. */
export function kindWord(e: Entity): string {
  if (e.geo_shape && e.layer === 'command') return 'COMMAND OBJECT';
  if (e.layer === 'reference') return 'REFERENCE';
  if (e.fragment) return 'INTEL FRAGMENT';
  return `${e.layer.toUpperCase()} ${(e.ontology?.template ?? 'entity').toUpperCase()}`;
}

export const GEO_WORD: Partial<Record<string, string>> = { wcs_sector: 'WCS sector', nfz: 'No-fly zone', sea_restriction: 'Sea restriction', picket_box: 'Picket box', wez: 'Engagement zone', debris_footprint: 'Debris footprint', soft_kill_area: 'Soft-kill area', vp: 'Defended point' };

/** The facts that matter for this kind of entity, most useful first. */
/**
 * A drawn object's colour on the map: the console's pick until the operator chooses another.
 * Choosing records the object again at the picture time, as the operator, with the colour set;
 * resetting records it without one. A geofence's colour changes without re-running its rule.
 */
function ObjectColor({ e }: { e: Entity }) {
  const client = useClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const gd = e.geo_details!;
  const layerLive = !!(gd.layer && client.entities.has(gd.layer));
  const set = async (color?: OperatorColor) => {
    setBusy(true);
    try {
      const { color: _old, ...rest } = gd;
      await client.publish({ entity_id: e.entity_id, payload: { ...(e.aliases ? { aliases: e.aliases } : {}), geo_shape: e.geo_shape!, geo_details: { ...rest, ...(color ? { color } : {}) } } });
    } catch (err) {
      toast.show({ color: 'Negative', content: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Colour on the map">
      <ColorPicker value={toneColor(operatorTone(gd, layerLive))} isDefault={!gd.color} isDisabled={busy} onChange={(c) => void set(c)} onReset={() => void set()} />
    </Section>
  );
}

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
    e.effector && ['Status', <Badge size="Medium" color={e.effector.status === 'down' ? 'Negative' : e.effector.status === 'engaging' ? 'Notice' : 'Positive'} emphasis="Subtle" label={e.effector.status.toUpperCase()} />],
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
    e.plant?.rank !== undefined && ['Rank', `${e.plant.rank} · RIL-reviewed`],
    e.plant?.interlock && ['Interlock', e.plant.interlock],
    // Intel fragments.
    e.fragment && ['Source', e.fragment.source_kind.replaceAll('_', ' ')],
    e.fragment && ['Confidence', <Badge size="Medium" color={e.fragment.confidence === 'confirmed' ? 'Positive' : e.fragment.confidence === 'likely' ? 'Notice' : 'Neutral'} emphasis="Subtle" label={e.fragment.confidence.toUpperCase()} />],
    e.fragment && ['Associated', e.fragment.associated ? 'Yes' : <Badge size="Medium" color="Neutral" emphasis="Intense" label="UNASSOCIATED" />],
    e.location_uncertainty && ['Uncertainty', `${(e.location_uncertainty.semi_major_m / 1000).toFixed(1)} × ${(e.location_uncertainty.semi_minor_m / 1000).toFixed(1)} km`],
    // Raid groups.
    e.group && ['Members', String(e.group.members.length)],
    e.group?.axis && ['Axis · wave', `${e.group.axis} · ${e.group.wave ?? '—'}`],
    // Command objects.
    gd && e.geo_shape && ['Type', GEO_WORD[gd.type] ?? gd.type.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase())],
    e.geo_shape && ['Size', shapeSummary(e.geo_shape)],
    gd?.ring && ['Ring', gd.ring],
    // A predicted aimpoint's time on target is a forecast, counted from the picture time.
    gd?.tot !== undefined && ['Time on target', `${raidLabel(gd.tot, client.scenario?.clock)} · ${gd.tot > t ? `in ${Math.ceil((gd.tot - t) / 60_000)} min` : 'passed'} · forecast`, 'wide'],
    gd?.wcs && ['Weapons control', <Badge size="Medium" color={gd.wcs === 'free' ? 'Negative' : gd.wcs === 'tight' ? 'Notice' : 'Positive'} emphasis="Subtle" label={gd.wcs.toUpperCase()} />],
    gd?.tier !== undefined && !e.plant && ['Tier', `Tier ${gd.tier}`],
    gd?.watch && ['Alert on', gd.watch === 'any' ? 'Any track' : `${gd.watch[0]!.toUpperCase()}${gd.watch.slice(1)} tracks`],
    gd?.type === 'geofence' && e.geo_shape && ['Inside now', String(insideNow(client, e.geo_shape, gd.watch ?? 'hostile', t))],
    // Operator objects: the layer it sits in (a withdrawn layer's objects are back in Operator objects).
    e.provenance.integration === 'console' && e.geo_shape && ['Layer', (gd?.layer && client.entities.get(gd.layer)?.aliases?.name) || 'Operator objects', 'wide'],
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
    <Badge size="Medium" color="Negative" emphasis="Intense" label={`BROKEN AT ${h.chain.brokenAt}`} />
  );
}

/** The records that matter in a lineage: what an entity came from or led to, not the bare observations. */
const meaningfulOf = (records: JournalRecord[]) => records.filter((r) => r.kind !== 'observation' && !(r.kind === 'fused' && !r.derived_from?.length));

function Lineage({ id, meaningful }: { id: string; meaningful: JournalRecord[] }) {
  const client = useClient();
  const view = useViewStore();
  const clock = client.scenario?.clock;
  return (
    <Section
      title="Lineage"
      count={meaningful.length}
      trailing={
        <Button size="xs" variant="secondary" tone="neutral" onClick={() => view.set({ highlight: meaningful.map((r) => r.entity_id ?? '').filter(Boolean) })}>
          Trace on map
        </Button>
      }
    >
      <ActionList accessibilityLabel="Lineage records">
        {meaningful.map((r) => {
          const s = eventSummary(r);
          return (
            <ActionListItem
              key={r.record_id}
              value={r.record_id}
              title={s.title}
              // The time leads the second line (as in the event feed), so nothing is pushed past the row.
              description={`${raidLabel(r.ingest_time, clock)} · ${r.kind} · ${shortHash(r.hash)}`}
              leading={<ActionListItemIcon icon={KIND_ICON[r.kind as keyof typeof KIND_ICON] ?? Boxes} />}
              onClick={() => s.subject && s.subject !== id && view.set({ selected: s.subject, locate: s.subject })}
            />
          );
        })}
      </ActionList>
    </Section>
  );
}

/** Reported evidence behind a fused track: its contributing sensors and any intel in its thread. */
function Evidence({ e }: { e: Entity }) {
  const client = useClient();
  const { records, loading } = useLineage(e.entity_id);
  const clock = client.scenario?.clock;
  const sensors = (e.track?.contributing ?? []).map((id) => ({ id, s: client.entities.get(id) }));
  const intel = records.filter((r) => r.kind === 'fragment');
  // Nothing reported: no heading, no section.
  if (!sensors.length && !intel.length) return <p className="BodySmallRegular bs-muted bs-pad">{loading ? 'Loading…' : 'No reported evidence yet.'}</p>;
  return (
    <Section title="Reported evidence">
      {sensors.map(({ id, s }) => (
        <Card key={id} padding={12} size="Medium">
          <span className="bs-hcard__text">
            <span className="BodyMediumMedium bs-ellipsis">{s?.aliases?.name ?? id}</span>
            <span className="BodySmallRegular bs-ink-secondary">
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
              <span className="BodyMediumMedium">
                {raidLabel(r.ingest_time, clock)} · {sum.title}
              </span>
              {sum.detail ? <span className="BodySmallRegular bs-ink-secondary">{sum.detail}</span> : null}
            </span>
          </Card>
        );
      })}
    </Section>
  );
}

type LinkIcon = typeof Boxes;

interface Link {
  key: string;
  text: string;
  ref: string;
  icon: LinkIcon;
}

/** The Links tab: linked objects and lineage, each only when it has something to show. */
function LinksTab({ e, t }: { e: Entity; t: number }) {
  const client = useClient();
  const events = useEvents();
  const links = linksOf(e, client, events, t);
  const { records, loading } = useLineage(e.entity_id);
  const meaningful = meaningfulOf(records);
  if (!links.length && !meaningful.length) return <p className="BodySmallRegular bs-muted bs-pad">{loading ? 'Loading…' : 'No linked records.'}</p>;
  return (
    <div className="bs-divided">
      {links.length ? <LinkedObjects links={links} /> : null}
      {meaningful.length ? <Lineage id={e.entity_id} meaningful={meaningful} /> : null}
    </div>
  );
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

function LinkedObjects({ links }: { links: Link[] }) {
  const view = useViewStore();
  return (
    <Section title="Linked objects" count={links.length}>
      <ActionList accessibilityLabel="Linked objects">
        {links.map((l) => (
          <ActionListItem
            key={l.key}
            value={l.key}
            title={l.text}
            leading={<ActionListItemIcon icon={l.icon} />}
            trailing={<ActionListItemText>{l.ref}</ActionListItemText>}
            onClick={() => view.set({ selected: l.ref, locate: l.ref })}
          />
        ))}
      </ActionList>
    </Section>
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
  // Nothing received: no heading, no section (the tab says so in a line).
  if (!mine.length) return hideEmpty ? null : <p className="BodySmallRegular bs-muted bs-pad">No activity received yet.</p>;
  return (
    <Section title="Activity">
      <ActionList accessibilityLabel="Entity activity">
        {mine.map((r) => {
          const s = eventSummary(r);
          return (
            <ActionListItem
              key={r.record_id}
              value={r.record_id}
              title={s.title}
              description={s.detail ? `${raidLabel(r.ingest_time, clock)} · ${s.detail}` : raidLabel(r.ingest_time, clock)}
              leading={<ActionListItemIcon icon={KIND_ICON[r.kind as keyof typeof KIND_ICON] ?? Boxes} />}
            />
          );
        })}
      </ActionList>
    </Section>
  );
}

function TheatreSummary({ derived }: { derived: Derived }) {
  const client = useClient();
  const threshold = client.scenario?.counts.saturationThreshold ?? 0;
  return (
    <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
      <div className="bs-divided">
        <Rings rings={derived.rings} closing={derived.closing} channels={threshold} />
        <RaidGroups groups={derived.groups} />
        <FireUnits effectors={derived.effectors} />
      </div>
    </ScrollArea>
  );
}

/** Size of a shape in one line: position, length, area and perimeter, or radius. */
export function shapeSummary(shape: GeoShape): string {
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
