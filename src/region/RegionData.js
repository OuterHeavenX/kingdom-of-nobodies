// Static geography and the founding character of each neighbouring kingdom.
// Map coordinates are kilometres on a 100 × 100 regional map; First Hearth's
// valley is the small square around (50, 55).

export const HEARTH = 'hearth';

// Commodities traded across the region. `food` marks what feeds people; the
// village can buy or sell the ones with a `local` good of the same name.
export const COMMODITIES = {
  grain: { label: 'Grain', icon: '🌾', base: 2, food: true, local: true, perishable: 0.004 },
  provisions: { label: 'Livestock goods', icon: '🧀', base: 4, food: true, perishable: 0.02 },
  fish: { label: 'Fish', icon: '🐟', base: 3, food: true, perishable: 0.05 },
  salt: { label: 'Salt', icon: '🧂', base: 4 },
  ore: { label: 'Ore', icon: '🪨', base: 2, local: true },
  iron: { label: 'Iron', icon: '⛓️', base: 5 },
  stone: { label: 'Stone', icon: '🧱', base: 2, local: true },
  tools: { label: 'Tools', icon: '🔨', base: 9, local: true },
  timber: { label: 'Timber', icon: '🪵', base: 3, local: true },
  luxuries: { label: 'Luxuries', icon: '💎', base: 14 },
};
export const FOOD_COMMODITIES = Object.keys(COMMODITIES).filter((k) => COMMODITIES[k].food);

// Per 100 people per day. Inputs are consumed to make an output (ore → iron → tools).
export const KINGDOMS = {
  greenvale: {
    name: 'Greenvale', identity: 'Agricultural kingdom', geography: 'Fertile plains', x: 17, y: 60, color: '#7fb069',
    population: 240, capacity: 420, account: 'k:greenvale',
    produces: { grain: 9.5, provisions: 3, timber: 0.4 },
    needs: { tools: 0.25, iron: 0.1, timber: 1.0, salt: 0.3, luxuries: 0.05 },
    vulnerability: 'Poor harvests swing food prices.',
    politics: 'A council of farming families that prefers cooperation.',
    leaderTitle: 'High Steward', stances: ['cooperative', 'cooperative', 'mercantile'],
    leaders: ['Maren Fallowfield', 'Orrin Haybrook', 'Tamsin Greaves', 'Willem Hollin', 'Bryony Thatch', 'Cedric Oakes'],
    festival: 'Greenvale Harvest Fair',
  },
  ironhold: {
    name: 'Ironhold', identity: 'Mountain realm', geography: 'Mountains and mines', x: 57, y: 14, color: '#8a8f9c',
    population: 180, capacity: 320, account: 'k:ironhold',
    produces: { ore: 8, iron: 3, stone: 5, tools: 1.1, grain: 0.8, provisions: 1.2 },
    inputs: { iron: { ore: 2 }, tools: { iron: 0.6 } },
    needs: { timber: 1.6, salt: 0.3, luxuries: 0.08 },
    vulnerability: 'Imports most of its food.',
    politics: 'Mining guilds and powerful merchants share power.',
    leaderTitle: 'Guildmaster', stances: ['mercantile', 'protectionist', 'mercantile'],
    leaders: ['Dagna Stonehelm', 'Brannoc Deepvein', 'Hilde Anvilsworth', 'Garrick Coldforge', 'Sigrun Orebrand', 'Tobin Slate'],
    festival: 'Ironhold Forge Feast',
  },
  saltmere: {
    name: 'Saltmere', identity: 'Coastal trading republic', geography: 'Harbour and coast', x: 84, y: 84, color: '#5fa8c4',
    population: 300, capacity: 480, account: 'k:saltmere',
    produces: { fish: 6.2, salt: 3, luxuries: 0.6, grain: 0.6 },
    needs: { timber: 1.2, tools: 0.3, iron: 0.1, luxuries: 0.15 },
    vulnerability: 'Lives on trade; disrupted routes hurt merchant income.',
    politics: 'A commercial council whose trade priorities shift with fortune.',
    leaderTitle: 'Doge', stances: ['mercantile', 'mercantile', 'cooperative', 'protectionist'],
    leaders: ['Lucan Brightwater', 'Isadora Vell', 'Marco Saltreeve', 'Nerys Tidewell', 'Pell Harrowgate', 'Odile Marr'],
    festival: 'Saltmere Lantern Regatta',
  },
};
export const FOOD_NEED = 6; // food units per 100 people per day

export const SETTLEMENT_POS = {
  [HEARTH]: { x: 50, y: 55 },
  ...Object.fromEntries(Object.entries(KINGDOMS).map(([id, k]) => [id, { x: k.x, y: k.y }])),
};

// Regional routes. Terrain and quality set travel speed; `crossing` marks the
// river at First Hearth's south gate (ford or bridge); `territory` is whose
// land the road runs through (transit rights). Hidden routes must be scouted.
export const ROUTES = [
  { id: 'greenvale-road', a: HEARTH, b: 'greenvale', name: 'Greenvale Road', km: 34, terrain: 'plains', quality: 'dirt', gate: 'west', points: [[50, 55], [36, 57], [17, 60]] },
  { id: 'ironhold-pass', a: HEARTH, b: 'ironhold', name: 'Ironhold Pass', km: 44, terrain: 'mountain', quality: 'track', gate: 'north', points: [[50, 55], [53, 40], [52, 26], [57, 14]] },
  { id: 'coast-road', a: HEARTH, b: 'saltmere', name: 'Coast Road', km: 46, terrain: 'coast', quality: 'dirt', gate: 'south', crossing: true, points: [[50, 55], [52, 63], [68, 74], [84, 84]] },
  { id: 'mill-track', a: 'greenvale', b: 'ironhold', name: 'Old Mill Track', km: 52, terrain: 'forest', quality: 'track', territory: 'greenvale', points: [[17, 60], [24, 38], [40, 22], [57, 14]] },
  { id: 'river-road', a: 'greenvale', b: 'saltmere', name: 'River Road', km: 74, terrain: 'plains', quality: 'dirt', territory: 'greenvale', points: [[17, 60], [30, 76], [56, 80], [84, 84]] },
  { id: 'highland-way', a: 'ironhold', b: 'saltmere', name: 'Highland Way', km: 40, terrain: 'mountain', quality: 'track', hidden: true, territory: 'ironhold', points: [[57, 14], [74, 32], [86, 58], [84, 84]] },
];

export const TERRAIN_SPEED = { plains: 1, forest: 0.85, coast: 0.95, mountain: 0.62 };
export const QUALITY_SPEED = { track: 0.75, dirt: 1, stone: 1.3 };
export const CART_KMH = 4.2;

// Features of the map, some unknown until scouted.
export const LANDMARKS = [
  { id: 'old-caer', name: 'Ruins of Old Caer', x: 31, y: 30, kind: 'ruins', hidden: true, text: 'A broken hill fort older than any kingdom; its stones tell of a forgotten realm.' },
  { id: 'greyfell-quarry', name: 'Greyfell Outcrop', x: 40, y: 44, kind: 'resource', hidden: true, resource: 'stone', text: 'Good building stone within a day of the village. The council may open a quarry.' },
  { id: 'shepherds-bridge', name: "Shepherd's Bridge", x: 30, y: 76, kind: 'bridge', hidden: true, text: 'An old stone bridge on the River Road, sound enough for carts.' },
  { id: 'highland-cairns', name: 'Highland Cairns', x: 76, y: 38, kind: 'route', hidden: true, revealsRoute: 'highland-way', text: 'Cairns marking a forgotten pass between Ironhold and the coast.' },
  { id: 'sunken-mere', name: 'Sunken Mere', x: 66, y: 66, kind: 'lake', text: 'A reedy lake where the Hearth river slows before reaching the sea.' },
  { id: 'iron-hills', name: 'Iron Hills', x: 62, y: 22, kind: 'mountain', text: 'The mountains of Ironhold.' },
];

// Fixed scenery for the map renderer (rivers, mountains, forests, coast).
export const SCENERY = {
  river: [[2, 62], [30, 68], [48, 64], [52, 63], [66, 66], [78, 76], [92, 86], [100, 90]],
  coast: [[70, 100], [76, 92], [90, 80], [100, 72]],
  mountains: [[48, 10], [55, 8], [62, 12], [66, 20], [58, 24], [45, 18], [70, 30], [78, 34], [82, 44]],
  forests: [[26, 40, 9], [42, 32, 7], [62, 48, 6], [20, 82, 6]],
};

// Lands two neighbours both have reason to want. Each lies along a real road;
// armies contesting it meet at its middle. `controller` holds it at the founding.
// Each kingdom holds one land at the founding and claims another, so none
// begins as everyone's defender.
export const DISPUTED_LANDS = [
  { id: 'mill-corridor', name: 'the Old Mill corridor', route: 'mill-track', claimants: ['greenvale', 'ironhold'], controller: 'greenvale', x: 32, y: 30, resource: 'timber', value: 140, text: 'Forested valleys along the Old Mill Track: timber for Ironhold\'s mines, pasture for Greenvale.' },
  { id: 'highland-pass', name: 'the Highland Pass', route: 'highland-way', claimants: ['ironhold', 'saltmere'], controller: 'ironhold', x: 78, y: 40, resource: 'stone', value: 110, text: 'The high road between the mines and the sea, and the tolls on it.' },
  { id: 'river-meadows', name: 'the River Meadows', route: 'river-road', claimants: ['greenvale', 'saltmere'], controller: 'saltmere', x: 43, y: 79, resource: 'grain', value: 120, text: 'Rich water meadows on the River Road, where Greenvale\'s fields meet Saltmere\'s salt pans.' },
];
