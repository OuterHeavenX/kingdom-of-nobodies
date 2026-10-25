import { isNewSeason } from '../core/Calendar.js';
import { seasonalAlliances } from '../diplomacy/Alliances.js';
import { seasonalClaims, ensureDisputes } from '../diplomacy/TerritorialClaims.js';
import { ensureMilitary, marchArmies } from './Army.js';
import { peacetimeForces } from './MilitaryManager.js';
import { dailyWar, considerWar } from './WarManager.js';

// The daily and hourly round of alliances, disputes and war.

export function ensureWarfare(state) {
  ensureMilitary(state);
  ensureDisputes(state);
  return state.military;
}

export function dailyMilitary(state) {
  ensureWarfare(state);
  peacetimeForces(state);
  if (isNewSeason(state.day)) {
    seasonalAlliances(state);
    seasonalClaims(state, { considerWar });
  }
  dailyWar(state);
  const m = state.military;
  if (m.history.length > 40) m.history.splice(0, m.history.length - 40);
}

export const hourlyMilitary = (state) => marchArmies(state);
