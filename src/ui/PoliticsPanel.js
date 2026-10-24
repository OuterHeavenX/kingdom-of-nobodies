import { balance } from '../economy/Transactions.js';
import { dateLabel, ageOn } from '../core/Calendar.js';
import { POLITICS, LIFE } from '../core/Config.js';
import { POLICIES } from '../politics/Policies.js';
import { FACTIONS, factionMembers } from '../politics/Opinion.js';
import { currentLeader } from '../politics/Government.js';
import { person } from '../citizens/FamilyTree.js';
import { esc, meter, portrait } from './util.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { relationScore, activeTreaties, embargoBetween, TREATY_KINDS, partyName, tariffRate } from '../diplomacy/Diplomacy.js';

export function politicsPanel(sim) {
  const s = sim.state;
  const gov = s.government;
  if (!gov) {
    const adults = s.citizens.filter((c) => ageOn(c.birthDay, s.day) >= LIFE.adultAge).length;
    return { title: 'Politics', html: `<div class="card"><h3>No elected government yet</h3><p>The founders' council governs informally. Once ${POLITICS.firstElectionAdults} adults live here (now ${adults}), the village will hold its first election.</p><p class="muted">Until then, you set the business levy from the Council tab.</p></div>` };
  }
  const leader = currentLeader(s);
  const camp = gov.campaign;
  const last = gov.elections.at(-1);
  const name = (id) => { const p = person(s, id); return p ? `${p.firstName} ${p.lastName}` : 'someone'; };
  const spark = (gov.approvalHistory ?? []).map((v) => `<span style="height:${Math.max(6, v)}%" class="${v < 35 ? 'neg' : ''}"></span>`).join('');
  const policyRows = Object.entries(POLICIES).map(([k, d]) => {
    const v = gov.policies[k];
    const label = d.describe ? d.describe(v ?? d.default) : v ? 'in force' : 'not in force';
    return `<dt>${esc(d.label)}</dt><dd>${esc(label)}</dd>`;
  }).join('');
  const factions = Object.entries(FACTIONS).map(([k, f]) => {
    const m = factionMembers(s, k);
    if (!m.length) return '';
    const head = [...m].sort((a, b) => b.reputation.standing - a.reputation.standing)[0];
    return `<div class="belief"><strong>${esc(f.name)}</strong> · ${m.length} member${m.length > 1 ? 's' : ''} · led by ${esc(head.firstName)}<br><span class="muted">Wants: ${Object.entries(f.wants).filter(([, w]) => w > 0).map(([i]) => i).join(', ')}</span></div>`;
  }).join('');
  const results = last ? `<div class="card"><h3>Last election · Year ${last.year}</h3>
    ${last.candidates.map((c) => `<div class="meter-label"><span>${esc(c.name)}${c.id === last.winnerId ? ' ✓' : ''}${c.endorsedBy?.length ? ` <span class="muted">(${c.endorsedBy.map((k) => FACTIONS[k].name).join(', ')})</span>` : ''}</span><span>${c.votes}</span></div><div class="meter"><i style="width:${last.turnout ? Math.round((c.votes / last.turnout) * 100) : 0}%"></i></div>`).join('')}
    <p class="muted" style="font-size:12px;margin-top:6px">${last.turnout} of ${last.eligible} adults voted.</p></div>` : '';
  const campaign = camp ? `<div class="card"><h3>Campaign · voting ${dateLabel(camp.electionDay)}</h3>
    ${camp.candidates.map((c) => { const p = person(s, c.id); return p ? `<button class="item" data-act="citizen" data-id="${p.id}">${portrait(p)}<span class="main"><strong>${esc(c.name)}${c.incumbent ? ' (incumbent)' : ''}</strong><small>Promises to ${esc(c.promises.join('; '))}</small>${c.endorsedBy.length ? `<small>Backed by the ${esc(c.endorsedBy.map((k) => FACTIONS[k].name).join(' and '))}</small>` : ''}</span></button>` : ''; }).join('')}
    <p class="muted" style="font-size:12px">Ballots cast so far: ${Object.keys(camp.ballots).length}</p></div>` : '';
  const scandals = gov.scandals.filter((x) => x.discovered).slice(-3).reverse().map((x) => `<div class="belief">Year ${Math.floor((x.discoveredDay - 1) / 12) + 1}: ${esc(name(x.leaderId))} took ${x.amount}🪙 from the treasury (repaid ${x.repaid ?? 0}).</div>`).join('');
  const protests = gov.protests.slice(-3).reverse().map((x) => `<div class="belief">${dateLabel(x.day)}: ${x.size} villagers protested (approval ${x.approval}%).</div>`).join('');
  const html = `
  <div class="card">
    <h3>${esc(gov.title)}</h3>
    ${leader ? `<button class="item" data-act="citizen" data-id="${leader.id}">${portrait(leader, true)}<span class="main"><strong style="font-size:16px">${esc(leader.firstName)} ${esc(leader.lastName)}${gov.leaderId ? '' : ' (acting)'}</strong>
      <small>${gov.termEnd ? `Term ends ${dateLabel(gov.termEnd)}` : 'Serving until an early election'}</small></span></button>` : '<p>The office is vacant.</p>'}
    ${meter('Public approval', gov.approval)}
    ${spark ? `<div class="bars" style="height:40px">${spark}</div>` : ''}
    <p class="muted" style="font-size:12px">Councillors: ${gov.councillors.map(name).map(esc).join(', ') || 'none'} · Next election ${dateLabel(gov.nextElectionDay)} · Treasury ${balance(s, 'treasury')}🪙</p>
  </div>
  ${campaign}
  <div class="card"><h3>Policies in force</h3><dl class="kv">${policyRows}</dl></div>
  ${results}
  <div class="card"><h3>Factions</h3>${factions || '<p class="muted">No organised factions yet.</p>'}</div>
  ${scandals || protests ? `<div class="card"><h3>Trouble</h3>${scandals}${protests}</div>` : ''}
  <div class="card"><h3>Past leaders</h3>${[...gov.elections].reverse().slice(0, 12).map((e) => `<div class="belief">Year ${e.year}: <strong>${esc(name(e.winnerId))}</strong> elected ${esc(e.title)} (${e.candidates.find((c) => c.id === e.winnerId)?.votes ?? 0} of ${e.turnout})</div>`).join('') || '<p class="muted">None yet.</p>'}</div>`;
  return { title: 'Politics', html };
}

/** Politics → Foreign: First Hearth's standing with each kingdom. */
export function foreignPanel(sim) {
  const s = sim.state;
  const gov = s.government;
  const rows = Object.keys(KINGDOMS).map((id) => {
    const score = relationScore(s, HEARTH, id);
    const treaties = activeTreaties(s, HEARTH, id).map((t) => TREATY_KINDS[t.kind].label);
    const embargo = embargoBetween(s, HEARTH, id);
    const rel = s.diplomacy.relations[[HEARTH, id].sort().join('|')];
    return `<button class="item" data-act="kingdom" data-id="${id}"><span class="portrait" style="background:${KINGDOMS[id].color}">${esc(KINGDOMS[id].name[0])}</span><span class="main"><strong>${esc(KINGDOMS[id].name)} · ${score > 0 ? '+' : ''}${Math.round(score)}</strong><small>${treaties.length ? esc(treaties.join(', ')) : 'no treaty'}${embargo ? ` · ⛔ ${esc(partyName(embargo.by))} embargo` : ''}</small>${rel?.log.length ? `<small>${esc(rel.log.at(-1).why)}</small>` : ''}</span><span class="side">tariff ${Math.round(tariffRate(s, id, HEARTH) * 100)}%</span></button>`;
  }).join('');
  const html = `<div class="card"><dl class="kv">
    <dt>Our import tariffs</dt><dd>${esc(gov?.policies?.tariffLevel ?? 'normal')}</dd>
    <dt>Seeking treaties</dt><dd>${(gov?.policies?.openDiplomacy ?? true) ? 'yes' : 'no'}</dd>
  </dl><p class="muted" style="font-size:12px">The elected government sets tariffs and whether to seek treaties; merchants and exporters want open markets, owners undercut by imports want protection.</p></div>
  <div class="list">${rows}</div>
  <button class="btn" data-act="region-tab" data-id="diplomacy">🗺️ Full diplomacy in the Region tab</button>`;
  return { title: 'Foreign relations', html };
}
