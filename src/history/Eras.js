import { HISTORY, DAYS_PER_YEAR } from '../core/Config.js';
import { yearOf, isNewYear } from '../core/Calendar.js';
import { settlementStage } from '../population/Expansion.js';
import { record } from '../society/Chronicle.js';

// Named eras and yearly summaries. At each new year the archive reviews what
// really happened in the past year (deaths by hunger, fires, elections,
// openings, discoveries, growth) and may declare a new era named for it.

export function yearlyReview(state) {
  if (!isNewYear(state.day) || state.day < DAYS_PER_YEAR) return null;
  const year = yearOf(state.day) - 1;
  const from = state.day - DAYS_PER_YEAR;
  const log = (state.eventLog ?? []).filter((e) => e.day >= from);
  const chron = state.chronicle.filter((e) => e.day >= from);
  const prev = state.yearly.at(-1);
  const summary = {
    year,
    population: state.citizens.length,
    births: state.stats.births - (prev?.totals.births ?? 0),
    deaths: state.stats.deaths - (prev?.totals.deaths ?? 0),
    immigrants: state.stats.immigrants - (prev?.totals.immigrants ?? 0),
    emigrants: state.stats.emigrants - (prev?.totals.emigrants ?? 0),
    marriages: (state.stats.marriages ?? 0) - (prev?.totals.marriages ?? 0),
    businessesOpened: chron.filter((e) => /officially opened/.test(e.text)).length,
    businessesClosed: chron.filter((e) => /bankrupt|closed permanently|closed after/.test(e.text)).length,
    hungerDeaths: Object.values(state.archive).filter((p) => p.deathDay >= from && p.cause === 'hunger').length,
    fires: log.filter((e) => e.type === 'buildingDestroyed').length,
    discoveries: log.filter((e) => e.type === 'discovery').length,
    elections: (state.government?.elections ?? []).filter((e) => e.day >= from).length,
    leaderId: state.government?.leaderId ?? null,
    stage: settlementStage(state.citizens.length),
    totals: { ...state.stats },
  };
  state.yearly.push(summary);
  if (state.yearly.length > 400) state.yearly.splice(0, state.yearly.length - 400);
  considerEra(state, summary, prev);
  return summary;
}

function considerEra(state, y, prev) {
  const current = state.eras.at(-1);
  const sinceYears = (state.day - current.startDay) / DAYS_PER_YEAR;
  const candidates = [];
  if (y.fires >= 2 || (y.fires >= 1 && y.deaths > y.births + 2)) candidates.push({ name: `The Great Fire of Year ${y.year}`, reason: `${y.fires} buildings burned in Year ${y.year}.`, urgent: true });
  if (y.hungerDeaths >= 3 && y.hungerDeaths >= y.population * 0.03) candidates.push({ name: 'The Hungry Years', reason: `${y.hungerDeaths} villagers died of hunger in Year ${y.year}.`, urgent: true });
  if (/Great Fire|Hungry/.test(current.name) && sinceYears >= 3 && !candidates.length && y.hungerDeaths === 0) candidates.push({ name: 'The Years of Recovery', reason: 'The village rebuilt after hard times.' });
  if (y.elections && state.government?.elections.length === 1) candidates.push({ name: 'The Age of Councils', reason: 'The village held its first election.', urgent: true });
  const gov = state.government;
  if (gov?.elections.length >= 2) {
    const [a, b] = gov.elections.slice(-2).map((e) => e.winnerId);
    const fam = (id) => (state.citizens.find((c) => c.id === id) ?? state.archive[id])?.lastName;
    if (a && b && a !== b && fam(a) === fam(b)) candidates.push({ name: `The ${fam(b)} Dynasty`, reason: `Two ${fam(b)}s led the village in succession.` });
  }
  if (y.businessesOpened >= 3) candidates.push({ name: 'The Merchant Age', reason: `${y.businessesOpened} businesses opened in Year ${y.year}.` });
  if (y.discoveries >= 1 && Object.keys(state.discoveries ?? {}).length >= 2) candidates.push({ name: 'The Age of Discovery', reason: 'New knowledge transformed village life.' });
  const rank = ['Hamlet', 'Village', 'Growing Town', 'Large Town', 'Kingdom Center'];
  const peak = state.peakStage ?? 'Hamlet';
  if (rank.indexOf(y.stage) > rank.indexOf(peak)) state.peakStage = y.stage;
  if (prev && rank.indexOf(y.stage) > rank.indexOf(peak) && ['Growing Town', 'Large Town', 'Kingdom Center'].includes(y.stage)) candidates.push({ name: y.stage === 'Growing Town' ? 'The Growing Town' : y.stage === 'Large Town' ? 'The Kingdom Rises' : 'The Kingdom Center', reason: `The settlement became a ${y.stage.toLowerCase()}.`, urgent: true });
  if (y.births >= 4 && y.hungerDeaths === 0 && !state.season?.cropFailureYear) candidates.push({ name: 'The Great Harvest', reason: `A plentiful year: ${y.births} children born.` });
  // The same kind of era does not return within twelve years.
  const recent = state.eras.filter((e) => (state.day - e.startDay) / DAYS_PER_YEAR < 12).map((e) => e.name.replace(/ of Year \d+$/, ''));
  const fresh = candidates.filter((c) => !recent.includes(c.name.replace(/ of Year \d+$/, '')));
  const pick = fresh.find((c) => c.urgent) ?? fresh[0];
  if (!pick || pick.name === current.name) return;
  if (!pick.urgent && sinceYears < HISTORY.minEraYears) return;
  current.endDay = state.day;
  state.eras.push({ name: pick.name, startDay: state.day, reason: pick.reason });
  record(state, 'council', `A new era begins: ${pick.name}. ${pick.reason}`, {}, 3);
}

export const eraOn = (state, day) => [...state.eras].reverse().find((e) => e.startDay <= day) ?? state.eras[0];
