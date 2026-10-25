import { dateLabel } from '../core/Calendar.js';
import { byId } from '../core/EntityRegistry.js';
import { LAWS } from '../law/LegalCode.js';
import { courtCapacity } from '../law/Courts.js';
import { esc, capital } from './util.js';

// Politics → Laws & courts: the code in force, bills, the court's docket and
// its judgments, each with the law and evidence it rested on.

export function lawPanel(sim) {
  const s = sim.state;
  const L = s.law;
  const judge = byId(s.citizens, L.judgeId);
  const laws = L.laws.map((l) => `<div class="belief"><strong>${esc(l.name)}</strong>${l.status !== 'ACTIVE' ? ` <span class="muted">(${esc(l.status.toLowerCase())})</span>` : l.effectiveDay > s.day ? ` <span class="muted">(in force from ${esc(dateLabel(l.effectiveDay))})</span>` : ''}<br><span class="muted">${esc(LAWS[l.key].requirement)} Remedy: ${esc(LAWS[l.key].remedy)}</span></div>`).join('');
  const bills = [...L.proposals].reverse().slice(0, 6).map((p) => `<div class="belief">${esc(dateLabel(p.proposedDay))}: <strong>${esc(p.name)}</strong> — ${esc(p.status.toLowerCase())} (${Object.values(p.votes).filter((v) => v === 'aye').length}–${Object.values(p.votes).filter((v) => v === 'no').length})<br><span class="muted">${esc(capital(p.reason))}</span></div>`).join('');
  const docket = L.cases.filter((c) => c.status !== 'JUDGED');
  const judged = L.cases.filter((c) => c.status === 'JUDGED').slice(-10).reverse();
  const row = (c) => `<button class="item" data-act="case" data-id="${c.id}"><span class="main"><strong>${esc(c.plaintiff.name)} v ${esc(c.defendant.name)}</strong><small>${esc(LAWS[c.law].name)} · ${c.status === 'JUDGED' ? esc(c.judgment.outcome) : `hearing ${esc(dateLabel(c.hearingDay ?? s.day + 1))}`}</small></span></button>`;
  const html = `
  <div class="card"><dl class="kv">
    <dt>Judge</dt><dd>${judge ? esc(`${judge.firstName} ${judge.lastName}`) : 'none yet'}</dd>
    <dt>Court sits</dt><dd>${courtCapacity(s) > 1 ? 'in the courthouse, two cases a day' : 'in the hall, one case a day'}</dd>
    <dt>Cases waiting</dt><dd>${docket.length}</dd>
    <dt>Judged</dt><dd>${L.stats.judged} (${L.stats.dismissed} dismissed)</dd>
    <dt>Fines / restitution</dt><dd>${L.stats.fines}🪙 / ${L.stats.restitution}🪙</dd>
  </dl></div>
  <div class="card"><h3>Laws</h3>${laws}</div>
  <div class="card"><h3>Bills</h3>${bills || '<p class="muted">No laws proposed yet.</p>'}</div>
  <div class="card"><h3>Docket</h3><div class="list">${docket.slice(0, 12).map(row).join('') || '<p class="muted">No cases waiting.</p>'}</div></div>
  <div class="card"><h3>Recent judgments</h3><div class="list">${judged.map(row).join('') || '<p class="muted">None yet.</p>'}</div></div>`;
  return { title: 'Laws & courts', html };
}

export function caseDetail(sim, id) {
  const s = sim.state;
  const c = s.law.cases.find((x) => x.id === id);
  if (!c) return { title: 'Case', html: '<p class="empty">This case has left the records.</p>' };
  const party = (p) => (byId(s.citizens, p.id) ? `<button class="chip" data-act="citizen" data-id="${p.id}">${esc(p.name)}</button>` : esc(p.name));
  const j = c.judgment;
  const html = `
  <div class="card"><dl class="kv">
    <dt>Plaintiff</dt><dd>${party(c.plaintiff)}</dd><dt>Defendant</dt><dd>${party(c.defendant)}</dd>
    <dt>Law</dt><dd>${esc(LAWS[c.law].name)}</dd><dt>Events of</dt><dd>${esc(dateLabel(c.eventDay))}</dd>
    <dt>Filed</dt><dd>${esc(dateLabel(c.filedDay))}</dd><dt>Hearing</dt><dd>${c.hearingDay ? esc(dateLabel(c.hearingDay)) : 'not yet scheduled'}</dd>
    ${c.amount ? `<dt>Claimed</dt><dd>${c.amount}🪙</dd>` : ''}
  </dl></div>
  <div class="card"><h3>Evidence</h3>${c.evidence.map((e) => `<div class="belief"><span class="muted">${esc(e.type)}:</span> ${esc(e.text)}</div>`).join('')}</div>
  ${j ? `<div class="card"><h3>Judgment · ${esc(j.outcome)}</h3><p>${esc(j.judgeName)} ruled on ${esc(dateLabel(j.day))} under the ${esc(j.law)}: ${esc(j.reason)}.</p>
    ${j.transfers.length ? `<dl class="kv">${j.transfers.map((t) => `<dt>${esc(t.kind)}</dt><dd>${t.amount}🪙 (ledger #${t.tx})</dd>`).join('')}</dl>` : ''}
    ${j.propertyTransfer ? `<p class="muted">Land transferred: ${esc(s.plots.find((p) => p.id === j.propertyTransfer.plotId)?.name ?? '')}.</p>` : ''}</div>` : ''}`;
  return { title: `Case ${c.id.replace('case', '#')}`, html };
}
