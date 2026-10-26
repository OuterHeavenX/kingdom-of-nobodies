// Opens every panel a player can reach: each tab in each of its modes, every
// detail page linked from them (as a tap would), and the detail page of every
// plot, business and citizen (as a tap in the 3D view would). Returns the pages
// that threw. Used by tests/panels.test.js and on saved long-run checkpoints.
import { HUD } from '../src/ui/HUD.js';

const DETAILS = ['citizen', 'business', 'plot', 'house', 'tree', 'bio', 'kingdom', 'caravan', 'case', 'landmark', 'foreign', 'war', 'army', 'bank', 'guild', 'faith', 'thennow'];
const MODES = { 'world-mode': 'worldMode', 'people-mode': 'peopleMode', 'region-mode': 'regionMode', 'pol-mode': 'polMode', 'econ-mode': 'econMode', 'hist-mode': 'historyMode' };
const TABS = ['world', 'citizens', 'region', 'economy', 'politics', 'history'];

export function sweepPanels(sim, { limit = 4000 } = {}) {
  const errors = [];
  let pages = 0;
  const render = (view) => {
    pages++;
    try { return HUD.prototype.content.call({ sim, view, game: {}, peopleSeg: HUD.prototype.peopleSeg }).html ?? ''; } catch (e) {
      errors.push({ view: JSON.stringify(view), error: e.stack?.split('\n').slice(0, 3).join(' | ') ?? String(e) });
      return '';
    }
  };
  const seen = new Set();
  const queue = [];
  const add = (kind, id) => { const k = `${kind}:${id}`; if (!seen.has(k)) { seen.add(k); queue.push([kind, id]); } };
  const links = (html) => {
    for (const m of html.matchAll(/data-act="([a-z-]+)" data-id="([^"]*)"/g)) if (DETAILS.includes(m[1])) add(m[1], m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  };
  const s = sim.state;
  for (const tab of TABS) {
    const base = { tab };
    const html = render(base);
    links(html);
    for (const m of html.matchAll(/data-act="([a-z]+-mode)" data-id="([^"]*)"/g)) {
      if (!MODES[m[1]]) continue;
      const v = { tab, [MODES[m[1]]]: m[2] };
      if (tab === 'citizens' && m[1] === 'people-mode' && m[2] === 'families') v.tab = 'families';
      links(render(v));
    }
  }
  for (const p of s.plots) add('plot', p.id);
  for (const b of s.businesses) add('business', b.id);
  for (const c of s.citizens) add('citizen', c.id);
  while (queue.length && pages < limit) {
    const [kind, id] = queue.shift();
    links(render({ tab: 'world', detail: { kind, id } }));
  }
  return { pages, errors };
}
