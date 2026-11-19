import { randomUUID } from 'node:crypto';

export function createSessions() {
  const positive = (name, fallback) => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw Error(`Invalid ${name}`);
    return value;
  };
  const max = positive('MAX_SESSIONS', 12);
  const idleMs = positive('SESSION_IDLE_MS', 60000);
  const maxMs = positive('SESSION_MAX_MS', 900000);
  const sessions = new Map();
  const expired = session => Date.now() - session.createdAt >= maxMs || Date.now() - session.lastSeen >= idleMs;
  const prune = () => { for (const [id, session] of sessions) if (expired(session)) sessions.delete(id); };
  return {
    create() {
      prune();
      if (sessions.size >= max) return null;
      const id = randomUUID();
      sessions.set(id, { createdAt: Date.now(), lastSeen: Date.now(), nextAt: 0, inFlight: false, decisions: 0 });
      return id;
    },
    get(id) {
      const session = sessions.get(id);
      if (!session) return { status: 404 };
      if (expired(session)) { sessions.delete(id); return { status: 410 }; }
      return { session };
    },
    delete(id) { sessions.delete(id); },
    count() { prune(); return sessions.size; },
  };
}
