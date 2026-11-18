const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/engine.html');
  await page.evaluate(() => DoomBridge.ready);
  await page.evaluate(async () => { window.CONTROL = (await import('/public/controls.js')).CONTROL; });
});

const obs = (page) => page.evaluate(() => DoomBridge.observe());
const sleep = (page, ms) => page.waitForTimeout(ms);

test('observe returns tactical state', async ({ page }) => {
  const o = await obs(page);
  expect(o.health).toBe(100);
  for (const k of ['armor', 'ammo', 'weapon', 'x', 'y', 'angle', 'gametic']) expect(typeof o[k]).toBe('number');
  expect(Array.isArray(o.monsters)).toBe(true);
  expect(Array.isArray(o.pickups)).toBe(true);
  expect(o.paused).toBe(false);
});

test('setControls moves the player', async ({ page }) => {
  const a = await obs(page);
  await page.evaluate(() => DoomBridge.setControls(CONTROL.FORWARD));
  await sleep(page, 1000);
  await page.evaluate(() => DoomBridge.setControls(0));
  const b = await obs(page);
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(20);
});

test('setPaused freezes gametic', async ({ page }) => {
  await page.evaluate(() => DoomBridge.setPaused(true));
  const a = await obs(page);
  await sleep(page, 1000);
  const b = await obs(page);
  expect(b.paused).toBe(true);
  expect(b.gametic).toBe(a.gametic);
  await page.evaluate(() => DoomBridge.setPaused(false));
  await sleep(page, 500);
  expect((await obs(page)).gametic).toBeGreaterThan(a.gametic);
});

test('setSpeed scales game time', async ({ page }, info) => {
  const rate = async (n) => {
    await page.evaluate((s) => DoomBridge.setSpeed(s), n);
    await sleep(page, 300);
    const t0 = Date.now(), a = (await obs(page)).gametic;
    await sleep(page, 3000);
    const b = (await obs(page)).gametic;
    return (b - a) / ((Date.now() - t0) / 1000);
  };
  const r = {};
  for (const n of [1, 2, 4, 8]) r[n] = await rate(n);
  const ratios = { 2: r[2] / r[1], 4: r[4] / r[1], 8: r[8] / r[1] };
  console.log('tics/s', JSON.stringify(r), 'ratios', JSON.stringify(ratios));
  info.annotations.push({ type: 'ratios', description: JSON.stringify(ratios) });
  expect(r[1]).toBeGreaterThan(30);
  for (const n of [2, 4, 8]) expect(Math.abs(ratios[n] - n) / n).toBeLessThan(0.25);
});

test('keyboard and mouse never reach the game', async ({ page }) => {
  const a = await obs(page);
  const canvas = page.locator('#canvas');
  await canvas.click();
  for (const k of ['ArrowUp', 'w', 'Control', 'Space', 'Escape', 'Enter']) await page.keyboard.down(k);
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(300, 200, { steps: 10 });
  await sleep(page, 1000);
  const b = await obs(page);
  for (const k of ['x', 'y', 'angle', 'health', 'weapon']) expect(b[k]).toBe(a[k]);
  // Escape would open the menu, which pauses single-player time.
  expect(b.gametic).toBeGreaterThan(a.gametic + 10);
});
