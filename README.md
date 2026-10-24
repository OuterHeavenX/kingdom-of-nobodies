# Kingdom of Nobodies — Milestone 2: The Living Society

A mobile-first, low-poly 3D medieval village where autonomous citizens work, trade, save, buy land, build
businesses, fall in love, gossip, succeed and fail. You are the village council: you can nudge the society,
but you can't control anyone.

**Play:** https://outerheavenx.github.io/kingdom-of-nobodies/

## What happens in the village

Every story in the Chronicle comes from the simulation itself. If the Chronicle says something happened,
the state behind it changed.

- **Citizens** (Ada, Bram, Cora, Dain and Elin, plus newcomers) have personalities with numeric trait strengths,
  needs, wallets, jobs, skills, dreams, memories, relationships and reputations.
- **Decisions** are utility-scored. Citizens weigh hunger, energy, loneliness, money, goals, personality,
  relationships and distance, then commit to an activity until it's done. Tap a citizen to see what they're
  doing, *why* (in their words, built from the factors that won), their goal, their next step and what else
  they considered.
- **Dreams** become step-by-step plans that adapt to circumstances. For example, Bram wants a lumberyard:
  work → save → buy a plot → build → open → profit → hire.
- **Economy**: all money is integer coins in accounts (citizens, businesses, the treasury, outside traders) and
  moves only through a recorded ledger, so the total money supply is conserved exactly. There are six
  business types (farm, lumberyard, blacksmith, bakery, tavern, general store) with production chains that
  consume inputs, plus wages, wholesale restocking, supply-and-demand pricing, competition for customers,
  trade caravans, dividends, levies and bankruptcy.
- **Property**: there are 14 plots in a land registry. Citizens reserve and buy plots atomically. Buildings go
  through visible stages (planning, foundation, frame, roof, finishing) that need timber and builder shifts.
  Failed businesses close, release staff, liquidate stock and put their property up for sale. A new owner may
  reopen, refit (e.g. stall → tavern) or demolish and rebuild.
- **Society**: directional friendship, trust, affection, rivalry and respect; courting, partners and breakups;
  gossip that spreads by conversation with witnessed/hearsay/invented sources (jealous citizens can start
  false rumours); and five reputation dimensions that affect hiring and where people shop.
- **Council**: emergency food aid, financial aid, festivals (which buy real food from local businesses), public
  cottages, business grants, a marketplace, and a business levy policy. Every action costs treasury money or
  has a trade-off. The council also performs some standing duties: it keeps the pantry stocked from local
  farms, feeds the destitute and reinvests a large surplus.

## Playing on an iPhone

1. Open the link above in Safari. To make it feel like an app, tap Share → *Add to Home Screen*.
2. Drag with one finger to orbit, pinch to zoom, and use two fingers to pan.
3. Tap a villager or a building plot in the 3D view, or use the bottom tabs: **Citizens, Economy, Buildings,
   Chronicle, Council**. Details open in a bottom sheet. Swipe it up to expand, swipe down to dismiss, or use ✕.
4. Use ⏸ and **1× / 3× / 6×** in the top bar. At 1× one in-game day takes 36 seconds.
5. Things to try: follow Bram (Citizens → Bram) and watch him save, buy Mill Row and build his lumberyard,
   usually within the first 15–40 days. Open **Buildings → Construction** to watch a site progress. Filter
   the **Chronicle** by category or tap *History* on any citizen, business or plot.
6. Council → *Kingdom & settings* has the name label toggle, *Battery saver* graphics, Save, Export, Import
   and New kingdom.

The world autosaves every minute and whenever you leave the page.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm ci
npm run dev          # development server
npm test             # unit, economy, property, save, 100-day simulation and build tests
npm run build && npm run preview   # production build on http://localhost:4173/kingdom-of-nobodies/
npm run test:e2e     # touch end-to-end test (needs Playwright + Chromium and the preview running)
```

## Architecture

The simulation is plain JavaScript over a single JSON state object with no DOM or WebGL dependencies, so it
runs identically in the browser and in Node tests. It advances in fixed 10-minute ticks, while rendering runs
at the display's frame rate.

```
src/
  main.js                 entry: boot screen hand-off
  core/                   Game (wiring, frame loop, autosave), GameClock (fixed-step speed control),
                          Config (all tuning constants), Random (seeded RNG stored in state),
                          EventBus, Serialization (checksummed save format, migration), SaveManager (IndexedDB)
  sim/                    Simulation (tick orchestrator, hourly/daily schedules), Setup (the founding)
  ai/                     CitizenBrain (activities and consequences), DecisionUtility (scoring + explanations),
                          GoalPlanner (dreams → steps → actions), Personality, MemorySystem
  citizens/               Citizen, CitizenManager (immigration, housing), Careers, Relationships (incl. romance)
  economy/                Transactions (ledger), Inventory, Businesses (types, production), Marketplace (retail,
                          wholesale, pricing, caravans), Employment (hire, fire, wages), EconomyManager (daily P&L,
                          life cycle, bankruptcy)
  property/               LandRegistry (plots), Ownership (atomic sales), Construction (stages, refits), Demolition
  society/                Chronicle, Gossip, Reputation
  council/                Council actions and standing duties
  world/                  World (renderer, lighting, day/night, picking), Terrain, Models (buildings and
                          construction stages), Villagers (figures and animation), Materials (shared caches)
  ui/                     HUD (top bar, tabs, routing), BottomSheet, Citizen/Business/Property/Chronicle/Council
                          panels, Notifications
  styles/                 main.css, panels.css, mobile.css
tests/                    node:test suites + e2e/mobile.e2e.cjs
```

Key design rules:

- **Systems change state, then record it.** For example, `buyPlot()` moves money and title, then writes the
  Chronicle entry and the plot history.
- **Deterministic**: the RNG state is saved with the world, so a reloaded world continues exactly as it would
  have (this is tested), and a 6× run is identical to a 1× run.
- **Explainable**: decision factors are numbers *and* phrases, and the explanation is assembled from the
  factors that produced the winning score.
- **Performance**: geometries and materials are shared; trees, rocks and crops are instanced; buildings rebuild
  only when their state signature changes; the HUD re-renders on a throttle and only when its HTML changes;
  pixel ratio and shadows scale with the *Battery saver* setting, which switches on automatically if the first
  seconds run slowly.

### Saves

Saves are checksummed envelopes stored in IndexedDB. Each write keeps the previous save in the same
transaction, and a copy goes to localStorage. Loading picks the newest valid copy, so a corrupted or
interrupted write never destroys the last good save. Milestone 1 saves are migrated automatically: the same
five residents keep their needs, moods and friendships, and the old treasury, food, wood, cottages and
chronicle carry over. Export and import use the same format.

### Deployment and the white-screen fix

The "white screen with words" on iPhone happened because GitHub Pages was publishing the raw repository
(`Deploy from a branch`) instead of the Vite build. The raw `index.html` points at `/src/main.js` and has no
compiled CSS. The fixes:

- **Settings → Pages → Source must be "GitHub Actions".** The workflow then publishes only `dist/`.
- The deploy workflow runs the tests and checks that `dist/index.html` references `/kingdom-of-nobodies/assets/…`
  and never `/src/` before publishing. `tests/build.test.js` checks the same thing locally.
- `index.html` has an inline-styled startup screen. If the game's files fail to load (for example, a cached old
  page pointing at assets replaced by a newer deploy), it reloads once with a fresh URL, then shows a clear
  message with a reload button.
- If WebGL is unavailable, the 3D view shows an explanation while the simulation and all panels keep working.
- The build ID (commit and time) is shown on the loading screen and at the bottom of the Council tab.
- There is no service worker, so there is no stale-cache trap.

## Known limitations

- Ageing, marriage ceremonies, children and inheritance belong to Milestone 3. The `family` fields are in
  place for them.
- The village is capped at 14 citizens and 14 plots. The architecture (central scheduler, bounded decisions,
  O(n) per tick) is meant to scale further.
- The economy is tuned for stability across seeds, not for realism. Some seeds stay small (three or four
  businesses), while others grow to eight.
- Citizens don't path around buildings; they walk in straight lines.
- The simulation pauses while the page is closed. There is no offline catch-up.
