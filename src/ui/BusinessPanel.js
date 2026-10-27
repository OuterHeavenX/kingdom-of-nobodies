import { balance } from '../economy/Transactions.js';
import { councilCooldown } from '../council/Council.js';
import { GOODS } from '../core/Config.js';
import { BUSINESS_TYPES, isTrading, retailPrice } from '../economy/Businesses.js';
import { economySnapshot, recentProfit } from '../economy/EconomyManager.js';
import { plotById } from '../property/LandRegistry.js';
import { esc, badge, link, portrait } from './util.js';

const ICON = { farm: '🌾', lumberyard: '🪵', blacksmith: '⚒️', bakery: '🍞', tavern: '🍺', general_store: '🛒' };

export function economyOverview(sim) {
  const s = sim.state;
  const snap = economySnapshot(s);
  const trading = s.businesses.filter(isTrading);
  const prices = Object.keys(GOODS).map((g) => {
    const sellers = trading.filter((b) => BUSINESS_TYPES[b.type].sells.includes(g));
    if (!sellers.length) return '';
    const avg = Math.round((sellers.reduce((t, b) => t + retailPrice(b, g), 0) / sellers.length) * 10) / 10;
    const stock = sellers.reduce((t, b) => t + (b.inventory[g] ?? 0), 0);
    return `<dt>${GOODS[g].icon} ${GOODS[g].label}</dt><dd>${avg}🪙 · ${stock} in stock</dd>`;
  }).join('');
  const list = [...s.businesses].sort((a, b) => (isTrading(b) - isTrading(a)) || b.foundedDay - a.foundedDay).map((b) => {
    const owner = s.citizens.find((c) => c.id === b.ownerId);
    return `<button class="item" data-act="business" data-id="${b.id}">
      <span class="portrait" style="background:#e9dcc0">${ICON[b.type]}</span>
      <span class="main"><strong>${esc(b.name)}</strong><small>${owner ? esc(owner.firstName) : 'Council'} · ${b.employees.length} staff · ${b.totals.customers} customers</small></span>
      <span class="side">${badge(b.status)}<br>${balance(s, b.id)}🪙</span></button>`;
  }).join('');
  const t = s.ledgerTotals;
  const html = `
  <div class="card">
    <h3>Village finances</h3>
    <dl class="kv">
      <dt>Citizens' wallets</dt><dd>${snap.wallets}🪙</dd>
      <dt>Business accounts</dt><dd>${snap.businessCash}🪙</dd>
      <dt>Council treasury</dt><dd>${snap.treasury}🪙</dd>
      <dt>Employed</dt><dd>${snap.employed} of ${s.citizens.length}</dd>
      <dt>Wages paid (all time)</dt><dd>${t.wage ?? 0}🪙</dd>
      <dt>Shop sales (all time)</dt><dd>${t.purchase ?? 0}🪙</dd>
      <dt>Trade with caravans</dt><dd>+${t.export ?? 0} / −${t.import ?? 0}🪙</dd>
    </dl>
  </div>
  <div class="card"><h3>Market prices</h3><dl class="kv">${prices || '<dt>No goods on sale</dt><dd></dd>'}</dl></div>
  <div class="card"><h3>Businesses · ${trading.length} trading</h3><div class="list">${list || '<p class="empty">No businesses yet.</p>'}</div></div>
  <div class="card"><h3>Recent transactions</h3>${s.ledger.slice(-8).reverse().map((tx) => `<div class="belief">Day ${tx.day} · <strong>${tx.amount}🪙</strong> ${esc(tx.kind)} — ${esc(tx.memo)}</div>`).join('')}</div>`;
  return { title: 'Economy', html };
}

export function businessDetail(sim, id) {
  const s = sim.state;
  const b = s.businesses.find((x) => x.id === id) ?? s.businessArchive?.[id]; // long-closed ones are archived
  if (!b) return { title: 'Business', html: '<p class="empty">Not found.</p>' };
  const def = BUSINESS_TYPES[b.type];
  const owner = s.citizens.find((c) => c.id === b.ownerId);
  const plot = plotById(s, b.plotId);
  const hist = b.history.slice(-14);
  const max = Math.max(1, ...hist.map((h) => Math.abs(h.profit)));
  const bars = hist.map((h) => `<span class="${h.profit < 0 ? 'neg' : ''}" style="height:${Math.max(4, (Math.abs(h.profit) / max) * 100)}%" title="Day ${h.day}: ${h.profit}"></span>`).join('');
  const stock = Object.entries(b.inventory).map(([g, n]) => `<dt>${GOODS[g]?.icon ?? ''} ${GOODS[g]?.label ?? g}</dt><dd>${n}${def.sells.includes(g) ? ` · ${retailPrice(b, g)}🪙` : ' (input)'}</dd>`).join('');
  const staff = b.employees.map((cid) => s.citizens.find((c) => c.id === cid)).filter(Boolean);
  const chain = def.output ? `${Object.keys(def.inputs).map((g) => GOODS[g].label).join(' + ') || (def.commons ? 'Forest' : 'Land')} → ${GOODS[def.output].label}` : 'Buys wholesale, sells retail';
  const html = `
  <div class="card">
    <div class="row between"><strong style="font-size:16px">${ICON[b.type]} ${esc(b.name)}</strong>${badge(b.status)}</div>
    <p class="muted">${def.label} on ${esc(plot?.name ?? '?')} · founded day ${b.foundedDay}${b.closedDay ? ` · closed day ${b.closedDay}` : ''}</p>
    <p>Production: ${esc(chain)}</p>
    <div class="chips">${owner ? link('citizen', owner.id, `👤 ${owner.firstName}`) : '<span class="chip">Council-run</span>'}${plot ? link('plot', plot.id, `📍 ${plot.name}`) : ''}</div>
  </div>
  <div class="card">
    <h3>Accounts</h3>
    <dl class="kv">
      <dt>Cash</dt><dd>${balance(s, b.id)}🪙</dd>
      <dt>Today so far</dt><dd>+${b.today.revenue} / −${b.today.wages + b.today.inputs + b.today.tax}🪙</dd>
      <dt>Last 3 days profit</dt><dd>${recentProfit(b, 3)}🪙</dd>
      <dt>All-time revenue</dt><dd>${b.totals.revenue}🪙</dd>
      <dt>All-time expenses</dt><dd>${b.totals.expenses}🪙</dd>
      <dt>Customers served</dt><dd>${b.totals.customers}</dd>
      <dt>Units produced</dt><dd>${b.totals.produced}</dd>
    </dl>
    ${hist.length ? `<div class="bars">${bars}</div><p class="muted" style="font-size:11px">Daily profit, last ${hist.length} days</p>` : ''}
  </div>
  <div class="card"><h3>Stock & prices</h3><dl class="kv">${stock || '<dt>Empty shelves</dt><dd></dd>'}</dl></div>
  <div class="card">
    <h3>Staff${b.openings ? ' · hiring' : ''}</h3>
    ${staff.length ? staff.map((c) => `<button class="item" data-act="citizen" data-id="${c.id}">${portrait(c)}<span class="main"><strong>${esc(c.firstName)}</strong><small>${c.employment?.wage ?? 0}🪙 a shift · since day ${c.employment?.since}</small></span></button>`).join('') : '<p class="muted">No employees.</p>'}
  </div>
  <div class="grid2">
    <button class="btn" data-act="focus-plot" data-id="${b.plotId}">📍 Show in village</button>
    <button class="btn" data-act="history" data-kind="business" data-id="${b.id}">📜 History</button>
    ${isTrading(b) && b.ownerId !== 'council' ? ((wait) => `<button class="btn primary" data-act="council" data-action="supportBusiness" data-id="${b.id}" ${wait || balance(s, 'treasury') < 20 ? 'disabled' : ''} title="${esc(wait ?? (balance(s, 'treasury') < 20 ? 'The treasury cannot afford it.' : ''))}">🤝 ${wait ? 'Granted this season' : 'Grant 20🪙'}</button>`)(councilCooldown(s, 'supportBusiness', b.id)) : ''}
  </div>`;
  return { title: b.name, html };
}
