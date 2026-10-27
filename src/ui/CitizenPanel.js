import { personalFinance } from './FinancePanel.js';
import { beliefLine, worldviewCard } from './ReligionPanel.js';
import { KINGDOMS } from '../region/RegionData.js';
import { balance } from '../economy/Transactions.js';
import { GOODS } from '../core/Config.js';
import { topTraits } from '../ai/Personality.js';
import { closestRelations, describeRelation } from '../citizens/Relationships.js';
import { ownedPlots } from '../property/Ownership.js';
import { plotById } from '../property/LandRegistry.js';
import { esc, meter, portrait, moodIcon, link, badge } from './util.js';
import { LIFE_STAGES } from '../core/Config.js';
import { ageOn, stageForAge, dateLabel } from '../core/Calendar.js';
import { classDistribution, CLASSES, wealthClass } from '../population/SocialClasses.js';
import { housingStats } from '../population/Housing.js';
import { settlementStage } from '../population/Expansion.js';
import { SKILLS, levelOf } from '../education/Skills.js';
import { person, siblingsOf } from '../citizens/FamilyTree.js';
import { FACTIONS } from '../politics/Opinion.js';

export function demographics(sim) {
  const s = sim.state;
  const stages = Object.fromEntries(LIFE_STAGES.map((st) => [st.id, 0]));
  for (const c of s.citizens) stages[stageForAge(ageOn(c.birthDay, s.day)).id]++;
  const max = Math.max(1, ...Object.values(stages));
  const classes = classDistribution(s);
  const y = s.yearly.at(-1);
  const housing = housingStats(s);
  return `<div class="card">
    <div class="row between"><h3 style="margin:0">${esc(settlementStage(s.citizens.length))} · ${s.citizens.length} people</h3><span class="muted" style="font-size:12px">${housing.free} beds free</span></div>
    ${y ? `<p class="muted" style="font-size:12px;margin:6px 0">Last year: ${y.births} born · ${y.deaths} died · ${y.immigrants} arrived · ${y.emigrants} left · ${y.marriages} weddings</p>` : ''}
    <div class="pyramid">${LIFE_STAGES.map((st) => `<div class="pyr-row"><span>${st.label}</span><i style="width:${Math.round((stages[st.id] / max) * 100)}%"></i><b>${stages[st.id]}</b></div>`).join('')}</div>
    <div class="chips" style="margin-top:8px">${CLASSES.map((k) => `<span class="chip">${k.label}: ${classes[k.id]}</span>`).join('')}</div>
    <p class="muted" style="font-size:11.5px;margin:6px 0 0">All time: ${s.stats.births} births · ${s.stats.deaths} deaths · ${s.stats.immigrants} arrivals · ${s.stats.emigrants} departures</p>
  </div>`;
}

export function citizenList(sim, view = {}) {
  const s = sim.state;
  const q = (view.citizenQuery ?? '').trim().toLowerCase();
  const list = [...s.citizens].filter((c) => !q || `${c.firstName} ${c.lastName} ${c.profession}`.toLowerCase().includes(q)).sort((a, b) => (b.founder - a.founder) || a.birthDay - b.birthDay);
  const rows = list.slice(0, q ? 80 : 50).map((c) => `
    <button class="item" data-act="citizen" data-id="${c.id}">
      ${portrait(c)}
      <span class="main"><strong>${esc(c.firstName)} ${esc(c.lastName)}${c.founder ? ' ★' : ''}</strong><small>${ageOn(c.birthDay, s.day)} · ${esc(c.profession)} · ${esc(c.activity?.label ?? c.decision.label)}</small></span>
      <span class="side">${balance(s, c.id)}🪙<br>${moodIcon(c.mood)} ${Math.round(c.mood)}</span>
    </button>`).join('');
  return { title: `People · ${s.citizens.length}`, html: `${demographics(sim)}<input class="search" type="search" placeholder="Search by name or trade…" data-act="citizen-search" value="${esc(view.citizenQuery ?? '')}"><div class="list">${rows}</div>${list.length > 50 && !q ? `<p class="muted center" style="font-size:12px">Showing 50 of ${list.length}. Search to find others.</p>` : ''}` };
}

export function citizenDetail(sim, id) {
  const s = sim.state;
  const trader = s.trade?.merchants?.[id] ?? null;
  const cases = (s.law?.cases ?? []).filter((k) => [k.plaintiff.id, k.defendant.id, k.plaintiff.ownerId, k.defendant.ownerId].includes(id));
  const c = s.citizens.find((x) => x.id === id);
  if (!c) return { title: 'Citizen', html: '<p class="empty">This citizen is no longer here.</p>' };
  const money = balance(s, c.id);
  const job = c.employment ? s.businesses.find((b) => b.id === c.employment.businessId) : null;
  const home = plotById(s, c.homePlotId);
  const partner = s.citizens.find((o) => o.id === (c.romance.partnerId ?? c.romance.courtingId));
  const steps = c.plan.steps ?? [];
  const firstOpen = steps.findIndex((x) => !x.done);
  const owned = ownedPlots(s, c.id);
  const businesses = s.businesses.filter((b) => b.ownerId === c.id);
  const relations = closestRelations(s, c.id, 5);
  const beliefs = Object.entries(c.beliefs).map(([rid, b]) => ({ rumor: s.rumors.find((r) => r.id === rid), ...b })).filter((b) => b.rumor).slice(-6).reverse();
  const carrying = Object.entries(c.inventory).filter(([, n]) => n > 0).map(([g, n]) => `${GOODS[g]?.icon ?? ''} ${n}`).join('  ');

  const html = `
  <div class="card">
    <div class="row">${portrait(c, true)}
      <div style="flex:1;min-width:0">
        <strong style="font-size:17px">${esc(c.firstName)} ${esc(c.lastName)}</strong>
        <div class="muted" style="font-size:13px">${esc(c.profession)} · ${esc(stageForAge(ageOn(c.birthDay, s.day)).label)}, ${ageOn(c.birthDay, s.day)}${c.founder ? ' · founder' : ''}</div>
        <div class="muted" style="font-size:12px">Born ${dateLabel(c.birthDay)} · generation ${c.generation ?? 1} · ${esc(wealthClass(s, c).label)}</div>
        <div style="font-size:13px;margin-top:2px">${money}🪙 · ${moodIcon(c.mood)} ${Math.round(c.mood)}% happy</div>
      </div>
    </div>
    <div class="chips" style="margin-top:9px">${topTraits(c, 4).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
  </div>

  <div class="card">
    <h3>Right now</h3>
    <p><strong>${esc(c.activity?.label ?? c.decision.label)}</strong></p>
    <p class="quote">“${esc(c.decision.reason)}”</p>
    <p style="margin-top:8px"><span class="muted">Goal:</span> ${esc(c.plan.goal)}</p>
    <p><span class="muted">Next step:</span> ${esc(c.plan.next)}</p>
    ${c.decision.alternatives?.length ? `<p class="muted" style="font-size:12px">Also considered: ${c.decision.alternatives.map((a) => `${esc(a.action)} (${Math.round(a.score)})`).join(', ')} · chose score ${Math.round(c.decision.score)}</p>` : ''}
  </div>

  <div class="card">
    <h3>Family</h3>
    <div class="chips">${[
      ...c.family.parentIds.map((pid) => [pid, 'parent']), ...(c.family.spouseId ? [[c.family.spouseId, 'spouse']] : []),
      ...c.family.formerSpouseIds.map((x) => [x, 'former spouse']), ...c.family.childIds.map((x) => [x, 'child']), ...siblingsOf(s, c.id).map((x) => [x.id, 'sibling']),
    ].map(([pid, rel]) => { const p = person(s, pid); return p ? `<button class="chip" data-act="${s.citizens.includes(p) ? 'citizen' : 'bio'}" data-id="${pid}">${esc(p.firstName)}${s.citizens.includes(p) ? '' : ' †'} · ${rel}</button>` : ''; }).join('') || '<span class="muted">No family in the village.</span>'}</div>
    ${c.pregnancy ? `<p style="margin-top:6px">Expecting a child (due ${dateLabel(c.pregnancy.dueDay)}).</p>` : ''}
    <div class="grid2" style="margin-top:8px"><button class="btn" data-act="tree" data-id="${c.id}">🌳 Family tree</button><button class="btn" data-act="bio" data-id="${c.id}">📖 Biography</button></div>
  </div>

  <div class="card">
    <h3>Education & skills</h3>
    ${meter('Schooling', c.education.level * 100)}
    ${c.education.trade ? `<p style="margin-top:6px">Trade: <strong>${esc(SKILLS[c.education.trade] ?? c.education.trade)}</strong>${c.education.masterId ? ` · apprenticed to ${esc(person(s, c.education.masterId)?.firstName ?? '?')}` : ''}</p>` : ''}
    ${Object.entries(c.skills).filter(([k, v]) => SKILLS[k] && v >= 0.08).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `<div class="meter-label"><span>${esc(SKILLS[k])} · ${levelOf(v)}</span><span>${Math.round(v * 100)}</span></div><div class="meter"><i style="width:${Math.round(v * 100)}%"></i></div>`).join('')}
    ${c.faction ? `<p class="muted" style="font-size:12px;margin-top:8px">Member of the ${esc(FACTIONS[c.faction].name)}${c.opinionOfLeader !== undefined ? ` · thinks ${c.opinionOfLeader}/100 of the current leader` : ''}</p>` : ''}
  </div>

  <div class="card">
    <h3>Dream</h3>
    <p><strong>${esc(c.dream.text)}</strong>${c.dream.fulfilledDay ? ` <span class="badge OPEN">Fulfilled day ${c.dream.fulfilledDay}</span>` : ''}</p>
    <ol class="steps">${steps.map((st, i) => `<li class="${st.done ? 'done' : i === firstOpen ? 'current' : ''}">${esc(st.label)}</li>`).join('')}</ol>
  </div>

  <div class="card">
    <h3>Needs</h3>
    ${meter('Fullness', c.needs.hunger)}${meter('Energy', c.needs.energy)}${meter('Social', c.needs.social)}${meter('Happiness', c.mood)}
  </div>

  <div class="card">
    <h3>Life</h3>
    <dl class="kv">
      <dt>Work</dt><dd>${job ? `${esc(job.name)}${c.employment.role === 'owner' ? ' (owner)' : ` · ${c.employment.wage}🪙/shift`}` : c.profession === 'Builder' || c.profession === 'Forager' ? 'Self-employed' : 'Unemployed'}</dd>
      <dt>Home</dt><dd>${home ? esc(home.ownerId === c.id ? `${home.name} (owns)` : home.building?.name ?? home.name) : 'None'}</dd>
      <dt>${c.romance.partnerId ? 'Partner' : 'Courting'}</dt><dd>${partner ? esc(partner.firstName) : '—'}</dd>
      <dt>Shifts worked</dt><dd>${c.stats.shiftsWorked}</dd>
      <dt>Earned / spent</dt><dd>${c.stats.earned} / ${c.stats.spent}🪙</dd>
      ${carrying ? `<dt>Carrying</dt><dd>${carrying}</dd>` : ''}
      ${c.origin ? `<dt>${c.returnedDay ? 'Came home from' : 'Came from'}</dt><dd>${esc(KINGDOMS[c.origin]?.name ?? c.origin)}</dd>` : ''}
      ${c.away ? `<dt>Away</dt><dd>${esc(c.away.reason)} until ${esc(dateLabel(c.away.until))}</dd>` : ''}
      ${trader ? `<dt>Trade</dt><dd>${trader.trips} caravan${trader.trips === 1 ? '' : 's'}, ${trader.profit}🪙 profit${trader.active ? ' · on the road' : ''}</dd>` : ''}
      ${cases.length ? `<dt>Court</dt><dd>${cases.length} case${cases.length > 1 ? 's' : ''}</dd>` : ''}
    </dl>
    ${cases.length ? `<div class="chips" style="margin-top:6px">${cases.slice(-3).map((k) => link('case', k.id, `⚖️ ${k.plaintiff.id === c.id ? 'v ' + k.defendant.name : k.plaintiff.name}`)).join('')}</div>` : ''}
    ${businesses.length || owned.length ? `<div class="chips" style="margin-top:9px">${businesses.map((b) => link('business', b.id, `🏪 ${b.name}`)).join('')}${owned.map((p) => link('plot', p.id, `📍 ${p.name}`)).join('')}</div>` : ''}
  </div>

  <div class="card">
    <h3>Relationships</h3>
    ${relations.length ? relations.map((r) => {
      const o = s.citizens.find((x) => x.id === r.id);
      if (!o) return '';
      return `<button class="item" data-act="citizen" data-id="${o.id}" style="min-height:46px;padding:7px 9px">${portrait(o)}
        <span class="main"><strong>${esc(o.firstName)} · ${esc(o.id === partner?.id ? (c.romance.partnerId ? 'Partner' : 'Courting') : describeRelation(r))}</strong>
        <small>Friendship ${Math.round(r.friendship)} · Trust ${Math.round(r.trust)} · Affection ${Math.round(r.affection)}${r.rivalry > 5 ? ` · Rivalry ${Math.round(r.rivalry)}` : ''}</small></span></button>`;
    }).join('') : '<p class="muted">No relationships yet.</p>'}
  </div>

  <div class="card">
    <h3>Reputation</h3>
    ${meter('Reliability', c.reputation.reliability)}${meter('Honesty', c.reputation.honesty)}${meter('Generosity', c.reputation.generosity)}${meter('Business competence', c.reputation.competence)}${meter('Social standing', c.reputation.standing)}
  </div>

  <div class="card">
    <h3>What ${esc(c.firstName)} has heard</h3>
    ${beliefs.length ? beliefs.map((b) => `<div class="belief"><span class="tag ${b.source}">${b.source === 'witnessed' ? 'SAW IT' : b.source === 'invented' ? 'MADE UP' : 'HEARSAY'}</span>${b.rumor.truth ? '' : '<span class="tag false">FALSE</span>'}${esc(b.rumor.text)} <span class="muted">(${Math.round(b.confidence * 100)}% sure${b.from ? `, from ${esc(s.citizens.find((x) => x.id === b.from)?.firstName ?? '?')}` : ''})</span></div>`).join('') : '<p class="muted">No gossip yet.</p>'}
  </div>

  <div class="card">
    <h3>Memories</h3>
    <div class="timeline">${c.memories.slice(0, 8).map((m) => `<div class="entry ${m.weight >= 3 ? 'imp3' : ''}"><small>DAY ${m.day}</small>${esc(m.text)}</div>`).join('') || '<p class="muted">Nothing memorable yet.</p>'}</div>
  </div>

  ${personalFinance(sim, c)}
  ${worldviewCard(sim, c)}
  <div class="grid2">
    <button class="btn" data-act="focus-citizen" data-id="${c.id}">📍 Follow in village</button>
    <button class="btn" data-act="history" data-kind="citizen" data-id="${c.id}">📜 Their history</button>
    <button class="btn primary" data-act="council" data-action="aid" data-id="${c.id}" ${balance(s, 'treasury') < 10 ? 'disabled' : ''}>✧ Grant 10🪙 aid</button>
    <button class="btn" data-act="tab" data-id="citizens">👥 All citizens</button>
  </div>`;
  return { title: `${c.firstName} — ${c.profession}`, html };
}

export { badge };
