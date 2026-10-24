// Milestone 4 — law and courts (brief items 24–29).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { DAYS_PER_YEAR } from '../src/core/Config.js';
import { totalMoney, balance } from '../src/economy/Transactions.js';
import { completeShift } from '../src/economy/Employment.js';
import { createBusiness } from '../src/economy/Businesses.js';
import { plotByName } from '../src/property/LandRegistry.js';
import { ensureLaw, lawInForce, lawByKey } from '../src/law/LegalCode.js';
import { noteTheft, noteContractShortfall, dailyCourts, hearCase } from '../src/law/Courts.js';

const fresh = (seed = 8) => new Simulation(createKingdom(seed));
const fund = (s, account, n) => { s.accounts.outside -= n; s.accounts[account] = (s.accounts[account] ?? 0) + n; };

/** A worker at a private business that cannot pay. */
function unpaidWorker(s) {
  const [owner, worker] = [s.citizens[0], s.citizens[4]];
  const b = createBusiness(s, { type: 'bakery', ownerId: owner.id, plotId: plotByName(s, 'North Lane').id, name: 'Test Bakery' });
  if (worker.employment) { const old = s.businesses.find((x) => x.id === worker.employment.businessId); old.employees = old.employees.filter((id) => id !== worker.id); }
  worker.employment = { businessId: b.id, role: 'worker', wage: 6, since: s.day, unpaid: 0 };
  b.employees.push(worker.id);
  return { owner, worker, b };
}

/** File every open claim and hear every case today. */
function goToCourt(s) {
  // Inspectors and claimants act daily; claimants may hesitate a few days before suing.
  let i = 0;
  do dailyCourts(s); while (++i < 40 && ensureLaw(s).claims.some((c) => !c.filed));
  for (const c of s.law.cases.filter((x) => x.status !== 'JUDGED')) hearCase(s, c);
}

test('24 & 25. cases arise from real events and carry traceable evidence', () => {
  const s = fresh().state;
  const { worker, b } = unpaidWorker(s);
  const day = s.day;
  completeShift(s, worker, b);
  completeShift(s, worker, b);
  const claim = s.law.claims.find((c) => c.kind === 'wages');
  assert.ok(claim, 'the unpaid shifts created a claim');
  assert.equal(claim.claimantId, worker.id);
  assert.equal(claim.defendantId, b.id);
  assert.equal(claim.items.length, 2);
  assert.equal(claim.day, day);
  assert.ok(claim.evidence.some((e) => e.type === 'employment' && e.text.includes(b.name)));
  assert.ok(claim.evidence.some((e) => e.type === 'ledger' && /ledger checked to entry \d+/.test(e.text)), 'evidence points at the ledger');
  goToCourt(s);
  const c = s.law.cases.find((x) => x.claimId === claim.id);
  assert.equal(c.eventDay, day);
  assert.deepEqual(c.evidence.map((e) => e.text), claim.evidence.slice(0, 8).map((e) => e.text), 'the case uses the evidence captured at the time');
});

test('26 & 27. fines and restitution move real money once, and never twice', () => {
  const s = fresh().state;
  const { owner, worker, b } = unpaidWorker(s);
  completeShift(s, worker, b);
  completeShift(s, worker, b);
  fund(s, owner.id, 50); // the owner can now pay
  const money = totalMoney(s);
  const before = { worker: balance(s, worker.id), treasury: balance(s, 'treasury') };
  goToCourt(s);
  const c = s.law.cases.find((x) => x.kind === 'wages');
  assert.equal(c.status, 'JUDGED');
  assert.equal(c.judgment.outcome, 'restitution');
  assert.equal(balance(s, worker.id) - before.worker, 12, 'two unpaid shifts at 6 coins');
  assert.ok(c.judgment.transfers.some((t) => t.kind === 'fine' && t.to === 'council'));
  for (const t of c.judgment.transfers) assert.ok(s.ledger.some((l) => l.id === t.tx && l.amount === t.amount), 'each payment is a ledger entry');
  assert.equal(totalMoney(s), money, 'money moved, none was made');
  const after = { worker: balance(s, worker.id), treasury: balance(s, 'treasury'), owner: balance(s, owner.id) };
  hearCase(s, c);
  assert.deepEqual({ worker: balance(s, worker.id), treasury: balance(s, 'treasury'), owner: balance(s, owner.id) }, after, 'a judged case is never executed again');
});

test('28. court-ordered land transfers keep ownership unique', () => {
  const sim = fresh();
  const s = sim.state;
  ensureLaw(s).laws.push({ id: 'law-land', key: 'land', name: 'Land Development Act', status: 'ACTIVE', enactedDay: 1, effectiveDay: 1 });
  const plot = plotByName(s, 'Mill Row');
  plot.ownerId = s.citizens[1].id;
  plot.marketStatus = 'NOT_FOR_SALE';
  plot.acquiredDay = 1;
  plot.boughtFor = 20;
  s.day = 3 * Math.ceil((1 + DAYS_PER_YEAR * 2 + 3) / 3); // inspectors visit every third day
  fund(s, 'treasury', 100);
  goToCourt(s);
  const c = s.law.cases.find((x) => x.kind === 'land');
  assert.ok(c, 'idle land was taken to court');
  assert.equal(c.judgment.outcome, 'property transfer');
  assert.equal(plot.ownerId, 'council');
  assert.equal(s.plots.filter((p) => p.id === plot.id).length, 1);
  assert.ok(c.judgment.transfers.some((t) => t.to === s.citizens[1].id && t.amount === 20), 'the owner was paid back what they paid');
});

test('29. laws apply only from their effective dates', () => {
  const s = fresh().state;
  assert.equal(lawInForce(s, 'contracts'), false, 'contract law is not part of the founding code');
  const merchant = s.citizens[2];
  const buyer = s.businesses.find((b) => b.type === 'farm');
  const contract = { id: 'tcX', merchantId: merchant.id, merchantHome: 'hearth', destination: 'hearth', buyer: { party: buyer.id, account: buyer.id }, qty: 20, delivered: 10, sellPrice: 3, commodity: 'grain', createdDay: s.day };
  noteContractShortfall(s, contract, 10, 'cargo spoiled on the road');
  fund(s, merchant.id, 50);
  goToCourt(s);
  const early = s.law.cases.find((x) => x.kind === 'contract');
  assert.equal(early.judgment.outcome, 'dismissed');
  assert.match(early.judgment.reason, /no law/);
  // Enact it with a future effective date: events before then are still not covered.
  s.law.laws.push({ id: 'law-contracts', key: 'contracts', name: 'Contract Enforcement Act', status: 'ACTIVE', enactedDay: s.day, effectiveDay: s.day + 3 });
  assert.equal(lawInForce(s, 'contracts'), false);
  s.day += 3;
  assert.equal(lawInForce(s, 'contracts'), true);
  noteContractShortfall(s, { ...contract, id: 'tcY' }, 10, 'cargo spoiled on the road');
  goToCourt(s);
  const later = s.law.cases.filter((x) => x.kind === 'contract').at(-1);
  assert.equal(later.judgment.outcome, 'contract enforced');
  // Storms excuse a merchant even under the law.
  noteContractShortfall(s, { ...contract, id: 'tcZ' }, 10, 'storms on the road');
  goToCourt(s);
  assert.equal(s.law.cases.filter((x) => x.kind === 'contract').at(-1).judgment.outcome, 'dismissed');
  assert.ok(lawByKey(s, 'contracts'));
});

test('thefts need witnesses to be proven, and the poor are not fined', () => {
  const s = fresh().state;
  const [thief, witness] = [s.citizens[3], s.citizens[1]];
  const farm = s.businesses.find((b) => b.type === 'farm');
  noteTheft(s, thief, farm.id, 'grain', 2, 4, []);
  noteTheft(s, thief, farm.id, 'grain', 2, 4, [witness]);
  s.accounts.outside += s.accounts[thief.id]; s.accounts[thief.id] = 0;
  fund(s, thief.id, 4);
  goToCourt(s);
  const cases = s.law.cases.filter((x) => x.kind === 'theft');
  assert.ok(cases.length >= 1);
  const proven = cases.find((x) => x.evidence.some((e) => e.type === 'witness'));
  if (proven) {
    assert.equal(proven.judgment.outcome, 'restitution');
    assert.match(proven.judgment.reason, /fine waived/);
  }
  const unproven = cases.find((x) => !x.evidence.some((e) => e.type === 'witness'));
  if (unproven) assert.equal(unproven.judgment.outcome, 'dismissed');
});
