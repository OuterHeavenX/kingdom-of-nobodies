import { balance } from '../economy/Transactions.js';
import { councilCooldown } from '../council/Council.js';
import { dateLabel } from '../core/Calendar.js';
import { HEARTH, KINGDOMS, ROUTES, LANDMARKS, SCENERY, SETTLEMENT_POS, COMMODITIES } from '../region/RegionData.js';
import { routeKnown, routeClosed, routeQuality, settlementName, exploredShare, routeById } from '../region/RegionManager.js';
import { foodCover, available } from '../region/Settlement.js';
import { nextScoutingTarget, expeditionCost } from '../region/Exploration.js';
import { caravanPosition, cargoUnits, hoursToNextStop } from '../trade/Caravans.js';
import { contractById } from '../trade/Contracts.js';
import { relationScore, activeTreaties, embargoBetween, TREATY_KINDS, PARTIES, partyName, tariffRate } from '../diplomacy/Diplomacy.js';
import { esc, meter, capital } from './util.js';
import { rulerCard, peopleCard, alliancesView, warsView } from './MilitaryPanel.js';
import { armyPosition } from '../military/Army.js';

// The Region tab: an SVG map drawn from the simulation (fog, roads, closures,
// caravans where they really are, the scouts' trail), the kingdoms, the
// caravans on the road, foreign relations and exploration.

const MODES = [['map', 'Map'], ['kingdoms', 'Kingdoms'], ['alliances', 'Alliances'], ['wars', 'Wars'], ['diplomacy', 'Diplomacy'], ['caravans', 'Caravans'], ['explore', 'Explore']];
const STATUS_ICON = { PLANNING: '📝', LOADING: '📦', TRAVELING: '🐂', ARRIVED: '🏁', UNLOADING: '📦', RETURNING: '↩️', COMPLETED: '✅', DELAYED: '⏳', CANCELLED: '✖️' };

function modeChips(mode) {
  return `<div class="segmented scroll-seg">${MODES.map(([k, l]) => `<button class="${k === mode ? 'active' : ''}" data-act="region-mode" data-id="${k}">${l}</button>`).join('')}</div>`;
}

const pts = (list) => list.map(([x, y]) => `${x},${y}`).join(' ');
const ownerColor = (cv) => (cv.home === HEARTH ? '#e8c06a' : KINGDOMS[cv.home]?.color ?? '#ccc');

/** The regional map as inline SVG. Every marker is tappable. */
export function regionMap(state, { selected = null } = {}) {
  const r = state.region;
  const fog = [];
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) if (r.fog[j * 10 + i] === '0') fog.push(`<rect x="${i * 10}" y="${j * 10}" width="10.2" height="10.2" class="fog"/>`);
  const routes = ROUTES.filter((rt) => routeKnown(state, rt)).map((rt) => {
    const closed = routeClosed(state, rt);
    const q = routeQuality(state, rt);
    return `<polyline points="${pts(rt.points)}" class="route ${q} ${closed ? 'closed' : ''}"><title>${esc(rt.name)} · ${rt.km} km · ${esc(q)}${closed ? ` · closed: ${esc(closed)}` : ''}</title></polyline>`;
  }).join('');
  const marks = LANDMARKS.filter((l) => r.discovered.landmarks.includes(l.id)).map((l) => `<g class="landmark" data-act="landmark" data-id="${l.id}"><circle cx="${l.x}" cy="${l.y}" r="1.6"/><text x="${l.x + 2}" y="${l.y + 1}">${esc(l.name)}</text></g>`).join('');
  const towns = Object.entries(SETTLEMENT_POS).map(([id, p]) => {
    const color = id === HEARTH ? '#f2d38a' : KINGDOMS[id].color;
    const short = id !== HEARTH && state.region.settlements[id].shortages.food;
    return `<g class="town${selected === id ? ' selected' : ''}" data-act="${id === HEARTH ? 'region-mode' : 'kingdom'}" data-id="${id === HEARTH ? 'kingdoms' : id}"><circle cx="${p.x}" cy="${p.y}" r="${id === HEARTH ? 3.4 : 3}" fill="${color}"/>${short ? `<circle cx="${p.x}" cy="${p.y}" r="4.6" class="alarm"/>` : ''}<text x="${p.x}" y="${p.y - 4.6}">${esc(settlementName(id))}</text></g>`;
  }).join('');
  const caravans = (state.trade?.caravans ?? []).filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED').map((c) => {
    const p = caravanPosition(c);
    return `<g class="caravan${c.status === 'DELAYED' ? ' delayed' : ''}" data-act="caravan" data-id="${c.id}"><rect x="${p.x - 1.3}" y="${p.y - 1}" width="2.6" height="2" rx=".5" fill="${ownerColor(c)}"/></g>`;
  }).join('');
  const armies = (state.military?.armies ?? []).filter((a) => a.status !== 'DISBANDED' && a.status !== 'MUSTERING').map((a) => {
    const p = armyPosition(state, a);
    const col = a.owner === HEARTH ? '#e8c06a' : KINGDOMS[a.owner].color;
    return `<g class="army" data-act="army" data-id="${a.id}"><polygon points="${p.x},${p.y - 2.4} ${p.x + 2},${p.y + 1.2} ${p.x - 2},${p.y + 1.2}" fill="${col}" stroke="#2a1a14" stroke-width=".4"/><text x="${p.x}" y="${p.y + 0.9}" class="army-x">⚔</text></g>`;
  }).join('');
  const out = r.expeditions.find((e) => e.status === 'OUT');
  const scout = out ? `<polyline points="${SETTLEMENT_POS[HEARTH].x},${SETTLEMENT_POS[HEARTH].y} ${out.target.x},${out.target.y}" class="scout-trail"/><text x="${out.target.x}" y="${out.target.y}" class="scout">🧭</text>` : '';
  return `<svg class="region-map" viewBox="0 0 100 100" role="img" aria-label="Map of the region">
    <rect width="100" height="100" class="land"/>
    <polygon points="${pts([...SCENERY.coast, [100, 100]])}" class="sea"/>
    ${SCENERY.forests.map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr}" class="forest"/>`).join('')}
    ${SCENERY.mountains.map(([x, y]) => `<polygon points="${x - 3},${y + 2.5} ${x},${y - 3} ${x + 3},${y + 2.5}" class="mountain"/>`).join('')}
    <polyline points="${pts(SCENERY.river)}" class="river"/>
    ${fog.join('')}
    ${routes}${marks}${scout}${towns}${caravans}${armies}
  </svg>
  <div class="map-legend"><span><i class="lg stone"></i>stone</span><span><i class="lg dirt"></i>road</span><span><i class="lg track"></i>track</span><span><i class="lg closed"></i>closed</span><span><i class="lg cv"></i>caravan</span></div>`;
}

function mapView(sim) {
  const s = sim.state;
  const active = (s.trade?.caravans ?? []).filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED');
  const closures = s.region.closures.filter((c) => c.until >= s.day).map((c) => `${routeById(c.routeId).name}: ${c.reason}${c.closed ? ' (closed)' : ' (slow)'}`);
  return `${regionMap(s)}
    <div class="card"><dl class="kv">
      <dt>Caravans on the road</dt><dd>${active.length}</dd>
      <dt>Region mapped</dt><dd>${Math.round(exploredShare(s) * 100)}%</dd>
      <dt>Road conditions</dt><dd>${closures.length ? esc(closures.join('; ')) : 'all clear'}</dd>
    </dl></div>
    <div class="card"><h3>Lately in the region</h3>${s.region.history.slice(-5).reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('') || '<p class="muted">Quiet roads.</p>'}</div>`;
}

function kingdomsView(sim) {
  const s = sim.state;
  return Object.keys(KINGDOMS).map((id) => {
    const k = s.region.settlements[id];
    const rel = relationScore(s, HEARTH, id);
    return `<button class="item" data-act="kingdom" data-id="${id}">
      <span class="portrait" style="background:${KINGDOMS[id].color}">${esc(k.name[0])}</span>
      <span class="main"><strong>${esc(k.name)}</strong><small>${esc(KINGDOMS[id].identity)} · ${k.population} people · ${esc(k.leader.title)} ${esc(k.leader.name)}</small>
      <small>${k.shortages.food ? '⚠️ food shortage · ' : ''}relations ${rel > 0 ? '+' : ''}${Math.round(rel)}${activeTreaties(s, HEARTH, id).length ? ` · ${activeTreaties(s, HEARTH, id).length} treaty` : ''}${embargoBetween(s, HEARTH, id) ? ' · embargo' : ''}</small></span>
      <span class="side">${balance(s, KINGDOMS[id].account)}🪙</span></button>`;
  }).join('') + `<div class="card"><h3>Visit in 3D</h3><p class="muted" style="font-size:12px">Walk among a kingdom's named people, see its market and any caravans or armies there. Time keeps running everywhere.</p><div class="grid2">${Object.keys(KINGDOMS).map((id) => `<button class="btn" data-act="visit" data-id="${id}">🏰 ${esc(KINGDOMS[id].name)}</button>`).join('')}</div></div>`;
}

export function kingdomDetail(sim, id) {
  const s = sim.state;
  const k = s.region.settlements[id];
  const def = KINGDOMS[id];
  if (!k) return { title: 'Kingdom', html: '<p class="empty">Unknown kingdom.</p>' };
  const rows = Object.keys(COMMODITIES).filter((g) => (k.inventory[g] ?? 0) > 0.5 || def.produces[g] || def.needs[g]).map((g) => {
    const base = COMMODITIES[g].base;
    const p = k.prices[g];
    const trend = p > base * 1.4 ? 'up' : p < base * 0.75 ? 'down' : '';
    return `<tr><td>${COMMODITIES[g].icon} ${esc(COMMODITIES[g].label)}</td><td class="num">${Math.floor(available(k, g))}</td><td class="num ${trend}">${p.toFixed(1)}</td><td class="num">${def.produces[g] ? 'makes' : def.needs[g] || COMMODITIES[g].food ? 'needs' : ''}</td></tr>`;
  }).join('');
  const relations = PARTIES.filter((p) => p !== id).map((p) => {
    const score = relationScore(s, id, p);
    const rel = s.diplomacy.relations[[id, p].sort().join('|')];
    return `<div class="meter-label"><span>${esc(partyName(p))}</span><span>${score > 0 ? '+' : ''}${Math.round(score)}</span></div><div class="meter rel"><i class="${score < -20 ? 'low' : score < 15 ? 'mid' : ''}" style="width:${(score + 100) / 2}%"></i></div>${rel?.log.length ? `<small class="muted">${esc(rel.log.at(-1).why)}</small>` : ''}`;
  }).join('');
  const treaties = activeTreaties(s, id).map((t) => `<div class="belief">${esc(TREATY_KINDS[t.kind].label)} with ${esc(partyName(t.parties.find((p) => p !== id)))} until ${esc(dateLabel(t.endDay))}</div>`).join('');
  const html = `
  <div class="card">
    <p class="muted" style="margin-top:0">${esc(def.identity)} · ${esc(def.geography)}</p>
    <dl class="kv">
      <dt>${esc(k.leader.title)}</dt><dd>${esc(k.leader.name)} (${esc(k.leader.stance)})</dd>
      <dt>Approval</dt><dd>${k.leader.approval}%</dd>
      <dt>Population</dt><dd>${k.population}</dd>
      <dt>Food stores</dt><dd>${Math.max(0, Math.round(foodCover(s, k)))} days${k.shortages.food ? ' ⚠️' : ''}</dd>
      <dt>Prosperity</dt><dd>${Math.round(k.prosperity * 100)}%</dd>
      <dt>Treasury</dt><dd>${balance(s, def.account)}🪙</dd>
      <dt>Import tariff (for us)</dt><dd>${Math.round(tariffRate(s, id, HEARTH) * 100)}%</dd>
    </dl>
    <p class="muted" style="font-size:12px">${esc(def.politics)} ${esc(def.vulnerability)}</p>
  </div>
  ${rulerCard(sim, id)}
  <div class="card"><h3>Market</h3><table class="mkt"><thead><tr><th>Good</th><th>Stock</th><th>Price</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="card"><h3>Relations</h3>${relations}${treaties ? `<h3 style="margin-top:10px">Treaties</h3>${treaties}` : ''}</div>
  ${peopleCard(sim, id)}
  <div class="card"><h3>History</h3>${k.history.slice(-8).reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('') || '<p class="muted">Nothing of note yet.</p>'}</div>`;
  return { title: k.name, html };
}

function caravansView(sim) {
  const s = sim.state;
  const list = [...(s.trade?.caravans ?? [])].reverse();
  const active = list.filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED');
  const done = list.filter((c) => c.status === 'COMPLETED').slice(0, 8);
  const row = (c) => {
    const stop = c.stops[c.stopIndex];
    const where = c.leg ? `${settlementName(c.leg.from)} → ${settlementName(c.leg.to)} (${Math.round((c.leg.progress / c.leg.km) * 100)}%)` : `at ${settlementName(c.at)}`;
    const cargo = Object.entries(c.cargo).map(([g, n]) => `${n} ${g}`).join(', ') || 'empty';
    return `<button class="item" data-act="caravan" data-id="${c.id}"><span class="portrait" style="background:${ownerColor(c)}">${STATUS_ICON[c.status] ?? '🐂'}</span>
      <span class="main"><strong>${esc(c.ownerName)}</strong><small>${esc(capital(c.status.toLowerCase()))} · ${esc(where)}</small><small>${esc(cargo)}${stop && c.status !== 'COMPLETED' ? ` · next: ${esc(stop.action)} at ${esc(settlementName(stop.at))}` : ''}</small></span></button>`;
  };
  const t = s.trade?.stats ?? {};
  return `<div class="card"><dl class="kv"><dt>Deliveries</dt><dd>${t.deliveries ?? 0}</dd><dt>Goods carried</dt><dd>${t.volume ?? 0}</dd><dt>Value traded</dt><dd>${t.value ?? 0}🪙</dd><dt>Spoiled on the road</dt><dd>${t.spoiled ?? 0}</dd><dt>Failed contracts</dt><dd>${t.failures ?? 0}</dd></dl></div>
    <div class="list">${active.map(row).join('') || '<p class="empty">No caravans on the road right now.</p>'}</div>
    ${done.length ? `<p class="muted" style="font-size:12px;margin:8px 0 4px">Recently completed</p><div class="list">${done.map(row).join('')}</div>` : ''}`;
}

export function caravanDetail(sim, id) {
  const s = sim.state;
  const c = (s.trade?.caravans ?? []).find((x) => x.id === id);
  if (!c) return { title: 'Caravan', html: '<p class="empty">This caravan has finished and left the records.</p>' };
  const contracts = c.stops.flatMap((st) => st.contracts ?? []).filter((v, i, a) => a.indexOf(v) === i).map((cid) => contractById(s, cid)).filter(Boolean);
  const eta = c.status === 'COMPLETED' ? null : Math.round(hoursToNextStop(s, c));
  const html = `
  ${regionMap(s, { selected: c.leg?.to ?? c.at })}
  <div class="card"><dl class="kv">
    <dt>Status</dt><dd>${STATUS_ICON[c.status] ?? ''} ${esc(capital(c.status.toLowerCase()))}</dd>
    <dt>Where</dt><dd>${c.leg ? `${esc(routeById(c.leg.route).name)}, ${Math.round(c.leg.progress)} of ${c.leg.km} km` : `at ${esc(settlementName(c.at))}`}</dd>
    ${eta !== null ? `<dt>Next stop in</dt><dd>about ${eta} h</dd>` : ''}
    <dt>Cargo</dt><dd>${Object.entries(c.cargo).map(([g, n]) => `${n} ${esc(g)}`).join(', ') || 'empty'} (${cargoUnits(c)}/${c.capacity})</dd>
    <dt>Spoiled</dt><dd>${Object.entries(c.spoiled).map(([g, n]) => `${n} ${esc(g)}`).join(', ') || 'none'}</dd>
    <dt>Running costs</dt><dd>${c.costs}🪙</dd>
  </dl>
  ${c.home === HEARTH ? `<div class="grid2" style="margin-top:8px"><button class="btn" data-act="follow-caravan" data-id="${c.id}">📍 Watch in the village</button>${s.citizens.some((x) => x.id === c.ownerId) ? `<button class="btn" data-act="citizen" data-id="${c.ownerId}">👤 ${esc(c.ownerName.split(' ')[0])}</button>` : ''}</div>` : ''}
  </div>
  <div class="card"><h3>Itinerary</h3>${c.stops.map((st, i) => `<div class="belief">${i < c.stopIndex ? '✓' : i === c.stopIndex ? '▶' : '·'} ${esc(capital(st.action))} at ${esc(settlementName(st.at))}</div>`).join('')}</div>
  ${contracts.map((ct) => `<div class="card"><h3>Contract ${esc(ct.id)}</h3><dl class="kv">
    <dt>Goods</dt><dd>${ct.qty} ${esc(ct.commodity)}</dd><dt>From</dt><dd>${esc(settlementName(ct.origin))} at ${ct.buyPrice}</dd><dt>To</dt><dd>${esc(ct.buyerName)} at ${ct.sellPrice}</dd>
    <dt>Status</dt><dd>${esc(ct.status.toLowerCase())}</dd><dt>Held in escrow</dt><dd>${ct.escrow}🪙</dd>${ct.profit !== undefined ? `<dt>Profit</dt><dd>${ct.profit}🪙</dd>` : ''}${ct.cancelReason ? `<dt>Cancelled</dt><dd>${esc(ct.cancelReason)}</dd>` : ''}
  </dl><p class="muted" style="font-size:12px">${esc(ct.reason)}</p></div>`).join('')}
  <div class="card"><h3>Log</h3>${[...c.log].reverse().map((l) => `<div class="belief">${esc(dateLabel(l.day))}: ${esc(l.text)}</div>`).join('')}</div>`;
  return { title: `${c.ownerName}'s caravan`, html };
}

function diplomacyView(sim) {
  const s = sim.state;
  const d = s.diplomacy;
  const pairs = Object.entries(d.relations).map(([key, r]) => {
    const [a, b] = key.split('|');
    return `<div class="meter-label"><span>${esc(partyName(a))} – ${esc(partyName(b))}</span><span>${r.score > 0 ? '+' : ''}${Math.round(r.score)}</span></div><div class="meter rel"><i class="${r.score < -20 ? 'low' : r.score < 15 ? 'mid' : ''}" style="width:${(r.score + 100) / 2}%"></i></div>${r.log.length ? `<small class="muted">Last: ${esc(r.log.at(-1).why)} (${r.log.at(-1).delta > 0 ? '+' : ''}${r.log.at(-1).delta})</small>` : ''}`;
  }).join('');
  const treaties = d.treaties.filter((t) => t.status === 'ACTIVE').map((t) => `<div class="belief"><strong>${esc(TREATY_KINDS[t.kind].label)}</strong>: ${esc(partyName(t.parties[0]))} & ${esc(partyName(t.parties[1]))}, until ${esc(dateLabel(t.endDay))}<br><span class="muted">${esc(t.terms)}</span></div>`).join('');
  const embargoes = d.embargoes.filter((e) => e.status === 'ACTIVE').map((e) => `<div class="belief">⛔ ${esc(partyName(e.by))} against ${esc(partyName(e.against))} since ${esc(dateLabel(e.startDay))}: ${esc(e.reason)}</div>`).join('');
  const flows = Object.entries(d.flows).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [a, b] = k.split('>'); return `<div class="belief">${esc(partyName(a))} → ${esc(partyName(b))}: ${n} people</div>`; }).join('');
  return `<div class="card"><h3>Relations</h3>${pairs}</div>
    <div class="card"><h3>Treaties</h3>${treaties || '<p class="muted">No treaties in force.</p>'}${embargoes ? `<h3 style="margin-top:10px">Embargoes</h3>${embargoes}` : ''}</div>
    <div class="card"><h3>Migration</h3>${flows || '<p class="muted">Nobody has moved between the settlements yet.</p>'}</div>
    <div class="card"><h3>Diplomatic history</h3>${d.history.slice(-10).reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>
    <div class="card"><h3>Send a gift</h3><p class="muted" style="font-size:12px">40 coins from the treasury warm relations with a kingdom.</p><div class="grid2">${Object.keys(KINGDOMS).map((id) => { const wait = councilCooldown(s, 'gift', id); return `<button class="btn" data-act="council" data-action="gift" data-id="${id}" ${wait ? 'disabled' : ''} title="${esc(wait ?? '')}">🎁 ${esc(KINGDOMS[id].name)}${wait ? ' · sent this year' : ''}</button>`; }).join('')}</div><p class="muted" style="font-size:11px">One gift to each kingdom a year.</p></div>`;
}

function exploreView(sim) {
  const s = sim.state;
  const r = s.region;
  const target = nextScoutingTarget(s);
  const cost = target ? expeditionCost(s, target) : null;
  const out = r.expeditions.find((e) => e.status === 'OUT');
  const found = LANDMARKS.filter((l) => r.discovered.landmarks.includes(l.id));
  return `${regionMap(s)}
    <div class="card"><h3>Scouting</h3>
      <p>${Math.round(exploredShare(s) * 100)}% of the region is mapped.${out ? ` ${esc(out.leaderName)} is out scouting and is due back ${esc(dateLabel(out.returnDay))}.` : ''}</p>
      ${!out && cost ? `<button class="btn primary" data-act="council" data-action="scout">🧭 Fund a scouting party (${cost.coins} coins, ${cost.days} days)</button>` : ''}
    </div>
    <div class="card"><h3>Discoveries</h3>${found.map((l) => `<div class="belief"><strong>${esc(l.name)}</strong>: ${esc(l.text)}</div>`).join('')}</div>
    <div class="card"><h3>Expeditions</h3>${[...r.expeditions].reverse().map((e) => `<div class="belief">${esc(dateLabel(e.departDay))}: ${esc(e.leaderName)} — ${esc(e.status.toLowerCase())}${e.cellsMapped !== undefined ? `, ${e.cellsMapped} stretches mapped` : ''}${e.findings.length ? `; found ${esc(e.findings.map((f) => f.split(':')[0]).join(', '))}` : ''}</div>`).join('') || '<p class="muted">No expeditions yet.</p>'}</div>`;
}

export function regionPanel(sim, view) {
  const mode = view.regionMode ?? 'map';
  const body = mode === 'kingdoms' ? kingdomsView(sim) : mode === 'alliances' ? alliancesView(sim) : mode === 'wars' ? warsView(sim) : mode === 'caravans' ? caravansView(sim) : mode === 'diplomacy' ? diplomacyView(sim) : mode === 'explore' ? exploreView(sim) : mapView(sim);
  return { title: `Kingdoms · ${MODES.find(([k]) => k === mode)[1]}`, html: modeChips(mode) + body };
}

export function landmarkDetail(sim, id) {
  const l = LANDMARKS.find((x) => x.id === id);
  return { title: l?.name ?? 'Landmark', html: `<div class="card"><p>${esc(l?.text ?? '')}</p></div>${regionMap(sim.state)}` };
}

