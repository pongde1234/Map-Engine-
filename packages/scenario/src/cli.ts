/**
 * Generate the Jamnagar scenario journal: data/journal/<id>-<seed>.sqlite + manifest JSON.
 *   pnpm scenario [--seed 7] [--out data/journal]
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SqliteJournal } from '@me/journal-sqlite';
import { verifyChain } from '@me/engine-core';
import { generateJamnagar } from './jamnagar/generate.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const seed = Number(args.get('seed') ?? 7);
const repoRoot = resolve(import.meta.dirname, '../../..');
const outDir = resolve(repoRoot, args.get('out') ?? 'data/journal');
mkdirSync(outDir, { recursive: true });

const t0 = performance.now();
const { drafts, manifest } = generateJamnagar({ seed });
const t1 = performance.now();

const file = join(outDir, `${manifest.id}-${seed}.sqlite`);
for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) rmSync(file + suffix);
const journal = new SqliteJournal(file);
const BATCH = 20_000;
for (let i = 0; i < drafts.length; i += BATCH) journal.append(drafts.slice(i, i + BATCH));
const t2 = performance.now();
const v = verifyChain(journal);
const head = journal.head();
manifest.journal = { records: journal.length, rootHash: head.hash, file: `${manifest.id}-${seed}.sqlite` };
journal.setMeta('manifest', manifest);
journal.close();
writeFileSync(join(outDir, `${manifest.id}-${seed}.manifest.json`), JSON.stringify(manifest, null, 2));

const kinds = new Map<string, number>();
for (const d of drafts) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);
console.log(`scenario ${manifest.id} seed=${seed}`);
console.log(`  records   ${drafts.length.toLocaleString()}  (${[...kinds].map(([k, n]) => `${k}:${n}`).join(' ')})`);
console.log(`  counts    ${JSON.stringify(manifest.counts)}`);
console.log(`  chain     ${v.ok ? 'verified' : `BROKEN at ${v.brokenAt}`} · root ${head.hash.slice(0, 16)}…`);
console.log(`  timing    generate ${(t1 - t0).toFixed(0)} ms · write ${(t2 - t1).toFixed(0)} ms`);
console.log(`  file      ${file}`);
