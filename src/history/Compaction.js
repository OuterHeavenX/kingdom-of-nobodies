import { isTrading } from '../economy/Businesses.js';

// Keeps long-running saves small without forgetting history. Identity, dates,
// family links, achievements and the chronicle's milestones are preserved;
// what is dropped is day-to-day detail nobody will look up decades later.

const significance = (r) => r.friendship + r.affection * 1.2 + r.rivalry * 1.5 + Math.abs(r.trust - 45) * 0.5 + (r.closeFriend ? 50 : 0);

export function compactState(state) {
  // Relationships: each person keeps their 24 most significant ties.
  const byOwner = new Map();
  for (const [key, r] of Object.entries(state.relationships)) {
    const owner = key.slice(0, key.indexOf('|'));
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push([key, significance(r)]);
  }
  for (const list of byOwner.values()) {
    if (list.length <= 24) continue;
    list.sort((a, b) => b[1] - a[1]);
    for (const [key] of list.slice(24)) delete state.relationships[key];
  }
  // Closed businesses become compact records a year after closing.
  for (const b of state.businesses) {
    if (isTrading(b) || b.compact || state.day - (b.closedDay ?? state.day) < 12) continue;
    b.history = b.history.slice(-3);
    b.inventory = {};
    b.prices = {};
    b.priceMult = {};
    b.today = { revenue: 0, wages: 0, inputs: 0, tax: 0, other: 0, customers: 0, produced: 0 };
    b.employees = [];
    b.compact = true;
  }
  // Archive records keep identity, family, career highlights and achievements.
  for (const p of Object.values(state.archive)) {
    if (p.compact) continue;
    p.employmentHistory = (p.employmentHistory ?? []).slice(-5);
    p.achievements = (p.achievements ?? []).slice(-14);
    p.lastMemories = (p.lastMemories ?? []).slice(0, 3);
    p.traits = Object.fromEntries(Object.entries(p.traits ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3));
    delete p.reputation;
    p.compact = true;
  }
  // Rumours nobody remembers, and stale estates, are let go.
  if (state.estates.length > 150) state.estates.splice(0, state.estates.length - 150);
  for (const plot of state.plots) if (plot.history.length > 16) plot.history.splice(0, plot.history.length - 16);
}
