# Kingdom of Nobodies — Milestone 5: The Age of Empires & Prosperity

A mobile-first, low-poly 3D medieval settlement that lives for generations among neighbouring kingdoms.
Five strangers light a hearth. Their descendants lay out streets, borrow from banks, join guilds, keep
their faiths, trade with kingdoms whose people have names, and live through wars they did not start. You
are the council: you can nudge the society, but you can't control anyone.

**Play:** https://outerheavenx.github.io/kingdom-of-nobodies/ · version 0.5.0

## The Age of Empires & Prosperity (Milestone 5)

The rule from earlier milestones holds: the chronicle only reports what the simulation actually did, and
every coin moves through the ledger. Money is still conserved exactly. Banks, guilds and faith communities
have ledger accounts of their own, and the stress test checks the books.

- **The town plans itself.** The four inner districts keep their hand-drawn layout. After that, the town
  grows street by street.
  - The planners measure real demand:
    - families squeezed into the communal hall;
    - homelessness and growth;
    - people per shop;
    - empty land;
    - traffic.
  - They search for the best street that branches at right angles off an existing road. A street is
    rejected if it would cross the river, a building, a plot or another road, or leave the valley.
  - Each plan goes to the council with its costs (road, survey) and benefits (beds, shops, land value).
    The council approves it, cuts it down to fit the treasury, borrows the gap from a bank against the land
    it will open, or rejects it.
  - The works crew builds the street shift by shift. Its plots are surveyed only once it is finished, so
    every new home has a road to its door (tested with the pathfinder).
  - Districts record how their character changes, for example from a residential quarter to a market
    quarter. The council rezones idle land toward what is short.
  - Citizens with capital (or a loan) build cottages to sell, but only while families need homes and some
    of them could afford the price. Only two such cottages are under way at a time. Families can buy a
    finished cottage and move in.
- **Kingdoms you can visit.** Kingdoms → *Visit in 3D* takes the camera to Greenvale, Ironhold or Saltmere.
  Only one settlement is drawn at a time, and the simulation keeps running everywhere.
  - Each kingdom has its own scene:
    - **Greenvale**: rolling farmland with windmills.
    - **Ironhold**: a walled stone town with mines and a smelter under the mountains.
    - **Saltmere**: a harbour with docks, boats, warehouses and a lighthouse.
  - Each kingdom has about 25 persistent named people with stable ids: a ruler, councillors, merchants, a
    guild master, a faith keeper, craftspeople and residents. They age, marry, have children, change
    trades, rise and fall with their kingdom, migrate along the real roads (taking days, never
    teleporting) and die. Vacant roles are filled by promotion.
  - Rulers are named citizens. Their character (ambition, caution, warmth, pride) shapes their priorities,
    how they negotiate and whether they go to war. Their record lists the treaties and wars of their reign.
  - Foreign merchant houses send a named merchant with each caravan, and that merchant is away until the
    caravan comes home. Carts in a kingdom's market are the caravans actually stopped there. Tents outside
    its walls are an army actually camped there.
- **Banks, credit and loans.** All banks keep a real balance sheet: cash, loans, deposits and equity.
  - The banks are moneylenders, merchant banks, the council's savings house and guild credit funds.
  - A deposit moves coins into the bank and records what the bank owes. You can only withdraw what you
    deposited, and only what the bank actually holds in cash.
  - Credit is assessed from:
    - income and how long the borrower has worked;
    - business profit;
    - repayment history;
    - existing debts;
    - collateral;
    - reputation.

    A rich idler with past defaults is refused, while a steady smith is not.
  - Loans pay for premises, homes, business expansion and development. The council can also borrow, for
    streets and for grain in a famine.
  - Interest accrues once a season, in whole coins, and never twice across a save and reload. Deposit
    interest is paid out of what the bank's loans earn, so idle savings cannot bankrupt it.
  - Missed payments bring penalties, then one restructuring, then default. A default goes to court under
    the Debt Recovery Act, and the judgment is carried out once:
    - repayment from the borrower's means;
    - or a forced sale of the pledged land, which repays the lender first;
    - or bankruptcy, with the loss written off and the borrower's credit ruined for ten years.
  - A failing bank is wound up in an orderly way. A healthy bank takes over its accounts and honours
    deposits as far as the failed bank's assets cover them. Without one, depositors share its cash pro
    rata.
  - Deaths and emigration settle debts and savings.
- **Guilds.** Merchants', Builders', Blacksmiths' and Carpenters' guilds and the Farmers' Association form
  once a trade has three practitioners.
  - Members pay dues into a real fund and elect a master.
  - The guild trains members, raises the quality of their shops, helps members who are out of work, and
    builds a hall (which raises the price of land nearby). Large guilds open credit funds and sponsor
    public works.
  - At elections, guilds back the candidate whose platform suits their trade, and their members' votes
    follow. A guild whose candidate wins may be granted a privilege, such as a lower market levy. Rival
    guilds that back opposing candidates are recorded as a dispute.
- **Faith.** Five original traditions:
  - **The Old Furrow**: nature and harvest.
  - **The Hearthkin**: ancestors and family memory.
  - **The Dawnlight**: light and renewal.
  - **The Open Hand**: service and charity.
  - **The Quiet Lantern**: scholarship and contemplation.

  Each villager is devout, casually affiliated, sceptical or holds to none, and that can change over a
  lifetime. Belief never affects honesty, intelligence, temper or worth.

  Communities collect offerings and pay for upkeep and a keeper. They raise shrines, chapels and temples
  and keep their seasonal rites. They also:
  - buy food from the village's own shops for a winter charity table, and in any hunger crisis;
  - sit with the bereaved;
  - sponsor the school;
  - help fire victims rebuild;
  - keep a book of the village's memorable days.

  People remember who helped them.
- **Alliances and war.**
  - **Disputes.** Three contested lands lie along real roads. Tension over each rises and falls for recorded
    reasons: relations, toll quarrels, need, embargoes, a ruler's pride. A formal dispute is negotiated
    every season.
  - **Deciding on war.** War is considered only after talks have failed twice. The ruler must be willing,
    the treasury must allow it, and the aggressor must expect to win. Defensive alliances can deter a war
    (the Chronicle says when they do).
  - **Allies.** When war is declared, allies must join or break their treaty. First Hearth can be drawn in
    through an alliance; its militia is made of real villagers who leave their jobs.
  - **Armies.** Mobilisation takes workers out of a kingdom's fields and mines. Armies carry real food,
    are paid every day, and march by the hour along the roads. Hunger costs them morale and deserters.
  - **Battles** weigh numbers, training, equipment, morale, supply, the commander and the ground, with a
    ±15% roll for the fortunes of the day.
  - **Sieges** close a town's roads to trade. They end in surrender, withdrawal, a parley or an assault.
  - **Peace.** Exhaustion, defeats and a three-year limit push both sides toward peace. The treaty sets
    who holds the land, any reparations, a non-aggression pact or ceasefire, and a recognised border.
  - **At home.** War blocks trade between the belligerents, sends refugees to First Hearth, and moves
    transit tolls with the territory. Any battle can be replayed on stylised ground.
- **Weather.** Clear, rain, fog, wind and snow follow the seasons and tend to persist from day to day.
  - Rain waters the crops in the growing months, while snow and fog slow the roads.
  - Wind fans fires, and a clear day lifts people's spirits.
  - The renderer draws whatever the simulation decided.
- **Optional cloud backup.** A Cloudflare Worker with a D1 database, GitHub sign-in, revision history,
  conflict detection and server-side validation (see [cloud/README.md](cloud/README.md)). It is
  implemented and tested in-process, but **not deployed**: it needs secrets that only the owner can
  create. Until then the Cloud card says it is not set up, and local saving is unchanged.
- **Look and feel.** New buildings: a counting house, guild halls, shrines, chapels, temples and barracks.
  - Houses have ridge beams, door frames, window sills and shutters.
  - There are rain and snow particles, overcast light and fog.
  - Militia muster at the north gate.
  - The camera has an overview and smooth zoom.
  - The navigation was rebuilt (see below).
  - Three.js is a separately cached chunk, so a game update does not re-download the engine.

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
   - **World**: the town:
     - what it needs;
     - the street plans before the council and its decisions;
     - districts and how their character has changed;
     - road works, building sites and homes built to sell;
     - the weather, and an *Overview* camera.
   - **People**: search, demographics, a population pyramid, and **Families** (houses and family trees). A
     citizen's page shows their money (savings, loans, credit record) and their belief.
   - **Kingdoms**:
     - the map, with armies and caravans where they really are;
     - kingdoms, with their ruler, named people and forces, and *Visit in 3D*;
     - alliances and the military balance;
     - disputed lands, wars, diplomacy, caravans and exploration.
   - **Economy**: businesses, trade, **banks** (balance sheets and loans), **guilds** and land.
   - **Politics**: government, laws & courts, **faith** and foreign relations.
   - **History**:
     - eras, the Memorial, the timeline and the departed;
     - **wars** (battles can be replayed);
     - **kingdoms'** own histories;
     - culture.
   - **Council**: actions, region & roads, settings and the optional **cloud backup**.
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
npm test                     # all node:test suites, including Milestone 5: city-planning, travel, finance,
                             # institutions, warfare and cloud-saves
npm run test:longevity -- 200 1,2,3,4 # headless 200-year stress test across seeds
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
  sim/         Simulation (tick, hourly and daily schedules; lifecycle hooks), Setup (the founding),
               Hooks (hook arrays that wire the Milestone 5 systems in without import cycles), Milestone5
  ai/          CitizenBrain (activities), DecisionUtility (life-stage-aware scoring + explanations),
               GoalPlanner (dreams → steps), Personality, MemorySystem
  citizens/    Citizen, Lifecycle (ageing, mortality, death), Families (marriage, births, adoption),
               FamilyTree, Genetics, Relationships, Careers, CitizenManager
  education/   Skills, Education (lessons, trades, apprenticeships, mentoring)
  economy/     Transactions (ledger), Businesses, Marketplace, Employment, EconomyManager, Inheritance
  property/    LandRegistry, Ownership, Construction (build, refit, expand, repair), Demolition, Footprints
  city/        LandDemand (housing, commercial, jobs, land prices, congestion), RoadPlanner (streets off
               existing roads, obstacle checks), CityPlanner (proposals, council review, districts, rezoning),
               UrbanDevelopment (speculative homes built to sell)
  finance/     BankAccounts (deposits, raiseCash, spendable), CreditAssessment, LoanManager (amortised
               loans, liens, restructuring, municipal borrowing), InterestSystem, DebtCollection (default,
               court claims, forced sales), BankManager (founding, balance sheets, failure)
  institutions/ Registry (institutions as legal persons), GuildManager + GuildEconomy (dues, elections,
               training, halls, credit funds, privileges), FaithManager (five traditions, evolving belief),
               ReligiousInstitutions (offerings, rites, shrines → temples, charity, relief), CommunityEvents
  politics/    Government (offices, elections, scandals, protests), Policies, Opinion (factions)
  population/  Migration, Housing, Expansion (districts), SocialClasses
  events/      Disasters (fire, crop failure, winter, fever, recession), Discoveries, Weather
  history/     Archive, Biography, Eras (yearly review), Compaction (bounded state growth)
  society/     Chronicle, Gossip, Reputation
  council/     Council actions, standing duties, public infrastructure
  world/       World (renderer, village / kingdom / battle modes, seasons, weather sky, camera flights),
               KingdomScene (3D foreign towns with named figures, carts and armies), BattleView,
               WeatherLayer (rain, snow, mist), Terrain, Models, Caravans, Festival, Villagers, Materials
  navigation/  RoadNetwork (road kinds, river, gates), NavigationGrid (footprints → cost grid), Pathfinding
               (A*, smoothing, route cache), Traffic, RoadConstruction (proposals, approval, works), NavCache
  region/      RegionData (kingdoms, commodities, routes, disputed lands), Settlement (aggregate kingdom
               simulation), RegionManager, Exploration, ForeignCitizenManager (named rulers, nobles,
               merchants and families; succession; travellers)
  trade/       Markets (prices, reservations, deliveries), Contracts (escrow), Caravans, TradeManager (merchants)
  diplomacy/   Diplomacy (relations, treaties incl. defence pacts and ceasefires, embargoes, tariffs, aid),
               Alliances, TerritorialClaims (disputes, tension, negotiation)
  military/    Army (marches along real routes), MilitaryManager (garrisons, mobilisation, village militia,
               supply), BattleResolver (explained outcomes), SiegeSystem, WarManager (causes, declarations,
               allies, exhaustion, peace terms)
  persistence/ SaveValidation, ConflictResolution, CloudSaveClient, CloudSync (optional cloud backup)
  law/         LegalCode (laws, effective dates, lawmaking, debt law), Courts (claims, evidence, judgments)
  culture/     Festivals, Traditions (emergent traditions, cultural exchange)
  ui/          HUD (World / People / Kingdoms / Economy / Politics / History / Council), BottomSheet, and the
               panels: City planning, Finance, Guilds, Religion, Military, Region, Cloud save, and the rest
cloud/         Optional Cloudflare Worker + D1 backup service (not deployed; see cloud/README.md)
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
  - **Web Worker: evaluated, not adopted.** A 200-year run takes about 1.0–1.2 ms per simulated tick at
    about 150 villagers in Node (see below). At 20× speed (80 ticks a second) that is about 10% of a second,
    well within budget even if a phone is several times slower. Moving the simulation into a worker would
    mean copying or proxying the whole state for every panel and pick, and would split saving and
    determinism across two threads. That cost is not worth paying at this scale.

### Saves

Saves are checksummed envelopes (format version 6) stored in IndexedDB:

- Every write keeps the previous save in the same transaction.
- Once per game year, a **recovery snapshot** is also kept, which you can restore from the Council tab.
- A copy goes to localStorage.
- Loading picks the newest valid copy.

Older saves migrate automatically.

- **A Milestone 4 kingdom (version 5)** gains the city planner (its existing districts become named
  districts), weather, the banking system (no bank exists until someone founds one), a belief for every
  existing citizen (guilds and faith communities then form from them in the following seasons), named
  foreign citizens for each kingdom, territorial disputes and the military records. No coins are created: every new account starts empty. What was added is
  listed in `migrationNotes`. `tests/fixtures/m4-save.json` is a real save produced by the Milestone 4 code;
  tests migrate it, check every citizen and coin survives, and run it on.
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

`npm run test:longevity -- 200 <seed>`, run on seeds 1–4 on the final Milestone 5 code. Every run is the
whole region together for 200 years: the village and all three kingdoms trading, migrating, allying and going
to war with each other. The checks:

- **Every simulated year:** exact money conservation, with banks, guilds, faith communities, armies and the
  three kingdoms all holding real ledger accounts.
- **Every decade**, everything Milestone 4 checked (unique ids; valid, acyclic families; employment only at
  trading businesses; valid owners; valid elections; no NaN; no negative inventory; escrow equal to open
  contracts; balanced caravan cargo; no caravan stuck over 40 days; no judgment executed twice; state under
  6 MB), plus:
  - every bank's balance sheet reconciles, and no deposit is fractional or negative;
  - a failed bank holds no money and owes no deposits;
  - no loan has a negative or impossible balance, and every live loan has a living borrower;
  - guild rosters list only people still in the village;
  - no war outlives its time limit, and no army is still in the field long after peace;
  - militia members away at war are real villagers;
  - the town has at most 420 plots, and every kingdom has a named ruler.

All checks held in all four runs. CI runs all four seeds on every pull request.

| Seed | Peak / final pop. | Births | Deaths | Immigrants / emigrants | Generations | Elections | Hunger deaths | Save size | Time |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 138 / 132 | 254 | 273 | 713 / 567 | 9 | 52 | 0 | 3.1 MB | 369 s |
| 2 | 137 / 88 | 287 | 256 | 807 / 755 | 9 | 52 | 3 | 2.7 MB | 347 s |
| 3 | 148 / 123 | 280 | 273 | 747 / 636 | 9 | 53 | 33 | 3.1 MB | 366 s |
| 4 | 150 / 150 | 261 | 293 | 837 / 660 | 9 | 54 | 3 | 3.3 MB | 401 s |

Milestone 5 systems after 200 years:

| Seed | Wars / battles / sieges | Peace treaties | Alliances | Banks open (failed) | Loans issued (coins) | Defaults | Guilds | Planned districts / plots | Homes built to sell | Named foreigners |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 8 / 21 / 0 | 13 | 5 | 3 (0) | 13,942 | 7 | 4 | 14 / 103 | 19 | 83 |
| 2 | 4 / 8 / 3 | 14 | 4 | 3 (0) | 14,300 | 17 | 4 | 14 / 103 | 24 | 84 |
| 3 | 6 / 17 / 1 | 16 | 8 | 3 (0) | 18,294 | 29 | 4 | 14 / 103 | 18 | 84 |
| 4 | 3 / 7 / 2 | 21 | 8 | 3 (0) | 14,303 | 11 | 5 | 14 / 103 | 23 | 86 |

Regional metrics after 200 years:

| Seed | Caravan deliveries / failures | Goods moved | Trade value | Treaties / embargoes (ever) | Roads | Judgments | Festival attendance | Kingdom populations (G / I / S) | Wider world's coins |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 2,669 / 9 | 67,009 | 411,524 | 37 / 7 | 45 | 253 | 93% | 420 / 314 / 479 | 204,180 |
| 2 | 3,357 / 17 | 77,175 | 438,558 | 40 / 20 | 49 | 270 | 91% | 420 / 333 / 480 | 211,671 |
| 3 | 2,945 / 14 | 73,400 | 441,716 | 46 / 12 | 42 | 837 | 85% | 420 / 320 / 492 | 208,144 |
| 4 | 3,177 / 9 | 75,740 | 447,228 | 47 / 7 | 47 | 363 | 90% | 420 / 319 / 480 | 204,359 |

- Times are for four runs in parallel on one machine: 1.0–1.16 ms per simulated tick, and a heap of
  44–95 MB at the end.
- The planner reached its limit of 14 planned districts (103 plots) by year 50–75 in every seed. After that
  the town grows by rebuilding and densifying, not outward.
- Seed 3 is the bad case. It has long spells where 40–65% of adults are out of work and the council's
  treasury is too poor to restock the pantry. Most of its 33 hunger deaths are jobless adults (17) and their
  children (11); every death records its cause.

### What the Milestone 5 stress test changed

- **Bank deposits were misreported.** The first runs showed deposits climbing to 340,000–735,000 coins,
  more money than the whole economy holds. The banks' books were sound: deposits matched the cash each bank
  held, and total money stayed fixed. The bug was in `financeSummary`: its running totals overwrote the
  current deposit figure, so it reported every coin ever deposited. This also made the Economy tab's
  "Saved in banks" figure wrong. Fixed, with a regression test.
- **Empty homes drew newcomers into joblessness.** The first runs had 5, 6, 28 and 19 hunger deaths (58 in
  total). Probes of the worst seeds found the deaths came during long stretches of 40–65% unemployment.
  Newcomers kept arriving because the planned streets always left beds to spare, and free beds counted in
  the town's appeal regardless of work. Free beds now attract only while there is work: their pull shrinks
  as unemployment rises and is gone at 50%. Hunger deaths fell to 0, 3, 33 and 3 (39 in total), and
  arrivals fell from about 1,000 to 750–840 per run. Seed 3 is worse than before (33 against 28). Changing
  migration sends each seed down a different history, so this is reported as is, not tuned away.

### Milestone 4 baseline (for comparison)

The same test on the final Milestone 4 code, seeds 1–3:

| Seed | Peak / final pop. | Births | Deaths | Immigrants / emigrants | Generations | Elections | Hunger deaths | Save size | Time |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 183 / 165 | 230 | 356 | 781 / 495 | 8 | 53 | 2 | 2.9 MB | 407 s |
| 2 | 181 / 179 | 228 | 346 | 736 / 444 | 8 | 52 | 8 | 2.9 MB | 397 s |
| 3 | 161 / 148 | 243 | 340 | 788 / 548 | 9 | 52 | 10 | 2.8 MB | 371 s |

Milestone 5 villages peak lower (137–150 against 161–183). The most direct cause is the immigration change
above: a jobless town no longer attracts newcomers. Savings held in banks, guild dues and faith offerings
may also contribute, but their effects were not measured separately.

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
- **The distant world ran dry.** In the first full runs, the 50,000-coin "outside" purse (the wider world)
  was empty by year 60. Greenvale had hoarded 25,000 coins and the village 30,000, and the purse can only
  buy surpluses while it has coins. Once it was empty, Ironhold and Saltmere could no longer sell their
  surpluses, and they starved down to their population floor. Three changes:
  - prosperous kingdoms now spend 2% a day of the coins above their reserve on goods from distant lands;
  - villagers with more than 1,500 coins spend 1% a day of the excess with travelling pedlars;
  - the wider world starts with 250,000 coins.

  Milestone 3 saves receive a one-time top-up to that amount when they migrate, recorded in
  `migrationNotes`. Spending from more modest savings (above 200) was also tried. It sent the village's
  cash out of the valley and hunger deaths rose to 92–158 per 200 years, so it was rejected.
- **Trade economics.** Carriage costs 0.3 coins per hour of road. The distant world buys gluts cheaply and
  sells grain dearly (2.2×), and only when a kingdom has less than one day of food left. Regional trade is
  therefore the normal way food moves between settlements.
- **Diagnostics recorded in the save.** Every hunger death records its cause (no food to be had, a family too
  poor to buy food, out of work and penniless, stranded away from home). Every closed business records why
  it closed (bankrupt, unprofitable, owner died, owner emigrated, building destroyed).

## Known limitations

- Each kingdom has about 25 named people (rulers, nobles, merchants, families); the rest of its population
  is still simulated in aggregate. The 3D kingdom views are procedural towns built from the kingdom's state,
  not hand-made places, and you visit them as an observer.
- Warfare is resolved at the scale of armies and battles, with explained strength factors and a ±15% roll;
  there is no tactical control of units.
- The cloud backup has been tested end-to-end only in-process (the Worker running against node:sqlite in
  the test suite). It is **not deployed**, so the shipped game shows cloud backup as "not set up".
- Unemployment can still run high in some seeds (around half of adults in one run). Emigration is the
  release valve, so migration churn is high: about 750 arrivals and 500 departures over 200 years.
- Hunger still kills: 0–3 people per 200 years in three of four seeds, but 33 in seed 3, where long spells
  of mass unemployment meet a treasury too poor to restock the pantry. Each death records its cause.
- The council's treasury is often low, so festivals are sometimes scaled down or cancelled.
- The simulation pauses while the page is closed. There is no offline catch-up.
- Planned streets are straight dirt streets branching at right angles from existing roads; there are no
  curved streets. The planner stops after 14 planned districts (about 103 plots), which every seed reached
  by year 50–75.

## Toward Milestone 6

- An offline catch-up simulation for the time the page is closed.
- Deploying the cloud backup service (see `cloud/README.md`) once an account and domain are chosen.
- More of each kingdom's population as individual people, and playable diplomacy with named rulers.
- Curved and terrain-following streets, and town walls raised in response to war.
