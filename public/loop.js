import { CONTROL as C } from './controls.js';

const MASK = { MOVE_FORWARD: C.FORWARD, MOVE_BACK: C.BACK, STRAFE_LEFT: C.STRAFE_L, STRAFE_RIGHT: C.STRAFE_R, TURN_LEFT: C.TURN_L, TURN_RIGHT: C.TURN_R, ATTACK: C.FIRE, USE: C.USE, WAIT: 0 };

// One request in flight; the next one is scheduled intervalMs after the previous reply.
export function startLoop({ bridge, api, onHud, intervalMs = 400 }) {
  let userPaused = false, stopped = false, pending = false, seq = 0, timer, holdTimer, interval = intervalMs;
  const times = [], t0 = Date.now();
  const hud = { latencyMs: null, perSec: 0, decisions: 0, health: null, action: 'WAIT', noDecision: false, ended: null };
  const active = () => !stopped && !userPaused && !document.hidden;
  const release = () => { clearTimeout(holdTimer); bridge.setControls(0); };
  const hold = (action, ms) => { clearTimeout(holdTimer); bridge.setControls(MASK[action] ?? 0); holdTimer = setTimeout(() => bridge.setControls(0), ms); };
  const emit = () => onHud({ ...hud });
  const schedule = () => { clearTimeout(timer); if (active()) timer = setTimeout(tick, interval); };

  // decisions in the last 10 s, so the rate decays while noDecision replies arrive
  const rate = () => {
    const now = Date.now();
    while (times.length && now - times[0] > 10000) times.shift();
    return times.length / Math.min(10, Math.max(1, (now - t0) / 1000));
  };

  async function tick() {
    if (!active() || pending) return; // a stale reply still pending reschedules when it lands
    pending = true;
    const mine = ++seq;
    const observation = bridge.observe();
    hud.health = observation.health;
    let reply;
    try { reply = await api.decide(observation); } catch (e) {
      pending = false;
      if (mine !== seq) return schedule();
      if (e.status === 404 || e.status === 410) { stopped = true; release(); hud.ended = 'session expired, reload to play again'; return emit(); }
      reply = { noDecision: true };
    }
    pending = false;
    if (mine !== seq) return schedule(); // stale: paused, hidden or stopped meanwhile; drop it
    interval = reply.intervalMs ?? interval;
    hud.noDecision = !!reply.noDecision;
    if (!reply.noDecision) {
      times.push(Date.now());
      hud.latencyMs = reply.latencyMs;
      hud.decisions = reply.decisions;
      hud.action = reply.action;
      hold(reply.action, reply.holdMs);
    }
    hud.perSec = rate();
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
