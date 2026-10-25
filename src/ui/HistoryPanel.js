import { yearOf, dateLabel, firstDayOfYear } from '../core/Calendar.js';
import { DAYS_PER_YEAR } from '../core/Config.js';
import { CATEGORIES, filterChronicle } from '../society/Chronicle.js';
import { biography } from '../history/Biography.js';
import { lifespanLabel } from '../history/Archive.js';
import { person } from '../citizens/FamilyTree.js';
import { esc, clock, capital } from './util.js';
import { warsView } from './MilitaryPanel.js';
import { KINGDOMS } from '../region/RegionData.js';

/** The neighbouring kingdoms' own histories and their remembered people. */
function kingdomHistories(sim) {
  const s = sim.state;
  const html = Object.entries(KINGDOMS).map(([kid, k]) => {
    const st = s.region.settlements[kid];
    const dead = (s.foreign?.departed ?? []).filter((d) => d.kingdom === kid && ['ruler', 'notable', 'merchant', 'guild', 'faith'].includes(d.role)).slice(-5).reverse();
    return `<div class="card"><h3>${esc(k.name)}</h3>${st.history.slice(-6).reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('')}
      ${dead.length ? `<p class="muted" style="font-size:12px;margin:6px 0 2px">Remembered</p>${dead.map((d) => `<button class="chip" data-act="foreign" data-id="${d.id}">${esc(d.name)} · ${esc(d.occupation)}</button>`).join(' ')}` : ''}</div>`;
  }).join('');
  return { title: 'History · Kingdoms', html: modeChips('kingdoms') + html };
}

const ICONS = { citizen: '👤', business: '🏪', property: '📍', economy: '🪙', relationships: '💞', construction: '🔨', council: '⚖️', region: '🗺️', trade: '🐂', diplomacy: '🤝', law: '📜', culture: '🎉' };
const MODES = [['eras', 'Eras'], ['timeline', 'Timeline'], ['people', 'Departed'], ['wars', 'Wars'], ['kingdoms', 'Kingdoms'], ['culture', 'Culture']];

function modeChips(mode) {
  return `<div class="segmented scroll-seg" style="margin-bottom:4px">${MODES.map(([k, l]) => `<button class="${k === mode ? 'active' : ''}" data-act="hist-mode" data-id="${k}">${l}</button>`).join('')}</div>`;
}

export function historyPanel(sim, view) {
  const mode = view.historyMode ?? 'eras';
  if (mode === 'timeline') return timeline(sim, view);
  if (mode === 'people') return departed(sim, view);
  if (mode === 'culture') return culture(sim);
  if (mode === 'wars') return { title: 'History · Wars', html: modeChips('wars') + warsView(sim) };
  if (mode === 'kingdoms') return kingdomHistories(sim);
  return eras(sim);
}

function eras(sim) {
  const s = sim.state;
  const founders = [...s.citizens, ...Object.values(s.archive)].filter((p) => p.founder).sort((a, b) => a.id.localeCompare(b.id));
  const memorial = `<div class="card memorial">
    <h3>The Founders' Memorial</h3>
    <p class="muted" style="font-size:12.5px">Raised beside the hearth where five strangers began the kingdom.</p>
    <div class="list">${founders.map((f) => `<button class="item" data-act="bio" data-id="${f.id}"><span class="portrait" style="background:${esc(f.color)}">${esc(f.firstName[0])}</span>
      <span class="main"><strong>${esc(f.firstName)} ${esc(f.lastName)}</strong><small>${esc(lifespanLabel(f))}</small></span><span class="side">📖</span></button>`).join('')}</div>
  </div>`;
  const eraList = [...s.eras].reverse().map((e, i, arr) => {
    const end = i === 0 ? null : arr[i - 1].startDay;
    return `<div class="entry imp3"><small>YEAR ${yearOf(e.startDay)}${end ? `–${yearOf(end)}` : ' – present'}</small><strong>${esc(e.name)}</strong><br><span class="muted">${esc(e.reason)}</span></div>`;
  }).join('');
  const notable = Object.values(s.archive).filter((p) => (p.achievements ?? []).filter((a) => !['married', 'trained'].includes(a.type)).length >= 2)
    .sort((a, b) => (b.achievements?.length ?? 0) - (a.achievements?.length ?? 0)).slice(0, 8);
  const html = `${modeChips('eras')}${memorial}
    <div class="card"><h3>Eras of the kingdom</h3><div class="timeline">${eraList}</div></div>
    ${notable.length ? `<div class="card"><h3>Remembered lives</h3><div class="list">${notable.map((p) => `<button class="item" data-act="bio" data-id="${p.id}"><span class="portrait" style="background:${esc(p.color)}">${esc(p.firstName[0])}</span><span class="main"><strong>${esc(p.firstName)} ${esc(p.lastName)}</strong><small>${esc(p.achievements.filter((a) => !['married', 'trained'].includes(a.type))[0]?.text ?? '')}</small></span></button>`).join('')}</div></div>` : ''}`;
  return { title: 'History', html };
}

function timeline(sim, view) {
  const s = sim.state;
  const currentYear = yearOf(s.day);
  const filter = view.chronicle ?? {};
  const entity = filter.citizen || filter.business || filter.plot;
  const year = entity ? null : view.historyYear ?? currentYear;
  const q = (view.historyQuery ?? '').trim().toLowerCase();
  let entries = filterChronicle(s, filter);
  if (year) { const from = firstDayOfYear(year); entries = entries.filter((e) => e.day >= from && e.day < from + DAYS_PER_YEAR); }
  if (q) entries = entries.filter((e) => e.text.toLowerCase().includes(q));
  entries = entries.slice(-150).reverse();
  let lastDay = null;
  const body = entries.map((e) => {
    const head = e.day !== lastDay ? `<div class="day-head">${dateLabel(e.day).toUpperCase()}</div>` : '';
    lastDay = e.day;
    return `${head}<div class="entry imp${e.importance}"><small>${ICONS[e.category] ?? ''} ${clock(e.minute)} · ${capital(e.category)}</small>${esc(e.text)}</div>`;
  }).join('');
  const summary = year ? s.yearly.find((y) => y.year === year) : null;
  const subject = filter.citizen ? person(s, filter.citizen) : null;
  const subjectName = subject ? `${subject.firstName} ${subject.lastName}` : filter.business ? s.businesses.find((b) => b.id === filter.business)?.name : filter.plot ? s.plots.find((p) => p.id === filter.plot)?.name : null;
  const chips = [`<button class="chip ${!filter.category ? 'active' : ''}" data-act="chronicle-filter" data-id="">All</button>`,
    ...CATEGORIES.map((c) => `<button class="chip ${filter.category === c ? 'active' : ''}" data-act="chronicle-filter" data-id="${c}">${ICONS[c]} ${capital(c)}</button>`)].join('');
  const html = `${modeChips('timeline')}
    ${subjectName ? `<div class="row between card" style="padding:8px 12px"><span>History of <strong>${esc(subjectName)}</strong></span><button class="chip" data-act="chronicle-clear">Show all</button></div>` : `
    <div class="row between card" style="padding:8px 12px">
      <button class="icon-btn small" data-act="hist-year" data-id="${Math.max(1, year - 1)}" ${year <= 1 ? 'disabled' : ''}>‹</button>
      <strong>Year ${year}</strong>
      <button class="icon-btn small" data-act="hist-year" data-id="${Math.min(currentYear, year + 1)}" ${year >= currentYear ? 'disabled' : ''}>›</button>
    </div>`}
    <input class="search" type="search" placeholder="Search the chronicle…" data-act="hist-search" value="${esc(view.historyQuery ?? '')}">
    <div class="chips scroll">${chips}</div>
    ${summary ? `<p class="muted" style="font-size:12px;margin:0">Year ${summary.year}: ${summary.births} born, ${summary.deaths} died, ${summary.immigrants} arrived, ${summary.emigrants} left, ${summary.marriages} weddings, ${summary.businessesOpened} businesses opened.</p>` : ''}
    <div class="timeline">${body || '<p class="empty">Nothing recorded for this selection.</p>'}</div>`;
  return { title: 'History · Timeline', html };
}

function departed(sim, view) {
  const s = sim.state;
  const q = (view.historyQuery ?? '').trim().toLowerCase();
  const all = Object.values(s.archive).filter((p) => !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)).sort((a, b) => (b.deathDay ?? b.leftDay) - (a.deathDay ?? a.leftDay));
  const rows = all.slice(0, 80).map((p) => `<button class="item" data-act="bio" data-id="${p.id}"><span class="portrait" style="background:${esc(p.color)};opacity:.75">${esc(p.firstName[0])}</span>
    <span class="main"><strong>${esc(p.firstName)} ${esc(p.lastName)}${p.founder ? ' ★' : ''}</strong><small>${esc(lifespanLabel(p))}${p.cause ? ` · ${esc(p.cause)}` : ''}</small></span></button>`).join('');
  return { title: `History · ${all.length} remembered`, html: `${modeChips('people')}<input class="search" type="search" placeholder="Search by name…" data-act="hist-search" value="${esc(view.historyQuery ?? '')}"><div class="list">${rows || '<p class="empty">No one has died or left yet.</p>'}</div>` };
}

export function biographyView(sim, id) {
  const s = sim.state;
  const b = biography(s, id);
  if (!b) return { title: 'Biography', html: '<p class="empty">Unknown person.</p>' };
  const p = person(s, id);
  const html = `
  <div class="card">
    <div class="row"><span class="portrait big" style="background:${esc(p.color)}">${esc(p.firstName[0])}</span>
      <div><strong style="font-size:17px">${esc(b.name)}</strong><div class="muted" style="font-size:13px">${esc(b.title)}</div><div class="muted" style="font-size:12px">${esc(lifespanLabel(p))}</div></div></div>
    <p class="quote" style="font-style:normal">${esc(b.text)}</p>
  </div>
  <div class="card"><h3>Facts</h3><dl class="kv">
    <dt>Born</dt><dd>${esc(b.born)}</dd>
    ${b.died ? `<dt>Died</dt><dd>${esc(b.died)} (${esc(b.cause)})</dd>` : ''}
    <dt>Occupation</dt><dd>${esc(b.occupation)}</dd>
    <dt>Generation</dt><dd>${p.generation ?? 1}</dd>
  </dl></div>
  ${b.achievements.length ? `<div class="card"><h3>Life events</h3><div class="timeline">${b.achievements.map((a) => `<div class="entry"><small>YEAR ${yearOf(a.day)}</small>${esc(a.text)}</div>`).join('')}</div></div>` : ''}
  <div class="grid2">
    <button class="btn" data-act="tree" data-id="${b.id}">🌳 Family tree</button>
    <button class="btn" data-act="history" data-kind="citizen" data-id="${b.id}">📜 In the chronicle</button>
    ${b.living ? `<button class="btn" data-act="citizen" data-id="${b.id}">👤 Their life now</button>` : ''}
  </div>`;
  return { title: b.name, html };
}

function culture(sim) {
  const s = sim.state;
  const c = s.culture;
  const f = c.current;
  const now = f && f.phase !== 'DONE' && f.phase !== 'CANCELLED' ? `<div class="card festival-card"><h3>${esc(f.name)}</h3><p>${f.phase === 'ACTIVE' ? `Under way in the square: ${f.attendees.length} villagers so far.` : `Being prepared for ${esc(dateLabel(f.day))}: ${Math.round(f.budget)} coins budgeted${f.sponsor ? `, ${f.sponsor.gift} from the ${esc(f.sponsor.house)} family` : ''}.`}</p>${f.traditions.length ? `<p class="muted">Traditions: ${esc(f.traditions.join(', '))}</p>` : ''}</div>` : '';
  const traditions = c.traditions.map((t) => `<div class="belief"><strong>${esc(t.name)}</strong>${t.active ? '' : ' <span class="muted">(lapsed)</span>'} · since Year ${t.foundedYear}${t.observed ? `, kept ${t.observed} time${t.observed > 1 ? 's' : ''}` : ''}<br><span class="muted">${esc(t.origin)}</span></div>`).join('');
  const history = [...c.history].reverse().slice(0, 12).map((h) => `<div class="belief">Year ${h.year} · <strong>${esc(h.name)}</strong>: ${h.attendance} of ${h.population} came, ${h.fed} fed, stalls took ${h.sales}🪙, cost ${h.cost}🪙${h.sponsor ? ` (sponsored by the ${esc(h.sponsor)} family)` : ''}</div>`).join('');
  const html = `${modeChips('culture')}${now}
    <div class="card"><h3>Traditions</h3>${traditions || '<p class="muted">Traditions grow from the village\'s own history: a family that keeps sponsoring the feast, a fire nobody forgets, the day the last founder dies.</p>'}</div>
    <div class="card"><h3>Festivals</h3>${history || '<p class="muted">The first festival is still to come.</p>'}</div>`;
  return { title: 'History · Culture', html };
}
