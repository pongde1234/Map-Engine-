// Denylist: no real Indian system identifiers anywhere in source, docs, generated scenario
// strings or the built app. The research studies informed feed categories only; screens and
// docs use neutral names. The terms are stored base64-encoded so this public check does not
// itself publish the list it blocks.
//   node tools/checks/denylist.mjs            (exit 1 on any hit)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ENCODED = [
  'SUFDQ1M=', 'QWthc2h0ZWVy', 'QWthc2ggdGVlcg==', 'VHJpZ3Vu', 'U2FuamF5', 'SU1TQVM=', 'TkMzSQ==', 'SU1BQw==', 'SUZDLUlPUg==',
  'SUZDIElPUg==', 'Q0lEU1M=', 'QUlEU1M=', 'QVNJR01B', 'QUNDQ1M=', 'QUZOZXQ=', 'U0FLU0hBTQ==', 'VHJpbmV0cmE=', 'TUlTTw==',
  'TmV0cmE=', 'QVNUUk9JRFM=', 'U3VkYXJzaGFu', 'UnVrbWluaQ==', 'U1BBUlNI', 'VGFjIEMzSQ==', 'QURDJlJT', 'T0lTL01JUw==',
];
const TERMS = ENCODED.map((s) => Buffer.from(s, 'base64').toString('utf8'));
const re = new RegExp(`\\b(${TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\&/]/g, '\\$&')).join('|')})\\b`, 'i');

const ROOTS = ['packages', 'apps', 'tools', 'docs'];
const ROOT_FILES = ['README.md'];
const SKIP_DIRS = new Set(['node_modules', '.vite', 'test-results', 'playwright-report']);
const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.json', '.md']);
const SELF = join('tools', 'checks', 'denylist.mjs');

const hits = [];
function scan(p) {
  readFileSync(p, 'utf8')
    .split('\n')
    .forEach((l, i) => {
      const m = re.exec(l);
      if (m) hits.push(`${p}:${i + 1}: "${m[1]}" · ${l.trim().slice(0, 120)}`);
    });
}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.has(extname(name)) && p !== SELF && st.size < 8_000_000) scan(p);
  }
}
for (const r of ROOTS) if (existsSync(r)) walk(r);
for (const f of ROOT_FILES) if (existsSync(f)) scan(f);
// Generated manifest strings (what screens print).
const manifest = 'data/journal/jamnagar-raid-7.manifest.json';
if (existsSync(manifest)) {
  const m = re.exec(readFileSync(manifest, 'utf8'));
  if (m) hits.push(`${manifest}: "${m[1]}"`);
}

if (hits.length) {
  console.error(`denylist: ${hits.length} hit(s)\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`denylist: clean (${TERMS.length} terms)`);
