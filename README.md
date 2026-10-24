# Kingdom of Nobodies — Milestone 4: Beyond the Hearth

A mobile-first, low-poly 3D medieval settlement that lives for generations and trades with its neighbours.
Five strangers light a hearth. Their descendants walk real roads, haul grain to hungry kingdoms, take each
other to court over unpaid wages, and dance at the Harvest Festival. You are the council: you can nudge the
society, but you can't control anyone.

**Play:** https://outerheavenx.github.io/kingdom-of-nobodies/ · version 0.4.0

## Beyond the Hearth (Milestone 4)

As before, the chronicle only reports what the simulation actually did: if it says a caravan delivered
grain, the grain moved, and so did the coins.

- **Roads and pathfinding.** Villagers walk on a 2-unit navigation grid built from the real building
  footprints, the river and the roads.
  - Routes come from A\* (8 neighbours, a binary heap), smoothed by cost-aware string-pulling and cached per
    layout. When a building goes up or burns down, routes replan.
  - An unreachable destination fails safely: the villager remembers it and picks something else to do.
  - Road surfaces set the walking cost: footpath, dirt, stone, a bridge, or wading the ford.
  - Roads are proposed for real reasons: owners petitioning for access, desire paths worn by heavy foot
    traffic, paving the busiest dirt road, or a bridge once the ford is crowded. The council approves a
    proposal and pays for it, and the works crew builds it over several shifts using timber and stone.
- **The region.** Three kingdoms surround First Hearth: **Greenvale** (farms), **Ironhold** (mines and forges)
  and **Saltmere** (a fishing port).
  - Each is simulated in aggregate:
    - population, prosperity and food cover;
    - production with input chains (ore → iron → tools) that follows the seasons;
    - spoilage;
    - a leader whose stance shifts with circumstances;
    - prices bounded between 0.45× and 3× of base.
  - They are linked by six roads that differ in terrain and quality. One of them is hidden until it is
    scouted.
  - The Region tab has an SVG map with fog of war. Expeditions led by a real villager, who is away while
    travelling, reveal corridors and landmarks.
- **Trade.** Merchants look for opportunities and explain them, for example: *"Ironhold is short of food;
  Greenvale sells at 1.51 a unit, Ironhold pays 3.45; 39 hours on the road; expected profit 79 coins"*.
  These merchants are First Hearth villagers who buy carts at the lumberyard, plus houses from each kingdom.
  - A contract holds the buyer's payment in escrow and reserves the seller's stock (a local seller's goods
    are physically set aside).
  - A caravan with a capacity loads the goods, pays drovers and tolls, and travels the regional roads in
    simulated time. It is slowed by winter, storms and heavy loads. It waits out floods and landslides,
    re-routes, or turns back.
  - Perishable cargo spoils. On delivery, escrow pays the merchant less the tariff, and the buyer's stores
    grow.
  - Every unit loaded ends up delivered, sold, spoiled or still aboard (this is checked).
  - Carts are drawn on the village road between the gate and the market. Tap one to follow it.
- **Diplomacy.** Every change in a relationship has a recorded cause: profitable trade, high tariffs,
  quarrels over tolls, gifts, embargoes, or old grievances fading with time.
  - Treaties change the actual rules:
    - trade treaties lower tariffs;
    - transit treaties waive tolls;
    - mutual assistance sends grain in a famine;
    - non-aggression pacts prevent embargoes.
  - Embargoes void contracts that haven't loaded yet and turn caravans back at the border. After one is
    lifted, neither side imposes another for three years. Feuds cost a kingdom's leader support.
  - People migrate between the settlements as identifiable individuals. An emigrant can come home with the
    same identity and family links.
- **Law and courts.** A legal code with enactment and effective dates. Founding laws cover property, wages,
  theft, fraud and tariffs; the government proposes and votes on new laws for contracts, licensing,
  building safety, permits and idle land.
  - Claims come from real events, with evidence captured at the time: missing wage payments with the
    employment record, a theft with its witnesses, a short delivery, a disputed estate, an embezzlement found
    in the ledger.
  - Cases are filed, scheduled and heard by an appointed judge. Courthouse capacity creates a backlog.
  - A judgment is executed exactly once through the ledger: restitution, a fine, an enforced contract, a
    property transfer or a licence suspension.
- **Seasons and culture.** Farms yield most in autumn and least in winter, and winter raises appetite.
  - Each season has a festival: the Festival of Renewal, the Midsummer Fair (which invites foreign
    merchants), the Harvest Festival and the Hearthlight Gathering. The council budgets real coins for each,
    a family may sponsor it, and food is bought from real sellers.
  - Villagers decide for themselves whether to attend, based on company, loneliness, work they still owe
    and distance. They eat from the feast and buy treats at the stalls.
  - Traditions grow out of history: a family that sponsors two harvests in a row starts a feast,
    Founders' Day begins once the last founder dies, there is a remembrance after a great fire, a
    merchants' market, and tales told by travellers. Customs from the kingdoms spread through contact.

## Earlier milestones: across the generations (Milestone 3)

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
   - **Economy**: businesses, **trade** (market prices, contracts, caravans, merchants) and land.
   - **Politics**: government, **laws & courts** (the legal code, proposals, cases with evidence and
     judgments) and **foreign** relations (treaties, embargoes and the causes behind each relationship).
   - **Region**: the map, kingdoms, caravans, diplomacy and exploration. Tap a kingdom, a caravan or a
     landmark.
   - **History**: eras, the Memorial, the timeline, the departed and **culture** (festivals and traditions).
     The chronicle can be filtered by trade, diplomacy, law and culture.
   - **Council**: actions (including scouting and diplomatic gifts), region & roads, and settings.
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
npm test                     # unit, economy, property, save, simulation, legacy, navigation, trade,
                             # diplomacy, law, festival, regional (acceptance) and build tests
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
  property/    LandRegistry, Ownership, Construction (build, refit, expand, repair), Demolition, Footprints
  politics/    Government (offices, elections, scandals, protests), Policies, Opinion (factions)
  population/  Migration, Housing, Expansion (districts), SocialClasses
  events/      Disasters (fire, crop failure, winter, fever, recession), Discoveries
  history/     Archive, Biography, Eras (yearly review), Compaction (bounded state growth)
  society/     Chronicle, Gossip, Reputation
  council/     Council actions, standing duties, public infrastructure
  world/       World (renderer, seasons, fires, memorial, camera follow, label LOD), Terrain (river and roads
               by kind), Models (incl. bridge and courthouse), Caravans (carts), Festival (decorations),
               Villagers (age-scaled figures, distance LOD), Materials
  navigation/  RoadNetwork (road kinds, river, gates), NavigationGrid (footprints → cost grid), Pathfinding
               (A*, smoothing, route cache), Traffic, RoadConstruction (proposals, approval, works), NavCache
  region/      RegionData (kingdoms, commodities, routes), Settlement (aggregate kingdom simulation),
               RegionManager (fog, routes, journeys, regional events), Exploration
  trade/       Markets (prices, reservations, deliveries), Contracts (escrow), Caravans, TradeManager (merchants)
  diplomacy/   Diplomacy (relations with causes, treaties, embargoes, tariffs, tolls, aid)
  law/         LegalCode (laws, effective dates, lawmaking), Courts (claims, evidence, cases, judgments)
  culture/     Festivals, Traditions (emergent traditions, cultural exchange)
  ui/          HUD and the People/Families/Economy/Politics/Region/History/Council panels (with Trade, Law
               and Region panels), BottomSheet
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
- **Money is a closed ledger.** The three kingdoms, escrow and the outside world are accounts too, so the
  total never changes: it is checked every simulated year.
- **Performance** for up to 250 citizens:
  - Lookups are cached by id. Expensive social summaries are computed once per day.
  - Villagers far from the view are hidden, and those at middle distance are moved but not animated.
  - Only the nearest ~14 unoverlapping name labels are drawn, plus the selected person's.
  - Buildings rebuild only when their state signature changes.
  - *Battery saver* lowers the pixel ratio, turns off shadows and tightens the level of detail.
  - The kingdoms are simulated once a day in aggregate rather than as people. The navigation grid is
    rebuilt only when the layout changes, and routes are cached per layout version.
  - **Web Worker: evaluated, not adopted.** A 200-year run takes about 0.8 ms per simulated tick at
    150 villagers in Node (see below). At 20× speed (80 ticks a second) that is about 6% of a second,
    well within budget even if a phone is several times slower. Moving the simulation into a worker would
    mean copying or proxying the whole state for every panel and pick, and would split saving and
    determinism across two threads. That cost is not worth paying at this scale.

### Saves

Saves are checksummed envelopes (format version 5) stored in IndexedDB:

- Every write keeps the previous save in the same transaction.
- Once per game year, a **recovery snapshot** is also kept, which you can restore from the Council tab.
- A copy goes to localStorage.
- Loading picks the newest valid copy.

Older saves migrate automatically.

- **A Milestone 3 village (version 4)** gains:
  - the road network, including roads for districts it has already opened;
  - the three kingdoms, funded from the outside account so no coins are created;
  - trade, diplomacy, the founding laws, culture and navigation.

  Every citizen, account and title is kept. `tests/fixtures/m3-save.json` is a real save produced by the
  Milestone 3 code, and a test migrates it and runs it for a year.
- **A Milestone 2 village** gains birth dates consistent with each person's age, sexes, family links,
  education, health, an archive, statistics and a government-ready council.
- **Milestone 1 saves** still migrate through the Milestone 2 path first.

Export and import use the same format. A reload continues identically even mid-journey, mid-unloading, with a
case pending, during road works, during a festival and across a season change. This is tested, and nothing is
duplicated.

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

`npm run test:longevity -- 200 <seed>`, run on four seeds. Every invariant was checked each decade: unique ids,
non-negative ages, valid and acyclic families, mutual marriages, employment only at trading businesses,
plots owned by the living, valid elections, no NaN, and exact money conservation every year. All held.

| Seed | Peak / final pop. | Births | Deaths | Immigrants | Marriages | Generations | Elections | Businesses opened / closed | Estates & sales | Fires | Hunger deaths | Save size | Time |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 176 / 166 | 186 | 389 | 364 | 285 | 8 | 52 | 457 / 445 | 170 | 164 | 17 | 2.6 MB | 282 s |
| 2 | 150 / 136 | 195 | 424 | 360 | 289 | 8 | 49 | 364 / 352 | 163 | 199 | 30 | 2.3 MB | 282 s |
| 3 | 152 / 151 | 201 | 404 | 349 | 271 | 8 | 53 | 234 / 221 | 167 | 182 | 12 | 2.3 MB | 266 s |
| 4 | 178 / 174 | 190 | 421 | 400 | 296 | 9 | 52 | 424 / 411 | 172 | 158 | 15 | 2.6 MB | 304 s |

All six discoveries happened in every run. Eras included *The Marsh Dynasty*, *The Great Harvest*, *The Great
Fire of Year 154* and *The Years of Recovery*. Times are for four runs in parallel on one machine. Births,
deaths, disasters and the economy were all active.

## Tuning decisions (Milestone 4)

The extended stress test surfaced real problems, and each was fixed at its cause rather than by switching a
system off:

- **Famine from unemployment.** In one seed, by year 50 only 25 of 90 adults had work. Businesses were
  closing and the pantry was empty. Children starved even though food was on sale, because their families
  had no coins. Two causes:
  - Owners of thriving businesses were emigrating "for a better life" and taking their households (and
    their businesses) with them. A household with an open business now never leaves for vague prospects,
    and savings over 90 coins weaken the pull abroad.
  - Newcomers kept arriving despite the joblessness. Unemployment now counts 1.6× against the village's
    appeal, and job openings attract outsiders only when locals aren't already out of work.
- **Districts opening too fast.** All ten districts were open by year 25 at 87 people. A new district now
  also needs population pressure: 10 + 7 × the districts already open, unless two or more villagers are
  homeless.
- **Diplomatic dead ends.** Some kingdoms stayed locked at −100 with each other, swapping embargoes forever.
  Now:
  - bitter relations fade toward indifference by 8% a season;
  - after an embargo is lifted, neither side may impose another for three years;
  - every active embargo costs the kingdom's leader approval;
  - a people tired of feuds elects a cooperative leader.
- **Trade economics.** Carriage costs 0.3 coins per hour of road. The distant world buys gluts cheaply and
  sells grain dearly (2.2×), and only when a kingdom has less than one day of food left. Regional trade is
  therefore the normal way food moves between settlements.
- **Diagnostics recorded in the save.** Every hunger death records its cause (no food to be had, a family too
  poor to buy food, out of work and penniless, stranded away from home). Every closed business records why
  it closed (bankrupt, unprofitable, owner died, owner emigrated, building destroyed).

## Known limitations

- The kingdoms are simulated in aggregate. Their people are numbers, not citizens, until someone migrates.
- The regional map is schematic, and kingdoms are not rendered in 3D. Carts are drawn only within about
  3 km of the village.
- Unemployment can still run high in some seeds (around half of adults in one run). Emigration acts as the
  release valve, which is plausible but not tuned for realism.
- The council's treasury is often low, so festivals are sometimes scaled down or cancelled.
- The simulation pauses while the page is closed. There is no offline catch-up.
- The district layout is still a fixed set of ten blocks, now linked by real roads. Citizens can pave and
  bridge, but cannot lay out new blocks.

## Toward Milestone 5

- Citizen-planned districts and streets on top of the road network.
- The kingdoms as places: visit them in 3D, with named foreign citizens and rulers to negotiate with.
- Credit, banks and loans, so merchants and businesses can borrow against their prospects.
- Religion, guilds and a richer culture system, building on traditions and festivals.
- Wars, alliances and border disputes built on top of treaties and embargoes.
- A server-side save backup and an offline catch-up simulation.
