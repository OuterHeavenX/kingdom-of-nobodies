import { esc } from './util.js';

// Short toasts for milestones and council feedback. At most three at once.
export class Notifications {
  constructor(el) { this.el = el; }
  show(text, { bad = false, ms = 4200 } = {}) {
    const t = document.createElement('div');
    t.className = `toast${bad ? ' bad' : ''}`;
    t.innerHTML = esc(text);
    this.el.appendChild(t);
    while (this.el.children.length > 3) this.el.firstChild.remove();
    setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 450); }, ms);
  }
}
