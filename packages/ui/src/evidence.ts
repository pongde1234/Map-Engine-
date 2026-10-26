/**
 * Evidence pack (storyboard C2): the record that goes to the national level, assembled from the
 * journal as known at the picture time. Seven source-linked sections: the decision log with every
 * authority and token, BDA, debris attribution with its confidence, the adversary's claims with
 * the records that answer them, narrative support with unverified items held back (DP-10), the
 * response options left as options (DP-11), and the reconstitution list (DP-12). Every item names
 * its source, time and record hash; anything unresolved says so, and the gap analysis lists what
 * the record does not hold. No number here is made up: a gap stays a gap.
 */
import type { Accounting, BdaPayload, DecisionPayload, EngagementPayload, EntityComponents, JournalRecord } from '@me/schema';
import type { MapClient } from '@me/client';
import type { Derived } from './derived.ts';

export type SectionStatus = 'sourced' | 'partial' | 'gap' | 'withheld';

export interface PackItem {
  id: string;
  title: string;
  detail?: string;
  source: string;
  at: number;
  hash?: string;
  /** What remains open about this item. */
  unresolved?: string;
}

export interface PackSection {
  id: 'decisions' | 'bda' | 'debris' | 'claims' | 'narrative' | 'response' | 'reconstitution';
  title: string;
  status: SectionStatus;
  note: string;
  items: PackItem[];
}

export interface ClaimPair {
  claim: PackItem;
  answers: PackItem[];
  state: 'answered' | 'unanswered';
}

export interface EvidencePack {
  asOf: number;
  sections: PackSection[];
  sourced: number;
  claims: ClaimPair[];
  narrative: { verified: PackItem[]; heldBack: PackItem[] } | null;
  /** DP-11's recorded options: shown, never selectable. */
  responseOptions: Array<{ id: string; label: string }>;
  gaps: PackItem[];
}

/** The CONOP's pack target. A target, not a measured result. */
export const PACK_TARGET = 'Decisions for the CCS within an hour';

const short = (h: string) => h.slice(0, 6).toUpperCase();
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function item(r: JournalRecord, title: string, detail?: string, unresolved?: string): PackItem {
  return {
    id: r.record_id,
    title,
    ...(detail ? { detail } : {}),
    source: r.provenance.sensor_class ?? r.provenance.source_feed,
    at: r.ingest_time,
    hash: r.hash,
    ...(unresolved ? { unresolved } : {}),
  };
}

export function evidencePack(client: MapClient, derived: Derived, accounting: Accounting | null, t: number): EvidencePack {
  const events = client.events;
  const byId = new Map(events.map((r) => [r.record_id, r]));
  const decisions = events.filter((r): r is JournalRecord<DecisionPayload> => r.kind === 'decision');
  const latest = (dp: string) => [...decisions].reverse().find((d) => d.payload.dp === dp);
  const bdas = events.filter((r): r is JournalRecord<BdaPayload> => r.kind === 'bda');
  const fragments = events.filter((r) => r.kind === 'fragment' && (r.payload as EntityComponents).fragment);
  const ofClass = (cls: string) => fragments.filter((r) => (r.payload as EntityComponents).ontology?.class === cls);
  const sections: PackSection[] = [];

  // 1. Decision log, with every release token and what was carried under it.
  const tokens = new Map<string, number>();
  for (const r of events) {
    const a = r.kind === 'engagement' ? (r.payload as EngagementPayload).authority_record : undefined;
    if (a && (r.payload as EngagementPayload).result === 'assigned') tokens.set(a, (tokens.get(a) ?? 0) + 1);
  }
  const decisionItems = decisions.map((d) => item(d, `${d.payload.dp} · ${d.payload.title}`, `${d.payload.layer} · ${d.payload.status} · ${d.author ?? d.payload.authority ?? ''}`));
  const tokenItems = [...tokens.entries()].flatMap(([rid, n]) => {
    const d = byId.get(rid) as JournalRecord<DecisionPayload> | undefined;
    return d ? [{ ...item(d, `Release token ${d.payload.dp}·${short(d.hash)}`, `${n} engagements · ${d.payload.authority ?? d.payload.layer}`), id: `token-${rid}` }] : [];
  });
  sections.push({ id: 'decisions', title: 'Decision log · every authority and token', status: decisions.length ? 'sourced' : 'gap', note: `${count(decisions.length, 'decision')} · ${count(tokens.size, 'release token')}`, items: [...decisionItems, ...tokenItems] });

  // 2. Battle-damage assessment.
  const bdaItems = bdas.map((b) => item(b, `${b.payload.target_id} · ${b.payload.damage}`, b.payload.summary, b.derived_from?.length ? undefined : 'No recorded source'));
  sections.push({ id: 'bda', title: 'Battle-damage assessment', status: bdas.length ? 'sourced' : 'gap', note: bdas.length ? count(bdas.length, 'assessment') : 'No BDA received', items: bdaItems });

  // 3. Debris attribution with its confidence.
  const debris = ofClass('debris_report').map((r) => {
    const f = (r.payload as EntityComponents).fragment!;
    return item(r, f.summary, `Confidence: ${f.confidence}`, f.confidence === 'confirmed' ? undefined : `Attribution ${f.confidence}, not confirmed`);
  });
  sections.push({ id: 'debris', title: 'Debris attribution and confidence', status: debris.length ? 'sourced' : 'gap', note: debris.length ? count(debris.length, 'recovery report') : 'No debris attribution record', items: debris });

  // 4. Adversary claims, each with the records that answer it (BDA covering the units it names).
  const claims: ClaimPair[] = ofClass('io_claim').map((r) => {
    const p = r.payload as EntityComponents;
    const named = (p.relationships ?? []).map((x) => x.target);
    const answers = bdas.filter((b) => named.includes(b.payload.target_id) || b.payload.target_id.startsWith('VP-')).map((b) => item(b, `BDA ${b.payload.target_id} · ${b.payload.damage}`, b.payload.summary));
    return { claim: item(r, p.fragment!.summary, `Names ${named.join(', ') || 'no unit'}`, answers.length ? undefined : 'No record answers this claim yet'), answers, state: answers.length ? 'answered' : 'unanswered' };
  });
  sections.push({
    id: 'claims',
    title: "Adversary's claims and counter-facts",
    status: claims.length ? (claims.every((c) => c.state === 'answered') ? 'sourced' : 'partial') : 'gap',
    note: claims.length ? `${count(claims.length, 'claim')} · ${claims.filter((c) => c.state === 'answered').length} answered by BDA` : 'No Red information-operations report received',
    items: claims.flatMap((c) => [c.claim, ...c.answers]),
  });

  // 5. Narrative support (DP-10): verified statements with their sources; unverified items held back.
  const dp10 = latest('DP-10');
  const tracks = accounting?.tracks ?? [];
  const outcome = (o: string) => tracks.filter((x) => x.outcome === o).length;
  const verified: PackItem[] = [];
  const heldBack: PackItem[] = [];
  if (tracks.length)
    verified.push({
      id: 'stmt-tracks',
      title: `${outcome('destroyed') + outcome('deflected') + outcome('withdrawn')} of ${tracks.length} threat tracks destroyed, turned away or withdrew; ${outcome('leaked')} leaked`,
      source: 'Run accounting (fused records)',
      at: t,
    });
  for (const b of bdas) verified.push(item(b, b.payload.summary, `BDA ${b.payload.target_id}`));
  const dp8 = latest('DP-8');
  if (dp8) verified.push(item(dp8, `Plant protective action ${dp8.payload.status} under DP-8`, dp8.payload.authority));
  for (const c of claims) (c.state === 'answered' ? verified : heldBack).push({ ...c.claim, title: `Claim: ${c.claim.title}`, detail: c.state === 'answered' ? `Answered by ${c.answers.map((a) => a.title).join('; ')}` : 'Unanswered' });
  for (const d of debris) if (d.unresolved) heldBack.push({ ...d, detail: d.unresolved });
  const dp11 = latest('DP-11');
  heldBack.push(dp11 ? item(dp11, 'Attribution of the raid', 'Pending at L1 (DP-11); no response approved') : { id: 'held-attribution', title: 'Attribution of the raid', detail: 'No attribution record', source: '—', at: t });
  const inFlight = outcome('in flight');
  if (inFlight) heldBack.push({ id: 'held-reattack', title: `Re-attack in progress: ${inFlight} threat tracks in flight`, detail: 'Outcome not yet recorded', source: 'Run accounting (fused records)', at: t });
  const narrative = dp10 ? { verified, heldBack } : null;
  sections.push({
    id: 'narrative',
    title: 'Narrative support (DP-10)',
    status: dp10 ? 'sourced' : 'withheld',
    note: dp10 ? `Draft · not for publication · ${dp10.payload.authority ?? 'L1 + state'} decide` : 'DP-10 is NATIONAL: not releasable to this view',
    items: dp10 ? [item(dp10, `${dp10.payload.dp} · ${dp10.payload.title}`, dp10.payload.summary)] : [],
  });

  // 6. Response options (DP-11): options only; no response approved.
  sections.push({
    id: 'response',
    title: 'Response options (DP-11)',
    status: dp11 ? 'sourced' : 'withheld',
    note: dp11 ? 'L1 only · option, never selected · attribution pending' : 'DP-11 is NATIONAL: not releasable to this view',
    items: dp11 ? [item(dp11, `${dp11.payload.dp} · ${dp11.payload.title}`, `${dp11.payload.summary} No response approved.`, 'Attribution pending')] : [],
  });

  // 7. Reconstitution: DP-12 proposals, then what the force state shows was spent.
  const dp12 = latest('DP-12');
  const recon: PackItem[] = dp12
    ? dp12.payload.summary
        .split(';')
        .map((s) => s.trim().replace(/\.$/, ''))
        .filter(Boolean)
        .map((s, i) => ({ ...item(dp12, s.charAt(0).toUpperCase() + s.slice(1), `${dp12.payload.dp} · proposed to ${dp12.payload.authority ?? 'L2/L3'}`), id: `${dp12.record_id}-${i}` }))
    : [];
  for (const e of derived.effectors) {
    const m = e.effector?.magazine;
    if (!m || m.ready >= 900 || m.capacity === undefined || m.ready >= m.capacity) continue;
    recon.push({ id: `mag-${e.entity_id}`, title: `${e.aliases?.callsign ?? e.entity_id}: ${m.ready} of ${m.capacity} rounds ready`, detail: m.ready <= m.floor ? `At reserve floor (${m.floor})` : `Floor ${m.floor}`, source: e.provenance.source_feed, at: e.source_time, hash: e.last_hash });
  }
  const launches = events.filter((r) => r.kind === 'engagement' && (r.payload as EngagementPayload).result === 'launched' && /interceptor/i.test((r.payload as EngagementPayload).weapon)).length;
  if (launches) recon.push({ id: 'recon-interceptors', title: `${launches} interceptor drones launched`, detail: 'From engagement records', source: 'Engagement records', at: t });
  sections.push({
    id: 'reconstitution',
    title: 'Reconstitution (DP-12)',
    status: dp12 ? 'sourced' : recon.length ? 'partial' : 'gap',
    note: dp12 ? `Proposals to ${dp12.payload.authority ?? 'L2/L3'} · force state` : 'DP-12 not yet proposed · force state only',
    items: recon,
  });

  // Gap analysis: what the record does not hold, and what stays open.
  const gaps: PackItem[] = [];
  for (const s of sections) if (s.status !== 'sourced') gaps.push({ id: `gap-${s.id}`, title: s.title, detail: s.note, source: s.status === 'withheld' ? 'Releasability' : 'Journal', at: t });
  for (const s of sections) for (const i of s.items) if (i.unresolved) gaps.push({ ...i, id: `open-${i.id}`, detail: i.unresolved });
  const unrecorded = outcome('no outcome recorded');
  if (unrecorded) gaps.push({ id: 'gap-outcomes', title: `${unrecorded} threat tracks ended with no recorded outcome`, source: 'Run accounting (fused records)', at: t });
  const loose = fragments.filter((r) => (r.payload as EntityComponents).fragment?.associated === false);
  for (const r of loose) gaps.push(item(r, `Not associated: ${r.entity_id}`, (r.payload as EntityComponents).fragment!.summary));
  gaps.push({ id: 'gap-reattack-p', title: 'Re-attack probability', detail: 'Not estimated in this run', source: '—', at: t });

  return {
    asOf: t,
    sections,
    sourced: sections.filter((s) => s.status === 'sourced').length,
    claims,
    narrative,
    responseOptions: dp11 ? dp11.payload.options.map((o) => ({ id: o.id, label: o.label })) : [],
    gaps,
  };
}

/** The pack as a file for the national level: every section and item with its hash, the chain check and the timings. */
export function packJson(
  pack: EvidencePack,
  meta: { asOfLabel: string; role: string; run: string; verify: { ok: boolean; checked: number; head: { seq: number; hash: string; t: number } | null; ms: number } | null; assembledMs: number },
): string {
  return JSON.stringify(
    {
      label: 'SYNTHETIC//DEMO',
      kind: 'evidence-pack',
      asOf: { t: pack.asOf, label: meta.asOfLabel },
      view: meta.role,
      run: meta.run,
      completeness: { sourced: pack.sourced, sections: pack.sections.length },
      integrity: meta.verify,
      timings: { assembledMs: meta.assembledMs, verifyMs: meta.verify?.ms ?? null, target: `${PACK_TARGET} (CONOP target, not a measured result)` },
      sections: pack.sections,
      claims: pack.claims,
      narrative: pack.narrative,
      responseOptions: pack.responseOptions.map((o) => ({ ...o, selected: false })),
      gaps: pack.gaps,
    },
    null,
    2,
  );
}
