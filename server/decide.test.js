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

test('times out after fifteen seconds even if a dependency never settles', async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const pending = decide({}, { getToken: () => new Promise(() => {}), fetch: vi.fn() });
  await vi.advanceTimersByTimeAsync(15000);
  expect(await pending).toMatchObject({ error: 'timeout' });
  expect(JSON.parse(log.mock.calls.at(-1)[0])).toMatchObject({ outcome: 'timeout', tokenMs: 15000 });
  log.mockRestore();
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

test('accepts a valid label without confidence', async () => {
  const body = { response: { answers: { action: { choice: 'ATTACK' } } } };
  expect(await decide({}, deps(body))).toMatchObject({ action: 'ATTACK', confidence: null });
});

test('uses HTTPS for a workspace host without a scheme', async () => {
  vi.stubEnv('DATABRICKS_HOST', 'workspace.example/');
  const result = await decide({}, { ...deps(), fetch: async url => {
    expect(url).toBe('https://workspace.example/api/2.0/ai-functions/ai-decide');
    return new Response(JSON.stringify(answer));
  } });
  expect(result.action).toBe('ATTACK');
});

test('uses HTTPS for OAuth when the workspace host has no scheme', async () => {
  vi.resetModules();
  const { getToken: freshToken } = await import('./token.js');
  vi.stubEnv('DATABRICKS_HOST', 'oauth.example/');
  vi.stubEnv('DATABRICKS_CLIENT_ID', 'client');
  vi.stubEnv('DATABRICKS_CLIENT_SECRET', 'secret');
  let tokenUrl;
  vi.stubGlobal('fetch', async url => {
    tokenUrl = url;
    return new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }));
  });
  expect(await freshToken()).toBe('fresh');
  expect(tokenUrl).toBe('https://oauth.example/oidc/v1/token');
});

test.each([200, 401])('refreshes a rejected cached token and retries only once, final HTTP %i', async finalStatus => {
  vi.resetModules();
  const { getToken: freshToken } = await import('./token.js');
  const { decide: freshDecide } = await import('./decide.js');
  vi.stubEnv('DATABRICKS_CLIENT_ID', 'client');
  vi.stubEnv('DATABRICKS_CLIENT_SECRET', 'secret');
  let tokens = 0;
  const authorizations = [];
  vi.stubGlobal('fetch', async (url, init) => {
    if (url.endsWith('/oidc/v1/token')) return new Response(JSON.stringify({ access_token: `token-${++tokens}`, expires_in: 3600 }));
    authorizations.push(init.headers.Authorization);
    return new Response(JSON.stringify(answer), { status: authorizations.length === 1 ? 401 : finalStatus });
  });
  expect(await freshToken()).toBe('token-1');
  const result = await freshDecide({});
  expect(authorizations).toEqual(['Bearer token-1', 'Bearer token-2']);
  expect(tokens).toBe(2);
  if (finalStatus === 200) expect(result.action).toBe('ATTACK');
  else expect(result.error).toBe('ai_decide HTTP 401');
});

test.each([200, 500])('rounds decision latency for HTTP %i', async status => {
  const now = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(101.6);
  try { expect((await decide({}, deps(answer, status))).latencyMs).toBe(2); }
  finally { now.mockRestore(); }
});

test('logs token, serialization and upstream durations without credentials or observations', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    await decide({ health: 80, privateMarker: 'do-not-log' }, deps());
    const event = JSON.parse(log.mock.calls.at(-1)?.[0] ?? '{}');
    expect(event).toMatchObject({ event: 'ai_decide', outcome: 'success', tokenMs: expect.any(Number), serializeMs: expect.any(Number), upstreamMs: expect.any(Number), latencyMs: expect.any(Number), requestBytes: expect.any(Number), attempts: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  } finally { log.mockRestore(); }
});

test('allows an eight-second upstream decision instead of discarding it at four seconds', async () => {
  vi.useFakeTimers();
  const pending = decide({}, { ...deps(), fetch: () => new Promise(resolve => setTimeout(() => resolve(new Response(JSON.stringify(answer))), 8000)) });
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toMatchObject({ action: 'ATTACK' });
});
