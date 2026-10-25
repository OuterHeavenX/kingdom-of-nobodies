// Touch end-to-end check on an emulated iPhone (test 15). Requires Playwright with
// Chromium and a running preview server:  npm run build && npm run preview
// then:  npm run test:e2e   (BASE_URL defaults to the local preview).
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/kingdom-of-nobodies/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const step = (name) => console.log('✓', name);

  await page.goto(BASE);
  await page.waitForFunction(() => window.__konStarted === true, null, { timeout: 20000 });
  // v0.5.2: a title screen with the icon, real loading progress, Start and Enable sound.
  await page.waitForSelector('#boot.ready #boot-go');
  assert.match(await page.textContent('#boot-go'), /Start|Continue/);
  assert.equal(await page.evaluate(() => kingdom.audio.ctx), null, 'no audio before the player taps');
  assert.equal(await page.evaluate(() => kingdom.clock && kingdom.started), false, 'the kingdom waits on the title screen');
  const iconOk = await page.evaluate(async () => { const r = await fetch('icons/apple-touch-icon.png'); const m = await fetch('manifest.webmanifest').then((x) => x.json()); return r.ok && r.headers.get('content-type').includes('png') && m.display === 'standalone'; });
  assert.ok(iconOk, 'the icon and manifest are served');
  step('title screen: icon, manifest, Start button, and nothing playing yet');
  await page.tap('#boot-sound');
  await page.tap('#boot-go');
  await page.waitForFunction(() => window.__konEntered === true);
  await page.waitForTimeout(2500);
  const audio = await page.evaluate(() => kingdom.audio.stats());
  assert.equal(audio.state, 'running', 'the tap unlocked audio');
  assert.ok(audio.notes > 0 && audio.music, `music is playing (${audio.music}, ${audio.notes} notes)`);
  assert.ok(audio.level > 0.0005, `real signal at the output (rms ${audio.level.toFixed(4)})`);
  step('Start with sound: original music plays through the mixer');
  assert.equal(await page.isVisible('#app'), true);
  assert.equal(await page.evaluate(() => !!document.querySelector('#world canvas')), true, 'WebGL canvas present');
  step('boots past the loading screen with compiled assets');

  const css = await page.evaluate(() => getComputedStyle(document.getElementById('tabbar')).display);
  assert.equal(css, 'grid', 'stylesheet applied');

  await page.tap('#tabbar button[data-tab=citizens]');
  await page.waitForSelector('#sheet[data-state=peek]');
  await page.tap('#sheet-body .item');
  await page.waitForFunction(() => document.getElementById('sheet-title').textContent.includes('—'));
  step('tab bar opens the sheet; tapping a citizen opens their story');

  const grip = await page.locator('#sheet-grip').boundingBox();
  await page.touchscreen.tap(grip.x + grip.width / 2, grip.y + 5);
  const drag = async (fromY, toY) => {
    const cdp = await ctx.newCDPSession(page);
    const x = grip.x + grip.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await drag(grip.y + 8, grip.y - 300);
  await page.waitForSelector('#sheet[data-state=full]', { timeout: 3000 });
  step('swipe up expands the sheet');
  const grip2 = await page.locator('#sheet-grip').boundingBox();
  await drag(grip2.y + 8, grip2.y + 700);
  await page.waitForSelector('#sheet[data-state=closed]', { timeout: 3000 });
  step('swipe down dismisses the sheet');

  await page.tap('#speed');
  assert.equal(await page.textContent('#speed'), '3×');
  await page.tap('#pause');
  assert.equal(await page.evaluate(() => kingdom.clock.paused), true);
  await page.tap('#pause');
  step('pause and speed controls respond to touch');

  await page.tap('#tabbar button[data-tab=council]');
  const before = await page.evaluate(() => kingdom.sim.treasury);
  await page.tap('[data-action=foodAid]');
  await page.waitForSelector('.toast');
  const after = await page.evaluate(() => kingdom.sim.treasury);
  assert.ok(after <= before, 'food aid is paid for');
  step('council action runs from the panel');

  const openTab = async (tab) => {
    await page.tap(`#tabbar button[data-tab=${tab}]`);
    await page.waitForFunction((t) => document.querySelector(`#tabbar button[data-tab=${t}]`).classList.contains('active') && document.getElementById('sheet-body').textContent.trim().length > 20, tab);
  };
  for (const tab of ['world', 'economy', 'politics', 'citizens']) await openTab(tab);
  // Families live inside the People tab in Milestone 5.
  await page.tap('#sheet-body [data-act=people-mode][data-id=families]');
  await page.waitForSelector('#sheet-body [data-act=house], #sheet-body .item');
  await openTab('history');
  await page.tap('#sheet-body [data-act=bio]');
  await page.waitForFunction(() => document.getElementById('sheet-body').textContent.includes('Family tree'));
  await page.tap('#sheet-body [data-act=tree]');
  await page.waitForSelector('#sheet-body .tree-node');
  step('world, economy, politics, history and families open; biography and family tree respond to touch');

  // Milestone 4: the region, trade, laws and caravans.
  await page.evaluate(() => { while (kingdom.sim.state.day < 7) kingdom.sim.step(); });
  await page.tap('#tabbar button[data-tab=region]');
  await page.waitForSelector('#sheet-body svg.region-map');
  const mapBox = await page.locator('#sheet-body svg.region-map').boundingBox();
  assert.ok(mapBox.height > 150 && mapBox.width > 250, `the regional map is visible (${Math.round(mapBox.width)}×${Math.round(mapBox.height)})`);
  await page.tap('#sheet-body svg.region-map g.town[data-act=kingdom]');
  await page.waitForFunction(() => /Greenvale|Ironhold|Saltmere/.test(document.getElementById('sheet-title').textContent));
  assert.match(await page.textContent('#sheet-body'), /Stores|Prices|Relations/i);
  step('Region tab: the map renders and tapping a kingdom opens its page');
  await page.tap('#sheet-back');
  for (const mode of ['kingdoms', 'alliances', 'wars', 'caravans', 'diplomacy', 'explore']) {
    await page.tap(`#sheet-body [data-act=region-mode][data-id=${mode}]`);
    await page.waitForFunction((m) => document.querySelector(`#sheet-body [data-act=region-mode][data-id=${m}]`)?.classList.contains('active'), mode);
  }
  // The sheet re-renders with live data, so taps go through selectors rather than held element handles.
  await page.tap('#sheet-body [data-act=region-mode][data-id=caravans]');
  const hasCaravan = await page.waitForSelector('#sheet-body [data-act=caravan]', { timeout: 5000 }).then(() => true, () => false);
  if (hasCaravan) {
    await page.tap('#sheet-body [data-act=caravan]');
    await page.waitForFunction(() => /caravan/i.test(document.getElementById('sheet-title').textContent));
    step('region modes switch; a caravan opens with its route and cargo');
  } else step('region modes switch (no caravan on the road at this moment)');
  // Milestone 5: visit a neighbouring kingdom in 3D and come home; banks and guilds panels.
  await page.tap('#sheet-body [data-act=region-mode][data-id=kingdoms]');
  await page.tap('#sheet-body [data-act=visit][data-id=ironhold]');
  await page.waitForSelector('#view-banner:not([hidden])');
  assert.equal(await page.evaluate(() => kingdom.world.mode), 'kingdom');
  await page.waitForTimeout(800);
  await page.tap('#go-home');
  await page.waitForSelector('#view-banner[hidden]', { state: 'attached' });
  assert.equal(await page.evaluate(() => kingdom.world.mode), 'village');
  step('a kingdom can be visited in 3D and left again');
  await page.tap('#tabbar button[data-tab=economy]');
  for (const mode of ['banks', 'guilds']) {
    await page.tap(`#sheet-body [data-act=econ-mode][data-id=${mode}]`);
    await page.waitForFunction((m) => document.querySelector(`#sheet-body [data-act=econ-mode][data-id=${m}]`)?.classList.contains('active'), mode);
  }
  await page.tap('#sheet-body [data-act=econ-mode][data-id=trade]');
  await page.waitForFunction(() => /market|caravan|contract/i.test(document.getElementById('sheet-body').textContent));
  await page.tap('#tabbar button[data-tab=politics]');
  await page.tap('#sheet-body [data-act=pol-mode][data-id=law]');
  await page.waitForFunction(() => /Law|court/i.test(document.getElementById('sheet-body').textContent));
  await page.tap('#sheet-body [data-act=pol-mode][data-id=foreign]');
  await page.waitForFunction(() => /Greenvale/.test(document.getElementById('sheet-body').textContent));
  step('trade, laws & courts and foreign relations panels open');

  // Milestone 5.1: Holiday Preview changes only the picture; settings and holiday choices are kept.
  await page.evaluate(() => { if (!kingdom.clock.paused) kingdom.clock.togglePause(); });
  const frozen = await page.evaluate(() => JSON.stringify(kingdom.sim.state));
  await page.tap('#tabbar button[data-tab=council]');
  await page.waitForSelector('#celebrations');
  assert.match(await page.textContent('#sheet-body'), /v0\.5\.2/, 'version 0.5.2 shown');
  assert.ok(await page.isVisible('#sound-settings'), 'sound & music settings');
  await page.evaluate(() => document.getElementById('celebrations').scrollIntoView());
  await page.tap('#sheet-body [data-act=preview][data-id=valentine]');
  await page.waitForSelector('#view-banner:not([hidden])');
  assert.match(await page.textContent('#view-banner'), /Previewing/);
  assert.equal(await page.evaluate(() => kingdom.world.themes.preview?.id), 'valentine');
  await page.waitForTimeout(1500);
  assert.ok(await page.evaluate(() => kingdom.world.themes.set?.count > 20), 'the town is decorated');
  assert.match(await page.textContent('#holiday-chip'), /Preview/);
  await page.tap('#sheet-body [data-act=preview][data-id=halloween]');
  await page.waitForTimeout(800);
  await page.tap('#go-home');
  await page.waitForSelector('#view-banner[hidden]', { state: 'attached' });
  assert.equal(await page.evaluate(() => kingdom.world.themes.preview), null);
  assert.equal(await page.evaluate(() => JSON.stringify(kingdom.sim.state)), frozen, 'preview changed nothing in the kingdom');
  step('Holiday Preview shows Valentine\'s Day and Halloween and returns to the real season, changing nothing');
  await page.evaluate(() => document.getElementById('celebrations').scrollIntoView());
  await page.tap('#sheet-body [data-act=hset][data-key=density][data-value=low]');
  await page.tap('#sheet-body [data-act=holiday-toggle][data-id=halloween]');
  assert.equal(await page.evaluate(() => kingdom.settings.holidays.density), 'low');
  assert.equal(await page.evaluate(() => kingdom.sim.state.holidays.enabled.halloween), false);
  await page.evaluate(() => kingdom.hud.toasts.show('A test notice'));
  await page.tap('#toasts .toast:last-child');
  await page.waitForFunction(() => ![...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent === 'A test notice' && !t.classList.contains('leaving')));
  await page.evaluate(() => kingdom.clock.togglePause());
  step('holiday and graphics settings respond to touch; a tap dismisses a notice');

  // v0.5.2: Era & technology, City evolution, and Then & Now (which changes nothing).
  await page.evaluate(() => { if (!kingdom.clock.paused) kingdom.clock.togglePause(); });
  await page.tap('#era-chip');
  await page.waitForFunction(() => /Age of Foundations/.test(document.getElementById('sheet-body').textContent) && /Technology/.test(document.getElementById('sheet-body').textContent));
  await page.tap('#sheet-body [data-act=world-mode][data-id=evolution]');
  await page.waitForFunction(() => /City evolution/.test(document.getElementById('sheet-body').textContent));
  step('the era chip opens Era & technology; City evolution shows the buildings by era');
  const untouched = await page.evaluate(() => JSON.stringify(kingdom.sim.state));
  await page.evaluate(() => kingdom.hud.openDetail('plot', kingdom.sim.state.plots.find((p) => p.name === 'Timber Edge').id));
  await page.waitForSelector('#sheet-body [data-act=thennow]');
  await page.tap('#sheet-body [data-act=thennow]');
  await page.waitForFunction(() => !!kingdom.world.thenNow && /Then & Now/.test(document.getElementById('sheet-title').textContent));
  await page.evaluate(() => { const r = document.querySelector('#sheet-body input[data-act=then-split]'); r.value = '20'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => kingdom.world.thenNow.split), 0.2);
  await page.tap('#sheet-body [data-act=then-exit]');
  await page.waitForFunction(() => !kingdom.world.thenNow);
  assert.equal(await page.evaluate(() => JSON.stringify(kingdom.sim.state)), untouched, 'Then & Now changed nothing in the kingdom');
  await page.evaluate(() => kingdom.clock.togglePause());
  step('Then & Now opens a property\'s history in 3D with a before/after divider and returns to the present');

  // Orientation: landscape and back, the renderer follows.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  const land = await page.evaluate(() => ({ w: kingdom.world.renderer.domElement.clientWidth, h: kingdom.world.renderer.domElement.clientHeight }));
  assert.ok(land.w > land.h, `landscape canvas ${land.w}×${land.h}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const port = await page.evaluate(() => ({ w: kingdom.world.renderer.domElement.clientWidth, h: kingdom.world.renderer.domElement.clientHeight }));
  assert.ok(port.h > port.w, `portrait canvas ${port.w}×${port.h}`);
  step('the 3D view survives orientation changes');

  // Hidden and back: sound suspends and waits for a tap.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => kingdom.audio.ctx.state), 'suspended');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => kingdom.audio.ctx.state), 'suspended', 'no autoplay on return');
  await page.tap('#pause'); await page.tap('#pause');
  await page.waitForFunction(() => kingdom.audio.ctx.state === 'running');
  step('sound suspends while hidden and resumes only on the next tap');

  await page.evaluate(async () => { while (kingdom.sim.state.day < 9) kingdom.sim.step(); await kingdom.save(); });
  const saved = await page.evaluate(() => ({ day: kingdom.sim.state.day, tick: kingdom.sim.state.tick }));
  await page.reload();
  await page.waitForFunction(() => window.__konStarted === true, null, { timeout: 20000 });
  assert.match(await page.textContent('#boot-go'), /Continue/);
  assert.equal(await page.evaluate(() => document.getElementById('boot-sound').checked), true, 'the sound choice is remembered');
  assert.equal(await page.evaluate(() => kingdom.audio.ctx), null, 'but nothing plays until Continue is tapped');
  await page.tap('#boot-go');
  await page.waitForFunction(() => window.__konEntered === true);
  const loaded = await page.evaluate(() => ({ day: kingdom.sim.state.day, tick: kingdom.sim.state.tick }));
  assert.equal(loaded.day, saved.day);
  assert.ok(loaded.tick >= saved.tick);
  assert.equal(await page.evaluate(() => kingdom.settings.holidays.density), 'low', 'display settings kept on this device');
  assert.equal(await page.evaluate(() => kingdom.sim.state.holidays.enabled.halloween), false, 'holiday choices kept with the kingdom');
  step('the world survives a page reload, with its holiday choices and settings');

  // Offline: the service worker serves the game from its versioned cache.
  const sw = await page.evaluate(async () => { if (!('serviceWorker' in navigator)) return null; const reg = await navigator.serviceWorker.ready; return { scope: reg.scope, caches: await caches.keys() }; });
  if (sw) {
    assert.ok(sw.caches.some((k) => k.startsWith('kon-')), `versioned cache (${sw.caches.join(', ')})`);
    await page.waitForTimeout(1500);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.__konStarted === true, null, { timeout: 20000 });
    await ctx.setOffline(false);
    step('offline: the installed game starts from the service worker cache');
  }

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('mobile e2e: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
