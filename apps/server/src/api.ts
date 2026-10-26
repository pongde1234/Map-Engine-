/**
 * REST surface (Lattice-style entity reads; publish comes with the adapters).
 *   GET /api/health · /api/scenario · /api/entities?t= · /api/entities/:id?t=
 *   GET /api/lineage/:id?t= · /api/consequences/:rid?t=&depth= · /api/events?from=&to=
 *   GET /api/accounting?t= · /api/verify?t= · /api/records/:id
 * Every read takes the ingest-time cursor `t`: what the system knew at t.
 */
import type { FastifyInstance } from 'fastify';
import type { Engine, VerifyResult } from '@me/engine-core';
import type { ScenarioManifest } from '@me/scenario';
import { canSeeEntity, canSeeRecord, identityFor } from './identity.ts';

export function registerApi(app: FastifyInstance, engine: Engine, manifest: ScenarioManifest, chain: VerifyResult): void {
  const idOf = (q: Record<string, string | undefined>) => identityFor(q.role);
  const tOf = (q: Record<string, string | undefined>) => (q.t ? Number(q.t) : engine.journal.head().t);

  app.get('/api/health', async () => ({
    ok: true,
    records: engine.journal.length,
    head: engine.journal.head(),
    keyframes: engine.keyframes.count,
    chain,
    operator: { records: engine.operator.length, head: engine.operator.head() },
    serverTime: Date.now(),
  }));

  app.get('/api/scenario', async () => manifest);

  app.get('/api/entities', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const id = idOf(q);
    return [...engine.asOf(tOf(q)).entities.values()].filter((e) => canSeeEntity(e, id));
  });

  app.get('/api/entities/:eid', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const { eid } = req.params as { eid: string };
    const e = engine.asOf(tOf(q)).get(eid);
    if (!e || !canSeeEntity(e, idOf(q))) return reply.code(404).send({ error: 'not found at t' });
    return e;
  });

  app.get('/api/lineage/:eid', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const { eid } = req.params as { eid: string };
    const upto = engine.journal.seqAtOrBefore(tOf(q));
    return engine.lineage.trace(engine.journal, eid, upto).filter((r) => canSeeRecord(r, idOf(q)));
  });

  // Downstream of a record (what was done under a decision), as known at t.
  app.get('/api/consequences/:rid', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const { rid } = req.params as { rid: string };
    const upto = engine.journal.seqAtOrBefore(tOf(q));
    const depth = Math.min(2, Math.max(1, Number(q.depth ?? 1)));
    return engine.lineage.consequences(engine.journal, rid, upto, depth).filter((r) => canSeeRecord(r, idOf(q)));
  });

  // Every threat track and plant unit with what the record says happened to it, as known at t.
  app.get('/api/accounting', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const id = idOf(q);
    const a = engine.outcomes.accounting(engine.journal.seqAtOrBefore(tOf(q)));
    const ok = (r?: string[]) => !r || !r.length || r.some((c) => id.releasability.includes(c));
    return { tracks: a.tracks.filter((x) => ok(x.releasability)), plant: a.plant.filter((x) => ok(x.releasability)) };
  });

  app.get('/api/events', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const from = Number(q.from ?? manifest.t0);
    const to = Number(q.to ?? manifest.t1);
    return engine.eventsBetween(from, to).filter((r) => canSeeRecord(r, idOf(q)));
  });

  app.get('/api/records/:rid', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const { rid } = req.params as { rid: string };
    const r = engine.findRecord(rid);
    if (!r || !canSeeRecord(r, idOf(q))) return reply.code(404).send({ error: 'not found' });
    return r;
  });

  // ?t= checks the chain up to what was known at t and returns the head at that time (pack integrity).
  // The journal is append-only, so a verified prefix stays verified: the load-time check seeds it
  // and later checks only extend it. `cached` says the answer came from that earlier check.
  let verifiedTo = chain.ok ? chain.checked : 0;
  app.get('/api/verify', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const { verifyChain } = await import('@me/engine-core');
    const toSeq = q.t ? engine.journal.seqAtOrBefore(Number(q.t)) : engine.journal.length;
    const t0 = performance.now();
    let v: VerifyResult = { ok: true, checked: toSeq };
    const cached = toSeq <= verifiedTo;
    if (!cached) {
      const ext = verifyChain(engine.journal, verifiedTo + 1, toSeq);
      v = ext.ok ? { ok: true, checked: toSeq } : { ok: false, checked: verifiedTo + ext.checked, ...(ext.brokenAt !== undefined ? { brokenAt: ext.brokenAt } : {}) };
      if (ext.ok) verifiedTo = toSeq;
    }
    const head = toSeq > 0 ? engine.journal.read(toSeq) : null;
    return { ...v, cached, root: head?.hash ?? '', head: head ? { seq: head.seq, hash: head.hash, t: head.ingest_time } : null, ms: Math.round(performance.now() - t0) };
  });
}
