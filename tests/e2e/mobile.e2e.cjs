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

  for (const tab of ['families', 'economy', 'politics', 'history']) {
    await page.tap(`#tabbar button[data-tab=${tab}]`);
    await page.waitForFunction((t) => document.querySelector(`#tabbar button[data-tab=${t}]`).classList.contains('active') && document.getElementById('sheet-body').textContent.trim().length > 20, tab);
  }
  await page.tap('#sheet-body [data-act=bio]');
  await page.waitForFunction(() => document.getElementById('sheet-body').textContent.includes('Family tree'));
  await page.tap('#sheet-body [data-act=tree]');
  await page.waitForSelector('#sheet-body .tree-node');
  step('families, economy, politics and history tabs open; biography and family tree respond to touch');

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
  for (const mode of ['kingdoms', 'caravans', 'diplomacy', 'explore']) {
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
  await page.tap('#tabbar button[data-tab=economy]');
  await page.tap('#sheet-body [data-act=econ-mode][data-id=trade]');
  await page.waitForFunction(() => /market|caravan|contract/i.test(document.getElementById('sheet-body').textContent));
  await page.tap('#tabbar button[data-tab=politics]');
  await page.tap('#sheet-body [data-act=pol-mode][data-id=law]');
  await page.waitForFunction(() => /Law|court/i.test(document.getElementById('sheet-body').textContent));
  await page.tap('#sheet-body [data-act=pol-mode][data-id=foreign]');
  await page.waitForFunction(() => /Greenvale/.test(document.getElementById('sheet-body').textContent));
  step('trade, laws & courts and foreign relations panels open');

  await page.evaluate(async () => { while (kingdom.sim.state.day < 9) kingdom.sim.step(); await kingdom.save(); });
  const saved = await page.evaluate(() => ({ day: kingdom.sim.state.day, tick: kingdom.sim.state.tick }));
  await page.reload();
  await page.waitForFunction(() => window.__konStarted === true, null, { timeout: 20000 });
  const loaded = await page.evaluate(() => ({ day: kingdom.sim.state.day, tick: kingdom.sim.state.tick }));
  assert.equal(loaded.day, saved.day);
  assert.ok(loaded.tick >= saved.tick);
  step('the world survives a page reload');

  assert.deepEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('mobile e2e: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
