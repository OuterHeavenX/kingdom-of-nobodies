import { yearOf, dateLabel } from '../core/Calendar.js';
import { DAYS_PER_YEAR } from '../core/Config.js';
import { AGES, ageDef, yearsToNextAge } from '../civilization/Ages.js';
import { techStatus } from '../civilization/Technology.js';
import { networkSummary, serviceAt, NETWORKS, unmetNeeds } from '../civilization/Infrastructure.js';
import { architectureStats } from '../civilization/Architecture.js';
import { densityStats } from '../civilization/Density.js';
import { redevelopmentProjects } from '../civilization/Modernization.js';
import { landmarks, heritageScore, isListed, inConservation } from '../civilization/Heritage.js';
import { transportSummary, MODES } from '../civilization/Transport.js';
import { propertyTimeline, appearances, ownerChain, describe, propertyOn } from '../civilization/PropertyHistory.js';
import { ERA_NAMES, ERA_MATERIAL, formOf, formLabel } from '../civilization/ArchitectureData.js';
import { buildingDims } from '../property/Footprints.js';
import { plotValue } from '../property/LandRegistry.js';
import { landDemand } from '../city/LandDemand.js';
import { housingStats } from '../population/Housing.js';
import { projectProgress } from '../property/Construction.js';
import { esc } from './util.js';

// Era & Technology, City Evolution and Then & Now. Everything shown is read
// from the simulation: the age opened by the calendar, the technologies the
// council has actually adopted, utilities actually laid, buildings actually
// standing, and each property's recorded history.

const eraBadge = (e) => `<span class="era-badge era-${e}">${ERA_NAMES[e]}</span>`;
const bar = (v) => `<div class="progress"><i style="width:${Math.max(0, Math.min(100, Math.round(v * 100)))}%"></i></div>`;

export function eraPanel(sim) {
  const s = sim.state;
  const civ = s.civ;
  if (!civ) return '<p class="empty">The civilization record is not available.</p>';
  const age = ageDef(civ.age);
  const year = yearOf(s.day);
  const toNext = yearsToNextAge(s.day);
  const span = toNext == null ? 1 : (year - age.from) / 100;
  const techs = techStatus(s);
  const byAge = AGES.map((a) => ({ a, list: techs.filter((t) => t.age === a.id) }));
  const nets = networkSummary(s);
  const tr = transportSummary(s);
  const works = civ.works.map((w) => `<div class="belief">${NETWORKS[w.net].icon} ${esc(NETWORKS[w.net].levels[w.level])} for ${esc(w.district)} · ${w.paid}/${w.cost}🪙${w.waiting ? ` (${esc(w.waiting)})` : ''}</div>`).join('');
  return `
  <div class="card era-hero era-${age.id}">
    <div class="row between"><strong style="font-size:17px">${age.icon} ${esc(age.name)}</strong><span class="muted">Year ${year}</span></div>
    <p class="muted" style="margin:6px 0">${esc(age.blurb)}</p>
    ${toNext == null ? '<p class="muted">The last age: the future is what the town makes of it.</p>' : `${bar(span)}<p class="muted" style="font-size:12px;margin-top:4px">${toNext} year${toNext === 1 ? '' : 's'} until the ${esc(ageDef(age.id + 1).name)} opens. Opening an age changes nothing standing: it puts new technology within reach.</p>`}
    <div class="age-strip">${AGES.map((a) => `<span class="${a.id < civ.age ? 'done' : a.id === civ.age ? 'current' : ''}" title="${esc(a.name)}">${a.icon}<small>Y${a.from}</small></span>`).join('')}</div>
  </div>
  <div class="card"><h3>Technology</h3>
    ${byAge.filter((x) => x.a.id <= civ.age + 1).map(({ a, list }) => `<h4>${a.icon} ${esc(a.short)}</h4>${list.map((t) => `<div class="tech ${t.adoptedDay ? 'adopted' : t.blocker?.startsWith('opens') ? 'locked' : ''}"><span>${t.icon}</span><div><strong>${esc(t.name)}</strong>${t.adoptedDay ? ` <small class="muted">adopted ${esc(dateLabel(t.adoptedDay, { short: true }))}</small>` : ''}<small>${esc(t.effect)}</small>${t.adoptedDay ? '' : `<small class="why">${esc(t.blocker ?? 'ready: the council will adopt it at the start of a season')}${t.cost ? ` · ${t.cost}🪙` : ''}</small>`}</div></div>`).join('')}`).join('')}
  </div>
  <div class="card"><h3>Infrastructure</h3>
    ${nets.map((n) => `<div class="net"><span>${n.icon}</span><div><strong>${esc(n.label)}</strong> <small class="muted">best in town: ${esc(n.levels[n.best])}</small>${bar(n.max ? n.covered / Math.max(1, n.districts) : 0)}<small class="muted">${n.max > (n.base ?? 0) ? `${n.covered} of ${n.districts} districts have ${esc(n.levels[n.max].toLowerCase())}` : 'needs a technology first'}</small></div></div>`).join('')}
    ${works ? `<h4>Public works</h4>${works}` : ''}
    <p class="muted" style="font-size:12px;margin-top:6px">Upkeep paid so far: ${civ.stats.upkeepPaid}🪙${civ.stats.decayed ? ` · ${civ.stats.decayed} district service${civ.stats.decayed === 1 ? '' : 's'} lapsed for want of upkeep` : ''}.</p>
  </div>
  <div class="card"><h3>Transport</h3>
    <dl class="kv"><dt>Freight</dt><dd>${MODES[tr.freight].icon} ${esc(MODES[tr.freight].label)}${tr.regional > 1 ? ` (caravans ${Math.round((tr.regional - 1) * 100)}% faster)` : ''}</dd>
      <dt>Station</dt><dd>${tr.station ? 'built' : 'none yet'}</dd>
      <dt>Trips by vehicle</dt><dd>${Object.entries(tr.trips).map(([k, n]) => `${MODES[k]?.icon ?? ''} ${n}`).join(' · ') || 'everyone walks'}</dd>
      <dt>Roads resurfaced</dt><dd>${tr.paved} of ${tr.roads}</dd></dl>
  </div>`;
}

export function evolutionPanel(sim) {
  const s = sim.state;
  if (!s.civ) return '';
  const a = architectureStats(s);
  const dn = densityStats(s);
  const hs = housingStats(s);
  const demand = landDemand(s);
  const lm = landmarks(s);
  const tallest = a.tallest;
  const valuable = s.plots.filter((p) => p.building).sort((x, y) => plotValue(y) - plotValue(x))[0];
  const max = Math.max(1, ...a.byEra);
  const builtArea = s.plots.reduce((sum, p) => sum + (p.building ? p.w * p.d : 0), 0);
  const density = builtArea ? Math.round((s.citizens.length / builtArea) * 1000) / 10 : 0;
  const projects = redevelopmentProjects(s);
  const apps = (s.civ.applications ?? []).slice(-6).reverse();
  return `
  <div class="card"><h3>City evolution</h3>
    <div class="era-bars">${[1, 2, 3, 4, 5].map((e) => `<div><span>${esc(ERA_NAMES[e])}</span><i style="width:${(a.byEra[e] / max) * 100}%" class="era-${e}"></i><b>${a.byEra[e]}</b></div>`).join('')}</div>
    <dl class="kv" style="margin-top:8px">
      <dt>Modernized</dt><dd>${a.modernPct}% of ${a.total} buildings</dd>
      <dt>Historic landmarks</dt><dd>${lm.listed.length} listed${lm.notable.length ? `, ${lm.notable.length} notable` : ''}${(s.civ.heritage?.conservation ?? []).length ? ` · conservation: ${esc(s.civ.heritage.conservation.join(', '))}` : ''}</dd>
      <dt>Density</dt><dd>${density} people per 100 m² built</dd>
      <dt>Housing</dt><dd>${hs.beds} beds, ${hs.free} free${hs.homeless ? `, ${hs.homeless} homeless` : ''} · ${demand.housingShortage} homes short</dd>
      <dt>Rented flats</dt><dd>${dn.apartments} apartment blocks, ${dn.towers} towers · ${dn.renters}/${dn.rentalBeds} beds let</dd>
      <dt>Mansions</dt><dd>${dn.mansions}</dd>
      <dt>Tallest</dt><dd>${tallest ? `<button class="chip" data-act="plot" data-id="${tallest.id}">${esc(formLabel(tallest.building))}, ${tallest.building.floors ?? 1} storeys · ${esc(tallest.name)}</button>` : '—'}</dd>
      <dt>Most valuable</dt><dd>${valuable ? `<button class="chip" data-act="plot" data-id="${valuable.id}">${esc(valuable.building.name)} · ${plotValue(valuable)}🪙</button>` : '—'}</dd>
    </dl>
  </div>
  <div class="card"><h3>Redevelopment</h3>
    ${projects.map(({ p, plot, label, owner }) => `<button class="item" data-act="plot" data-id="${plot.id}"><span class="main"><strong>${esc(label)}</strong><small>${esc(plot.name)} · ${esc(owner)} · ${esc(p.stage.toLowerCase())}${p.waiting ? ` · ${esc(p.waiting.toLowerCase())}` : ''}</small></span><span class="side">${Math.round(projectProgress(p) * 100)}%</span></button>`).join('') || '<p class="muted">No buildings are being rebuilt right now.</p>'}
    ${apps.length ? `<h4>Planning</h4>${apps.map((x) => `<div class="belief"><strong>${esc(formOf(x.type, x.era).labels[0])}</strong> · ${esc(x.status.toLowerCase().replace('_', ' '))}${x.decision ? `<br><span class="muted">${esc(x.decision)}</span>` : ''}</div>`).join('')}` : ''}
  </div>
  <div class="card"><h3>Heritage</h3>
    ${lm.memorial ? '<div class="belief">🗿 <strong>Founders\' Memorial</strong> · the square · always protected</div>' : ''}
    ${lm.listed.map((l) => `<button class="item" data-act="plot" data-id="${l.plot.id}"><span class="main"><strong>🏛 ${esc(l.name)}</strong><small>${esc(l.plot.name)} · listed Year ${yearOf(l.day)}: ${esc(l.why)}</small></span></button>`).join('')}
    ${lm.notable.map((n) => `<button class="item" data-act="plot" data-id="${n.plot.id}"><span class="main"><strong>${esc(n.plot.building.name)}</strong><small>${esc(n.plot.name)} · importance ${n.score}${n.reasons.length ? ` · ${esc(n.reasons[0])}` : ''}</small></span></button>`).join('')}
    ${lm.disputes.length ? `<h4>Planning disputes</h4>${lm.disputes.map((d) => `<div class="belief">${esc(d.concerns[0] ?? '')} · ${esc(d.status === 'OPEN' ? `council votes on day ${d.voteDay}` : d.outcome ?? 'closed')}</div>`).join('')}` : ''}
  </div>`;
}

/** Architecture, condition and heritage of one property, for its detail sheet. */
export function architectureCard(sim, p) {
  const s = sim.state;
  const b = p.building;
  if (!b || !s.civ) return '';
  const dm = buildingDims(p, b);
  const h = heritageScore(s, p);
  const unmet = unmetNeeds(s, p, b.type, b.era ?? 1);
  const age = Math.round((s.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR);
  const services = ['power', 'water', 'transit'].map((n) => `${NETWORKS[n].icon} ${serviceAt(s, p, n)}`).join(' ');
  return `<div class="card"><h3>Architecture</h3>
    <dl class="kv">
      <dt>Style</dt><dd>${esc(formLabel(b))} ${eraBadge(b.era ?? 1)}</dd>
      <dt>Built</dt><dd>Year ${yearOf(b.rebuiltDay ?? b.builtDay ?? 1)} (${age} year${age === 1 ? '' : 's'} ago)${b.firstBuiltDay ? ` · first building here Year ${yearOf(b.firstBuiltDay)}` : ''}</dd>
      <dt>Structure</dt><dd>${esc(ERA_MATERIAL[b.era ?? 1])} · ${dm.floors} storey${dm.floors === 1 ? '' : 's'}, ${Math.round(dm.h)} m tall</dd>
      <dt>Condition</dt><dd>${Math.round(b.condition ?? 100)}%${(b.condition ?? 100) < 75 ? ' · needs maintenance' : ''}</dd>
      <dt>Value</dt><dd>${plotValue(p)}🪙</dd>
      <dt>Utilities</dt><dd>${services}${unmet.length ? ` · <span class="warn">short of ${esc(unmet.join(', '))}</span>` : ''}</dd>
      <dt>Heritage</dt><dd>${isListed(s, p.id) ? '🏛 Listed (protected)' : inConservation(s, p) ? '🏛 In a conservation area' : `importance ${h.score}`}${h.reasons.length ? ` · ${esc(h.reasons.slice(0, 2).join('; '))}` : ''}</dd>
    </dl>
    <button class="btn primary" data-act="thennow" data-id="${p.id}" style="margin-top:8px;width:100%">🕰 Then &amp; Now</button>
  </div>`;
}

const KIND_TEXT = { built: 'Built', rebuilt: 'Rebuilt', demolished: 'Demolished', ruined: 'Destroyed by fire', restored: 'Restored', expanded: 'Expanded', owner: 'New owner', business: 'New business', closed: 'Business closed', renamed: 'Renamed', surveyed: 'Surveyed' };

/** The Then & Now viewer: a property's timeline, a chosen year beside the present, owners and families. */
export function thenNowView(sim, plotId, view) {
  const s = sim.state;
  const p = s.plots.find((x) => x.id === plotId);
  if (!p) return { title: 'Then & Now', html: '<p class="empty">Not found.</p>' };
  const stops = appearances(s, plotId);
  const timeline = propertyTimeline(s, plotId);
  const chosen = view.thenDay ?? stops[0]?.d ?? 1;
  const then = propertyOn(s, plotId, chosen);
  const now = p.building;
  const owners = ownerChain(s, plotId);
  const split = view.thenSplit ?? 0.5;
  const html = `
  <div class="card thennow">
    <p class="muted" style="font-size:12px;margin:0 0 8px">Viewing history changes nothing: the kingdom keeps living in Year ${yearOf(s.day)}.</p>
    <div class="chips scroll">${stops.map((r) => `<button class="chip ${r.d === chosen ? 'active' : ''}" data-act="then-year" data-id="${r.d}">Y${r.year} · ${esc(r.state.t ? describe(r.state) : 'Vacant')}</button>`).join('')}</div>
    <div class="compare">
      <div><small>THEN · Year ${yearOf(chosen)}</small><strong>${esc(then ? describe(then) : 'Vacant land')}</strong><span class="muted">${esc(then?.bz ?? then?.n ?? '')}${then?.e ? ` · ${ERA_NAMES[then.e]}` : ''}</span></div>
      <div><small>NOW · Year ${yearOf(s.day)}</small><strong>${esc(now ? formLabel(now) : 'Vacant land')}</strong><span class="muted">${esc(now?.name ?? '')}${now ? ` · ${ERA_NAMES[now.era ?? 1]}` : ''}</span></div>
    </div>
    <label class="slider-label">◀ Then <input type="range" min="0" max="100" value="${Math.round(split * 100)}" data-act="then-split" aria-label="Before and after"> Now ▶</label>
    <div class="grid2"><button class="btn" data-act="then-show" data-id="${p.id}">👁 Show in 3D</button><button class="btn" data-act="then-exit">✓ Back to the present</button></div>
  </div>
  <div class="card"><h3>Owners</h3>${owners.map((o) => `<div class="belief">${o.living ? `<button class="chip" data-act="citizen" data-id="${esc(o.id)}">${esc(o.name)}</button>` : o.id.startsWith('c') && s.archive[o.id] ? `<button class="chip" data-act="bio" data-id="${esc(o.id)}">${esc(o.name)} ✝</button>` : esc(o.name)} · from Year ${o.year}${o.link ? ` · <em>${esc(o.link)}</em>` : ''}</div>`).join('') || '<p class="muted">No owners recorded.</p>'}</div>
  <div class="card"><h3>Timeline</h3><div class="timeline">${[...timeline].reverse().map((r) => `<div class="entry"><small>YEAR ${r.year}</small>${esc(KIND_TEXT[r.k] ?? r.k)}${r.k === 'owner' ? `: ${esc(r.on ?? '')}` : r.k === 'business' ? `: ${esc(r.bz ?? '')}` : r.state.t ? `: ${esc(describe(r.state))}${r.from && r.k === 'rebuilt' ? ` (replacing a ${esc(r.from.toLowerCase())})` : ''}` : ''}</div>`).join('') || '<p class="muted">No recorded history yet.</p>'}</div></div>`;
  return { title: `Then & Now · ${p.name}`, html };
}
