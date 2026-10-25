import { dateLabel } from '../core/Calendar.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { partyName, TREATY_KINDS, relationScore } from '../diplomacy/Diplomacy.js';
import { tensionFactors, claimantOf } from '../diplomacy/TerritorialClaims.js';
import { activeWars, sides, exhaustion } from '../military/WarManager.js';
import { armyWhere, armyPosition } from '../military/Army.js';
import { forcesOf, potentialStrength } from '../military/MilitaryManager.js';
import { explain } from '../military/BattleResolver.js';
import { peopleOf, rulerOf, rulerPriorities, foreignById, foreignAge, whereabouts, ROLE_LABEL } from '../region/ForeignCitizenManager.js';
import { esc, meter, capital } from './util.js';

// Kingdoms, their people, their alliances and their wars. Every figure here
// is read from the simulation: army sizes, supplies, costs, casualties, the
// causes of disputes and the terms that ended wars.

const color = (p) => (p === HEARTH ? '#e8c06a' : KINGDOMS[p]?.color ?? '#aaa');
const dot = (p) => `<span class="dot" style="background:${color(p)}"></span>`;

/** The ruler's card on a kingdom's page. */
export function rulerCard(sim, kid) {
  const s = sim.state;
  const r = rulerOf(s, kid);
  if (!r) return '';
  const pers = r.personality;
  const trait = (k, hi, lo) => (pers[k] > 0.65 ? hi : pers[k] < 0.35 ? lo : null);
  const character = [trait('ambition', 'ambitious', 'content'), trait('caution', 'cautious', 'bold'), trait('warmth', 'warm', 'cold'), trait('pride', 'proud', 'modest')].filter(Boolean).join(', ') || 'even-tempered';
  return `<div class="card ruler">
    <div class="row"><span class="portrait big" style="background:${color(kid)}">👑</span><div>
      <strong>${esc(r.firstName)} ${esc(r.lastName)}</strong><br><small class="muted">${esc(KINGDOMS[kid].leaderTitle)} of ${esc(KINGDOMS[kid].name)} since ${esc(dateLabel(r.since ?? s.day))} · age ${foreignAge(s, r)}</small></div></div>
    <dl class="kv" style="margin-top:8px">
      <dt>Character</dt><dd>${esc(character)}</dd>
      <dt>Priorities</dt><dd>${esc(rulerPriorities(s, kid).join('; '))}</dd>
      <dt>Outlook</dt><dd>${esc(s.region.settlements[kid].leader.stance)}</dd>
      <dt>With First Hearth</dt><dd>${relationScore(s, kid, HEARTH) > 0 ? '+' : ''}${Math.round(relationScore(s, kid, HEARTH))}</dd>
    </dl>
    ${r.achievements.length ? `<h3>Record</h3>${r.achievements.slice(-5).reverse().map((a) => `<div class="belief">${esc(dateLabel(a.day))}: ${esc(a.text)}</div>`).join('')}` : ''}
    <div class="grid2" style="margin-top:8px"><button class="btn" data-act="foreign" data-id="${r.id}">📖 ${esc(r.firstName)}'s story</button><button class="btn primary" data-act="visit" data-id="${kid}">🏰 Visit ${esc(KINGDOMS[kid].name)}</button></div>
  </div>`;
}

/** The kingdom's named people. */
export function peopleCard(sim, kid) {
  const s = sim.state;
  const order = ['ruler', 'notable', 'merchant', 'guild', 'faith', 'craft', 'resident', 'child'];
  const people = peopleOf(s, kid).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || b.standing - a.standing);
  const military = forcesOf(s, kid);
  return `<div class="card"><h3>Named people (${people.length})</h3><div class="list">${people.map((p) => `<button class="item" data-act="foreign" data-id="${p.id}"><span class="portrait" style="background:${color(kid)}">${esc(p.firstName[0])}</span>
    <span class="main"><strong>${esc(p.firstName)} ${esc(p.lastName)}</strong><small>${esc(p.occupation)} · ${foreignAge(s, p)} · ${esc(whereabouts(s, p))}</small></span></button>`).join('')}</div>
    <p class="muted" style="font-size:12px">The rest of ${esc(KINGDOMS[kid].name)}'s ${s.region.settlements[kid].population} people are simulated together.</p></div>
    <div class="card"><h3>Forces</h3><dl class="kv"><dt>Could field</dt><dd>${potentialStrength(s, kid)} (strength)</dd><dt>Under arms</dt><dd>${s.region.settlements[kid].mobilised ?? 0}</dd><dt>Training</dt><dd>${Math.round(military.training * 100)}%</dd><dt>Equipment</dt><dd>${Math.round(military.equipment * 100)}%</dd><dt>Morale</dt><dd>${Math.round(military.morale * 100)}%</dd></dl></div>`;
}

export function foreignDetail(sim, id) {
  const s = sim.state;
  const p = foreignById(s, id);
  if (!p) {
    const d = (s.foreign?.departed ?? []).find((x) => x.id === id);
    return { title: d?.name ?? 'Unknown', html: d ? `<div class="card"><p>${esc(d.occupation)} of ${esc(KINGDOMS[d.kingdom]?.name)}, who died ${esc(dateLabel(d.died))} (${esc(d.cause)}).</p>${d.achievements.map((a) => `<div class="belief">${esc(a.text)}</div>`).join('')}</div>` : '<p class="empty">No record of this person.</p>' };
  }
  const spouse = foreignById(s, p.spouseId);
  const kids = p.childIds.map((c) => foreignById(s, c)).filter(Boolean);
  const html = `<div class="card"><div class="row"><span class="portrait big" style="background:${color(p.kingdom)}">${esc(p.firstName[0])}</span><div><strong>${esc(p.firstName)} ${esc(p.lastName)}</strong><br><small class="muted">${esc(ROLE_LABEL[p.role])} · ${esc(p.occupation)} · ${esc(KINGDOMS[p.kingdom].name)}</small></div></div>
    <dl class="kv" style="margin-top:8px"><dt>Age</dt><dd>${foreignAge(s, p)}</dd><dt>Where</dt><dd>${esc(whereabouts(s, p))}</dd><dt>Standing</dt><dd>${p.standing}</dd><dt>Fortune</dt><dd>${p.wealth > 100 ? 'wealthy' : p.wealth > 40 ? 'comfortable' : 'modest'}</dd>
    ${spouse ? `<dt>Spouse</dt><dd><button class="chip" data-act="foreign" data-id="${spouse.id}">${esc(spouse.firstName)}</button></dd>` : ''}${kids.length ? `<dt>Children</dt><dd>${kids.map((k) => `<button class="chip" data-act="foreign" data-id="${k.id}">${esc(k.firstName)}</button>`).join(' ')}</dd>` : ''}
    ${p.trips ? `<dt>Trading journeys</dt><dd>${p.trips}</dd>` : ''}</dl>
    ${p.location === p.kingdom ? `<button class="btn" data-act="visit" data-id="${p.kingdom}">🏰 Visit ${esc(KINGDOMS[p.kingdom].name)}</button>` : ''}</div>
    ${p.achievements.length ? `<div class="card"><h3>Achievements</h3>${p.achievements.slice().reverse().map((a) => `<div class="belief">${esc(dateLabel(a.day))}: ${esc(a.text)}</div>`).join('')}</div>` : ''}
    ${p.memories.length ? `<div class="card"><h3>Lately</h3>${p.memories.map((m) => `<div class="belief">${esc(dateLabel(m.day))}: ${esc(m.text)}</div>`).join('')}</div>` : ''}`;
  return { title: `${p.firstName} ${p.lastName}`, html };
}

/** Alliances and the military balance of the region. */
export function alliancesView(sim) {
  const s = sim.state;
  const mil = (s.diplomacy?.treaties ?? []).filter((t) => t.status === 'ACTIVE' && TREATY_KINDS[t.kind]?.military);
  const strengths = [HEARTH, ...Object.keys(KINGDOMS)].map((p) => [p, potentialStrength(s, p)]);
  const max = Math.max(1, ...strengths.map(([, v]) => v));
  return `<div class="card"><h3>Alliances</h3>${mil.map((t) => `<div class="belief">${dot(t.parties[0])}${dot(t.parties[1])} <strong>${esc(TREATY_KINDS[t.kind].label)}</strong>: ${esc(partyName(t.parties[0]))} & ${esc(partyName(t.parties[1]))} until ${esc(dateLabel(t.endDay))}${t.reason ? `<br><span class="muted">${esc(t.reason)}</span>` : ''}</div>`).join('') || '<p class="muted">No military alliances in force.</p>'}</div>
    <div class="card"><h3>Military balance</h3>${strengths.map(([p, v]) => meter(`${partyName(p)} (${v})`, (v / max) * 100)).join('')}<p class="muted" style="font-size:12px">What each could field now, weighing numbers, training, equipment, morale and the treasury to pay for it.</p></div>
    <div class="card"><h3>Disputed lands</h3>${(s.military?.disputes ?? []).map((d) => `<div class="belief"><strong>${esc(capital(d.name))}</strong> · held by ${esc(partyName(d.controller))}, claimed by ${esc(partyName(claimantOf(d)))} · ${esc(d.status.toLowerCase())} · tension ${d.tension}
      <br><span class="muted">${esc(tensionFactors(s, d).filter(([, v]) => v > 0).map(([t]) => t).join('; ') || 'calm')}</span>${d.lastTalks ? `<br><span class="muted">Last talks ${esc(dateLabel(d.lastTalks.day))} (odds ${d.lastTalks.odds}%)</span>` : ''}</div>`).join('')}</div>`;
}

/** Wars past and present, with armies, battles and costs. */
export function warsView(sim) {
  const s = sim.state;
  const wars = [...(s.military?.wars ?? [])].reverse();
  const armies = (s.military?.armies ?? []).filter((a) => a.status !== 'DISBANDED');
  return `${armies.length ? `<div class="card"><h3>Armies in the field</h3><div class="list">${armies.map((a) => `<button class="item" data-act="army" data-id="${a.id}"><span class="portrait" style="background:${color(a.owner)}">⚔️</span><span class="main"><strong>${esc(a.name)}</strong><small>${a.soldiers} soldiers · ${esc(armyWhere(s, a))}</small><small>supplies ${a.supplies} · morale ${Math.round(a.morale * 100)}%</small></span></button>`).join('')}</div></div>` : ''}
    <div class="list">${wars.map((w) => `<button class="item" data-act="war" data-id="${w.id}"><span class="portrait" style="background:${w.status === 'ACTIVE' ? '#b8443a' : '#7f8f80'}">${w.status === 'ACTIVE' ? '🔥' : '🕊️'}</span><span class="main"><strong>${esc(w.name)}</strong><small>${esc(w.attackers.map(partyName).join(', '))} against ${esc(w.defenders.map(partyName).join(', '))}</small><small>${esc(dateLabel(w.startDay))}${w.endDay ? ` – ${esc(dateLabel(w.endDay))}` : ' · ongoing'} · ${w.battles.length} battle${w.battles.length === 1 ? '' : 's'}</small></span></button>`).join('') || '<p class="empty">The region is at peace. No war has been fought yet.</p>'}</div>`;
}

export function warDetail(sim, id) {
  const s = sim.state;
  const w = (s.military?.wars ?? []).find((x) => x.id === id);
  if (!w) return { title: 'War', html: '<p class="empty">No record of this war.</p>' };
  const battles = (s.military.battles ?? []).filter((b) => b.warId === w.id);
  const html = `<div class="card"><p>${esc(w.cause)}.</p><dl class="kv">
    <dt>Began</dt><dd>${esc(dateLabel(w.startDay))}</dd>${w.endDay ? `<dt>Ended</dt><dd>${esc(dateLabel(w.endDay))}: ${esc(w.reason)}</dd><dt>Terms</dt><dd>${esc(w.terms.join(', '))}</dd>` : ''}
    ${sides(w).map((p) => `<dt>${dot(p)} ${esc(partyName(p))}</dt><dd>${w.costs[p] ?? 0}🪙 spent · ${w.casualties[p] ?? 0} lost · score ${w.score[p] ?? 0}${w.status === 'ACTIVE' ? ` · weariness ${Math.round(exhaustion(s, w, p) * 100)}%` : ''}</dd>`).join('')}
    ${w.refused.length ? `<dt>Broke their alliance</dt><dd>${esc(w.refused.map(partyName).join(', '))}</dd>` : ''}</dl></div>
    <div class="card"><h3>Battles</h3>${battles.map((b) => `<div class="belief"><strong>${esc(b.name)}</strong> (${esc(dateLabel(b.day))}): ${esc(partyName(b.winner))} won · ${b.sides.map((x) => `${esc(partyName(x.party))} ${x.before}→${x.after}`).join(', ')}<br><span class="muted">${esc(explain(b))}</span><br><button class="btn small" data-act="replay-battle" data-id="${b.id}">▶ Replay on the field</button></div>`).join('') || '<p class="muted">No battle yet.</p>'}</div>`;
  return { title: w.name, html };
}

export function armyDetail(sim, id) {
  const s = sim.state;
  const a = (s.military?.armies ?? []).find((x) => x.id === id);
  if (!a) return { title: 'Army', html: '<p class="empty">This army has stood down.</p>' };
  const pos = armyPosition(s, a);
  const villagers = a.citizenIds.map((cid) => s.citizens.find((c) => c.id === cid)).filter(Boolean);
  return { title: a.name, html: `<div class="card"><dl class="kv"><dt>Status</dt><dd>${esc(capital(a.status.toLowerCase()))}</dd><dt>Where</dt><dd>${esc(armyWhere(s, a))} (map ${Math.round(pos.x)}, ${Math.round(pos.y)})</dd><dt>Soldiers</dt><dd>${a.soldiers} of ${a.startSoldiers}</dd><dt>Training</dt><dd>${Math.round(a.training * 100)}%</dd><dt>Equipment</dt><dd>${Math.round(a.equipment * 100)}%</dd><dt>Morale</dt><dd>${Math.round(a.morale * 100)}%</dd><dt>Food</dt><dd>${a.supplies} rations${a.hungry ? ` · hungry ${a.hungry} days` : ''}</dd><dt>Cost so far</dt><dd>${a.costs}🪙</dd></dl>
    ${villagers.length ? `<h3>Villagers serving</h3>${villagers.map((c) => `<button class="chip" data-act="citizen" data-id="${c.id}">${esc(c.firstName)}</button>`).join(' ')}` : ''}</div>
    <div class="card"><h3>Log</h3>${[...a.history].reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('')}</div>` };
}

export const activeWarCount = (s) => activeWars(s).length;
