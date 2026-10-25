import { dateLabel } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { ensureFinance, depositOf, bankById } from '../finance/BankAccounts.js';
import { balanceSheet, financeSummary, BANK_KINDS } from '../finance/BankManager.js';
import { loansOf, purposeText } from '../finance/LoanManager.js';
import { creditRecord, seasonalIncome, outstandingDebt } from '../finance/CreditAssessment.js';
import { esc, capital } from './util.js';

// Banks, loans and a citizen's own finances. Each bank shows a real balance
// sheet; each loan its terms, repayments and status.

const ownerName = (s, id) => (id === 'council' ? 'the council' : s.citizens.find((c) => c.id === id)?.firstName ?? s.guilds?.list.find((g) => g.id === id)?.name ?? id);

export function financePanel(sim) {
  const s = sim.state;
  const f = ensureFinance(s);
  const sum = financeSummary(s);
  const banks = f.banks.map((b) => {
    const sh = balanceSheet(s, b);
    return `<button class="item" data-act="bank" data-id="${b.id}"><span class="portrait" style="background:${b.status === 'FAILED' ? '#7f8f80' : b.status === 'TROUBLED' ? '#d39a3a' : '#c9a442'}">🏦</span>
      <span class="main"><strong>${esc(b.name)}</strong><small>${esc(BANK_KINDS[b.kind].label)} · ${esc(b.status.toLowerCase())} · owned by ${esc(ownerName(s, b.ownerId))}</small>
      <small>reserves ${sh.cash} · loans ${sh.loans} · deposits ${sh.deposits} · equity ${sh.equity}</small></span></button>`;
  }).join('');
  const loans = f.loans.filter((l) => l.status === 'ACTIVE' || l.status === 'DELINQUENT' || l.status === 'COLLECTING').slice(-20).reverse();
  const html = `<div class="card"><dl class="kv">
      <dt>Saved in banks</dt><dd>${sum.deposits}🪙</dd><dt>Owed on loans</dt><dd>${sum.outstanding}🪙 (${sum.loans} loans${sum.delinquent ? `, ${sum.delinquent} behind` : ''})</dd>
      <dt>Lent in all</dt><dd>${sum.issued}🪙</dd><dt>Repaid in all</dt><dd>${sum.repaid}🪙</dd><dt>Interest earned</dt><dd>${sum.interest}🪙</dd><dt>Defaults</dt><dd>${sum.defaults} (${sum.writtenOff}🪙 written off)</dd><dt>Bank failures</dt><dd>${sum.failures}</dd>
    </dl></div>
    <div class="list">${banks || '<p class="empty">No bank yet. A citizen with capital, or the council once the treasury is comfortable, will open one.</p>'}</div>
    ${loans.length ? `<div class="card"><h3>Loans outstanding</h3>${loans.map((l) => loanRow(s, l)).join('')}</div>` : ''}`;
  return { title: 'Banks & loans', html };
}

function loanRow(s, l) {
  return `<div class="belief"><strong>${esc(l.borrowerName)}</strong> · ${l.balance}🪙 left of ${l.principal} · ${Math.round(l.rate * 1000) / 10}% · ${l.payment}/season${l.status !== 'ACTIVE' ? ` · <b>${esc(l.status.toLowerCase())}</b>` : ''}<br><span class="muted">${esc(purposeText(l.purpose))} · from ${esc(bankById(s, l.bankId)?.name ?? 'the council')}${l.collateralPlotId ? ` · secured on ${esc(s.plots.find((p) => p.id === l.collateralPlotId)?.name ?? '')}` : ''}</span></div>`;
}

export function bankDetail(sim, id) {
  const s = sim.state;
  const b = bankById(s, id);
  if (!b) return { title: 'Bank', html: '<p class="empty">No such bank.</p>' };
  const sh = balanceSheet(s, b);
  const loans = ensureFinance(s).loans.filter((l) => l.bankId === b.id).slice(-15).reverse();
  const savers = Object.entries(b.deposits).sort((x, y) => y[1] - x[1]).slice(0, 10);
  const html = `<div class="card"><h3>Balance sheet</h3><table class="mkt"><tbody>
      <tr><td>Cash in the vault</td><td class="num">${sh.cash}</td></tr><tr><td>Loans owed to the bank</td><td class="num">${sh.loans}</td></tr><tr><td><b>Assets</b></td><td class="num"><b>${sh.assets}</b></td></tr>
      <tr><td>Deposits owed to savers</td><td class="num">${sh.deposits}</td></tr><tr><td><b>Equity</b> (assets − deposits)</td><td class="num"><b>${sh.equity}</b></td></tr>
      <tr><td>Reserve ratio</td><td class="num">${Math.round(sh.reserveRatio * 100)}%</td></tr></tbody></table>
      <dl class="kv"><dt>Status</dt><dd>${esc(b.status.toLowerCase())}${b.failure ? ` — ${esc(b.failure.why)}; savers recovered ${b.failure.recovery}%` : ''}</dd><dt>Founded</dt><dd>${esc(dateLabel(b.foundedDay))} with ${b.capital}🪙</dd><dt>Owner</dt><dd>${esc(ownerName(s, b.ownerId))}</dd><dt>Deposit interest</dt><dd>${Math.round((b.rates.effective ?? b.rates.deposit) * 1000) / 10}% a year</dd><dt>Dividends paid</dt><dd>${b.stats.dividends}🪙</dd><dt>Written off</dt><dd>${b.stats.writtenOff}🪙</dd></dl></div>
    <div class="card"><h3>Largest savers</h3>${savers.map(([h, n]) => `<div class="belief">${esc(ownerName(s, h))}: ${n}🪙</div>`).join('') || '<p class="muted">No deposits.</p>'}</div>
    <div class="card"><h3>Loans</h3>${loans.map((l) => loanRow(s, l)).join('') || '<p class="muted">No loans yet.</p>'}</div>`;
  return { title: b.name, html };
}

/** The money section of a citizen's page. */
export function personalFinance(sim, c) {
  const s = sim.state;
  if (!s.finance) return '';
  const saved = depositOf(s, c.id);
  const loans = loansOf(s, c.id);
  const rec = creditRecord(s, c.id);
  const app = c.lastLoanApplication;
  if (!saved && !loans.length && !app && !rec.onTime && !rec.defaults) return '';
  return `<div class="card"><h3>Money</h3><dl class="kv"><dt>Cash</dt><dd>${balance(s, c.id)}🪙</dd><dt>Savings in the bank</dt><dd>${saved}🪙</dd><dt>Debts</dt><dd>${outstandingDebt(s, c.id)}🪙</dd><dt>Income</dt><dd>about ${seasonalIncome(s, c)}🪙 a season</dd>
    <dt>Credit record</dt><dd>${rec.onTime} on time · ${rec.late} late · ${rec.defaults} defaults${rec.bankruptDay ? ` · bankrupt ${esc(dateLabel(rec.bankruptDay))}` : ''}</dd></dl>
    ${loans.map((l) => loanRow(s, l)).join('')}
    ${app ? `<p class="muted" style="font-size:12px">Last applied for credit ${esc(dateLabel(app.day))}: ${app.amount}🪙 ${esc(purposeText(app.purpose))} — ${app.approved ? `approved by ${esc(app.bank)}` : 'refused'} (score ${app.score}: ${esc(app.reasons.join('; '))}).</p>` : ''}</div>`;
}

export { capital };
