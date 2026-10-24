import { balance } from '../economy/Transactions.js';
import { GOODS } from '../core/Config.js';
import { topTraits } from '../ai/Personality.js';
import { closestRelations, describeRelation } from '../citizens/Relationships.js';
import { ownedPlots } from '../property/Ownership.js';
import { plotById } from '../property/LandRegistry.js';
import { esc, meter, portrait, moodIcon, link, badge } from './util.js';

export function citizenList(sim) {
  const s = sim.state;
  const rows = [...s.citizens].sort((a, b) => a.arrivedDay - b.arrivedDay).map((c) => `
    <button class="item" data-act="citizen" data-id="${c.id}">
      ${portrait(c)}
      <span class="main"><strong>${esc(c.firstName)} ${esc(c.lastName)}</strong><small>${esc(c.profession)} · ${esc(c.activity?.label ?? c.decision.label)}</small></span>
      <span class="side">${balance(s, c.id)}🪙<br>${moodIcon(c.mood)} ${Math.round(c.mood)}</span>
    </button>`).join('');
  return { title: `Citizens · ${s.citizens.length}`, html: `<div class="list">${rows}</div>` };
}

export function citizenDetail(sim, id) {
  const s = sim.state;
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
        <div class="muted" style="font-size:13px">${esc(c.profession)} · age ${c.age}${c.legacyTrait ? ` · founder` : ''}</div>
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
    </dl>
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

  <div class="grid2">
    <button class="btn" data-act="focus-citizen" data-id="${c.id}">📍 Show in village</button>
    <button class="btn" data-act="history" data-kind="citizen" data-id="${c.id}">📜 Their history</button>
    <button class="btn primary" data-act="council" data-action="aid" data-id="${c.id}" ${balance(s, 'treasury') < 10 ? 'disabled' : ''}>✧ Grant 10🪙 aid</button>
    <button class="btn" data-act="tab" data-id="citizens">👥 All citizens</button>
  </div>`;
  return { title: `${c.firstName} — ${c.profession}`, html };
}

export { badge };
