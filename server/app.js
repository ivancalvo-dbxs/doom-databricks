import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide as realDecide } from './decide.js';
import { createSessions } from './sessions.js';
import { createBudget, intervalMs } from './budget.js';

export function createApp({ decide = realDecide } = {}) {
  const app = express();
  const sessions = createSessions();
  const budget = createBudget();
  app.use(express.json({ limit: '32kb' }));
  app.get('/healthz', (_req, res) => res.sendStatus(200));
  app.post('/api/session', (_req, res) => {
    const sessionId = sessions.create();
    if (!sessionId) return res.status(503).json({ error: 'full' });
    res.status(201).json({ sessionId, intervalMs: intervalMs(sessions.count()) });
  });
  app.delete('/api/session/:id', (req, res) => { sessions.delete(req.params.id); res.sendStatus(204); });
  app.post('/api/decide', async (req, res) => {
    const { sessionId, observation } = req.body ?? {};
    const { session, status } = sessions.get(sessionId);
    if (status) return res.status(status).json({ error: status === 410 ? 'expired' : 'unknown' });
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return res.status(400).json({ error: 'Invalid observation' });
    const cadence = intervalMs(sessions.count());
    const noDecision = () => res.json({ noDecision: true, intervalMs: cadence });
    session.lastSeen = Date.now();
    if (session.inFlight || Date.now() < session.nextAt || !budget.take()) return noDecision();
    session.nextAt = Date.now() + cadence;
    session.inFlight = true;
    try {
      const result = await decide(observation);
      if (result.error) return noDecision();
      session.decisions++;
      return res.json({ action: result.action, holdMs: 300, intervalMs: cadence, latencyMs: result.latencyMs, decisions: session.decisions });
    } catch { return noDecision(); }
    finally { session.inFlight = false; }
  });
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request' }));
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(Number(process.env.DATABRICKS_APP_PORT || 8000), '0.0.0.0');
}
