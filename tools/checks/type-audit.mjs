// Type audit: measure the rendered text of the console, per theme and view.
//   AUDIT_BASE=http://127.0.0.1:5174/ node tools/checks/type-audit.mjs [dark|light|both]
// For every visible text node: computed size and weight, text colour and its WCAG contrast
// against the nearest opaque background. Fails (exit 1) when, in any view or theme:
//   - more than SMALL_MAX of the text is under 12px (a small Badge or Counter, which FDS fixes at
//     10px, is not counted);
//   - any neutral text (the grey inks) is under 4.5:1;
//   - a view uses more than PAIRS_MAX different size/weight pairs.
//   - (FDS-owned controls, such as a primary Button or a Badge, are reported but not failed: their fills are FDS's.)
// The theme is set again after every page load: a load resets it to the app's default (dark).
import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5173/';
const SMALL_MAX = 0.15;
const PAIRS_MAX = 8;
const themes = process.argv[2] === 'light' ? ['light'] : process.argv[2] === 'dark' ? ['dark'] : ['dark', 'light'];

/** Runs in the page: every visible text node with its size, weight, colour and contrast. */
const collect = () => {
  const lum = (r, g, b) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: a[0], g: a[1], b: a[2], a: a[3] ?? 1 };
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const text = n.textContent.trim();
    const el = n.parentElement;
    if (!text || !el) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const [hi, lo] = [lum(fg.r, fg.g, fg.b), lum(bg.r, bg.g, bg.b)].sort((a, b) => b - a);
    out.push({
      size: parseFloat(cs.fontSize),
      weight: cs.fontWeight,
      ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10,
      neutral: Math.abs(fg.r - fg.g) < 20 && Math.abs(fg.g - fg.b) < 26,
      fds: !!el.closest('.ds-badge, .ds-counter, .ds-avatar'),
      ctl: !!el.closest('button, [role="button"], .ds-badge, .ds-counter, .ds-avatar'),
      text: text.slice(0, 26),
      // A panel list row's own text (docs/TYPE.md): its title and its detail line.
      row: el.closest('.bs-left, .bs-right, .tb__detail, .sv__rail, .sv__record')
        ? el.classList.contains('ds-action-list-item__title') ? 'title' : el.classList.contains('ds-action-list-item__description') ? 'detail' : null
        : null,
    });
  }
  return out;
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
for (const theme of themes) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const setTheme = async () => {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(1200);
  };
  const views = [];
  const grab = async (label) => views.push({ label, rows: await page.evaluate(collect) });
  const open = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    await setTheme();
  };
  await open(`${BASE}?bm=B4`);
  await grab('battlespace');
  for (const tab of ['Alerts', 'Sources']) {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click().catch(() => {});
    await page.waitForTimeout(800);
    await grab(`left ${tab.toLowerCase()}`);
  }
  await open(`${BASE}?bm=B4&sel=F-0525`);
  await grab('inspector (fused track)');
  for (const name of ['Targets', 'Ontology']) {
    await page.getByText(name, { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await grab(name.toLowerCase());
  }
  await page.close();

  console.log(`\n== ${theme}`);
  for (const v of views) {
    // A view's own text only: a page that is not showing is hidden, so it is not in the sweep.
    const counted = v.rows.filter((r) => !r.fds);
    const small = counted.filter((r) => r.size < 12).length;
    const low = v.rows.filter((r) => r.neutral && r.ratio < 4.5 && !r.ctl);
    const ctl = new Set(v.rows.filter((r) => r.ctl && r.ratio < 4.5).map((r) => r.text));
    const pairs = new Set(counted.map((r) => `${r.size}/${r.weight}`));
    const share = counted.length ? small / counted.length : 0;
    // Panel list rows follow the roles: a title is 14px / 500, a detail line 12px.
    const rowsOff = v.rows.filter((r) => (r.row === 'title' && (r.size !== 14 || r.weight !== '500')) || (r.row === 'detail' && r.size !== 12));
    const bad = share > SMALL_MAX || low.length > 0 || pairs.size > PAIRS_MAX || rowsOff.length > 0;
    failed ||= bad;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${v.label.padEnd(24)} text ${String(counted.length).padStart(4)} · under 12px ${(share * 100).toFixed(0).padStart(3)}% · size/weight pairs ${pairs.size} · neutral under 4.5:1 ${low.length}${low.length ? ` (${low.slice(0, 3).map((r) => `"${r.text}" ${r.ratio}`).join(', ')})` : ''} · FDS controls under 4.5:1 ${ctl.size} · list rows off-role ${rowsOff.length}${rowsOff.length ? ` (${rowsOff.slice(0, 3).map((r) => `"${r.text}" ${r.size}/${r.weight}`).join(', ')})` : ''}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
