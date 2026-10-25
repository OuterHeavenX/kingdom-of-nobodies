import { dailyHooks, hourlyHooks } from './Hooks.js';
import { financing } from '../city/CityPlanner.js';
import { municipalLoan } from '../finance/LoanManager.js';
import { milestone5Setup } from './Setup.js';
import { saleHooks } from '../property/Ownership.js';
import { emigrationHooks } from '../population/Migration.js';
import { ensureFinance, spendable, raiseCash } from '../finance/BankAccounts.js';
import { ensureGuilds, seasonalGuilds, onGuildMemberGone } from '../institutions/GuildManager.js';
import { guildEconomy } from '../institutions/GuildEconomy.js';
import { evolveBeliefs } from '../institutions/FaithManager.js';
import { ensureFaith, dailyFaith, consoleBereaved } from '../institutions/ReligiousInstitutions.js';
import { lifecycleHooks } from '../citizens/Lifecycle.js';
import { dailyFinance, pledgeNewLand, settleBeforeLeaving, borrowForDevelopment } from '../finance/BankManager.js';

// Wires the Milestone 5 systems into the simulation's schedules and the
// shared lifecycle hooks. Imported once by Simulation.js.

milestone5Setup.push(ensureFinance, ensureGuilds, ensureFaith);
financing.borrow = municipalLoan;

dailyHooks.early.push(dailyFinance);
dailyHooks.late.push(seasonalGuilds, guildEconomy, evolveBeliefs, dailyFaith);
lifecycleHooks.death.push(onGuildMemberGone, consoleBereaved);
dailyHooks.developmentFunding = (state) => ({ funds: (c) => spendable(state, c.id), raise: raiseCash, borrow: borrowForDevelopment });

saleHooks.push((state, plot, sellerId) => pledgeNewLand(state, plot, plot.ownerId));
emigrationHooks.push(settleBeforeLeaving);

export { hourlyHooks };
