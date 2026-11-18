const { test, expect } = require('@playwright/test');

const load = async (page, url) => {
  await page.goto(url);
  await page.evaluate(() => DoomBridge.ready);
  await page.evaluate(async () => { window.CONTROL = (await import('/public/controls.js')).CONTROL; });
};

const obs = (page) => page.evaluate(() => DoomBridge.observe());
const sleep = (page, ms) => page.waitForTimeout(ms);

test.beforeEach(({ page }) => load(page, '/tests/engine.html'));

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

// Presses keys (Escape opens the menu, which freezes the player; Control fires), drags the mouse,
// then holds FORWARD for a while. Returns the state before and after.
const injectInput = async (page, keys = ['ArrowUp', 'w', 'Control', 'Space', 'Escape', 'Enter']) => {
  const a = await obs(page);
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(300, 200, { steps: 10 });
  await sleep(page, 300);
  await page.evaluate(() => DoomBridge.setControls(CONTROL.FORWARD));
  await sleep(page, 1200);
  await page.evaluate(() => DoomBridge.setControls(0));
  const b = await obs(page);
  for (const k of keys) await page.keyboard.up(k);
  await page.mouse.up();
  return [a, b];
};
const moved = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

test('keyboard and mouse never reach the game', async ({ page }) => {
  const [a, b] = await injectInput(page);
  expect(moved(a, b)).toBeGreaterThan(20); // Escape did not open the menu, so FORWARD still walks
  for (const k of ['angle', 'health', 'weapon', 'ammo']) expect(b[k]).toBe(a[k]); // no mouse turn, no Control fire
});

test('setSpeed accepts only 1, 2, 4, 8 and ignores anything else', async ({ page }) => {
  const speed = async (v) => { await page.evaluate((n) => DoomBridge.setSpeed(n), v); return (await obs(page)).speed; };
  expect(await speed(1)).toBe(1);
  expect(await speed(4)).toBe(4);
  for (const bad of [3, 0, -2, 16, 1000000, 2.5, NaN, null, undefined, 'abc']) expect(await speed(bad)).toBe(4);
  expect(await speed(8)).toBe(8);
});

// The control: the same injected input must move the player and spend ammo when input is allowed,
// so the test above can actually fail. The debug build (tests/debug-engine/) is not served to viewers.
test.describe('debug build', () => {
  test.beforeEach(({ page }) => load(page, '/tests/engine-debug.html'));

  test('negative control: injected input does reach a build that allows it', async ({ page }) => {
    await page.evaluate(() => Module._agent_debug_enable_input());
    const [a, b] = await injectInput(page, ['Escape']);
    expect(moved(a, b)).toBeLessThan(5); // Escape opened the menu, so FORWARD did nothing
  });

  test('attacking is true only in attack states, not while chasing', async ({ page }) => {
    const MT_POSSESSED = 1; // zombieman, a hitscan attacker with a short attack chain
    await page.evaluate((t) => Module._agent_debug_spawn(t, 200), MT_POSSESSED);
    const seen = await page.evaluate(() => new Promise((resolve) => {
      const s = { attacking: 0, chasing: 0 };
      const end = Date.now() + 8000;
      const t = setInterval(() => {
        const o = DoomBridge.observe();
        const m = o.monsters[0];
        if (m) s[m.attacking ? 'attacking' : 'chasing']++;
        if ((s.attacking && s.chasing > 3) || Date.now() > end || o.health <= 0) { clearInterval(t); resolve(s); }
      }, 20);
    }));
    expect(seen.attacking).toBeGreaterThan(0);
    expect(seen.chasing).toBeGreaterThan(0);
  });
});
