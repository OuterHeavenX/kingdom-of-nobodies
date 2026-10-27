// Keeping the detail sheet live without getting in the player's way.
//
// The sheet re-renders itself about once a second so its numbers follow the
// simulation. Two things must survive that: a search box the player is typing
// in (replacing it would drop the focus and, on iPhone, the keyboard), and a
// scroll in progress (a native touch scroll ends with pointercancel, not
// pointerup, and momentum keeps scrolling after the finger lifts).

/** Text-entry elements whose focus must survive a re-render. */
export const KEEP_SELECTOR = 'textarea, input.search, input[type=search], input[type=text], input:not([type])';

const KEY_ATTRS = ['data-act', 'data-id', 'data-key', 'name'];

const isElement = (n) => n?.nodeType === 1;
const same = (a, b) => a.tagName === b.tagName && KEY_ATTRS.every((k) => (a.getAttribute(k) ?? null) === (b.getAttribute(k) ?? null));

function findAll(root, test, out = []) {
  for (const c of Array.from(root.childNodes)) {
    if (!isElement(c)) continue;
    if (test(c)) out.push(c);
    findAll(c, test, out);
  }
  return out;
}

function syncAttributes(live, fresh) {
  for (const { name } of Array.from(live.attributes)) if (!fresh.hasAttribute(name)) live.removeAttribute(name);
  for (const { name, value } of Array.from(fresh.attributes)) if (live.getAttribute(name) !== value) live.setAttribute(name, value);
}

/**
 * Replace `root`'s content with `fresh`'s children, except that `keep` (a live
 * element inside `root`, usually the focused input) stays where it is: every
 * node around it, and around each of its ancestors, is swapped for the new
 * version, so the element itself is never detached and keeps its focus, caret
 * and typed value. `fresh` is consumed. Returns false (and changes nothing) if
 * the new content has no single counterpart for `keep` at the same depth.
 */
export function patchAround(root, fresh, keep) {
  if (!isElement(keep) || !keep.getAttribute('data-act')) return false;
  const chain = [];
  for (let n = keep; n && n !== root; n = n.parentNode) chain.unshift(n);
  if (!chain.length || chain[0].parentNode !== root) return false;
  const twins = findAll(fresh, (n) => same(n, keep));
  if (twins.length !== 1) return false;
  const fchain = [];
  for (let n = twins[0]; n && n !== fresh; n = n.parentNode) fchain.unshift(n);
  if (fchain.length !== chain.length || chain.some((n, i) => n.tagName !== fchain[i].tagName)) return false;
  let liveParent = root, freshParent = fresh;
  for (let i = 0; i < chain.length; i++) {
    const live = chain[i], twin = fchain[i];
    for (const c of Array.from(liveParent.childNodes)) if (c !== live) liveParent.removeChild(c);
    const sibs = Array.from(freshParent.childNodes);
    const at = sibs.indexOf(twin);
    for (const c of sibs.slice(0, at)) liveParent.insertBefore(c, live);
    for (const c of sibs.slice(at + 1)) liveParent.insertBefore(c, null);
    if (i < chain.length - 1) syncAttributes(live, twin);
    liveParent = live;
    freshParent = twin;
  }
  return true;
}

/**
 * Whether the player is touching or scrolling the sheet right now. A pointer
 * holds updates until shortly after it is lifted or cancelled; a scroll holds
 * them until it has been still for `settle` ms (momentum included).
 */
export class SheetActivity {
  constructor({ now = () => performance.now(), release = 250, settle = 1000 } = {}) {
    this.now = now;
    this.release = release;
    this.settle = settle;
    this.pointer = false;
    this.upAt = -Infinity;
    this.scrollAt = -Infinity;
  }

  down() { this.pointer = true; }

  /** pointerup and pointercancel both end a touch. */
  up() {
    if (!this.pointer) return;
    this.pointer = false;
    this.upAt = this.now();
  }

  scrolled() { this.scrollAt = this.now(); }

  busy(t = this.now()) {
    return this.pointer || t - this.upAt < this.release || t - this.scrollAt < this.settle;
  }
}
