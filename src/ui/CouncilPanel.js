import { balance } from '../economy/Transactions.js';
import { COUNCIL, ECONOMY } from '../core/Config.js';
import { isTrading } from '../economy/Businesses.js';
import { esc } from './util.js';

export function councilPanel(sim, ctx) {
  const s = sim.state;
  const roadRows = (s.roadProjects ?? []).filter((p) => p.status === 'BUILDING' || p.status === 'PROPOSED').map((p) => `<div class="belief"><strong>${esc(p.name)}</strong> · ${esc(p.kind)} · ${p.status === 'BUILDING' ? `${Math.round(Math.min(1, p.work / p.need.work) * 100)}% built${p.waiting ? ` (${esc(p.waiting.toLowerCase())})` : ''}` : 'proposed'}<br><span class="muted">${esc(p.reason)}</span></div>`).join('');
  const scoutOut = (s.region?.expeditions ?? []).some((e) => e.status === 'OUT');
  const t = balance(s, 'treasury');
  const tot = s.ledgerTotals;
  const selectedCitizen = sim.selected.kind === 'citizen' ? s.citizens.find((c) => c.id === sim.selected.id) : null;
  const struggling = s.businesses.find((b) => b.status === 'STRUGGLING' && b.ownerId !== 'council') ?? s.businesses.find((b) => isTrading(b) && b.ownerId !== 'council');
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
    <div class="segmented">${['low', 'normal', 'high'].map((lvl) => `<button class="${s.council.taxLevel === lvl ? 'active' : ''}" data-act="tax" data-id="${lvl}" ${s.government?.leaderId ? 'disabled' : ''}>${lvl[0].toUpperCase() + lvl.slice(1)} · ${ECONOMY.tax[lvl]}🪙</button>`).join('')}</div>
    <p class="muted" style="font-size:12px;margin-top:6px">${s.government?.leaderId ? `Taxes are now set by the elected ${esc(s.government.title)} (see Politics).` : 'Per business per day, plus a tithe on savings above 60 coins. Higher taxes fill the treasury but squeeze profits and lower happiness.'}</p>
  </div>
  ${action('🍲 Emergency food aid', `Buy food from local sellers (or the pantry) and hand ${COUNCIL.foodAidUnits} portions to the hungriest villagers.`, 'Distribute', 'foodAid', {}, t < 3 && !Object.keys(s.council.pantry).length)}
  ${action('✧ Financial aid', selectedCitizen ? `Grant ${esc(selectedCitizen.firstName)} ${COUNCIL.aidAmount} coins from the treasury.` : 'Select a villager first (tap one in the village or Citizens list).', `${COUNCIL.aidAmount}🪙`, 'aid', { id: selectedCitizen?.id ?? '' }, !selectedCitizen || t < COUNCIL.aidAmount)}
  ${action('🎉 Village festival', `Spend up to ${COUNCIL.festivalBudget} coins on local food and drink; everyone gathers in the square.`, 'Sponsor', 'festival', {}, t < 10 || s.council.festivalCooldownUntil > s.day)}
  ${action('🏠 Fund a public cottage', `Builders and timber paid from the treasury; adds two beds so newcomers can settle.`, '~30🪙', 'publicCottage', {}, t < COUNCIL.publicCottageBudget || !freeCottageLand)}
  ${action('🤝 Support a business', struggling ? `Grant ${esc(struggling.name)} ${COUNCIL.businessGrant} coins.` : 'No citizen-owned business to support yet.', `${COUNCIL.businessGrant}🪙`, 'supportBusiness', { id: struggling?.id ?? '' }, !struggling || t < COUNCIL.businessGrant)}
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
    <div class="segmented" style="margin:6px 0 10px">${['high', 'low'].map((q) => `<button class="${ctx.settings.quality === q ? 'active' : ''}" data-act="quality" data-id="${q}">${q === 'high' ? 'Best graphics' : 'Battery saver'}</button>`).join('')}</div>
    <div class="grid2">
      <button class="btn" data-act="save">💾 Save now</button>
      <button class="btn" data-act="export">⬇ Export save</button>
      <button class="btn" data-act="import">⬆ Import save</button>
      <button class="btn" data-act="restore">↺ Restore yearly snapshot</button>
      <button class="btn danger" data-act="new">✦ New kingdom</button>
    </div>
    <p class="muted" style="font-size:12px;margin-top:8px">Autosaves every minute and when you leave the page; a recovery snapshot is kept once per game year. ${ctx.lastSaved ? `Last saved ${ctx.lastSaved}.` : ''} ${ctx.source ? `Loaded from: ${esc(ctx.source)}.` : ''}</p>
  </div>
  <p class="version">Kingdom of Nobodies · v0.3.0 Legacy &amp; Generations · build ${esc(ctx.build)}</p>`;
  return { title: 'The Council', html };
}
