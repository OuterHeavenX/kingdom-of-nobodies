import { byId } from '../core/EntityRegistry.js';
import { balance } from '../economy/Transactions.js';
import { BottomSheet } from './BottomSheet.js';
import { Notifications } from './Notifications.js';
import { citizenList, citizenDetail } from './CitizenPanel.js';
import { economyOverview, businessDetail } from './BusinessPanel.js';
import { buildingsList, plotDetail } from './PropertyPanel.js';
import { chronicle } from './ChroniclePanel.js';
import { councilPanel } from './CouncilPanel.js';
import { clock } from './util.js';
import { plotById } from '../property/LandRegistry.js';

const $ = (id) => document.getElementById(id);

/**
 * The heads-up display: top bar, bottom navigation and the detail sheet.
 * View state is { tab, detail: {kind,id} | null, history stack, filters }.
 */
export class HUD {
  constructor(game) {
    this.game = game;
    this.sim = game.sim;
    this.toasts = new Notifications($('toasts'));
    this.sheet = new BottomSheet($('sheet'), { onClose: () => { this.view.detail = null; this.stack = []; } });
    this.sheet.onChange = () => setTimeout(() => this.renderTabs(), 300);
    this.view = { tab: 'citizens', detail: null, plotFilter: 'all', chronicle: {} };
    this.stack = [];
    this.lastTop = 0;
    this.lastBody = 0;
    this.bodyHtml = '';
    this.interacting = false;
    this.bind();
    this.renderTop(true);
    this.renderSheet(true);
  }

  bind() {
    $('pause').onclick = () => { this.game.clock.togglePause(); this.renderTop(true); };
    $('speed').onclick = () => { this.game.clock.cycleSpeed(); this.renderTop(true); };
    $('tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      if (this.view.tab === b.dataset.tab && !this.view.detail && this.sheet.state !== 'closed' && !this.sheet.docked) { this.sheet.set('closed'); this.renderTabs(); return; }
      this.openTab(b.dataset.tab);
    });
    $('sheet-back').onclick = () => this.back();
    const body = $('sheet-body');
    body.addEventListener('pointerdown', () => { this.interacting = true; });
    window.addEventListener('pointerup', () => { setTimeout(() => { this.interacting = false; }, 250); });
    body.addEventListener('click', (e) => this.onAction(e));
    body.addEventListener('change', (e) => this.onAction(e));
    $('import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.game.importSave(f); });
  }

  openTab(tab, opts = {}) {
    this.view.tab = tab;
    this.view.detail = null;
    this.stack = [];
    if (opts.plotFilter) this.view.plotFilter = opts.plotFilter;
    this.sheet.open('peek');
    this.renderSheet(true);
    $('sheet-body').scrollTop = 0;
  }

  openDetail(kind, id, { push = true } = {}) {
    if (push && this.view.detail) this.stack.push(this.view.detail);
    this.view.detail = { kind, id };
    if (kind === 'citizen' || kind === 'plot') this.sim.select(kind, id);
    this.sheet.open('peek');
    this.renderSheet(true);
    $('sheet-body').scrollTop = 0;
  }

  back() {
    this.view.detail = this.stack.pop() ?? null;
    this.renderSheet(true);
  }

  onAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, id } = el.dataset;
    const g = this.game;
    switch (act) {
      case 'citizen': case 'business': case 'plot': this.openDetail(act, id); break;
      case 'tab': this.openTab(id); break;
      case 'tab-filter': this.openTab(id, { plotFilter: el.dataset.filter }); break;
      case 'plot-filter': this.view.plotFilter = id; this.renderSheet(true); break;
      case 'chronicle-filter': this.view.chronicle = { category: id || null }; this.renderSheet(true); break;
      case 'chronicle-clear': this.view.chronicle = {}; this.renderSheet(true); break;
      case 'history': this.view.tab = 'chronicle'; this.view.detail = null; this.stack = []; this.view.chronicle = { [el.dataset.kind]: id }; this.renderSheet(true); $('sheet-body').scrollTop = 0; break;
      case 'focus-citizen': { const c = byId(this.sim.state.citizens, id); if (c) { g.world?.focusOn(c.x, c.z); this.sheet.set('peek'); } break; }
      case 'focus-plot': { const p = plotById(this.sim.state, id); if (p) { this.sim.select('plot', id); g.world?.focusOn(p.x, p.z); this.sheet.set('peek'); } break; }
      case 'council': {
        const res = this.sim.council(el.dataset.action, id || undefined);
        this.toasts.show(res.message, { bad: !res.ok });
        this.renderSheet(true);
        this.renderTop(true);
        break;
      }
      case 'tax': { const res = this.sim.council('setTax', id); this.toasts.show(res.message, { bad: !res.ok }); this.renderSheet(true); break; }
      case 'labels': g.setSetting('labels', el.checked); break;
      case 'quality': g.setSetting('quality', id); this.renderSheet(true); break;
      case 'save': g.save(true); break;
      case 'export': g.saves.exportFile(this.sim.state); this.toasts.show('Save file downloaded.'); break;
      case 'import': $('import-file').click(); break;
      case 'new': if (confirm('Start a new kingdom? Your current village will be replaced. (Export it first if you want to keep it.)')) g.newKingdom(); break;
      default: break;
    }
  }

  /** Called every animation frame; throttles DOM work. */
  update(now) {
    if (now - this.lastTop > 250) this.renderTop();
    if (now - this.lastBody > 900 && !this.interacting && (this.sheet.state !== 'closed' || this.sheet.docked)) this.renderSheet();
  }

  renderTop(force = false) {
    this.lastTop = performance.now();
    const s = this.sim.state;
    const clockEl = $('clock');
    const text = `Day ${s.day} · ${clock(s.minute)}`;
    if (clockEl.textContent !== text) clockEl.textContent = text;
    const stats = `<span class="stat" title="Treasury">🪙 ${balance(s, 'treasury')}</span><span class="stat" title="Food in the village">🍞 ${this.sim.food}</span>` +
      `<span class="stat" title="Timber">🪵 ${this.sim.wood}</span><span class="stat" title="Population">👥 ${s.citizens.length}</span><span class="stat" title="Average happiness">♥ ${this.sim.averageMood}%</span>`;
    if (force || this.statsHtml !== stats) { $('stats').innerHTML = stats; this.statsHtml = stats; }
    const clockState = this.game.clock;
    $('pause').textContent = clockState.paused ? '▶' : '⏸';
    $('pause').classList.toggle('active', clockState.paused);
    $('pause').setAttribute('aria-label', clockState.paused ? 'Resume' : 'Pause');
    $('speed').textContent = `${clockState.speed}×`;
  }

  /** Tell the renderer how much of the stage the sheet covers. */
  syncInset() {
    const world = this.game.world;
    if (!world) return;
    const covered = this.sheet.docked || this.sheet.state === 'closed' ? 0 : this.sheet.state === 'full' ? 0 : $('sheet').getBoundingClientRect().height;
    world.setBottomInset(covered);
  }

  renderTabs() {
    this.syncInset();
    for (const b of $('tabbar').querySelectorAll('button')) b.classList.toggle('active', b.dataset.tab === this.view.tab && (this.sheet.state !== 'closed' || this.sheet.docked));
  }

  content() {
    const { tab, detail } = this.view;
    if (detail?.kind === 'citizen') return citizenDetail(this.sim, detail.id);
    if (detail?.kind === 'business') return businessDetail(this.sim, detail.id);
    if (detail?.kind === 'plot') return plotDetail(this.sim, detail.id);
    if (tab === 'economy') return economyOverview(this.sim);
    if (tab === 'buildings') return buildingsList(this.sim, this.view.plotFilter);
    if (tab === 'chronicle') return chronicle(this.sim, this.view.chronicle);
    if (tab === 'council') return councilPanel(this.sim, { settings: this.game.settings, build: this.game.build, lastSaved: this.game.lastSavedText(), source: this.game.loadSource });
    return citizenList(this.sim);
  }

  renderSheet(force = false) {
    this.lastBody = performance.now();
    const { title, html } = this.content();
    $('sheet-title').textContent = title;
    $('sheet-back').hidden = !this.view.detail;
    this.renderTabs();
    if (!force && html === this.bodyHtml) return;
    const body = $('sheet-body');
    const scroll = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = scroll;
    this.bodyHtml = html;
  }
}
