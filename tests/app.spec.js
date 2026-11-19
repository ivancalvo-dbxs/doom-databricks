import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:4174' });

// Mock /api/*. `decide(body, n)` returns the reply (or a promise of it); every call is recorded.
async function setup(page, { session = { status: 201, body: { sessionId: 's1', intervalMs: 50 } }, decideStatus = 200, sessionGate, decide } = {}) {
  const log = { decides: [], sessions: 0, deleted: [], deletes: 0, inFlight: 0, maxInFlight: 0 };
  await page.addInitScript(() => {
    window.__controls = [];
    let bridge;
    Object.defineProperty(window, 'DoomBridge', {
      configurable: true,
      get: () => bridge,
      set(v) { const set = v.setControls; v.setControls = (m) => { window.__controls.push(m); set(m); }; bridge = v; },
    });
  });
  await page.route('**/api/session', async (r) => {
    log.sessions++;
    await sessionGate;
    await r.fulfill({ status: session.status, json: { ...session.body, sessionId: `s${log.sessions}` } });
  });
  await page.route('**/api/session/*', (r) => { log.deletes++; log.deleted.push(r.request().url().split('/').pop()); r.fulfill({ status: 204 }); });
  await page.route('**/api/decide', async (r) => {
    const body = r.request().postDataJSON();
    log.decides.push(body);
    log.maxInFlight = Math.max(log.maxInFlight, ++log.inFlight);
    const reply = await decide(body, log.decides.length);
    log.inFlight--;
    await r.fulfill({ status: decideStatus, json: reply });
  });
  await page.goto('/');
  return log;
}
const ok = (action, n) => ({ action, holdMs: 300, intervalMs: 50, latencyMs: 123, decisions: n });
const hud = (page) => page.locator('#hud');

test('page renders the game on a canvas', async ({ page }) => {
  await setup(page, { decide: async (_b, n) => ok('WAIT', n) });
  await page.evaluate(() => DoomBridge.ready);
  await expect(page.locator('#canvas')).toBeVisible();
  const box = await page.locator('#canvas').boundingBox();
  expect(box.width / box.height).toBeCloseTo(4 / 3, 1);
});

test('one request in flight, observation sent, HUD shows the fields', async ({ page }) => {
  const log = await setup(page, { decide: async (_b, n) => { await new Promise((r) => setTimeout(r, 100)); return ok('ATTACK', n); } });
  await expect.poll(() => log.decides.length).toBeGreaterThan(3);
  expect(log.maxInFlight).toBe(1);
  expect(log.decides[0]).toMatchObject({ sessionId: 's1', observation: { health: 100 } });
  await expect(hud(page)).toContainText('ai_decide 123 ms');
  await expect(hud(page)).toContainText('decisions/s');
  await expect(hud(page)).toContainText('health 100');
  await expect(hud(page)).toContainText('ATTACK');
  await expect(hud(page)).not.toContainText('NO DECISION');
  expect(await page.evaluate(() => __controls)).toContain(64);
});

test('next request waits intervalMs after the previous reply', async ({ page }) => {
  const times = [];
  await setup(page, { session: { status: 201, body: { sessionId: 's1', intervalMs: 400 } }, decide: async (_b, n) => { times.push(Date.now()); return { ...ok('WAIT', n), intervalMs: 400 }; } });
  await expect.poll(() => times.length).toBeGreaterThan(2);
  expect(times[2] - times[1]).toBeGreaterThanOrEqual(380);
});

test('reply arriving after pause is ignored and pause sends nothing', async ({ page }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const log = await setup(page, { decide: async (_b, n) => (n === 1 ? (await gate, ok('ATTACK', 99)) : ok('WAIT', n)) });
  await expect.poll(() => log.decides.length).toBe(1);
  await page.click('#pause');
  release();
  await page.waitForTimeout(400);
  expect(log.decides.length).toBe(1);
  await expect(hud(page)).not.toContainText('ATTACK');
  expect(await page.evaluate(() => __controls)).not.toContain(64);
  await page.click('#pause');
  await expect.poll(() => log.decides.length).toBeGreaterThan(1);
});

test('noDecision shows the marker and controls fall to WAIT after the hold', async ({ page }) => {
  const log = await setup(page, { decide: async (_b, n) => (n === 1 ? ok('MOVE_FORWARD', 1) : { noDecision: true, intervalMs: 50 }) });
  await expect(hud(page)).toContainText('NO DECISION');
  await expect.poll(() => page.evaluate(() => __controls.slice(-1)[0])).toBe(0);
  expect(await page.evaluate(() => __controls)).toContain(1);
  expect(log.decides.length).toBeGreaterThan(1);
});

test('hidden tab sends nothing and resumes when visible', async ({ page }) => {
  const log = await setup(page, { decide: async (_b, n) => ok('WAIT', n) });
  await expect.poll(() => log.decides.length).toBeGreaterThan(1);
  const hide = (hidden) => page.evaluate((h) => { Object.defineProperty(document, 'hidden', { value: h, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await hide(true);
  await page.waitForTimeout(150); // let any request already on the wire settle
  const n = log.decides.length;
  await page.waitForTimeout(500);
  expect(log.decides.length).toBe(n);
  await hide(false);
  await expect.poll(() => log.decides.length).toBeGreaterThan(n);
});

test('leaving the page deletes the session', async ({ page }) => {
  const log = await setup(page, { decide: async (_b, n) => ok('WAIT', n) });
  await expect.poll(() => log.decides.length).toBeGreaterThan(0);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await expect.poll(() => log.deletes).toBe(1);
});

test('a full server shows a message', async ({ page }) => {
  const log = await setup(page, { session: { status: 503, body: { error: 'full' } }, decide: async () => ({}) });
  await expect(hud(page)).toContainText('full');
  expect(log.decides.length).toBe(0);
});

test('an expired session stops the loop', async ({ page }) => {
  const log = await setup(page, { decideStatus: 410, decide: async () => ({ error: 'expired' }) });
  await expect(hud(page)).toContainText('expired');
  await page.waitForTimeout(300);
  expect(log.decides.length).toBe(1);
});

test('pause/resume or hide/show while a request is pending never starts a second one', async ({ page }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const log = await setup(page, { decide: async (_b, n) => (n === 1 ? (await gate, ok('WAIT', 1)) : ok('WAIT', n)) });
  await expect.poll(() => log.decides.length).toBe(1);
  const hide = (h) => page.evaluate((v) => { Object.defineProperty(document, 'hidden', { value: v, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, h);
  await page.click('#pause');
  await page.click('#pause');
  await hide(true);
  await hide(false);
  await page.waitForTimeout(300);
  expect(log.decides.length).toBe(1);
  expect(log.maxInFlight).toBe(1);
  release();
  await expect.poll(() => log.decides.length).toBeGreaterThan(1);
  expect(log.maxInFlight).toBe(1);
});

test('pagehide stops the loop and deletes the session; bfcache restore starts a fresh one', async ({ page }) => {
  const log = await setup(page, { decide: async (_b, n) => ok('WAIT', n) });
  await expect.poll(() => log.decides.length).toBeGreaterThan(1);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  await expect.poll(() => log.deleted).toEqual(['s1']);
  await page.waitForTimeout(150);
  const n = log.decides.length;
  await page.waitForTimeout(400);
  expect(log.decides.length).toBe(n);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => log.sessions).toBe(2);
  await expect.poll(() => log.decides.length).toBeGreaterThan(n);
  expect(log.decides.at(-1).sessionId).toBe('s2');
});

test('a session that finishes creating after pagehide is deleted and never used', async ({ page }) => {
  let open;
  const sessionGate = new Promise((r) => (open = r));
  const log = await setup(page, { sessionGate, decide: async (_b, n) => ok('WAIT', n) });
  await expect.poll(() => log.sessions).toBe(1);
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  open();
  await expect.poll(() => log.deleted).toEqual(['s1']);
  await page.waitForTimeout(300);
  expect(log.decides.length).toBe(0);
});

test('decisions/s decays to 0 while noDecision replies arrive', async ({ page }) => {
  await setup(page, { decide: async (_b, n) => (n === 1 ? ok('WAIT', 1) : { noDecision: true, intervalMs: 50 }) });
  await expect(hud(page)).toContainText('NO DECISION');
  await expect(hud(page)).toContainText('0.0 decisions/s', { timeout: 15000 }); // the 10 s window empties
});

test('Pause clicked while the session is being created keeps the loop paused until Resume', async ({ page }) => {
  let open;
  const sessionGate = new Promise((r) => (open = r));
  const log = await setup(page, { sessionGate, decide: async (_b, n) => ok('WAIT', n) });
  await expect.poll(() => log.sessions).toBe(1);
  await page.click('#pause');
  await page.click('#speeds button:nth-child(3)');
  open();
  await page.waitForTimeout(500);
  expect(log.decides.length).toBe(0);
  await expect(page.locator('#pause')).toHaveText('Resume');
  expect((await page.evaluate(() => DoomBridge.observe())).paused).toBe(true);
  await page.click('#pause');
  await expect.poll(() => log.decides.length).toBeGreaterThan(0);
});
