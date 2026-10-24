import './styles/main.css';
import './styles/panels.css';
import './styles/mobile.css';
import { Game } from './core/Game.js';

// Entry point: start the game and hand control from the startup screen.
const boot = document.getElementById('boot');
/* global __BUILD__ */
document.getElementById('boot-version').textContent = `build ${typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}`;

const game = new Game();
window.kingdom = game; // handy for debugging from the console
game.start().then(() => {
  window.__konStarted = true;
  try { sessionStorage.removeItem('kon-retried'); } catch { /* ignore */ }
  document.getElementById('app').hidden = false;
  game.world?.resize();
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 600);
}).catch((e) => {
  console.error(e);
  window.__konFail?.('The kingdom could not start', e.message);
});
