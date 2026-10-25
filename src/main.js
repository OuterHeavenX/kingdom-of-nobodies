import './styles/main.css';
import './styles/panels.css';
import './styles/mobile.css';
import { Game } from './core/Game.js';

// Entry point: start the game behind the title screen, report real loading
// progress, and hand over when the player taps Start or Continue (a tap, so
// sound may begin if they want it).
const boot = document.getElementById('boot');
const status = document.getElementById('boot-status');
const bar = document.getElementById('boot-bar');
/* global __BUILD__ */
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
document.getElementById('boot-version').textContent = `v0.5.2 · build ${BUILD}`;
const progress = (text, fraction) => { if (status) status.textContent = text; if (bar) bar.style.width = `${Math.round(fraction * 100)}%`; };
progress('Loading the engine…', 0.25);

const game = new Game();
window.kingdom = game; // handy for debugging from the console
game.start(progress).then(() => {
  window.__konStarted = true;
  try { sessionStorage.removeItem('kon-retried'); } catch { /* ignore */ }
  document.getElementById('app').hidden = false;
  game.world?.resize();
  const go = document.getElementById('boot-go');
  const sound = document.getElementById('boot-sound');
  go.textContent = game.loadSource ? `Continue · Year ${Math.floor((game.sim.state.day - 1) / 12) + 1}` : 'Start a new kingdom';
  sound.checked = game.audio.enabled;
  if (!game.audio.supported) sound.parentElement.hidden = true;
  progress(game.loadSource ? `Your kingdom is ready (${game.loadSource}).` : 'Five strangers wait by an unlit hearth.', 1);
  boot.classList.add('ready');
  const enter = () => {
    game.begin({ sound: sound.checked });
    window.__konEntered = true;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 600);
  };
  go.addEventListener('click', enter, { once: true });
  // ?autostart skips the title screen (automated tests, links that open straight into the kingdom).
  if (/[?&]autostart\b/.test(location.search)) enter();
}).catch((e) => {
  console.error(e);
  window.__konFail?.('The kingdom could not start', e.message);
});

// Offline play and fast starts from the Home Screen (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('Service worker not registered:', e.message)));
}
