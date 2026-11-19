import { startLoop } from './loop.js';

const $ = (id) => document.getElementById(id);
const hudEl = $('hud');
const showHud = (h) => {
  if (h.ended) return (hudEl.textContent = h.ended);
  hudEl.replaceChildren(`ai_decide ${h.latencyMs ?? '-'} ms | ${h.perSec.toFixed(1)} decisions/s | ${h.decisions} decisions | health ${h.health} | ${h.action}`);
  if (h.noDecision) { const b = document.createElement('b'); b.textContent = ' | NO DECISION'; hudEl.append(b); }
};

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function main() {
  await DoomBridge.ready;
  const res = await post('/api/session', {});
  if (res.status === 503) return (hudEl.textContent = 'Server full, try again in a minute');
  if (!res.ok) return (hudEl.textContent = 'Could not start a session');
  const { sessionId, intervalMs } = await res.json();
  addEventListener('pagehide', () => fetch(`/api/session/${sessionId}`, { method: 'DELETE', keepalive: true }));

  const api = {
    async decide(observation) {
      const r = await post('/api/decide', { sessionId, observation });
      if (!r.ok) throw Object.assign(new Error('decide failed'), { status: r.status });
      return r.json();
    },
  };
  const loop = startLoop({ bridge: DoomBridge, api, onHud: showHud, intervalMs });

  let paused = false;
  $('pause').onclick = () => { paused = !paused; paused ? loop.pause() : loop.resume(); $('pause').textContent = paused ? 'Resume' : 'Pause'; };
  for (const n of [1, 2, 4, 8]) {
    const b = Object.assign(document.createElement('button'), { textContent: `${n}x` });
    b.onclick = () => { loop.setSpeed(n); for (const o of $('speeds').children) o.classList.toggle('on', o === b); };
    $('speeds').append(b);
    if (n === 1) b.click();
  }
}
main();
