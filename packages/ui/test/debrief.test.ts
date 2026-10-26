import { describe, expect, it } from 'vitest';
import type { Accounting, EntityComponents, JournalRecord } from '@me/schema';
import { debriefOf, threadOf } from '../src/debrief.ts';
import { evidencePack, packJson } from '../src/evidence.ts';
import { T, bdaRecord, clientWith, decision, derivedWith, engagementRecord, fragment } from './fixtures.ts';

const accounting: Accounting = {
  tracks: [
    { id: 'T-1', cls: 'owa_drone', firstT: T - 9000, outcome: 'destroyed', outcomeT: T - 5000, reclassified: [] },
    { id: 'T-2', cls: 'owa_drone', firstT: T - 9000, outcome: 'leaked', outcomeT: T - 4000, reclassified: [] },
    { id: 'T-3', cls: 'probe', firstT: T - 9000, outcome: 'withdrawn', outcomeT: T - 4000, reclassified: [] },
    { id: 'T-4', cls: 'arm', firstT: T - 9000, outcome: 'deflected', outcomeT: T - 4000, reclassified: [] },
  ],
  plant: [
    { id: 'PU-CDU', unit: 'Crude unit', tier: 1, history: [{ t: T - 9000, state: 'running' }, { t: T - 6000, state: 'depressurised' }] },
    { id: 'PU-TNK', unit: 'Tank farm', tier: 2, history: [{ t: T - 9000, state: 'running' }] },
  ],
};

// The D-3 thread to an engagement: report → raid assessment → DP-1 → DP-0 envelope → DP-5 task → engagement → BDA.
const f1 = fragment('X-LCH-N', T - 20_000, 'launch_prep', 'possible');
const dp0 = decision('DP0', 'DP-0', T - 30_000, { layer: 'L1' });
const dp1 = decision('DP1', 'DP-1', T - 19_000, { layer: 'L2', derived: [f1.record_id, 'DP0'] });
const raid = { ...fragment('X-RAID-1', T - 10_000, 'report', 'likely', { thread: 'TH-RAID' }), derived_from: ['DP0', 'DP1'] } as JournalRecord;
const dp5 = decision('DP5', 'DP-5', T - 9000, { layer: 'L3', derived: ['DP0', raid.record_id] });
const assigned = engagementRecord('E1', 'T-1', 'assigned', T - 6000, 'DP5');
const kill = engagementRecord('E2', 'T-1', 'kill', T - 5000, 'DP5');
const bdaTnk = bdaRecord('B1', 'PU-TNK', 'light', T - 3000, ['IMPACT-T-2']);
const bdaVp = bdaRecord('B2', 'VP-RIL', 'none', T - 2900, ['IMPACT-T-2']);
const claimBase = fragment('X-IO-1', T - 2000, 'io_claim', 'confirmed', { kind: 'osint', thread: 'TH-RAID' });
const claim = { ...claimBase, payload: { ...(claimBase.payload as EntityComponents), relationships: [{ type: 'associated_with', target: 'PU-CDU' }] } } as JournalRecord;
const debris = fragment('X-DEB-1', T - 1500, 'debris_report', 'likely', { kind: 'contact_report', thread: 'TH-RAID' });
const events = [dp0, f1, dp1, raid, dp5, assigned, kill, bdaTnk, bdaVp, claim, debris];

describe('debrief', () => {
  it('derives every tally from the records and sets it beside the run manifest', () => {
    const c = clientWith([], events);
    (c as unknown as { scenario: unknown }).scenario = { id: 'test', seed: 7, counts: { threats: 4, hardKills: 1, leakers: 1, probesWithdrawn: 1, emcon: 1, softKill: 0, tier1Hits: 0 } };
    const d = debriefOf(c, derivedWith(), accounting);
    const tally = Object.fromEntries(d.tallies.map((x) => [x.id, [x.recorded, x.run]]));
    expect(tally).toMatchObject({ threats: [4, 4], destroyed: [1, 1], leaked: [1, 1], withdrawn: [1, 1], emcon: [1, 1], soft: [0, 0], unrecorded: [0, 0] });
    expect(d.withToken).toBe(2);
    expect(d.engagements[0]!.token).toMatch(/^DP-5·/);
  });

  it('keeps the plant history and lets the plant-wide BDA cover units without their own', () => {
    const d = debriefOf(clientWith([], events), derivedWith(), accounting);
    const by = Object.fromEntries(d.targets.map((x) => [x.id, x]));
    expect(by['PU-CDU']!.history.map((h) => h.state)).toEqual(['running', 'depressurised']);
    expect(by['PU-CDU']!.damage).toBe('none');
    expect(by['PU-TNK']!.damage).toBe('light');
    expect(d.tier1Hits.recorded).toBe(0);
  });

  it('accounts for every fragment, with what was derived from it', () => {
    const d = debriefOf(clientWith([], events), derivedWith(), accounting);
    expect(d.fragments.find((f) => f.entityId === 'X-LCH-N')!.usedBy).toContain('DP-1');
  });

  it('follows the thread from a received fragment to the engagement; a missing link stays empty', () => {
    const steps = threadOf([f1, dp0, dp1, raid, dp5, assigned, kill], 'T-1');
    const got = Object.fromEntries(steps.map((s) => [s.id, s.records.length]));
    expect(got).toEqual({ 'Received fragments': 1, Assessment: 1, 'DP record': 1, 'Approved envelope': 1, Task: 1, Engagement: 2, BDA: 0 });
  });
});

describe('evidence pack', () => {
  it('gives every item a source, a time and, from a record, its hash', () => {
    const p = evidencePack(clientWith([], events), derivedWith(), accounting, T);
    for (const s of p.sections) for (const i of s.items) expect(i.source && i.at).toBeTruthy();
    expect(p.sections.find((s) => s.id === 'decisions')!.items.some((i) => i.title.startsWith('Release token DP-5·'))).toBe(true);
  });

  it('answers the adversary claim with the recorded BDA and holds unconfirmed debris attribution back', () => {
    const p = evidencePack(clientWith([], [...events, decision('DP10', 'DP-10', T - 100, { layer: 'L1', status: 'proposed', rel: ['NATIONAL'] })]), derivedWith(), accounting, T);
    expect(p.claims[0]!.state).toBe('answered');
    expect(p.claims[0]!.answers.map((a) => a.id)).toContain('B2');
    expect(p.narrative!.heldBack.some((h) => h.id === debris.record_id)).toBe(true);
    expect(p.narrative!.heldBack.some((h) => h.title === 'Attribution of the raid')).toBe(true);
  });

  it('withholds the national sections without their records, and never selects a response option', () => {
    const l3 = evidencePack(clientWith([], events), derivedWith(), accounting, T);
    expect(l3.sections.find((s) => s.id === 'narrative')!.status).toBe('withheld');
    expect(l3.sections.find((s) => s.id === 'response')!.status).toBe('withheld');
    const dp11 = decision('DP11', 'DP-11', T - 50, { layer: 'L1', status: 'option', rel: ['NATIONAL'], options: [{ id: 'respond', label: 'Response options (labelled)', selected: false }] });
    const l1 = evidencePack(clientWith([], [...events, dp11]), derivedWith(), accounting, T);
    expect(l1.responseOptions).toEqual([{ id: 'respond', label: 'Response options (labelled)' }]);
    const file = JSON.parse(packJson(l1, { asOfLabel: 'H+61', role: 'l1', run: 'test', verify: null, assembledMs: 3 }));
    expect(file.responseOptions.every((o: { selected: boolean }) => o.selected === false)).toBe(true);
    expect(file.timings.target).toMatch(/CONOP target, not a measured result/);
  });

  it('lists what the record does not hold', () => {
    const p = evidencePack(clientWith([], events), derivedWith(), accounting, T);
    const titles = p.gaps.map((g) => g.title);
    expect(titles).toContain('Re-attack probability');
    expect(titles).toContain('Response options (DP-11)');
  });
});
