/**
 * Evidence pack (storyboard C2): the record that goes to the national level, assembled from the
 * journal as known at the picture time. Seven source-linked sections (decision log with every
 * authority and token, BDA, debris attribution, the adversary's claims with counter-facts,
 * narrative support with unverified items held back, response options left as options,
 * reconstitution), completeness, the chain check to the picture time, and the gap analysis.
 * Measured times stand apart from the CONOP's one-hour target, which is labelled as a target.
 * Read-only; the export is a local file. FDS components only.
 */
import { useMemo } from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionItemBody,
  AccordionItemHeader,
  ActionList,
  ActionListItem,
  ActionListItemBadge,
  ActionListItemText,
  ActionListSection,
  Badge,
  Button,
  Card,
  Metric,
  ProgressBar,
  Radio,
  RadioGroup,
  ScrollArea,
  TabItem,
  TabList,
  TabPanel,
  Tabs,
} from '@faclon-labs/fds';
import { Download, UserRoundCog } from 'lucide-react';
import { formatZulu, type RaidClock } from '@me/schema';
import { useClient, useClientTick, useEngineTime } from '@me/map-react';
import { Facts, PACK_TARGET, evidencePack, packJson, raidLabel, shortHash, useAccounting, useChainCheck, useDerived, type EvidencePack, type PackItem, type PackSection, type SectionStatus } from '@me/ui';
import type { Presenter } from './presenter.ts';

type BadgeColor = 'Positive' | 'Notice' | 'Negative' | 'Neutral' | 'Information';

const STATUS: Record<SectionStatus, { label: string; color: BadgeColor }> = {
  sourced: { label: 'SOURCED', color: 'Positive' },
  partial: { label: 'PARTIAL', color: 'Notice' },
  gap: { label: 'GAP', color: 'Negative' },
  withheld: { label: 'NOT RELEASABLE', color: 'Neutral' },
};

function ItemRow({ i, clock }: { i: PackItem; clock: RaidClock | undefined }) {
  return (
    <ActionListItem
      value={i.id}
      title={i.title}
      description={[i.detail, i.source, i.hash ? shortHash(i.hash) : null].filter(Boolean).join(' · ')}
      {...(i.unresolved ? { titleSuffix: <ActionListItemBadge className="bs-tag" size="Small" color="Notice" emphasis="Subtle" label="OPEN" /> } : {})}
      trailing={<ActionListItemText>{raidLabel(i.at, clock)}</ActionListItemText>}
    />
  );
}

export function EvidencePage({ presenter }: { presenter: Presenter }) {
  const client = useClient();
  const tick = useClientTick(500);
  const t = useEngineTime(1000);
  const derived = useDerived(1000);
  const role = client.identity?.role ?? 'l3';
  const clock = client.scenario?.clock;
  const { accounting } = useAccounting(t, role);
  const { check } = useChainCheck(t);
  const built = useMemo(() => {
    const t0 = performance.now();
    const pack = evidencePack(client, derived, accounting, t);
    return { pack, ms: Math.max(1, Math.round(performance.now() - t0)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tick, derived, accounting, Math.floor(t / 60_000)]);
  const { pack, ms } = built;
  const frame = presenter.current?.page === 'evidence' ? presenter.current : undefined;
  const asOf = clock ? raidLabel(pack.asOf, clock) : formatZulu(pack.asOf);
  const run = `${client.scenario?.id ?? 'scenario'} · seed ${client.scenario?.seed ?? '—'}`;
  const withheld = pack.sections.some((s) => s.status === 'withheld');

  const download = () => {
    const blob = new Blob([packJson(pack, { asOfLabel: asOf, role, run, verify: check, assembledMs: ms })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `evidence-pack-${asOf.replace(/[^A-Za-z0-9+-]/g, '')}-${role}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="db">
      <div className="sv__bar">
        <Badge size="Small" color="Information" emphasis="Subtle" label={`PACK AS OF ${asOf} · ${formatZulu(pack.asOf).slice(0, 5)}Z`} />
        <Badge size="Small" color="Neutral" emphasis="Subtle" label={`VIEW ${(client.identity?.display ?? role).toUpperCase()}`} />
        <Badge size="Small" color="Notice" emphasis="Intense" label="SYNTHETIC" />
        {frame ? <Badge size="Small" color="Neutral" emphasis="Subtle" label={`${frame.id} · ${frame.caption ?? frame.label}`} /> : null}
        <span className="bs-fill" />
        {withheld ? (
          <Button size="xs" variant="secondary" tone="neutral" leadingIcon={<UserRoundCog size={14} />} onClick={() => client.setRole('l1')}>
            View as L1
          </Button>
        ) : null}
        <Button size="xs" variant="primary" tone="brand" leadingIcon={<Download size={14} />} onClick={download}>
          Export pack
        </Button>
      </div>

      <ScrollArea className="sv__main" viewportClassName="bs-scroll__viewport">
        <div className="sv__content">
          <div className="db__tiles db__tiles--4" aria-label="Pack status">
            <Card padding={12} size="Medium" accessibilityLabel="Completeness">
              <div className="tb-tile">
                <div className="tb-tile__head">
                  <span className="BodyXSmallSemibold">COMPLETENESS</span>
                  <Badge className="bs-tag" size="Small" color={pack.sourced === pack.sections.length ? 'Positive' : 'Notice'} emphasis="Subtle" label={`${pack.gaps.length} GAPS`} />
                </div>
                <ProgressBar type="meter" label={`${pack.sourced} of ${pack.sections.length} sections sourced`} value={pack.sourced} max={pack.sections.length} color={pack.sourced === pack.sections.length ? 'Positive' : 'Notice'} />
                <span className="BodyXSmallRegular bs-muted">Every item names its source, time and record</span>
              </div>
            </Card>
            <Card padding={12} size="Medium" accessibilityLabel="Integrity">
              <div className="tb-tile">
                <div className="tb-tile__head">
                  <span className="BodyXSmallSemibold">INTEGRITY</span>
                  <Badge className="bs-tag" size="Small" color={check ? (check.ok ? 'Positive' : 'Negative') : 'Neutral'} emphasis="Subtle" label={check ? (check.ok ? 'CHAIN VERIFIED' : 'CHAIN BROKEN') : 'CHECKING'} />
                </div>
                <span className="BodySmallSemibold bs-num bs-ellipsis">{check?.head ? shortHash(check.head.hash) : '—'}</span>
                <span className="BodyXSmallRegular bs-muted bs-ellipsis">{check ? `${check.checked.toLocaleString('en')} records to ${raidLabel(check.head?.t ?? pack.asOf, clock)}` : 'Hash chain to the pack time'}</span>
              </div>
            </Card>
            <Card padding={12} size="Medium" accessibilityLabel="Measured">
              <div className="tb-tile">
                <div className="tb-tile__head">
                  <span className="BodyXSmallSemibold">MEASURED</span>
                  <Badge className="bs-tag" size="Small" color="Information" emphasis="Subtle" label="THIS RUN" />
                </div>
                <Metric type="Heading" size="Small" value={ms} unit="ms assembled" suffix="none" color="Neutral" />
                <span className="BodyXSmallRegular bs-muted">{check ? (check.cached ? 'Chain prefix verified earlier on this server' : `Chain check ${(check.ms / 1000).toFixed(1)} s on the server`) : 'Chain check pending'}</span>
              </div>
            </Card>
            <Card padding={12} size="Medium" accessibilityLabel="CONOP target">
              <div className="tb-tile">
                <div className="tb-tile__head">
                  <span className="BodyXSmallSemibold">CONOP TARGET</span>
                  <Badge className="bs-tag" size="Small" color="Neutral" emphasis="Subtle" label="TARGET" />
                </div>
                <span className="BodySmallSemibold">{PACK_TARGET}</span>
                <span className="BodyXSmallRegular bs-muted">The CONOP's target, not a measured result</span>
              </div>
            </Card>
          </div>

          <Accordion variant="filled" showNumberPrefix selectionType="multiple" defaultExpandedIndex={[3, 4, 6]}>
            {pack.sections.map((s) => (
              <AccordionItem key={s.id}>
                <AccordionItemHeader title={s.title} subtitle={s.note} titleSuffix={<Badge className="bs-tag" size="Small" color={STATUS[s.status].color} emphasis="Subtle" label={STATUS[s.status].label} />} />
                <AccordionItemBody>
                  <SectionBody s={s} pack={pack} clock={clock} />
                </AccordionItemBody>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </ScrollArea>

      <aside className="sv__record" aria-label="Gaps and integrity">
        <Tabs className="bs-tabs-fill" defaultValue="gaps" size="Small" variant="filled">
          <div className="bs-tabbar bs-tabbar--insp">
            <TabList>
              <TabItem value="gaps">Gap analysis</TabItem>
              <TabItem value="integrity">Integrity</TabItem>
            </TabList>
          </div>
          <ScrollArea className="bs-scroll" viewportClassName="bs-scroll__viewport">
            <TabPanel value="gaps">
              <section className="bs-stack bs-pad" aria-label="Gap analysis">
                <Card padding={12} size="Medium" accessibilityLabel="Gaps">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className="BodyXSmallSemibold">WHAT THE RECORD DOES NOT HOLD</span>
                      <Badge className="bs-tag" size="Small" color={pack.gaps.length ? 'Notice' : 'Positive'} emphasis="Subtle" label={`${pack.gaps.length} ITEMS`} />
                    </div>
                    <ActionList accessibilityLabel="Gaps and open items">
                      {pack.gaps.map((g) => (
                        <ActionListItem key={g.id} value={g.id} title={g.title} description={[g.detail, g.source].filter(Boolean).join(' · ')} />
                      ))}
                    </ActionList>
                  </div>
                </Card>
              </section>
            </TabPanel>
            <TabPanel value="integrity">
              <section className="bs-stack bs-pad" aria-label="Integrity">
                <Card padding={12} size="Medium" accessibilityLabel="Chain check">
                  <div className="tb-check">
                    <div className="tb-check__head">
                      <span className="BodyXSmallSemibold">CHAIN CHECK TO THE PACK TIME</span>
                      <Badge className="bs-tag" size="Small" color={check?.ok ? 'Positive' : 'Neutral'} emphasis="Subtle" label={check ? (check.ok ? 'VERIFIED' : 'BROKEN') : 'CHECKING'} />
                    </div>
                    <Facts
                      flush
                      items={[
                        ['Records checked', check ? check.checked.toLocaleString('en') : '—'],
                        ['Server time', check ? (check.cached ? 'Verified earlier (load or prior check)' : `${(check.ms / 1000).toFixed(1)} s`) : '—'],
                        ['Head at the pack time', check?.head ? `${check.head.hash.slice(0, 16)}…` : '—', 'wide'],
                        ['Head record', check?.head ? `#${check.head.seq.toLocaleString('en')} · ${raidLabel(check.head.t, clock)}` : '—', 'wide'],
                        ['Run', run, 'wide'],
                        ['Pack assembled', `${ms} ms in this console (measured)`, 'wide'],
                        ['CONOP target', `${PACK_TARGET}: a target, not a measured result`, 'wide'],
                      ]}
                    />
                  </div>
                </Card>
              </section>
            </TabPanel>
          </ScrollArea>
        </Tabs>
        <div className="bs-insp__foot">
          <span className="BodyXSmallRegular bs-muted">Verified events stand apart from unresolved claims. Response options stay with L1; nothing here is published.</span>
        </div>
      </aside>
    </div>
  );

}

function SectionBody({ s, pack, clock }: { s: PackSection; pack: EvidencePack; clock: RaidClock | undefined }) {
  if (s.id === 'claims' && pack.claims.length)
    return (
      <ActionList accessibilityLabel="Claims and counter-facts">
        {pack.claims.map((c) => (
          <ActionListSection key={c.claim.id} title={`Claim · ${c.state === 'answered' ? `answered by ${c.answers.length} record${c.answers.length === 1 ? '' : 's'}` : 'unanswered'}`}>
            <ItemRow i={c.claim} clock={clock} />
            {c.answers.map((a) => (
              <ItemRow key={a.id} i={a} clock={clock} />
            ))}
          </ActionListSection>
        ))}
      </ActionList>
    );
  if (s.id === 'narrative' && pack.narrative)
    return (
      <div className="tb-check">
        <Badge className="bs-tag" size="Small" color="Notice" emphasis="Subtle" label="DRAFT · NOT FOR PUBLICATION" />
        <ActionList accessibilityLabel="Narrative support">
          <ActionListSection title={`Verified · ${pack.narrative.verified.length}`}>
            {pack.narrative.verified.map((i) => (
              <ItemRow key={i.id} i={i} clock={clock} />
            ))}
          </ActionListSection>
          <ActionListSection title={`Held back · ${pack.narrative.heldBack.length}`}>
            {pack.narrative.heldBack.map((i) => (
              <ItemRow key={i.id} i={{ ...i, unresolved: i.unresolved ?? i.detail ?? 'Unverified' }} clock={clock} />
            ))}
          </ActionListSection>
        </ActionList>
      </div>
    );
  if (s.id === 'response' && s.status === 'sourced')
    return (
      <div className="tb-check">
        <RadioGroup label="Recorded options · never selected" isDisabled size="Small">
          {pack.responseOptions.map((o) => (
            <Radio key={o.id} value={o.id}>
              {o.label}
            </Radio>
          ))}
        </RadioGroup>
        <ActionList accessibilityLabel="Response options record">
          {s.items.map((i) => (
            <ItemRow key={i.id} i={i} clock={clock} />
          ))}
        </ActionList>
      </div>
    );
  if (!s.items.length) return <span className="BodySmallRegular bs-muted">{s.note}</span>;
  return (
    <ActionList accessibilityLabel={s.title}>
      {s.items.map((i) => (
        <ItemRow key={i.id} i={i} clock={clock} />
      ))}
    </ActionList>
  );
}
