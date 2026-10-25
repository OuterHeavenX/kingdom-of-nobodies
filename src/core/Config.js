// Central tuning constants. Every economic and behavioural number lives here so
// the simulation can be balanced without hunting through system code.

/** Coins held by the wider world beyond the region (the 'outside' account) at the founding. */
export const WIDER_WORLD = 250000;
export const SAVE_VERSION = 7;

export const TIME = {
  minutesPerTick: 10,
  ticksPerDay: 144,
  realSecondsPerTick: 0.25, // at 1× speed one in-game day lasts 36 seconds
  speeds: [1, 3, 6, 20],
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

export const MOVE = { unitsPerTick: 2.6, arriveDistance: 0.6 };

export const POPULATION = {
  max: 250,
  hallBeds: 10,
  cottageBeds: 4,
  houseBeds: 6,
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
  stone: { label: 'Stone', icon: '🧱', base: 2 },
};

export const FOOD_GOODS = ['meal', 'bread', 'grain', 'berries'];

export const ECONOMY = {
  wholesaleFactor: 0.7,
  priceMin: 0.65,
  priceMax: 1.6,
  priceStepPerDay: 0.12,
  dividendShare: 0.2,
  tax: { low: 0, normal: 1, high: 3 },
  taxMood: { low: 1.5, normal: 0, high: -3 },
  tithe: { low: 0.01, normal: 0.02, high: 0.04 }, // daily share of savings above titheFloor
  titheFloor: 60,
  treasuryComfort: 300,
  caravanEveryDays: 3,
  caravanBuyFactor: 0.75,
  caravanMaxUnitsPerGood: 10,
  caravanGrainPrice: 3,
  liquidationFactor: 0.5,
  oreImportPrice: 2,
  startingCapital: 14,
  struggleDays: 3,
  closeAfterStruggleDays: 7,
  luxuryReserve: 1500, // savings above this are slowly spent on goods from beyond the valley
  luxuryShare: 0.01, // share of the excess spent each day
  maxOpenPerType: 3,
  maxActiveProjects: 3,
  minWage: 4,
  toolUses: 12,
  toolBoost: 1.3,
  councilPantryPrice: 1,
  councilPantryMax: 60,
};

export const WAGES = {
  Farmer: 6, Woodcutter: 7, Builder: 6, Forager: 5, Baker: 7, Blacksmith: 8,
  Merchant: 6, Innkeeper: 6, Laborer: 5, Teacher: 6,
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
  courtAffection: 55,
  partnerAffection: 72,
  partnerDays: 4,
  breakupTrust: 22,
  rumorShareChance: 0.6,
  rumorDecay: 0.7,
  maxBeliefs: 14,
  maxMemories: 14,
  cheatChance: 0.25,
  cheatNoticeChance: 0.5,
};

export const CHRONICLE = { max: 900, keepImportant: 200 }; // Milestone 5 records more institutions, wars and plans
export const LEDGER = { max: 260 };

export const COUNCIL = {
  aidAmount: 10,
  foodAidUnits: 6,
  festivalBudget: 24,
  festivalCooldownDays: 4,
  businessGrant: 20,
  marketplaceCost: 60,
  publicCottageBudget: 30,
  reserve: 120,
};

// ---------------------------------------------------------------------------
// Milestone 3: Legacy & Generations
// ---------------------------------------------------------------------------

// A year has four seasons. Short seasons let generations unfold in a play
// session: at 1x one year lasts about 7 minutes, at 20x about 22 seconds.
export const CALENDAR = {
  daysPerSeason: 3,
  seasons: ['Spring', 'Summer', 'Autumn', 'Winter'],
};
export const DAYS_PER_YEAR = CALENDAR.daysPerSeason * CALENDAR.seasons.length;

export const LIFE_STAGES = [
  { id: 'infant', label: 'Infant', from: 0 },
  { id: 'child', label: 'Child', from: 3 },
  { id: 'teen', label: 'Teenager', from: 13 },
  { id: 'young', label: 'Young adult', from: 18 },
  { id: 'adult', label: 'Adult', from: 30 },
  { id: 'elder', label: 'Elder', from: 60 },
];

export const LIFE = {
  adultAge: 18,
  apprenticeAge: 13,
  retireAge: 62,
  fertileFrom: 19,
  fertileTo: 44,
  pregnancyDays: 9,          // three seasons
  minDaysBetweenBirths: 18,  // 1.5 years
  maxChildren: 5,
  marriageMinAge: 18,
  // Gompertz mortality: yearly death probability = a * exp(b * age).
  gompertzA: 0.00012,
  gompertzB: 0.088,
  infantYearlyRisk: 0.02,
  starvationDailyRisk: 0.02,
};

export const FAMILY = {
  engagementAfterDays: 6,
  weddingAfterDays: 4,
  divorceTrust: 18,
  childCostPerDay: 1,
};

export const EDUCATION = {
  lessonGain: 0.012,
  schoolBonus: 2,
  apprenticeGainMultiplier: 2.5,
  apprenticeStipend: 2,
  mentorGain: 0.02,
  teacherWage: 6,
};

export const POLITICS = {
  firstElectionAdults: 10,
  termYears: 4,
  campaignDays: 6,
  maxCandidates: 3,
  protestApproval: 30,
  resignApproval: 18,
  embezzleChancePerSeason: 0.35,
};

export const EVENTS = {
  fireDailyPerBuilding: 0.0009,
  fireDurationTicks: 8,
  cropFailureChance: 0.12,
  harshWinterChance: 0.15,
  diseaseDailyChance: 0.0025,
  diseaseSpread: 0.12,
  recessionChance: 0.07,
};

export const HISTORY = {
  chronicleMax: 900,
  minEraYears: 6,
};

// ---------------------------------------------------------------------------
// Milestone 5: The Age of Empires & Prosperity
// ---------------------------------------------------------------------------

export const CITY = {
  reviewEveryDays: 3,
  maxProceduralDistricts: 14,
  maxSpeculativeHomes: 2, // cottages built for sale at any one time
  developerMinWealth: 140,
  homeSalePremium: 1.15, // asking price of a new cottage over its land and materials
};

export const FINANCE = {
  // Rates are per year; interest accrues once per season on whole coins.
  depositRate: 0.03,
  baseLoanRate: 0.08,
  maxRiskPremium: 0.14,
  reserveRatio: 0.25, // a bank keeps at least this share of deposits as cash
  cashCushion: 50, // a citizen keeps this much in hand before depositing
  depositAbove: 90,
  maxTermSeasons: 16,
  penaltyRate: 0.05,
  missedForDefault: 3,
  bankFoundingCapital: 120,
  savingsHouseCapital: 160,
  clerkWage: 4,
  maxLoansPerBorrower: 2,
};

export const INSTITUTIONS = {
  guildMinMembers: 3,
  guildDuesPerSeason: 1, // a season is three days: about four coins a year
  guildHallCost: 140,
  faithMinMembers: 3,
  charityMealUnits: 3,
};

export const MILITARY = {
  soldierUpkeep: 0.05, // coins per soldier per day (wages, equipment repair) paid out of the treasury
  foodPerHundredSoldiers: 7,
  marchKmh: 3.2,
  maxWarDays: 36, // three years: exhaustion forces a settlement before this
  garrisonShare: 0.04,
  mobiliseShare: 0.12,
  militiaWage: 3,
};
