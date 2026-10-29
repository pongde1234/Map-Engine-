// Density audit: how much the console shows per screen, and the sizes of what it is made of.
//   AUDIT_BASE=http://127.0.0.1:5174/ node tools/checks/density-audit.mjs [width height]  (default 1920 1080)
// Prints one JSON block: vertical chrome, rows visible in the Alerts and Layers panels, facts visible in the
// inspector, the theatre summary's height against the panel, KPI/row/card heights, and the heights of buttons,
// badges, counters and tabs. Run before and after a density change; the targets are in the density plan.
import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:5173/';
const [W, H] = [Number(process.argv[2] ?? 1920), Number(process.argv[3] ?? 1080)];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const out = { viewport: `${W}x${H}` };
const goto = async (q) => {
  await page.goto(`${BASE}?${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);
};
const openView = async (name) => {
  await page.getByText(name, { exact: true }).first().click({ timeout: 20000 });
  await page.waitForTimeout(2200);
};
const evalIn = (fn, arg) => page.evaluate(fn, arg);

/** Rows of `sel` fully inside the scrolling viewport `box`, and their median pitch (top to top). */
const rowsIn = (boxSel, sel) =>
  evalIn(
    ([b, s]) => {
      const box = document.querySelector(b);
      if (!box) return null;
      const vp = box.querySelector('.ds-scroll__viewport, .bs-scroll__viewport') ?? box;
      const v = vp.getBoundingClientRect();
      const rows = [...box.querySelectorAll(s)].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
      const inside = rows.filter((r) => r.top >= v.top - 1 && r.bottom <= v.bottom + 1);
      const pitches = inside.slice(1).map((r, i) => r.top - inside[i].top).sort((a, c) => a - c);
      return { visible: inside.length, pitch: pitches.length ? Math.round(pitches[Math.floor(pitches.length / 2)]) : null, height: Math.round(v.height) };
    },
    [boxSel, sel],
  );

const sizes = () =>
  evalIn(() => {
    const uniq = (sel) => [...new Set([...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().height)))].sort((a, b) => a - b);
    return { buttons: uniq('button.ds-btn'), badges: uniq('.ds-badge'), counters: uniq('.ds-counter'), tabs: uniq('[role=tab]'), inputs: uniq('input') };
  });

// Battlespace, nothing selected: the theatre summary
await goto('bm=B4');
await openView('Battlespace');
await page.mouse.click(5, 5);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
out.battlespace = await evalIn(() => {
  const h = (s) => {
    const e = document.querySelector(s);
    return e ? Math.round(e.getBoundingClientRect().height) : null;
  };
  const m = document.querySelector('.me-map')?.getBoundingClientRect();
  const right = document.querySelector('aside.bs-right .ds-scroll__viewport, aside.bs-right .bs-scroll__viewport');
  const kpi = [...document.querySelectorAll('.bs-kpi')].map((e) => Math.round(e.getBoundingClientRect().height));
  return {
    chrome: { shell: h('header'), viewTabs: h('.console__tabs'), timeline: h('.bs-tl') },
    map: m ? `${Math.round(m.width)}x${Math.round(m.height)}` : null,
    summary: { panelHeight: right ? Math.round(right.getBoundingClientRect().height) : null, contentHeight: right ? right.scrollHeight : null, kpiTiles: kpi, sectionHeads: [...document.querySelectorAll('.bs-sec__head')].map((e) => Math.round(e.getBoundingClientRect().height)).slice(0, 4) },
  };
});
out.fireUnits = await rowsIn('aside.bs-right', '.bs-fu__item');
out.raidGroups = await rowsIn('aside.bs-right section[aria-label="Raid groups"]', '.ds-action-list-item');
out.layers = await rowsIn('aside.bs-left', '[role=treeitem]');
await page.getByRole('tab', { name: /^Alerts/ }).click();
await page.waitForTimeout(900);
out.alerts = await rowsIn('aside.bs-left', '.ds-action-list-item');
out.sizesBattlespace = await sizes();

// The inspector on a fused track
await goto('bm=B4&sel=F-0525');
await openView('Battlespace');
out.inspector = await evalIn(() => {
  const aside = document.querySelector('aside.bs-right');
  const a = aside.getBoundingClientRect();
  const tabs = aside.querySelector('[role=tablist]')?.getBoundingClientRect();
  const vp = aside.querySelector('.ds-scroll__viewport, .bs-scroll__viewport');
  const v = vp.getBoundingClientRect();
  const facts = [...aside.querySelectorAll('.bs-fact')].map((e) => e.getBoundingClientRect()).filter((r) => r.top >= v.top - 1 && r.bottom <= v.bottom + 1);
  const h = (s) => {
    const e = aside.querySelector(s);
    return e ? Math.round(e.getBoundingClientRect().height) : null;
  };
  return { headToTabsBottom: tabs ? Math.round(tabs.bottom - a.top) : null, headToFirstContent: Math.round(v.top - a.top), pin: h('.bs-insp__pin'), head: h('.bs-insp__head'), factsVisible: facts.length, factHeight: facts[0] ? Math.round(facts[0].height) : null, hypothesisCards: [...aside.querySelectorAll('.bs-hcard')].map((e) => Math.round(e.closest('.ds-card')?.getBoundingClientRect().height ?? e.getBoundingClientRect().height)) };
});

// Targets
await openView('Targets');
out.targets = await evalIn(() => {
  const med = (a) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  return { cardHeight: med([...document.querySelectorAll('.tb-card')].map((e) => Math.round(e.closest('.ds-card')?.getBoundingClientRect().height ?? e.getBoundingClientRect().height))), columnHead: med([...document.querySelectorAll('.tb__colhead')].map((e) => Math.round(e.getBoundingClientRect().height))), strip: (() => { const e = document.querySelector('.tb__strip'); return e ? Math.round(e.getBoundingClientRect().height) : null; })() };
});
out.sizesTargets = await sizes();

console.log(JSON.stringify(out, null, 1));
await browser.close();
