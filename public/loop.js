import { CONTROL as C } from './controls.js';

const MASK = { MOVE_FORWARD: C.FORWARD, MOVE_BACK: C.BACK, STRAFE_LEFT: C.STRAFE_L, STRAFE_RIGHT: C.STRAFE_R, TURN_LEFT: C.TURN_L, TURN_RIGHT: C.TURN_R, ATTACK: C.FIRE, USE: C.USE, WAIT: 0 };

// One request in flight; the next one is scheduled intervalMs after the previous reply.
export function startLoop({ bridge, api, onHud, intervalMs = 400 }) {
  let userPaused = false, stopped = false, seq = 0, timer, holdTimer, interval = intervalMs;
  const times = [];
  const hud = { latencyMs: null, perSec: 0, decisions: 0, health: null, action: 'WAIT', noDecision: false, ended: null };
  const active = () => !stopped && !userPaused && !document.hidden;
  const release = () => { clearTimeout(holdTimer); bridge.setControls(0); };
  const hold = (action, ms) => { clearTimeout(holdTimer); bridge.setControls(MASK[action] ?? 0); holdTimer = setTimeout(() => bridge.setControls(0), ms); };
  const emit = () => onHud({ ...hud });
  const schedule = () => { clearTimeout(timer); if (active()) timer = setTimeout(tick, interval); };

  async function tick() {
    if (!active()) return;
    const mine = ++seq;
    const observation = bridge.observe();
    hud.health = observation.health;
    let reply;
    try { reply = await api.decide(observation); } catch (e) {
      if (mine !== seq) return;
      if (e.status === 404 || e.status === 410) { stopped = true; release(); hud.ended = 'session expired, reload to play again'; return emit(); }
      reply = { noDecision: true };
    }
    if (mine !== seq) return; // stale: paused, hidden or stopped meanwhile
    interval = reply.intervalMs ?? interval;
    hud.noDecision = !!reply.noDecision;
    if (!reply.noDecision) {
      const now = Date.now();
      times.push(now);
      while (now - times[0] > 10000) times.shift();
      hud.perSec = times.length / Math.min(10, Math.max(1, (now - times[0]) / 1000 + interval / 1000));
      hud.latencyMs = reply.latencyMs;
      hud.decisions = reply.decisions;
      hud.action = reply.action;
      hold(reply.action, reply.holdMs);
    }
    emit();
    schedule();
  }

  const sync = () => {
    seq++; // invalidates any reply still in flight
    clearTimeout(timer);
    if (active()) { bridge.setPaused(false); tick(); } else { release(); bridge.setPaused(true); }
  };
  const onVisibility = () => sync();
  document.addEventListener('visibilitychange', onVisibility);
  sync();

  return {
    pause() { userPaused = true; sync(); },
    resume() { userPaused = false; sync(); },
    setSpeed: (n) => bridge.setSpeed(n),
    stop() { stopped = true; seq++; clearTimeout(timer); release(); document.removeEventListener('visibilitychange', onVisibility); },
  };
}
