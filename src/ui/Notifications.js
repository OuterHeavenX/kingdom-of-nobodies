import { esc } from './util.js';

// Toasts for milestones, holidays and council feedback. They stay long enough
// to read (about eight seconds, holidays longer), at most three at once, and
// a tap dismisses one early. The timer pauses while a finger rests on it.
export const TOAST_MS = 8000;

export class Notifications {
  constructor(el) { this.el = el; }
  show(text, { bad = false, ms = TOAST_MS, holiday = false } = {}) {
    const t = document.createElement('div');
    t.className = `toast${bad ? ' bad' : ''}${holiday ? ' holiday' : ''}`;
    t.innerHTML = esc(text);
    t.style.setProperty('--toast-ms', `${ms}ms`);
    this.el.appendChild(t);
    while (this.el.children.length > 3) this.el.firstChild.remove();
    let left = ms, started = performance.now(), timer = null;
    const leave = () => { t.classList.add('leaving'); setTimeout(() => t.remove(), 450); };
    const run = () => { started = performance.now(); timer = setTimeout(leave, left); };
    t.addEventListener('pointerdown', () => { clearTimeout(timer); left = Math.max(1500, left - (performance.now() - started)); t.classList.add('held'); });
    t.addEventListener('pointerup', () => { t.classList.remove('held'); leave(); });
    t.addEventListener('pointercancel', () => { t.classList.remove('held'); run(); });
    run();
  }
}
