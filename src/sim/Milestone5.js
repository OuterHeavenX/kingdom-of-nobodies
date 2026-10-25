import { dailyHooks, hourlyHooks } from './Hooks.js';
import { financing } from '../city/CityPlanner.js';
import { ensureForeign, dailyForeign, caravanReturns, succession } from '../region/ForeignCitizenManager.js';
import { leaderHooks } from '../region/Settlement.js';
import { ensureWarfare, dailyMilitary, hourlyMilitary } from '../military/index.js';
import { warBetween, besieged } from '../military/WarManager.js';
import { casualtyHooks } from '../military/BattleResolver.js';
import { warHooks } from '../diplomacy/Diplomacy.js';
import { die } from '../citizens/Lifecycle.js';
import { ensureWeather, dailyWeather } from '../events/Weather.js';
import { municipalLoan } from '../finance/LoanManager.js';
import { milestone5Setup } from './Setup.js';
import { saleHooks } from '../property/Ownership.js';
import { emigrationHooks } from '../population/Migration.js';
import { ensureFinance, spendable, raiseCash } from '../finance/BankAccounts.js';
import { ensureGuilds, seasonalGuilds, onGuildMemberGone, onProfessionChange } from '../institutions/GuildManager.js';
import { professionHooks } from '../citizens/Careers.js';
import { guildEconomy } from '../institutions/GuildEconomy.js';
import { evolveBeliefs } from '../institutions/FaithManager.js';
import { ensureFaith, dailyFaith, consoleBereaved } from '../institutions/ReligiousInstitutions.js';
import { lifecycleHooks } from '../citizens/Lifecycle.js';
import { dailyFinance, pledgeNewLand, settleBeforeLeaving, borrowForDevelopment, bankTithe } from '../finance/BankManager.js';
import { titheHooks } from '../council/Council.js';
import { ensureHolidays, hourlyHolidays } from '../culture/Holidays.js';

// Wires the Milestone 5 systems into the simulation's schedules and the
// shared lifecycle hooks. Imported once by Simulation.js.

milestone5Setup.push(ensureWeather, ensureFinance, ensureGuilds, ensureFaith, ensureForeign, ensureWarfare, ensureHolidays);
leaderHooks.pick = (state, k, stance, why) => (state.foreign ? succession(state, k.id, why, { stance, apply: false }) : null);
financing.borrow = municipalLoan;
titheHooks.push(bankTithe);

dailyHooks.early.push(dailyFinance);
dailyHooks.early.push(dailyWeather, dailyForeign, caravanReturns, dailyMilitary);
hourlyHooks.push(hourlyMilitary);
// Milestone 5.1: the holidays of the year (records only; citizens choose for themselves in DecisionUtility).
hourlyHooks.push(hourlyHolidays);
warHooks.between = warBetween;
warHooks.besieged = besieged;
casualtyHooks.die = (state, c, cause) => die(state, c, cause);
dailyHooks.late.push(seasonalGuilds, guildEconomy, evolveBeliefs, dailyFaith);
lifecycleHooks.death.push(onGuildMemberGone, consoleBereaved);
professionHooks.push(onProfessionChange);
dailyHooks.developmentFunding = (state) => ({ funds: (c) => spendable(state, c.id), raise: raiseCash, borrow: borrowForDevelopment });

saleHooks.push((state, plot, sellerId) => pledgeNewLand(state, plot, plot.ownerId));
emigrationHooks.push(settleBeforeLeaving, (state, c) => onGuildMemberGone(state, c, 'left the village'));

export { hourlyHooks };
