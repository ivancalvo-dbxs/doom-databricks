import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ACTIONS, INSTRUCTIONS, decide } from './decide.js';
import { getToken } from './token.js';

beforeEach(() => vi.stubEnv('DATABRICKS_HOST', 'https://workspace.example'));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const answer = { response: { answers: { action: { choice: 'ATTACK', probabilities: { ATTACK: 0.9 }, confidence: 0.9 } } }, metadata: { version: '1.0' } };
const deps = (body = answer, status = 200) => ({ getToken: async () => 'secret', fetch: async () => new Response(JSON.stringify(body), { status }) });

test('sends native state and choice criteria and reads the real response envelope', async () => {
  vi.stubEnv('DATABRICKS_HOST', 'https://workspace.example');
  const observation = { health: 80, monsters: [] };
  const result = await decide(observation, { ...deps(), fetch: async (url, init) => {
    expect(url).toBe('https://workspace.example/api/2.0/ai-functions/ai-decide');
    expect(init.headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(init.body);
    expect(body.state).toEqual(observation);
    expect(body.options).toEqual({ version: '1.0' });
    expect(body.questions.action).toMatchObject({ type: 'choice', instructions: INSTRUCTIONS });
    expect(Object.keys(body.questions.action.criteria)).toEqual(ACTIONS);
    return new Response(JSON.stringify(answer));
  } });
  expect(result).toMatchObject({ action: 'ATTACK', confidence: 0.9, latencyMs: expect.any(Number) });
});

test.each([
  [{ error_message: 'unavailable', response: null }, 200],
  [{ response: { answers: { action: { choice: 'FLY' } } } }, 200],
  [{ response: null }, 200],
  [{}, 429], [{}, 500],
])('upstream failure yields an error: %j, %i', async (body, status) => {
  expect(await decide({}, deps(body, status))).toMatchObject({ error: expect.any(String), latencyMs: expect.any(Number) });
});

test('times out after four seconds even if a dependency never settles', async () => {
  vi.useFakeTimers();
  const pending = decide({}, { getToken: () => new Promise(() => {}), fetch: vi.fn() });
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toMatchObject({ error: 'timeout' });
});

test('network and token errors never throw', async () => {
  expect(await decide({}, { getToken: async () => { throw Error('credentials'); } })).toMatchObject({ error: expect.any(String) });
});

test('caches OAuth tokens and refreshes sixty seconds before expiry', async () => {
  vi.useFakeTimers();
  vi.stubEnv('DATABRICKS_HOST', 'https://oauth.example');
  vi.stubEnv('DATABRICKS_CLIENT_ID', 'client');
  vi.stubEnv('DATABRICKS_CLIENT_SECRET', 'secret');
  let requests = 0;
  vi.stubGlobal('fetch', async (url, init) => {
    expect(url).toBe('https://oauth.example/oidc/v1/token');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`);
    expect(new URLSearchParams(init.body).get('scope')).toBe('ai-functions');
    expect(new URLSearchParams(init.body).get('grant_type')).toBe('client_credentials');
    return new Response(JSON.stringify({ access_token: `token-${++requests}`, expires_in: 3600 }));
  });
  expect(await getToken()).toBe('token-1');
  expect(await getToken()).toBe('token-1');
  await vi.advanceTimersByTimeAsync(3540000);
  expect(await getToken()).toBe('token-2');
});
