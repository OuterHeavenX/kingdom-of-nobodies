# Kingdom of Nobodies — Milestone 3: Legacy & Generations

A mobile-first, low-poly 3D medieval settlement that lives for generations. Five strangers light a hearth.
Their children grow up, learn trades, marry, inherit the family bakery or sell it, run for office, survive
fires and fevers, and are remembered in the chronicle long after they die. You are the council: you can
nudge the society, but you can't control anyone.

**Play:** https://outerheavenx.github.io/kingdom-of-nobodies/ · version 0.3.0

## What happens across the generations

Every story in the chronicle comes from the simulation itself. If the chronicle says something happened,
the state behind it changed.

- **Time and life.** A year has four seasons of three days (a year is about 7 minutes at 1×, or 22 seconds at
  20×). Every citizen has a birth day. Age, life stage (infant, child, teen, young adult, adult, elder) and
  birthdays all follow from it. Mortality rises with age (a Gompertz curve) and also with hunger, illness
  and accidents. Death is processed once: the job ends, the spouse is widowed, kin mourn, wards are
  re-homed, the estate is settled, and the person moves to the archive with their full biography.
- **Families.** Attraction, courtship, engagement, marriage at the Hearth Hall, divorce and widowhood.
  Couples decide whether they want children. Pregnancy lasts three seasons. Children inherit blended
  personality traits and appearance with some variation. Orphans become council wards and may be adopted.
  Family trees are acyclic by construction, and every house (family name) is ranked by its wealth, land,
  businesses, terms in office and achievements.
- **Education and careers.** Children take lessons at home, or at the school once one is built. Teens choose a
  trade and apprentice under a master, and mentors pass on skills. Skills grow only through practice: work
  shifts, lessons and apprenticeships. Elders retire and hand over their business.
- **Inheritance and succession.** Coins are split between the spouse and children. Land and buildings pass to the
  main heir, and so do unfinished construction projects. A business goes to the best-suited heir, is held in
  trust for a minor, or is sold. Nothing is duplicated: the money supply is conserved across every death
  (this is tested).
- **Government.** Once ten adults live in the settlement, it elects a Village Elder (later a Mayor, a Lord Mayor and finally a Lord Protector).
  The election runs like this:
  - Candidates campaign on platforms built from the issues they care about. Factions (the Merchant Guild, the
    Workers' Coalition, the Landowners' Association, the Traditionalists and the Reformers) endorse candidates.
  - Every adult casts a ballot at the hall during the campaign. The tally is deterministic, and a term lasts
    four years.
  - Ten policies change real variables: taxes and the tithe, food assistance, public housing, unemployment
    relief, the public works crew, market fees, construction grants, business licensing, public schooling
    and apprenticeship grants.
  - Approval responds to how people are living. Leaders can embezzle and be caught, protests can force a
    resignation, and a crisis makes the leader restore food assistance.
- **Population and the town.** Births, deaths, immigration (families of one to four people, drawn by jobs,
  housing and happiness) and emigration (after a long stretch of unhappiness).
  - Housing is a real constraint: families are rehoused, and public cottages are built.
  - When land runs short, the council pays road crews to open a new district, up to ten.
  - Buildings can be expanded (up to level 3), damaged, repaired, burned to ruins and rebuilt.
  - Civic infrastructure appears as the town grows: wells, a granary, a school and a Town Hall.
- **Events.** Fires that spread and are fought by neighbours (a well helps), crop failures, harsh winters, fever
  outbreaks and recessions. Six discoveries (the heavy plough, tempered tools, timber framing, sealed
  granaries, the watermill, clean wells and drains) change production and health permanently.
- **History.** Named eras (The Founding Years, The Age of Councils, The Garrow Dynasty, The Great Fire of
  Year 165…) are chosen from what each year actually brought. There is a searchable timeline by year, a
  biography for everyone who ever lived, and the **Founders' Memorial** in the square. Tap it to open the
  founders' stories. It gains a gold crown once all five founders have died.

## Playing on an iPhone

1. Open the link above in Safari. To make it feel like an app, tap Share → *Add to Home Screen*.
2. Drag with one finger to orbit, pinch to zoom, and use two fingers to pan.
3. Bottom tabs:
   - **People**: search, demographics and a population pyramid.
   - **Families**: houses and family trees.
   - **Economy**: businesses, land and buildings.
   - **Politics**: leader, approval, policies, factions and elections.
   - **History**: eras, the Memorial, the timeline and the departed.
   - **Council**: actions and settings.
4. Tap anyone, anywhere, to read their story. *Follow in village* keeps the camera on them until you drag the
   view. 🌳 opens a family tree centred on that person, and 📖 opens a biography.
5. Use ⏸ and **1× / 3× / 6× / 20×** in the top bar. 20× is for watching generations pass.
6. Council → *Kingdom & settings* has the name label toggle, *Battery saver* graphics, Save, Export, Import,
   *Restore yearly snapshot* and New kingdom.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm ci
npm run dev                  # development server
npm test                     # unit, economy, property, save, simulation, legacy (Milestone 3) and build tests
npm run test:longevity -- 200 1,2,3   # headless 200-year stress test across seeds
npm run build && npm run preview      # production build on http://localhost:4173/kingdom-of-nobodies/
npm run test:e2e             # touch end-to-end test (needs Playwright + Chromium and the preview running)
```

## Architecture

The simulation is plain JavaScript over a single JSON state object with no DOM or WebGL dependencies, so it
runs identically in the browser and in Node tests. It advances in fixed 10-minute ticks, while rendering runs
at the display's frame rate. `index.html` contains no game logic.

```
src/
  core/        Game, GameClock, Config (all tuning), Calendar (dates, ages, stages), Random (seeded, in state),
               EntityRegistry (cached id lookups), Serialization (checksummed, versioned saves + migration),
               SaveManager (IndexedDB current/previous/yearly snapshot + localStorage backup)
  sim/         Simulation (tick, hourly and daily schedules; lifecycle hooks), Setup (the founding)
  ai/          CitizenBrain (activities), DecisionUtility (life-stage-aware scoring + explanations),
               GoalPlanner (dreams → steps), Personality, MemorySystem
  citizens/    Citizen, Lifecycle (ageing, mortality, death), Families (marriage, births, adoption),
               FamilyTree, Genetics, Relationships, Careers, CitizenManager
  education/   Skills, Education (lessons, trades, apprenticeships, mentoring)
  economy/     Transactions (ledger), Businesses, Marketplace, Employment, EconomyManager, Inheritance
  property/    LandRegistry, Ownership, Construction (build, refit, expand, repair), Demolition
  politics/    Government (offices, elections, scandals, protests), Policies, Opinion (factions)
  population/  Migration, Housing, Expansion (districts), SocialClasses
  events/      Disasters (fire, crop failure, winter, fever, recession), Discoveries
  history/     Archive, Biography, Eras (yearly review), Compaction (bounded state growth)
  society/     Chronicle, Gossip, Reputation
  council/     Council actions, standing duties, public infrastructure
  world/       World (renderer, seasons, fires, memorial, camera follow, label LOD), Terrain (districts'
               roads), Models, Villagers (age-scaled figures, distance LOD), Materials
  ui/          HUD and the People/Families/Economy/Politics/History/Council panels, BottomSheet
tests/         node:test suites, longevity.mjs (stress test), e2e/mobile.e2e.cjs
```

Key design rules:

- **Systems change state, then record it.** Achievements, biographies and eras are derived from recorded
  facts.
- **Deterministic**: the RNG lives in the saved state. A reloaded world continues exactly, including mid-birth,
  mid-election and mid-fire (this is tested), and a 20× run is identical to a 1× run.
- **Bounded growth**: each year, compaction keeps each person's 24 most significant relationships, reduces
  closed businesses to compact records, and trims archive records to their identity, family, career highlights
  and achievements. The archive keeps every person who ever lived.
- **Performance** for up to 250 citizens:
  - Lookups are cached by id. Expensive social summaries are computed once per day.
  - Villagers far from the view are hidden, and those at middle distance are moved but not animated.
  - Only the nearest ~14 unoverlapping name labels are drawn, plus the selected person's.
  - Buildings rebuild only when their state signature changes.
  - *Battery saver* lowers the pixel ratio, turns off shadows and tightens the level of detail.

### Saves

Saves are checksummed envelopes (format version 4) stored in IndexedDB:

- Every write keeps the previous save in the same transaction.
- Once per game year, a **recovery snapshot** is also kept, which you can restore from the Council tab.
- A copy goes to localStorage.
- Loading picks the newest valid copy.

Older saves migrate automatically. A Milestone 2 village gains birth dates consistent with each person's age,
sexes, family links, education, health, an archive, statistics and a government-ready council. Milestone 1
saves still migrate through the Milestone 2 path first. Export and import use the same format.

### Deployment and the white-screen fix

The "white screen with words" on iPhone happened because GitHub Pages was publishing the raw repository
instead of the Vite build. **Settings → Pages → Source must be "GitHub Actions".**

- The deploy workflow runs the tests and checks that `dist/index.html` references
  `/kingdom-of-nobodies/assets/…` and never `/src/`. `tests/build.test.js` checks the same thing locally.
- `index.html` has an inline-styled startup screen that reloads once if assets are missing, then shows a clear
  message.
- If WebGL fails, a clear message appears while the simulation and panels keep working.
- The version and build ID are shown in the Council tab.
- There is no service worker, so there is no stale-cache trap.
- CI on pull requests runs the tests, the build, a Playwright mobile touch test on an emulated iPhone, and the
  200-year stress test.

## Stress test results (200 in-game years)

STRESS_TABLE

## Known limitations

- Citizens walk in straight lines; there is no pathfinding around buildings.
- The simulation pauses while the page is closed. There is no offline catch-up.
- The economy and demography are tuned for stability across seeds, not for historical realism. Immigration
  does much of the work of keeping the population up, and births alone don't replace deaths.
- Emigration is rare, because the welfare systems keep most people content.
- The district layout is a fixed set of ten blocks. After that, the town grows only by expanding buildings.

## Toward Milestone 4

- Neighbouring settlements, trade routes and diplomacy, which would give emigration somewhere to go.
- Pathfinding and a road graph, so districts can be laid out by citizens rather than prebuilt blocks.
- Laws and courts (crimes, trials) on top of the existing reputation and scandal systems.
- Religion and festivals tied to the seasonal calendar.
- Moving the simulation into a Web Worker for larger populations, and a server-side save backup.
