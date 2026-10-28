// Type lint: the console sets text through FDS type classes and tokens, at 12px or more.
// See docs/TYPE.md for the roles. Fails (exit 1) on:
//   - BodyXSmall / CodeSmall (10px) in app TSX: reading text is 12px at the least. What FDS fixes at 10px
//     (a small Badge, a small Counter) is set through their own props and is not matched here.
//   - font-size / font-family / font-weight / line-height written by hand (TSX style props or CSS),
//     other than FDS's own tokens (var(--font-…), var(--line-height-…)).
//   - a hex or rgb colour in a CSS color declaration, or a style={{ color … }} prop.
//   - a validation error shown in the muted ink (an error is negative).
//   node tools/checks/type-lint.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['packages/ui/src', 'packages/map/src', 'apps/battlespace/src'];
const SKIP_DIRS = new Set(['node_modules', '.vite', 'dist']);
const hits = [];

const rules = [
  { id: 'xsmall', test: (l, ext) => (ext === '.tsx' || ext === '.ts') && /\b(BodyXSmall|CodeSmall)\w*/.test(l) && !/^\s*(\*|\/\/)/.test(l), msg: '10px type class: use a 12px role (see docs/TYPE.md)' },
  { id: 'font-prop', test: (l, ext) => (ext === '.tsx' && /\b(fontSize|fontFamily|fontWeight|lineHeight)\s*:/.test(l)) || (ext === '.css' && /^\s*(font-size|font-family|font-weight|line-height)\s*:/.test(l) && !/var\(--(font|line-height)/.test(l)), msg: 'hand-set font property: use an FDS type class or FDS font token' },
  { id: 'color-literal', test: (l, ext) => (ext === '.css' && /^\s*color\s*:\s*(#|rgb)/.test(l)) || (ext === '.tsx' && /style=\{\{[^}]*\bcolor\s*:/.test(l)), msg: 'text colour must be an FDS --text-* token' },
  { id: 'muted-error', test: (l, ext) => ext === '.tsx' && /bs-muted/.test(l) && /\{error\}/.test(l), msg: 'an error is negative ink, not muted' },
];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (['.ts', '.tsx', '.css'].includes(extname(name)) && !p.endsWith('type.ts')) {
      const ext = extname(name);
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((l, i) => {
          for (const r of rules) if (r.test(l, ext)) hits.push(`${p}:${i + 1}: [${r.id}] ${r.msg} · ${l.trim().slice(0, 110)}`);
        });
    }
  }
}
for (const r of ROOTS) walk(r);

if (hits.length) {
  console.error(hits.join('\n'));
  console.error(`type-lint: ${hits.length} problem(s)`);
  process.exit(1);
}
console.log('type-lint: clean');
