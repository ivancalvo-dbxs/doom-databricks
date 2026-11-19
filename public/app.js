import { startLoop } from './loop.js';

const $ = (id) => document.getElementById(id);
const hudEl = $('hud');
const showHud = (h) => {
  if (h.ended) return (hudEl.textContent = h.ended);
  hudEl.replaceChildren(`ai_decide ${h.latencyMs ?? '-'} ms | ${h.perSec.toFixed(1)} decisions/s | ${h.decisions} decisions | health ${h.health} | ${h.action}`);
  if (h.noDecision) { const b = document.createElement('b'); b.textContent = ' | NO DECISION'; hudEl.append(b); }
};

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (id) => fetch(`/api/session/${id}`, { method: 'DELETE', keepalive: true });

let gen = 0, sessionId, loop, paused = false, speed = 1;

// Registered up front so a page left mid-startup is still cleaned up.
function end() {
  gen++; // invalidates a start() still waiting on the network
  loop?.stop();
  loop = null;
  if (sessionId) del(sessionId);
  sessionId = null;
}

async function start() {
  const mine = ++gen;
  paused = false;
  $('pause').textContent = 'Pause';
  await DoomBridge.ready;
  const res = await post('/api/session', {});
  if (res.status === 503) return mine === gen && (hudEl.textContent = 'Server full, try again in a minute');
  if (!res.ok) return mine === gen && (hudEl.textContent = 'Could not start a session');
  const { sessionId: id, intervalMs } = await res.json();
  if (mine !== gen) return del(id); // page was left while the session was being created
  sessionId = id;
  const api = {
    async decide(observation) {
      const r = await post('/api/decide', { sessionId: id, observation });
      if (!r.ok) throw Object.assign(new Error('decide failed'), { status: r.status });
      return r.json();
    },
  };
  loop = startLoop({ bridge: DoomBridge, api, onHud: showHud, intervalMs });
  loop.setSpeed(speed);
}

addEventListener('pagehide', end);
addEventListener('pageshow', (e) => e.persisted && start()); // bfcache restore

$('pause').onclick = () => { paused = !paused; paused ? loop?.pause() : loop?.resume(); $('pause').textContent = paused ? 'Resume' : 'Pause'; };
for (const n of [1, 2, 4, 8]) {
  const b = Object.assign(document.createElement('button'), { textContent: `${n}x` });
  b.onclick = () => { speed = n; loop?.setSpeed(n); for (const o of $('speeds').children) o.classList.toggle('on', o === b); };
  $('speeds').append(b);
  if (n === 1) b.classList.add('on');
}
start();
