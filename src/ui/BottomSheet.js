// Collapsible bottom sheet with three states: closed, peek (about half the
// screen, the village stays visible) and full. Drag the grip or header to
// resize; a fast downward swipe dismisses. On wide screens CSS docks it as a
// side panel and these states have no visual effect.

const ORDER = ['closed', 'peek', 'full'];

export class BottomSheet {
  constructor(el, { onClose } = {}) {
    this.el = el;
    this.onClose = onClose;
    this.state = el.dataset.state;
    const handles = [el.querySelector('.sheet-grip'), el.querySelector('.sheet-head')];
    for (const h of handles) h.addEventListener('pointerdown', (e) => this.start(e));
    window.addEventListener('pointermove', (e) => this.move(e), { passive: true });
    window.addEventListener('pointerup', (e) => this.end(e));
    window.addEventListener('pointercancel', (e) => this.end(e));
    el.querySelector('#sheet-close').addEventListener('click', () => this.set('closed'));
    el.querySelector('#sheet-size').addEventListener('click', () => this.set(this.state === 'full' ? 'peek' : 'full'));
  }

  get docked() { return getComputedStyle(this.el).position !== 'fixed'; }

  set(state) {
    if (state === this.state) return;
    const was = this.state;
    this.state = state;
    this.el.dataset.state = state;
    this.el.querySelector('#sheet-size').textContent = state === 'full' ? '⌄' : '⌃';
    if (state === 'closed' && was !== 'closed') this.onClose?.();
    this.onChange?.(state);
  }

  open(min = 'peek') { if (ORDER.indexOf(this.state) < ORDER.indexOf(min)) this.set(min); }

  start(e) {
    if (this.docked || e.target.closest('button')) return;
    this.drag = { y: e.clientY, t: performance.now(), height: this.el.getBoundingClientRect().height, moved: false };
    this.el.classList.add('dragging');
  }

  move(e) {
    if (!this.drag) return;
    const dy = e.clientY - this.drag.y;
    if (Math.abs(dy) > 4) this.drag.moved = true;
    const h = Math.max(80, this.drag.height - dy);
    this.el.style.height = `${h}px`;
  }

  end(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.el.classList.remove('dragging');
    this.el.style.height = '';
    if (!d.moved) return;
    const dy = e.clientY - d.y;
    const velocity = dy / Math.max(1, performance.now() - d.t);
    const parent = this.el.parentElement.getBoundingClientRect().height;
    const finalH = d.height - dy;
    if (velocity > 0.6 || finalH < parent * 0.2) this.set(this.state === 'full' && finalH > parent * 0.3 ? 'peek' : 'closed');
    else if (velocity < -0.6 || finalH > parent * 0.62) this.set('full');
    else this.set('peek');
  }
}
