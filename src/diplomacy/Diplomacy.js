import { HEARTH } from '../region/RegionData.js';

// Foreign relations (filled out in the diplomacy stage). Trade asks two things
// of diplomacy: what tariff a destination charges a trader, and whether a
// trade or a road is open to them at all.

const LOCAL_TARIFF = { low: 0.03, normal: 0.06, high: 0.12 };

/** Import tariff a destination charges a trader from `fromHome`. */
export function tariffRate(state, destination, fromHome) {
  if (destination === fromHome) return 0;
  if (destination === HEARTH) return LOCAL_TARIFF[state.government?.policies?.tariffLevel ?? 'normal'] ?? 0.06;
  return state.region.settlements[destination].tariff;
}

/** May a trader from `home` buy in `origin` and sell in `destination`? Returns a reason when not. */
export function tradeBlocked(state, origin, destination, home) { return null; }

/** May a trader from `home` use this route? */
export const routeAllowed = (state, home) => () => true;
