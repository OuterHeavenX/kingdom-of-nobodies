import { dateLabel } from '../core/Calendar.js';
import { HEARTH, KINGDOMS, COMMODITIES } from '../region/RegionData.js';
import { settlementName } from '../region/RegionManager.js';
import { marketPrice, marketAvailable, marketDemand } from '../trade/Markets.js';
import { activeRoadProject } from '../navigation/RoadConstruction.js';
import { esc } from './util.js';

// Economy → Trade: what things cost in each market, what is wanted where, the
// contracts on the road and the merchants of First Hearth.

const MARKETS = [HEARTH, ...Object.keys(KINGDOMS)];

export function tradePanel(sim) {
  const s = sim.state;
  const t = s.trade;
  const head = MARKETS.map((m) => `<th>${esc(settlementName(m).replace('First ', ''))}</th>`).join('');
  const rows = Object.keys(COMMODITIES).map((g) => {
    const cells = MARKETS.map((m) => {
      if (m === HEARTH && !COMMODITIES[g].local) return '<td class="num muted">–</td>';
      const p = marketPrice(s, m, g);
      const spare = marketAvailable(s, m, g), want = marketDemand(s, m, g);
      const cls = want >= 4 ? 'up' : spare >= 10 ? 'down' : '';
      return `<td class="num ${cls}">${p.toFixed(1)}<small>${want >= 4 ? `↑${want}` : spare >= 10 ? `${spare}` : ''}</small></td>`;
    }).join('');
    return `<tr><td>${COMMODITIES[g].icon}</td>${cells}</tr>`;
  }).join('');
  const live = t.contracts.filter((c) => c.status === 'AGREED' || c.status === 'IN_TRANSIT');
  const recent = t.contracts.filter((c) => c.status === 'DELIVERED' || c.status === 'PARTIAL').slice(-8).reverse();
  const merchants = Object.values(t.merchants).sort((a, b) => b.profit - a.profit);
  const road = activeRoadProject(s);
  const html = `
  <div class="card"><h3>Regional markets</h3><p class="muted" style="font-size:12px;margin-top:0">Price per unit; ↑ marks demand, a plain number spare stock.</p>
    <table class="mkt wide"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  <div class="card"><h3>Contracts under way</h3>${live.map((c) => `<button class="item" data-act="caravan" data-id="${c.caravanId}"><span class="main"><strong>${c.qty} ${esc(COMMODITIES[c.commodity].label.toLowerCase())}: ${esc(settlementName(c.origin))} → ${esc(settlementName(c.destination))}</strong><small>${esc(c.merchantName)} · buys at ${c.buyPrice}, sells to ${esc(c.buyerName)} at ${c.sellPrice} · ${esc(c.status === 'AGREED' ? 'agreed' : 'on the road')}</small></span></button>`).join('') || '<p class="muted">None right now.</p>'}</div>
  <div class="card"><h3>Recent deliveries</h3>${recent.map((c) => `<div class="belief">${esc(dateLabel(c.deliveredDay))}: ${c.delivered} ${esc(c.commodity)} to ${esc(settlementName(c.destination))} by ${esc(c.merchantName)}, ${c.revenue}🪙 (profit ${c.profit}🪙)</div>`).join('') || '<p class="muted">No deliveries yet.</p>'}</div>
  <div class="card"><h3>Our merchants</h3>${merchants.map((m) => `<div class="belief"><strong>${esc(m.name)}</strong> · ${m.trips} trip${m.trips === 1 ? '' : 's'} · profit ${m.profit}🪙${m.active ? ' · on the road' : ''}<br><span class="muted">${esc(m.lastPlan?.text ?? 'Has not looked for a trade yet.')}</span></div>`).join('') || '<p class="muted">No villager trades beyond the valley yet. Merchants and shopkeepers with savings will, when a margin appears.</p>'}</div>
  <div class="card"><h3>Council stores</h3><dl class="kv"><dt>Stone</dt><dd>${s.council.stores?.stone ?? 0}</dd><dt>Road works</dt><dd>${road ? `${esc(road.name)}${road.waiting ? ` — ${esc(road.waiting.toLowerCase())}` : ''}` : 'none'}</dd></dl></div>`;
  return { title: 'Trade', html };
}
