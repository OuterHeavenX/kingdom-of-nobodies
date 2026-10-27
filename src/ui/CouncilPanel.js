import { balance } from '../economy/Transactions.js';
import { COUNCIL, ECONOMY } from '../core/Config.js';
import { isTrading } from '../economy/Businesses.js';
import { esc } from './util.js';
import { councilCooldown } from '../council/Council.js';

export function councilPanel(sim, ctx) {
  const s = sim.state;
  const roadRows = (s.roadProjects ?? []).filter((p) => p.status === 'BUILDING' || p.status === 'PROPOSED').map((p) => `<div class="belief"><strong>${esc(p.name)}</strong> · ${esc(p.kind)} · ${p.status === 'BUILDING' ? `${Math.round(Math.min(1, p.work / p.need.work) * 100)}% built${p.waiting ? ` (${esc(p.waiting.toLowerCase())})` : ''}` : 'proposed'}<br><span class="muted">${esc(p.reason)}</span></div>`).join('');
  const scoutOut = (s.region?.expeditions ?? []).some((e) => e.status === 'OUT');
  const t = balance(s, 'treasury');
  const tot = s.ledgerTotals;
  const selectedCitizen = sim.selected.kind === 'citizen' ? s.citizens.find((c) => c.id === sim.selected.id) : null;
  // Offer a business that can be helped now; one granted this season waits its turn.
  const candidates = s.businesses.filter((b) => isTrading(b) && b.ownerId !== 'council');
  const free = candidates.filter((b) => !councilCooldown(s, 'supportBusiness', b.id));
  const struggling = free.find((b) => b.status === 'STRUGGLING') ?? candidates.find((b) => b.status === 'STRUGGLING') ?? free[0] ?? candidates[0];
  const grantWait = struggling ? councilCooldown(s, 'supportBusiness', struggling.id) : null;
  const aidWait = selectedCitizen ? councilCooldown(s, 'aid', selectedCitizen.id) : null;
  const pendingTax = s.council.pendingTax?.day === s.day ? s.council.pendingTax.level : null;
  const taxWait = pendingTax ? null : councilCooldown(s, 'setTax');
  const freeCottageLand = s.plots.some((p) => p.ownerId === 'council' && p.landType === 'residential' && !p.building && !p.projectId);
  const action = (title, desc, cost, act, args = {}, disabled = false) => `
    <div class="card action"><strong>${title}</strong><p>${desc}</p>
      <button class="btn primary" data-act="council" data-action="${act}" ${Object.entries(args).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} ${disabled ? 'disabled' : ''}>${cost}</button></div>`;
  const html = `
  <div class="card">
    <h3>Treasury</h3>
    <div class="row between"><strong style="font-size:22px">${t}🪙</strong><span class="muted" style="font-size:12px">Pantry: ${Object.entries(s.council.pantry).map(([g, n]) => `${n} ${g}`).join(', ') || 'empty'}</span></div>
    <dl class="kv" style="margin-top:8px">
      <dt>Levies collected</dt><dd>${tot.tax ?? 0}🪙</dd>
      <dt>Property sales</dt><dd>${tot.property ?? 0}🪙 (all sales)</dd>
      <dt>Aid & grants given</dt><dd>${(tot.aid ?? 0) + (tot.grant ?? 0)}🪙</dd>
    </dl>
  </div>
  <div class="card">
    <h3>Business levy</h3>
    <div class="segmented">${['low', 'normal', 'high'].map((lvl) => `<button class="${s.council.taxLevel === lvl ? 'active' : ''}" data-act="tax" data-id="${lvl}" ${s.government?.leaderId || (taxWait && s.council.taxLevel !== lvl) ? 'disabled' : ''} title="${esc(taxWait ?? '')}">${lvl[0].toUpperCase() + lvl.slice(1)} · ${ECONOMY.tax[lvl]}🪙${pendingTax === lvl ? ' (from tomorrow)' : ''}</button>`).join('')}</div>
    <p class="muted" style="font-size:12px;margin-top:6px">${s.government?.leaderId ? `Taxes are now set by the elected ${esc(s.government.title)} (see Politics).` : `Per business per day, plus a tithe on savings above 60 coins. Higher taxes fill the treasury but squeeze profits and lower happiness. A new level takes effect from the next day, at most once a season.${pendingTax ? ` Announced: ${esc(pendingTax)} from tomorrow.` : taxWait ? ` ${esc(taxWait)}` : ''}`}</p>
  </div>
  ${action('🍲 Emergency food aid', `Buy food from local sellers (or the pantry) and hand ${COUNCIL.foodAidUnits} portions to the hungriest villagers.`, 'Distribute', 'foodAid', {}, t < 3 && !Object.keys(s.council.pantry).length)}
  ${action('✧ Financial aid', selectedCitizen ? (aidWait ? `${esc(selectedCitizen.firstName)}: ${esc(aidWait)}` : `Grant ${esc(selectedCitizen.firstName)} ${COUNCIL.aidAmount} coins from the treasury (once a season each).`) : 'Select a villager first (tap one in the village or Citizens list).', `${COUNCIL.aidAmount}🪙`, 'aid', { id: selectedCitizen?.id ?? '' }, !selectedCitizen || !!aidWait || t < COUNCIL.aidAmount)}
  ${action('🎉 Village festival', `Spend up to ${COUNCIL.festivalBudget} coins on local food and drink; everyone gathers in the square.`, 'Sponsor', 'festival', {}, t < 10 || s.council.festivalCooldownUntil > s.day)}
  ${action('🏠 Fund a public cottage', `Builders and timber paid from the treasury; adds two beds so newcomers can settle.`, '~30🪙', 'publicCottage', {}, t < COUNCIL.publicCottageBudget || !freeCottageLand)}
  ${action('🤝 Support a business', struggling ? (grantWait ? `${esc(struggling.name)}: ${esc(grantWait)}` : `Grant ${esc(struggling.name)} ${COUNCIL.businessGrant} coins (once a season each).`) : 'No citizen-owned business to support yet.', `${COUNCIL.businessGrant}🪙`, 'supportBusiness', { id: struggling?.id ?? '' }, !struggling || !!grantWait || t < COUNCIL.businessGrant)}
  ${action('🏛️ Establish a marketplace', s.council.marketplace ? 'Established. Caravans visit every two days and distance matters less to shoppers.' : 'Market stalls around the square: caravans visit more often and shoppers travel further.', `${COUNCIL.marketplaceCost}🪙`, 'marketplace', {}, s.council.marketplace || t < COUNCIL.marketplaceCost)}
  <div class="card">
    <h3>Region & roads</h3>
    ${roadRows || '<p class="muted">No road works proposed. Villagers petition for paths to their doors and the council paves busy tracks.</p>'}
    <div class="grid2" style="margin-top:8px">
      <button class="btn" data-act="council" data-action="scout" ${scoutOut ? 'disabled' : ''}>🧭 ${scoutOut ? 'Scouts are out' : 'Fund scouts'}</button>
      <button class="btn" data-act="region-tab" data-id="diplomacy">🎁 Diplomacy</button>
    </div>
  </div>
  <div class="grid2">
    <button class="btn" data-act="tab-filter" data-id="economy" data-filter="sale">📍 Inspect land</button>
    <button class="btn" data-act="tab" data-id="economy">📊 Review finances</button>
  </div>
  <div class="card">
    <h3>Kingdom & settings</h3>
    <label class="toggle">Name labels <input type="checkbox" data-act="labels" ${ctx.settings.labels ? 'checked' : ''}></label>
    <div class="grid2">
      <button class="btn" data-act="save">💾 Save now</button>
      <button class="btn" data-act="export">⬇ Export save</button>
      <button class="btn" data-act="import">⬆ Import save</button>
      <button class="btn" data-act="restore">↺ Restore yearly snapshot</button>
      ${ctx.backup ? '<button class="btn" data-act="export-backup">⬇ Pre-upgrade copy</button>' : ''}
      <button class="btn danger" data-act="new">✦ New kingdom</button>
    </div>
    <p class="muted" style="font-size:12px;margin-top:8px">Autosaves every minute and when you leave the page; a recovery snapshot is kept once per game year. ${ctx.lastSaved ? `Last saved ${ctx.lastSaved}.` : ''} ${ctx.source ? `Loaded from: ${esc(ctx.source)}.` : ''}</p>
  </div>
  ${ctx.sound ?? ''}
  ${ctx.graphics ?? ''}
  ${ctx.celebrations ?? ''}
  ${ctx.cloud ?? ''}
  <p class="version">Kingdom of Nobodies · v0.5.2 The Evolution of Civilization · build ${esc(ctx.build)}</p>`;
  return { title: 'The Council', html };
}
