import { byId } from '../core/EntityRegistry.js';
import { ensureDivine } from '../divine/State.js';
import { bestow, keepSilence, prayerTarget, BLESSINGS } from '../divine/Blessings.js';
import { sendOmen, OMENS } from '../divine/Omens.js';
import { placeStone, postponeStone, siteProblem, suggestedSites } from '../divine/Stone.js';
import { openPrayers } from '../divine/Prayers.js';
import { eyeSvg, WHISPER_NOTICE } from './UnseenPanel.js';
import { esc } from './util.js';

const $ = (id) => document.getElementById(id);

/**
 * The player's side of the Hidden Hand in the interface: the floating eye
 * button, the private Year 200 notice, the panel's actions and choosing a
 * place for the stone on the land. Kept apart from HUD.js so that file stays
 * about navigation.
 */
export class UnseenController {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.placing = null; // { inscription, x, z, problem }
    this.lastBadge = '';
    this.bind();
    this.applyEyeSetting();
  }

  get sim() { return this.hud.sim; }
  get state() { return this.hud.sim.state; }

  bind() {
    const eye = $('unseen-eye');
    if (eye) {
      eye.innerHTML = `<span class="eye-glyph">${eyeSvg(26)}</span><span class="eye-motes" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="eye-badge" hidden></span>`;
      eye.onclick = () => (this.hud.view.tab === 'unseen' && this.hud.sheet.state !== 'closed' && !this.hud.view.detail ? this.hud.sheet.set('closed') : this.open());
    }
    const notice = $('whisper-notice');
    if (notice) {
      notice.innerHTML = `<div class="wn-card" role="dialog" aria-labelledby="wn-title"><span class="wn-eye">${eyeSvg(30)}</span><h3 id="wn-title">${esc(WHISPER_NOTICE.title)}</h3><p>${esc(WHISPER_NOTICE.text)}</p>
        <div class="wn-actions"><button class="btn primary hh-gold" id="wn-place">Place the Mysterious Stone</button><button class="btn ghost" id="wn-later">Not Yet</button></div></div>`;
      $('wn-place').onclick = () => { notice.hidden = true; this.noticeShown = false; ensureDivine(this.state).pendingNotice = false; this.open('mysteries'); };
      $('wn-later').onclick = () => { postponeStone(this.state); notice.hidden = true; this.noticeShown = false; this.hud.toasts.show('The stone can wait. You may raise it whenever you choose (The Unseen Influence → Mysteries).'); };
    }
  }

  /** Eye button placement from settings: right (default), left or hidden. */
  applyEyeSetting() {
    const eye = $('unseen-eye');
    if (!eye) return;
    const where = this.game.settings.unseenEye ?? 'right';
    eye.hidden = where === 'hidden';
    eye.classList.toggle('left', where === 'left');
  }

  /** Keep the chosen section's button in view on the scrolling section bar. */
  revealSection() { setTimeout(() => document.querySelector('.hh-seg button.active')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }), 0); }

  open(section = null) {
    if (section) this.hud.view.unseen = section;
    this.hud.openTab('unseen');
    this.revealSection();
    this.game.audio.hiddenHand?.('motif');
  }

  /** Called every frame through HUD.update: the notice, and the eye's badge for waiting prayers. */
  update() {
    const s = this.state;
    const d = s.divine;
    const notice = $('whisper-notice');
    if (notice && d?.pendingNotice && this.game.started && !this.noticeShown && !this.placing) {
      notice.hidden = false;
      this.noticeShown = true;
      this.game.audio.hiddenHand?.('motif');
    }
    const n = d ? openPrayers(s).filter((p) => !p.viewed).length : 0;
    const badge = n ? String(Math.min(9, n)) + (n > 9 ? '+' : '') : '';
    if (badge !== this.lastBadge) {
      const el = $('unseen-eye')?.querySelector('.eye-badge');
      if (el) { el.textContent = badge; el.hidden = !badge; }
      this.lastBadge = badge;
    }
  }

  /** Panel actions (data-act="hh-…"). Returns true when handled. */
  onAction(act, el, e) {
    if (e.type === 'change' && act !== 'hh-eye') return true;
    const s = this.state;
    const v = this.hud.view;
    const id = el.dataset.id;
    const refresh = () => this.hud.renderSheet(true);
    switch (act) {
      case 'hh-open': this.open(); return true;
      case 'hh-mode': v.unseen = id; v.unseenBlessing = null; v.unseenPrayer = null; refresh(); $('sheet-body').scrollTop = 0; this.revealSection(); return true;
      case 'hh-pick': v.unseenBlessing = v.unseenBlessing === id ? null : id; refresh(); return true;
      case 'hh-bless': this.result(bestow(s, id, el.dataset.target), el.dataset.target); v.unseenBlessing = null; refresh(); return true;
      case 'hh-answer-open': v.unseenPrayer = v.unseenPrayer === id ? null : id; refresh(); return true;
      case 'hh-answer': {
        const p = ensureDivine(s).prayers.find((x) => x.id === id);
        if (p) this.result(bestow(s, el.dataset.blessing, prayerTarget(s, p, el.dataset.blessing), { prayerId: p.id }), prayerTarget(s, p, el.dataset.blessing));
        v.unseenPrayer = null; refresh(); return true;
      }
      case 'hh-silence': keepSilence(s, id); this.hud.toasts.show('You kept your silence. Nothing follows from it.'); refresh(); return true;
      case 'hh-omen': {
        const t = this.game.world?.controls?.target ?? { x: 0, z: 0 };
        const res = sendOmen(s, id, { x: t.x, z: t.z });
        this.hud.toasts.show(res.message, { bad: !res.ok });
        if (res.ok) { this.game.world?.hand?.playOmen(res.omen); this.game.audio.hiddenHand?.(OMENS[id].scope === 'stone' || id === 'tone' ? 'tone' : 'omen'); }
        refresh(); return true;
      }
      case 'hh-insc': v.unseenInscription = id; refresh(); return true;
      case 'hh-place-site': {
        const site = suggestedSites(s).find((x) => x.key === id);
        if (site && !site.problem) this.beginPlacing(site.x, site.z);
        return true;
      }
      case 'hh-place-map': this.beginPlacing(null, null); return true;
      case 'hh-show-stone': { const st = s.divine?.stone; if (st) { this.game.world?.focusOn(st.x, st.z, 26); this.hud.sheet.set('peek'); } return true; }
      case 'hh-filter': v.unseenFilter = id; refresh(); return true;
      case 'hh-eye': this.game.setSetting('unseenEye', id); this.applyEyeSetting(); refresh(); return true;
      default: return false;
    }
  }

  /** Feedback after an intervention: a toast for the player, motes in the world, a soft sound. */
  result(res, targetId) {
    this.hud.toasts.show(res.message, { bad: !res.ok });
    if (!res.ok) return;
    const c = byId(this.state.citizens, targetId);
    const b = this.state.businesses.find((x) => x.id === targetId);
    const plot = b && this.state.plots.find((p) => p.id === b.plotId);
    const at = c && !c.away ? { x: c.x, z: c.z } : plot ? { x: plot.x, z: plot.z } : null;
    if (at) this.game.world?.hand?.blessingMotes(at.x, at.z);
    this.game.audio.hiddenHand?.('blessing', at);
  }

  // --- Choosing a place for the stone ---------------------------------------------------------

  beginPlacing(x, z) {
    const w = this.game.world;
    const inscription = this.hud.view.unseenInscription ?? 'glyphs';
    if (!w) {
      // No 3D view: place at the chosen suggestion directly.
      if (x !== null) this.confirm({ inscription, x, z });
      else this.hud.toasts.show('Choose one of the suggested places (the 3D view is unavailable).', { bad: true });
      return;
    }
    this.placing = { inscription, x, z, problem: x === null ? 'Tap the land' : siteProblem(this.state, x, z) };
    w.hand.startPlacing((px, pz) => { this.placing.x = px; this.placing.z = pz; this.placing.problem = siteProblem(this.state, px, pz); w.hand.setPreview(px, pz, !this.placing.problem); this.banner(); });
    if (x !== null) { w.hand.setPreview(x, z, !this.placing.problem); w.focusOn(x, z, 30); }
    this.hud.sheet.set('closed');
    this.banner();
  }

  banner() {
    const el = $('view-banner');
    if (!el || !this.placing) return;
    const p = this.placing;
    el.hidden = false;
    const ok = p.x !== null && !p.problem;
    el.innerHTML = `<span>◈ ${p.x === null ? 'Tap open land to choose where the stone stands' : ok ? 'The stone will stand here' : esc(p.problem)}</span><button class="btn small hh-gold" id="hh-confirm" ${ok ? '' : 'disabled'}>✓ Place here</button><button class="btn small ghost" id="hh-cancel">✕</button>`;
    $('hh-confirm').onclick = () => this.confirm(p);
    $('hh-cancel').onclick = () => this.cancelPlacing();
  }

  confirm({ inscription, x, z }) {
    const res = placeStone(this.state, { x, z, inscription });
    this.hud.toasts.show(res.message, { bad: !res.ok, ms: 9000 });
    if (!res.ok) return;
    this.endPlacing();
    this.game.world?.hand?.sync(true);
    this.game.audio.hiddenHand?.('stone');
    this.game.save();
    this.open('mysteries');
  }

  cancelPlacing() { this.endPlacing(); this.open('mysteries'); }

  /** A different kingdom was loaded: forget any half-finished placement or notice. */
  reset() {
    if (this.placing) this.endPlacing();
    const notice = $('whisper-notice');
    if (notice) notice.hidden = true;
    this.noticeShown = false;
    this.lastBadge = null;
  }

  endPlacing() {
    this.placing = null;
    this.game.world?.hand?.stopPlacing();
    this.hud.setBanner(this.hud.awayBanner ?? null);
  }
}

export { BLESSINGS };
