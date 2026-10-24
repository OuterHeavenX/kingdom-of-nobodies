// Central tuning constants. Every economic and behavioural number lives here so
// the simulation can be balanced without hunting through system code.

export const SAVE_VERSION = 3;

export const TIME = {
  minutesPerTick: 10,
  ticksPerDay: 144,
  realSecondsPerTick: 0.25, // at 1× speed one in-game day lasts 36 seconds
  speeds: [1, 3, 6],
  maxTicksPerFrame: 12,
  dayStartHour: 6,
  workStartHour: 6,
  workEndHour: 18,
  shopOpenHour: 6,
  shopCloseHour: 20,
  tavernCloseHour: 23,
  nightStartHour: 22,
};

export const NEEDS = {
  hungerDecay: 0.34, // fullness lost per tick (~49 per day)
  energyDecay: 0.42,
  sleepGain: 1.25,
  socialDecay: 0.22,
  criticalHunger: 12,
  criticalEnergy: 6,
};

export const MOVE = { unitsPerTick: 1.6, arriveDistance: 0.6 };

export const POPULATION = {
  max: 14,
  hallBeds: 8,
  cottageBeds: 2,
  immigrationEveryDays: 3,
  immigrantMinCoins: 14,
  immigrantMaxCoins: 34,
};

// Goods: base price is the fair retail price in coins. `food` is fullness restored.
export const GOODS = {
  grain: { label: 'Grain', icon: '🌾', base: 2, food: 22 },
  berries: { label: 'Berries', icon: '🫐', base: 2, food: 18 },
  bread: { label: 'Bread', icon: '🍞', base: 3, food: 38 },
  meal: { label: 'Hot meal', icon: '🍲', base: 5, food: 52, social: 12 },
  timber: { label: 'Timber', icon: '🪵', base: 3 },
  ore: { label: 'Ore', icon: '🪨', base: 2 },
  tools: { label: 'Tools', icon: '🔨', base: 9 },
};

export const FOOD_GOODS = ['meal', 'bread', 'grain', 'berries'];

export const ECONOMY = {
  wholesaleFactor: 0.7,
  priceMin: 0.65,
  priceMax: 1.6,
  priceStepPerDay: 0.12,
  dividendShare: 0.35,
  tax: { low: 0, normal: 1, high: 3 },
  taxMood: { low: 1.5, normal: 0, high: -3 },
  caravanEveryDays: 3,
  caravanBuyFactor: 0.75,
  caravanMaxUnitsPerGood: 10,
  caravanGrainPrice: 3,
  liquidationFactor: 0.5,
  oreImportPrice: 2,
  startingCapital: 14,
  struggleDays: 3,
  closeAfterStruggleDays: 7,
  maxOpenPerType: 2,
  maxActiveProjects: 3,
  minWage: 4,
  toolUses: 12,
  toolBoost: 1.3,
  councilPantryPrice: 1,
  councilPantryMax: 30,
};

export const WAGES = {
  Farmer: 6, Woodcutter: 7, Builder: 6, Forager: 5, Baker: 7, Blacksmith: 8,
  Merchant: 6, Innkeeper: 6, Laborer: 5,
};

// Construction stages after PLANNING. Work is in labour units; a builder shift adds ~3.
export const STAGES = [
  { name: 'FOUNDATION', work: 8, timber: 2 },
  { name: 'FRAME', work: 12, timber: 4 },
  { name: 'ROOF', work: 10, timber: 3 },
  { name: 'FINISHING', work: 6, timber: 1 },
];
export const REFIT_STAGE = { name: 'FINISHING', work: 6, timber: 1 };
export const DEMOLITION = { work: 8, salvageTimber: 2 };
export const BUILD = {
  builderWorkPerShift: 3,
  ownerWorkPerShift: 2,
  maxWorkersPerShift: 3,
  builderWage: 5,
};

export const SOCIAL = {
  friendGain: 6,
  coworkerGain: 1.5,
  courtAffection: 62,
  partnerAffection: 80,
  partnerDays: 4,
  breakupTrust: 22,
  rumorShareChance: 0.6,
  rumorDecay: 0.7,
  maxBeliefs: 14,
  maxMemories: 14,
  cheatChance: 0.25,
  cheatNoticeChance: 0.5,
};

export const CHRONICLE = { max: 420, keepImportant: 160 };
export const LEDGER = { max: 260 };

export const COUNCIL = {
  aidAmount: 10,
  foodAidUnits: 6,
  festivalBudget: 24,
  festivalCooldownDays: 4,
  businessGrant: 20,
  marketplaceCost: 60,
  publicCottageBudget: 30,
  reserve: 160,
};
