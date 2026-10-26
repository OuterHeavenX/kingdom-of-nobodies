import { isNewSeason, isNewYear } from '../core/Calendar.js';
import { byId } from '../core/EntityRegistry.js';
import { dailyHooks, hourlyHooks } from '../sim/Hooks.js';
import { milestone5Setup } from '../sim/Setup.js';
import { activityHooks } from '../ai/CitizenBrain.js';
import { candidateHooks } from '../ai/DecisionUtility.js';
import { healthHooks } from '../events/Disasters.js';
import { productionHooks, producedHooks } from '../economy/Businesses.js';
import { hiringHooks } from '../economy/Employment.js';
import { skillHooks } from '../education/Skills.js';
import { casualtyHooks } from '../military/BattleResolver.js';
import { navHooks } from '../navigation/NavigationGrid.js';
import { obstacleHooks } from '../city/RoadPlanner.js';
import { roadObstacleHooks } from '../navigation/RoadConstruction.js';
import { ensureDivine, regenerateWhispers, pruneEffects, activeEffects } from './State.js';
import { worldviewOf, socialIndex, reconsider, considerFaith, evolveOutlook } from './Worldview.js';
import { stoneRects, hourlyStone, dailyStone } from './Stone.js';
import { chatAboutStone, reviewRoles, teachChildren, considerMissions, returnMissions } from './Spread.js';
import { seasonalSocieties, considerSplit, siteWorks, membershipLean } from './Movements.js';
import { dailyPrayers, closePrayersOf } from './Prayers.js';
import { lifecycleHooks } from '../citizens/Lifecycle.js';
import { emigrationHooks } from '../population/Migration.js';
import { dailyBlessings, illnessFactor, protectFactor, battleFactor, productionFactor, noteProduced, hiringBonus } from './Blessings.js';
import { proposeActivities, adjustForCourage, BEGIN, FINISH } from './Activities.js';

// v0.5.3 — The Hidden Hand. Wires the divine layer into the simulation's
// schedules and extension points. Everything here runs on the simulation's
// own day and hour; nothing runs per rendered frame.

/** Citizens currently learning faster under Inspiration (gainSkill has no state, so it is indexed here). */
const inspired = new WeakSet();
const inspiredByState = new WeakMap();
function refreshInspired(state) {
  for (const c of inspiredByState.get(state) ?? []) inspired.delete(c);
  const now = activeEffects(state, 'inspiration').map((e) => byId(state.citizens, e.target)).filter(Boolean);
  for (const c of now) inspired.add(c);
  inspiredByState.set(state, now);
}

export function dailyDivine(state) {
  const d = ensureDivine(state);
  regenerateWhispers(state);
  for (const c of state.citizens) worldviewOf(state, c);
  dailyBlessings(state);
  pruneEffects(state);
  refreshInspired(state);
  dailyPrayers(state);
  if (d.stone) dailyStone(state);
  returnMissions(state);
  if (isNewSeason(state.day) && d.stone?.discovered) {
    const idx = socialIndex(state);
    for (const c of state.citizens) if (c.worldview?.stone) reconsider(state, c, idx, (x) => membershipLean(state, x));
    for (const c of state.citizens) considerFaith(state, c);
    seasonalSocieties(state);
    siteWorks(state);
    considerMissions(state);
  }
  if (isNewYear(state.day)) {
    for (const c of state.citizens) evolveOutlook(state, c);
    reviewRoles(state);
    teachChildren(state);
    considerSplit(state);
  }
}

function hourlyDivine(state) {
  if (!state.divine) return;
  if (state.divine.stone) hourlyStone(state);
}

// --- Wiring -----------------------------------------------------------------------------

// New kingdoms and migrated saves: the divine layer, and a worldview for everyone already living.
milestone5Setup.push((state) => { ensureDivine(state); for (const c of state.citizens) worldviewOf(state, c); });
dailyHooks.late.push(dailyDivine);
hourlyHooks.push(hourlyDivine);

activityHooks.chat.push(chatAboutStone);
Object.assign(activityHooks.begin, BEGIN);
Object.assign(activityHooks.finish, FINISH);
candidateHooks.propose.push(proposeActivities);
candidateHooks.adjust.push(adjustForCourage);

healthHooks.illness = (state, c) => (state.divine ? illnessFactor(state, c) : 1);
healthHooks.protect = (state, c) => (state.divine?.effects?.length ? protectFactor(state, c) : 1);
casualtyHooks.guard = (state, c) => (state.divine?.effects?.length ? battleFactor(state, c) : 1);
productionHooks.push(productionFactor);
producedHooks.push(noteProduced);
hiringHooks.push(hiringBonus);
skillHooks.push((c) => (inspired.has(c) ? 1.5 : 1));

lifecycleHooks.death.push((state, c) => closePrayersOf(state, c, 'they died'));
emigrationHooks.push((state, c) => closePrayersOf(state, c, 'they left the valley'));

navHooks.solids.push(stoneRects);
obstacleHooks.push(stoneRects);
roadObstacleHooks.push(stoneRects);

export { ensureDivine };
