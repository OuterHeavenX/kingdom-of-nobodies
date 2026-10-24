import { CATEGORIES, filterChronicle } from '../society/Chronicle.js';
import { esc, clock, capital } from './util.js';

const ICONS = { citizen: '👤', business: '🏪', property: '📍', economy: '🪙', relationships: '💞', construction: '🔨', council: '⚖️' };

/** filter: { category, citizen, business, plot } */
export function chronicle(sim, filter = {}) {
  const s = sim.state;
  const entries = filterChronicle(s, filter).slice(-160).reverse();
  let lastDay = null;
  const body = entries.map((e) => {
    const head = e.day !== lastDay ? `<div class="day-head">DAY ${e.day}</div>` : '';
    lastDay = e.day;
    return `${head}<div class="entry imp${e.importance}"><small>${ICONS[e.category] ?? ''} ${clock(e.minute)} · ${capital(e.category)}</small>${esc(e.text)}</div>`;
  }).join('');
  const chips = [`<button class="chip ${!filter.category ? 'active' : ''}" data-act="chronicle-filter" data-id="">All</button>`,
    ...CATEGORIES.map((c) => `<button class="chip ${filter.category === c ? 'active' : ''}" data-act="chronicle-filter" data-id="${c}">${ICONS[c]} ${capital(c)}</button>`)].join('');
  const subject = filter.citizen ? s.citizens.find((c) => c.id === filter.citizen)?.firstName
    : filter.business ? s.businesses.find((b) => b.id === filter.business)?.name
      : filter.plot ? s.plots.find((p) => p.id === filter.plot)?.name : null;
  const banner = subject ? `<div class="row between card" style="padding:8px 12px"><span>History of <strong>${esc(subject)}</strong></span><button class="chip" data-act="chronicle-clear">Show all</button></div>` : '';
  return { title: 'The Chronicle', html: `${banner}<div class="chips scroll">${chips}</div><div class="timeline">${body || '<p class="empty">Nothing recorded yet.</p>'}</div>` };
}
