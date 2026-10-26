/**
 * Map Engine server.
 *   pnpm --filter @me/server dev            (journal: data/journal/jamnagar-raid-7.sqlite)
 *   ME_JOURNAL=… ME_PORT=8787 ME_HOST=0.0.0.0
 *
 * Air-gap: no outbound requests; the server is the clock authority; CSP allows 'self' only.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { Engine, verifyChain } from '@me/engine-core';
import { SqliteJournal } from '@me/journal-sqlite';
import type { ScenarioManifest } from '@me/scenario';
import { Session } from './session.ts';
import { registerApi } from './api.ts';
import { OperatorDesk } from './operator.ts';

const root = resolve(import.meta.dirname, '../../..');
const journalPath = resolve(root, process.env.ME_JOURNAL ?? 'data/journal/jamnagar-raid-7.sqlite');
const port = Number(process.env.ME_PORT ?? 8787);
const host = process.env.ME_HOST ?? '0.0.0.0';

if (!existsSync(journalPath)) {
  console.error(`journal not found: ${journalPath}\nrun: pnpm scenario`);
  process.exit(1);
}

const t0 = performance.now();
const journal = new SqliteJournal(journalPath, { readonly: false });
const manifest = journal.getMeta<ScenarioManifest>('manifest');
if (!manifest) throw new Error('journal has no manifest meta');
const engine = new Engine(journal);
engine.index();
const chain = verifyChain(journal);
const loadMs = performance.now() - t0;
console.log(
  `journal ${journal.length.toLocaleString('en')} records · ${engine.keyframes.count} keyframes · chain ${chain.ok ? 'verified' : 'BROKEN'} · ${loadMs.toFixed(0)} ms`,
);

// Operator objects: a second chain anchored to this journal's head, persisted beside it.
const desk = new OperatorDesk(engine, manifest, journalPath.replace(/\.sqlite$/, '') + '.operator.jsonl');
const ops = desk.load();
console.log(`operator log ${ops.loaded} records${ops.setAside ? ` · previous log chained to another journal, set aside: ${ops.setAside}` : ''}`);

const startMark = manifest.clock.marks.find((m) => m.id === 'D-3')?.t ?? manifest.t0;

const app = Fastify({ logger: { level: process.env.ME_LOG ?? 'warn' } });

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:; child-src blob:",
  );
  reply.header('X-Content-Type-Options', 'nosniff');
  return payload;
});

await app.register(fastifyWebsocket, { options: { maxPayload: 1 << 20 } });
app.get('/ws', { websocket: true }, (socket) => {
  new Session(socket, engine, manifest, desk, startMark);
});

registerApi(app, engine, manifest, chain);

const tilesDir = resolve(root, 'data/tiles');
if (existsSync(tilesDir)) {
  await app.register(fastifyStatic, { root: tilesDir, prefix: '/tiles/', decorateReply: false, acceptRanges: true, cacheControl: true, maxAge: '1d' });
}
const webDir = resolve(root, 'apps/battlespace/dist');
if (existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir, prefix: '/' });
}

await app.listen({ port, host });
console.log(`map engine server on http://${host}:${port}  (ws /ws · api /api · tiles /tiles)`);
