import { INSTITUTIONS, COUNCIL } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { isTrading } from '../economy/Businesses.js';
import { gainSkill } from '../education/Skills.js';
import { PROFESSIONS } from '../citizens/Careers.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { isNewSeason } from '../core/Calendar.js';
import { plotsForSale, plotHistory } from '../property/LandRegistry.js';
import { buyPlot } from '../property/Ownership.js';
import { startProject, completionHooks } from '../property/Construction.js';
import { depositOf } from '../finance/BankAccounts.js';
import { createBank } from '../finance/BankManager.js';
import { activeGuilds, guildOf } from './GuildManager.js';

// What a guild's fund is spent on. Every coin moves through the ledger and
// every benefit changes something real: skills, a member's purse, the
// quality of members' shops, a hall on the street, a loan fund for members,
// or a donation the council spends on public works.

const skillOf = (c) => PROFESSIONS[String(c.profession).replace(/^Retired /, '')]?.skill ?? null;

/** Training: the master teaches; each member's craft skill improves (more with a hall). */
function training(state, g) {
  const master = byId(state.citizens, g.leaderId);
  const members = g.members.map((id) => byId(state.citizens, id)).filter(Boolean);
  const fee = Math.min(members.length, Math.floor(balance(state, g.id) / 3));
  if (!master || fee < 1) return;
  if (!transfer(state, g.id, master.id, fee, 'wage', `${master.firstName} trained members of the ${g.name}`)) return;
  for (const c of members.slice(0, fee)) { const sk = skillOf(c); if (sk) gainSkill(c, sk, g.plotId ? 0.02 : 0.012); }
  g.stats.training += fee;
}

/** Quality standards: members' shops keep to the guild's standard of work. */
function standards(state, g) {
  for (const b of state.businesses.filter((x) => isTrading(x) && g.members.includes(x.ownerId))) b.quality = Math.min(1, b.quality + 0.04);
}

/** Help for members in hardship, from the common fund. */
function assistance(state, g) {
  for (const id of g.members) {
    const c = byId(state.citizens, id);
    if (!c || balance(state, c.id) + depositOf(state, c.id) >= 6 || c.employment) continue;
    if (balance(state, g.id) < 12) break;
    if (transfer(state, g.id, c.id, 6, 'aid', `The ${g.name} helped ${c.firstName} through hard times`)) {
      g.stats.aid += 6;
      remember(state, c, `The ${g.name} helped me when I had no work.`, 2, 'kindness');
    }
  }
}

/** A prosperous guild builds a hall on commercial or workshop land. */
function considerHall(state, g) {
  if (g.plotId || state.projects.some((p) => p.ownerId === g.id) || g.members.length < 4) return;
  const plot = plotsForSale(state, 'guildhall', g.id).find((p) => !p.building);
  if (!plot || balance(state, g.id) < plot.price + INSTITUTIONS.guildHallCost) return;
  if (!buyPlot(state, plot.id, g.id).ok) return;
  const res = startProject(state, { plotId: plot.id, ownerId: g.id, kind: 'construction', buildingType: 'guildhall', purpose: 'guildhall' });
  if (res.ok) { g.plotId = plot.id; record(state, 'economy', `The ${g.name} bought ${plot.name} and began building a guild hall with its members' dues.`, { citizens: g.leaderId ? [g.leaderId] : [], plot: plot.id }, 3); }
}

completionHooks.guildhall = (state, plot, project) => {
  const g = activeGuilds(state).find((x) => x.id === project.ownerId);
  if (!g) return;
  plot.building.name = `${g.name} Hall`;
  plotHistory(state, plot, `The ${g.name} Hall opened: meetings, training and ceremonies are held here.`);
  // A hall draws trade to its street: neighbouring land on the market is worth more.
  let raised = 0;
  for (const p of state.plots.filter((x) => x !== plot && x.marketStatus === 'FOR_SALE' && Math.hypot(x.x - plot.x, x.z - plot.z) < 22)) { p.price = Math.round(p.price * 1.1); raised++; }
  record(state, 'construction', `The ${g.name} Hall opened on ${plot.name}${raised ? `; ${raised} nearby plots rose in price` : ''}.`, { plot: plot.id, citizens: g.leaderId ? [g.leaderId] : [] }, 3);
  for (const id of g.members) { const c = byId(state.citizens, id); if (c) c.mood = Math.min(100, c.mood + 6); }
};

/** A large, well-funded guild opens a credit fund that lends only to its members. */
function considerCredit(state, g) {
  if (g.creditBankId || g.members.length < 6 || balance(state, g.id) < 220) return;
  const bank = createBank(state, { kind: 'guild_credit', ownerId: g.id, name: `${g.name} Credit Fund`, capital: 120, members: [...g.members] });
  if (!bank) return;
  g.creditBankId = bank.id;
  record(state, 'economy', `The ${g.name} opened a credit fund with 120 coins, lending to members on the guild's word.`, {}, 2);
}

/** A rich guild sponsors public works: a donation to the treasury, spent by the council. */
function sponsor(state, g) {
  const spare = balance(state, g.id) - (g.plotId ? 80 : INSTITUTIONS.guildHallCost + 60);
  if (spare < 60 || balance(state, 'treasury') > COUNCIL.reserve * 3) return;
  const gift = Math.floor(spare * 0.4);
  if (gift > 0 && transfer(state, g.id, 'treasury', gift, 'gift', `The ${g.name} sponsored public works`)) {
    g.stats.sponsored += gift;
    record(state, 'council', `The ${g.name} gave the council ${gift} coins toward public works.`, { citizens: g.leaderId ? [g.leaderId] : [] }, 2);
  }
}

export function guildEconomy(state) {
  if (!isNewSeason(state.day)) return;
  for (const g of activeGuilds(state)) {
    training(state, g);
    standards(state, g);
    assistance(state, g);
    considerHall(state, g);
    considerCredit(state, g);
    sponsor(state, g);
    const bank = g.creditBankId && state.finance?.banks.find((b) => b.id === g.creditBankId);
    if (bank) bank.members = [...g.members];
  }
}

/** Apprentices of a guild master learn faster (Education.completeApprenticeship). */
export const apprenticeBonus = (state, master) => (master && guildOf(state, master) ? (guildOf(state, master).plotId ? 1.4 : 1.2) : 1);
