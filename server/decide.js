import { getToken as oauthToken } from './token.js';

const criteria = {
  MOVE_FORWARD: 'Advance toward an objective or through open space.',
  MOVE_BACK: 'Retreat from nearby danger.',
  STRAFE_LEFT: 'Dodge left without turning.',
  STRAFE_RIGHT: 'Dodge right without turning.',
  TURN_LEFT: 'Turn left to find a target or passage.',
  TURN_RIGHT: 'Turn right to find a target or passage.',
  ATTACK: 'Fire at a visible enemy in front when ammunition is available.',
  USE: 'Open a nearby door or activate a switch.',
  WAIT: 'Take no action.',
};
export const ACTIONS = Object.keys(criteria);
export const INSTRUCTIONS = 'Play Doom using the tactical state. Choose one action to survive, explore, collect supplies, and reach the exit. Attack only when an enemy is visible and in front of you with ammunition available. Use movement and turning to navigate when there is no target.';

export async function decide(observation, { fetch: request = globalThis.fetch, getToken = oauthToken } = {}) {
  const start = performance.now();
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, 4000);
    });
    const result = await Promise.race([timeout, (async () => {
      const token = await getToken();
      if (controller.signal.aborted) throw Error('timeout');
      const host = process.env.DATABRICKS_HOST;
      if (!host) throw Error('Missing DATABRICKS_HOST');
      const response = await request(`${host.replace(/\/$/, '')}/api/2.0/ai-functions/ai-decide`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: observation, questions: { action: { type: 'choice', instructions: INSTRUCTIONS, criteria } }, options: { version: '1.0' } }),
        signal: controller.signal,
      });
      if (!response.ok) throw Error(`ai_decide HTTP ${response.status}`);
      const data = await response.json();
      if (data.error_message) throw Error(data.error_message);
      const answer = data.response?.answers?.action;
      if (!ACTIONS.includes(answer?.choice) || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) throw Error('Invalid decision response');
      return { action: answer.choice, confidence: answer.confidence };
    })()]);
    return { ...result, latencyMs: performance.now() - start };
  } catch (error) {
    return { error: controller.signal.aborted ? 'timeout' : error.message || 'Decision failed', latencyMs: performance.now() - start };
  } finally { clearTimeout(timer); }
}
