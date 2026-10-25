import { dateLabel } from '../core/Calendar.js';
import { ensureCity } from '../city/CityPlanner.js';
import { landDemand } from '../city/LandDemand.js';
import { ROAD_KINDS } from '../navigation/RoadNetwork.js';
import { WEATHER_LABEL, WEATHER_ICON } from '../events/Weather.js';
import { settlementStage } from '../population/Expansion.js';
import { esc, capital } from './util.js';

// The World tab: the town as it grows — what it needs, the plans before the
// council, streets being built, districts and their changing character,
// private developments and the day's weather. And the camera.

export function worldPanel(sim, view) {
  const s = sim.state;
  const city = ensureCity(s);
  const d = landDemand(s);
  const mode = view.worldMode ?? 'overview';
  const seg = `<div class="segmented scroll-seg">${[['overview', 'Town'], ['plans', 'Plans'], ['districts', 'Districts'], ['building', 'Building']].map(([k, l]) => `<button class="${mode === k ? 'active' : ''}" data-act="world-mode" data-id="${k}">${l}</button>`).join('')}</div>`;
  const camera = `<div class="grid2"><button class="btn" data-act="overview">🔭 Overview</button><button class="btn" data-act="tab" data-id="region">🗺️ Region</button><button class="btn" data-act="celebrations">🎉 Seasons & holidays</button></div>`;
  let body = '';
  if (mode === 'overview') {
    const w = s.weather?.today;
    body = `<div class="card"><dl class="kv"><dt>Settlement</dt><dd>${esc(settlementStage(s.citizens.length))} · ${s.citizens.length} people</dd><dt>Weather</dt><dd>${w ? `${WEATHER_ICON[w.kind]} ${esc(WEATHER_LABEL[w.kind])}` : '—'}</dd>
      <dt>Homes short</dt><dd>${d.housingShortage}${d.homeless ? ` (${d.homeless} homeless)` : ''}</dd><dt>House plots for sale</dt><dd>${d.vacantResidential}</dd><dt>Shop land for sale</dt><dd>${d.vacantCommercial}</dd><dt>People per shop</dt><dd>${Math.round(d.commercialDemand * 14)}</dd>
      <dt>Out of work</dt><dd>${d.unemployed} (${d.openings} openings)</dd><dt>Average land price</dt><dd>${d.landPrice}🪙</dd><dt>Busiest road</dt><dd>${d.congestion.busiest ? `${esc(d.congestion.busiest.name)} (${d.congestion.busiest.avg} trips)` : '—'}</dd></dl></div>${camera}`;
  } else if (mode === 'plans') {
    body = `${city.proposals.slice().reverse().slice(0, 12).map((p) => `<div class="card"><strong>${esc(p.name)}</strong> · ${esc(p.status.toLowerCase())}<p class="muted" style="font-size:12px;margin:4px 0">${esc(capital(p.reason))}.</p>
      <dl class="kv"><dt>Street</dt><dd>${Math.round(Math.max(p.road.w, p.road.d))} paces of ${esc(ROAD_KINDS[p.road.kind].label.toLowerCase())}</dd><dt>Plots</dt><dd>${p.plots.length} (${p.appraisal.beds} beds, ${p.appraisal.shops} shops)</dd><dt>Cost</dt><dd>${p.appraisal.total}🪙${p.loanId ? ' (part borrowed)' : ''}</dd>${p.decision ? `<dt>Council</dt><dd>${esc(p.decision)}</dd>` : ''}</dl></div>`).join('') || '<p class="empty">No street plans yet. The planners take over once the old districts are full.</p>'}
      ${city.rezonings.length ? `<div class="card"><h3>Rezoning</h3>${city.rezonings.slice(-6).reverse().map((r) => `<div class="belief">${esc(dateLabel(r.day))}: ${esc(r.from)} → ${esc(r.to)} (${esc(r.why)})</div>`).join('')}</div>` : ''}`;
  } else if (mode === 'districts') {
    body = Object.values(city.districts).map((x) => `<div class="card"><strong>${esc(x.name)}</strong> · ${esc(x.identity)}<p class="muted" style="font-size:12px;margin:4px 0">${x.origin === 'planned' ? 'Laid out by the town planners' : x.origin === 'founding' ? 'The founders\' village' : 'Surveyed by the council'}${x.foundedDay > 1 ? `, ${esc(dateLabel(x.foundedDay))}` : ''} · ${s.plots.filter((p) => (p.district ?? 'Old Town') === x.name).length} plots</p>${x.history.length ? x.history.slice(-3).reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: became ${esc(h.identity)}</div>`).join('') : ''}</div>`).join('');
  } else {
    const roads = (s.roadProjects ?? []).filter((p) => ['BUILDING', 'APPROVED', 'PROPOSED'].includes(p.status));
    const builds = s.projects.map((p) => `<div class="belief">${esc(s.plots.find((x) => x.id === p.plotId)?.name ?? '')}: ${esc(p.kind)}${p.buildingType ? ` of a ${esc(p.buildingType)}` : ''} · ${esc(p.stage.toLowerCase())}${p.waiting ? ` (${esc(p.waiting.toLowerCase())})` : ''}</div>`).join('');
    body = `<div class="card"><h3>Road works</h3>${roads.map((p) => `<div class="belief"><strong>${esc(p.name)}</strong> · ${esc(p.status.toLowerCase())}${p.status === 'BUILDING' ? ` ${Math.round(Math.min(1, p.work / p.need.work) * 100)}%` : ''}<br><span class="muted">${esc(p.reason)}</span></div>`).join('') || '<p class="muted">None under way.</p>'}</div>
      <div class="card"><h3>Building sites</h3>${builds || '<p class="muted">None.</p>'}</div>
      <div class="card"><h3>Homes built to sell</h3>${city.developments.slice(-8).reverse().map((v) => `<div class="belief">${esc(s.citizens.find((c) => c.id === v.developerId)?.firstName ?? 'A developer')} · ${esc(s.plots.find((p) => p.id === v.plotId)?.name ?? '')} · ${esc(v.status.toLowerCase())}${v.price ? ` for ${v.price}🪙 (${v.profit >= 0 ? '+' : ''}${v.profit})` : ` · asking ${v.ask}🪙`}</div>`).join('') || '<p class="muted">No speculative building yet.</p>'}</div>`;
  }
  return { title: 'The Town', html: seg + body };
}
