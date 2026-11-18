import request from 'supertest';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from './app.js';
import { intervalMs } from './budget.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const success = async () => ({ action: 'ATTACK', confidence: 0.9, latencyMs: 747 });
const session = async app => (await request(app).post('/api/session')).body.sessionId;
const choose = (app, sessionId, observation = {}) => request(app).post('/api/decide').send({ sessionId, observation });

test('health and session admission refuse the thirteenth visitor', async () => {
  const app = createApp({ decide: success });
  expect((await request(app).get('/healthz')).status).toBe(200);
  for (let i = 0; i < 12; i++) expect((await request(app).post('/api/session')).status).toBe(201);
  const full = await request(app).post('/api/session');
  expect(full.status).toBe(503);
  expect(full.body).toEqual({ error: 'full' });
});

test.each([[60000, false], [900000, true]])('expires and releases sessions at %i ms', async (duration, keepAlive) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const app = createApp({ decide: success });
  const id = await session(app);
  if (keepAlive) for (let elapsed = 30000; elapsed < duration; elapsed += 30000) {
    vi.setSystemTime(Date.now() + 30000);
    expect((await choose(app, id)).status).toBe(200);
  }
  vi.setSystemTime(Date.now() + (keepAlive ? 30000 : duration));
  expect((await choose(app, id)).status).toBe(410);
  for (let i = 0; i < 12; i++) expect((await request(app).post('/api/session')).status).toBe(201);
});

test('scales cadence below eighteen requests per second', () => {
  expect(intervalMs(1)).toBe(400);
  expect(intervalMs(12)).toBeGreaterThanOrEqual(667);
});

test('returns decisions and deletes sessions', async () => {
  const app = createApp({ decide: success });
  const id = await session(app);
  expect((await choose(app, id)).body).toEqual({ action: 'ATTACK', holdMs: 300, intervalMs: 400, latencyMs: 747, decisions: 1 });
  expect((await request(app).delete(`/api/session/${id}`)).status).toBe(204);
  expect((await choose(app, id)).status).toBe(404);
});

test.each([async () => ({ error: 'upstream' }), async () => { throw Error('upstream'); }])('maps failed decisions to noDecision', async decide => {
  const app = createApp({ decide });
  expect((await choose(app, await session(app))).body).toEqual({ noDecision: true, intervalMs: 400 });
});

test('unknown sessions and invalid observations never spend decisions', async () => {
  const app = createApp({ decide: () => { throw Error('must not call'); } });
  expect((await choose(app, 'unknown')).status).toBe(404);
  expect((await choose(app, await session(app), 'invalid')).status).toBe(400);
});

test('enforces cadence and only one in-flight request per session', async () => {
  let resolve;
  const app = createApp({ decide: () => new Promise(done => { resolve = done; }) });
  const id = await session(app);
  const pending = choose(app, id).then(response => response);
  while (!resolve) await new Promise(done => setImmediate(done));
  expect((await choose(app, id)).body.noDecision).toBe(true);
  resolve(await success());
  await pending;
  expect((await choose(app, id)).body.noDecision).toBe(true);
});

test('enforces a global rolling budget even if clients ignore cadence', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let calls = 0;
  const app = createApp({ decide: async () => { calls++; return success(); } });
  const ids = await Promise.all(Array.from({ length: 12 }, () => session(app)));
  for (const id of ids) await choose(app, id);
  vi.setSystemTime(Date.now() + 667);
  for (const id of ids) await choose(app, id);
  expect(calls).toBe(18);
  vi.setSystemTime(Date.now() + 1000);
  expect((await choose(app, ids[0])).body.action).toBe('ATTACK');
});

test('session caps are configurable and stale slots are reclaimed on admission', async () => {
  vi.stubEnv('MAX_SESSIONS', '1');
  vi.stubEnv('SESSION_IDLE_MS', '1000');
  vi.useFakeTimers({ toFake: ['Date'] });
  const app = createApp({ decide: success });
  await session(app);
  expect((await request(app).post('/api/session')).status).toBe(503);
  vi.setSystemTime(Date.now() + 1000);
  expect((await request(app).post('/api/session')).status).toBe(201);
});
