import { yearOf } from '../core/Calendar.js';
import { record } from '../society/Chronicle.js';
import { KINGDOMS } from '../region/RegionData.js';
import { ensureCulture, FESTIVALS } from './Festivals.js';

// Traditions grow out of the village's own history, never at random: a family
// that sponsors the harvest feast year after year, the day the last founder
// died, a fire nobody forgets, merchants who make the Midsummer Fair their own,
// ruins the scouts found. Customs also travel: long trade, good relations and
// newcomers from a kingdom bring its ways to First Hearth.

const CUSTOMS = {
  greenvale: { name: 'Greenvale harvest dances', season: 2, text: 'learned from Greenvale traders and settlers' },
  ironhold: { name: 'Ironhold forge-fire songs', season: 3, text: 'brought by Ironhold miners who settled here' },
  saltmere: { name: 'Saltmere lantern boats', season: 1, text: 'floated on the river as they do in Saltmere' },
};

function found(state, t) {
  const culture = ensureCulture(state);
  if (culture.traditions.some((x) => x.id === t.id)) return null;
  const tradition = { active: true, foundedDay: state.day, foundedYear: yearOf(state.day), observed: 0, ...t };
  culture.traditions.push(tradition);
  record(state, 'culture', `A new tradition: ${tradition.name}. ${tradition.origin}`, {}, 3);
  return tradition;
}

/** Yearly (and after festivals): look for history that has become tradition. */
export function considerTraditions(state) {
  const culture = ensureCulture(state);
  // A house that sponsors the Harvest Festival two years running makes it theirs.
  const harvest = culture.sponsors.filter((s) => s.season === 2).slice(-2);
  if (harvest.length === 2 && harvest[0].house === harvest[1].house && harvest[1].year - harvest[0].year === 1) {
    found(state, { id: `sponsor-${harvest[1].house}`, kind: 'sponsorship', house: harvest[1].house, season: 2, name: `The ${harvest[1].house} Harvest Feast`, origin: `The ${harvest[1].house} family has paid for the harvest feast two years running; it is expected of them now.` });
  }
  // Founders' Day, once the last of the five has died.
  if (!state.citizens.some((c) => c.founder) && Object.values(state.archive).some((p) => p.founder)) {
    found(state, { id: 'founders-day', kind: 'remembrance', season: 0, name: "Founders' Day", origin: 'With the last of the five founders gone, the Festival of Renewal now begins at their memorial.' });
  }
  // A great fire is remembered at Hearthlight.
  const fireEra = state.eras.find((e) => /Great Fire/.test(e.name));
  if (fireEra) found(state, { id: 'fire-remembrance', kind: 'remembrance', season: 3, name: 'The Night of Lanterns', origin: `Since ${fireEra.name}, Hearthlight begins with lanterns for the homes that burned.` });
  // Merchants who keep trading make the Midsummer Fair their market.
  const merchants = Object.values(state.trade?.merchants ?? {}).filter((m) => m.trips >= 3).length;
  if (merchants >= 2) found(state, { id: 'merchants-market', kind: 'guild', season: 1, name: "The Merchants' Market", origin: `${merchants} of the village's merchants now host the Midsummer Fair, inviting traders from every kingdom.` });
  // Scouts' discoveries enter the stories told at Hearthlight.
  if (state.region?.discovered?.landmarks.includes('old-caer')) found(state, { id: 'caer-tales', kind: 'storytelling', season: 3, name: 'Tales of Old Caer', origin: 'Elders tell of the ruined fort the scouts found, and children dare each other to visit it.' });
  // Living traditions pass to the next generation; a family tradition lapses only when the family is gone.
  for (const t of culture.traditions.filter((x) => x.kind === 'sponsorship' && x.active)) {
    if (!state.citizens.some((c) => c.lastName === t.house)) { t.active = false; t.lapsedYear = yearOf(state.day); record(state, 'culture', `${t.name} lapsed: no one of the ${t.house} family remains.`, {}, 2); }
  }
}

/** Seasonal: trade, settlers and friendship carry foreign customs here. */
export function culturalExchange(state) {
  const culture = ensureCulture(state);
  if (!state.region || !state.diplomacy) return;
  for (const id of Object.keys(KINGDOMS)) {
    const traded = state.diplomacy.tradeLog[['hearth', id].sort().join('|')] ?? 0;
    const settlers = state.diplomacy.flows[`${id}>hearth`] ?? 0;
    const relation = state.diplomacy.relations[['hearth', id].sort().join('|')]?.score ?? 0;
    culture.exchange.exposure[id] = Math.round(((culture.exchange.exposure[id] ?? 0) * 0.9 + traded / 100 + settlers * 0.5) * 10) / 10;
    if (culture.exchange.exposure[id] >= 12 && relation >= 25 && !culture.exchange.adopted.includes(id)) {
      culture.exchange.adopted.push(id);
      const c = CUSTOMS[id];
      found(state, { id: `custom-${id}`, kind: 'custom', origin: `${c.name.charAt(0).toUpperCase() + c.name.slice(1)}, ${c.text}, are now part of the ${FESTIVALS[c.season].name}.`, season: c.season, name: c.name, from: id });
    }
  }
}

/** Mark the traditions observed at a festival (called when it concludes). */
export function observeTraditions(state, festival) {
  for (const t of ensureCulture(state).traditions.filter((x) => x.active && x.season === festival.season)) { t.observed++; t.lastObserved = festival.year; }
}

/** Daily: run the festival calendar, then notice what has become tradition. */
export function dailyCulture(state, { dailyFestivals, isNewSeason, isNewYear }) {
  const culture = ensureCulture(state);
  const held = culture.history.length;
  dailyFestivals(state);
  if (culture.history.length > held) { observeTraditions(state, culture.history.at(-1)); considerTraditions(state); }
  if (isNewSeason(state.day)) culturalExchange(state);
  if (isNewYear(state.day)) considerTraditions(state);
}
