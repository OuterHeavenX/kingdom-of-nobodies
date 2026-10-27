import { dailyFestivals } from '../culture/Festivals.js';
import { dailyCulture } from '../culture/Traditions.js';
import { considerLaws } from '../law/LegalCode.js';
import { dailyCourts, hourlyCourts } from '../law/Courts.js';
import { TIME, ECONOMY } from '../core/Config.js';
import { createKingdom } from './Setup.js';
import { updateCitizen } from '../ai/CitizenBrain.js';
import { closeDay, economySnapshot, dailyLuxuries } from '../economy/EconomyManager.js';
import { restockAll, villageFood, villageWood, spoilCarriedFood } from '../economy/Marketplace.js';
import { updateProjects } from '../property/Construction.js';
import { softenListings } from '../property/Ownership.js';
import { checkBreakups, pruneRelationships } from '../citizens/Relationships.js';
import { recomputeStanding } from '../society/Reputation.js';
import { decayRumors, createFact } from '../society/Gossip.js';
import { assignHomes } from '../citizens/CitizenManager.js';
import { maybeImmigrate, maybeEmigrate, maybeReturn } from '../population/Migration.js';
import { COUNCIL_ACTIONS, councilDaily } from '../council/Council.js';
import { dailyLifecycle, lifecycleHooks } from '../citizens/Lifecycle.js';
import { dailyFamilies, dailyParenthood, feedInfants } from '../citizens/Families.js';
import { chooseTrade, findMaster, onAdulthood } from '../education/Education.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { rehouseFamilies } from '../population/Housing.js';
import { maybeExpand } from '../population/Expansion.js';
import { dailyGovernment, onCitizenGone } from '../politics/Government.js';
import { dailyDisasters, updateFires } from '../events/Disasters.js';
import { dailyDiscovery } from '../events/Discoveries.js';
import { yearlyReview } from '../history/Eras.js';
import { compactState } from '../history/Compaction.js';
import { isNewYear, isNewSeason } from '../core/Calendar.js';
import { councilInfrastructure } from '../council/Council.js';
import { considerRoads, approveRoads } from '../navigation/RoadConstruction.js';
import { decayTraffic } from '../navigation/Traffic.js';
import { dailyRegion } from '../region/RegionManager.js';
import { dailyExploration } from '../region/Exploration.js';
import { tickTrade, dailyTrade, onMerchantGone } from '../trade/TradeManager.js';
import { dailyDiplomacy } from '../diplomacy/Diplomacy.js';
import { planCity, reviewPlans, reviewDistricts } from '../city/CityPlanner.js';
import { considerDevelopment } from '../city/UrbanDevelopment.js';
import { dailyHooks, hourlyHooks } from './Hooks.js';
import './Milestone5.js';
import '../civilization/index.js';
import '../divine/index.js';

lifecycleHooks.teen.push((state, c) => { chooseTrade(state, c); findMaster(state, c); });
lifecycleHooks.adulthood.push((state, c) => onAdulthood(state, c));
lifecycleHooks.death.push((state, c) => onCitizenGone(state, c));
lifecycleHooks.death.push((state, c) => onMerchantGone(state, c));
import { balance, totalMoney } from '../economy/Transactions.js';

/** How a would-be developer can raise money (savings and bank credit, once banks exist). */
const developmentOptions = (s) => dailyHooks.developmentFunding?.(s) ?? {};

// The simulation orchestrator. It owns the plain-JSON game state and advances
// it in fixed ticks (10 in-game minutes). It has no DOM or WebGL dependencies,
// so it runs identically in the browser and in headless tests.

export class Simulation {
  constructor(state = null) {
    this.state = state ?? createKingdom();
    this.state.events = [];
    this.listeners = new Set();
    this.selected = { kind: 'citizen', id: this.state.citizens[0]?.id ?? null };
    this.recent = [];
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  get citizens() { return this.state.citizens; }
  get averageMood() { return Math.round(this.state.citizens.reduce((s, c) => s + c.mood, 0) / Math.max(1, this.state.citizens.length)); }
  get food() { return villageFood(this.state); }
  get wood() { return villageWood(this.state); }
  get treasury() { return balance(this.state, 'treasury'); }

  /** Advance one tick. */
  step() {
    const s = this.state;
    s.tick++;
    s.minute += TIME.minutesPerTick;
    if (s.minute >= 1440) {
      s.minute -= 1440;
      this.endOfDay();
      s.day++;
      this.startOfDay();
    }
    if (s.minute % 60 === 0) this.hourly();
    for (const c of s.citizens) updateCitizen(s, c);
    tickTrade(s);
    this.processEvents();
  }

  hourly() {
    const s = this.state;
    const h = s.minute / 60;
    updateProjects(s);
    updateFires(s);
    hourlyCourts(s);
    if (h === 6 || h === 12) restockAll(s);
    for (const fn of hourlyHooks) fn(s, h);
  }

  endOfDay() {
    const s = this.state;
    closeDay(s);
    s.history.push({
      day: s.day, treasury: balance(s, 'treasury'), food: villageFood(s), wood: villageWood(s), population: s.citizens.length,
      mood: this.averageMood, open: s.businesses.filter((b) => b.status === 'OPEN' || b.status === 'STRUGGLING').length,
      wallets: s.citizens.reduce((t, c) => t + balance(s, c.id), 0),
    });
    if (s.history.length > 120) s.history.shift();
  }

  startOfDay() {
    const s = this.state;
    for (const c of s.citizens) c.shiftsToday = 0;
    dailyLifecycle(s);
    dailyFamilies(s);
    dailyParenthood(s);
    feedInfants(s);
    for (const c of s.citizens) {
      const age = ageOf(s, c);
      if (age >= LIFE.apprenticeAge && age < LIFE.adultAge && !c.education.masterId && s.day % 4 === 0) {
        if (!c.education.trade) chooseTrade(s, c);
        findMaster(s, c);
      }
    }
    yearlyReview(s);
    if (isNewYear(s.day)) compactState(s);
    dailyGovernment(s);
    dailyDisasters(s);
    dailyDiscovery(s);
    councilInfrastructure(s);
    if (s.eventLog.length > 300) s.eventLog.splice(0, s.eventLog.length - 300);
    councilDaily(s);
    maybeExpand(s);
    planCity(s);
    reviewPlans(s);
    reviewDistricts(s);
    for (const fn of dailyHooks.early) fn(s);
    considerDevelopment(s, developmentOptions(s));
    dailyLuxuries(s);
    dailyRegion(s);
    dailyExploration(s);
    dailyTrade(s);
    dailyDiplomacy(s);
    considerLaws(s);
    dailyCourts(s);
    dailyCulture(s, { dailyFestivals, isNewSeason, isNewYear });
    considerRoads(s);
    approveRoads(s);
    decayTraffic(s);
    maybeImmigrate(s);
    maybeEmigrate(s);
    if (isNewSeason(s.day)) maybeReturn(s);
    checkBreakups(s);
    if (s.day % 3 === 0) pruneRelationships(s);
    recomputeStanding(s);
    decayRumors(s);
    softenListings(s);
    assignHomes(s);
    rehouseFamilies(s);
    for (const fn of dailyHooks.late) fn(s);
    spoilCarriedFood(s);
    s.commons.forest = Math.min(s.commons.forestCap, s.commons.forest + 9);
    s.commons.berries = Math.min(s.commons.berriesCap, s.commons.berries + 26);
  }

  processEvents() {
    const s = this.state;
    if (!s.events.length) return;
    for (const e of s.events) {
      if (e.type === 'rumor') {
        const a = s.citizens.find((c) => c.id === e.subject), b = s.citizens.find((c) => c.id === e.other);
        if (a && b) {
          const text = e.kind === 'courting' ? `${a.firstName} and ${b.firstName} are courting.` : `${a.firstName} and ${b.firstName} broke up.`;
          createFact(s, e.kind, a.id, text, [a.id, b.id], b.id);
        }
      } else if (e.type === 'chronicle') {
        this.recent.push(e.entry);
      }
    }
    if (this.recent.length > 30) this.recent.splice(0, this.recent.length - 30);
    s.events = [];
  }

  /** Run many ticks without rendering (tests, catch-up). */
  runTicks(n) { for (let i = 0; i < n; i++) this.step(); }
  runDays(days) { this.runTicks(days * TIME.ticksPerDay); }

  council(action, ...args) {
    const fn = COUNCIL_ACTIONS[action];
    const result = fn ? fn(this.state, ...args) : { ok: false, message: 'Unknown action' };
    this.processEvents();
    this.emit();
    return result;
  }

  select(kind, id) { this.selected = { kind, id }; this.emit(); }

  snapshot() { return { ...economySnapshot(this.state), money: totalMoney(this.state) }; }
}
