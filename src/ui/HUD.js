import { byId } from '../core/EntityRegistry.js';
import { balance } from '../economy/Transactions.js';
import { BottomSheet } from './BottomSheet.js';
import { Notifications } from './Notifications.js';
import { citizenList, citizenDetail } from './CitizenPanel.js';
import { economyOverview, businessDetail } from './BusinessPanel.js';
import { buildingsList, plotDetail } from './PropertyPanel.js';
import { familiesList, houseDetail, familyTree } from './FamilyPanel.js';
import { politicsPanel, foreignPanel } from './PoliticsPanel.js';
import { regionPanel, kingdomDetail, caravanDetail, landmarkDetail } from './RegionPanel.js';
import { tradePanel } from './TradePanel.js';
import { lawPanel, caseDetail } from './LawPanel.js';
import { historyPanel, biographyView } from './HistoryPanel.js';
import { dateLabel, yearOf } from '../core/Calendar.js';
import { settlementStage } from '../population/Expansion.js';
import { councilPanel } from './CouncilPanel.js';
import { clock } from './util.js';
import { plotById } from '../property/LandRegistry.js';
import { worldPanel } from './CityPlanningPanel.js';
import { financePanel, bankDetail } from './FinancePanel.js';
import { guildPanel, guildDetail } from './GuildPanel.js';
import { religionPanel, faithDetail } from './ReligionPanel.js';
import { foreignDetail, warDetail, armyDetail } from './MilitaryPanel.js';
import { cloudCard } from './CloudSavePanel.js';
import { noteVisit } from '../region/ForeignCitizenManager.js';
import { KINGDOMS } from '../region/RegionData.js';

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
    this.view = { tab: 'citizens', worldMode: 'overview', peopleMode: 'people', detail: null, plotFilter: 'all', chronicle: {}, econMode: 'business', historyMode: 'eras', historyYear: null, historyQuery: '', citizenQuery: '', regionMode: 'map', polMode: 'government' };
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
    body.addEventListener('input', (e) => {
      const el = e.target.closest('input.search');
      if (!el) return;
      if (el.dataset.act === 'citizen-search') this.view.citizenQuery = el.value;
      if (el.dataset.act === 'hist-search') this.view.historyQuery = el.value;
      this.renderSheet(true);
      const again = $('sheet-body').querySelector(`input[data-act="${el.dataset.act}"]`);
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    });
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

  /** Tapping the Founders' Memorial in the square opens the History tab on it. */
  showMemorial() {
    this.view.historyMode = 'eras';
    this.openTab('history');
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
      case 'citizen': case 'business': case 'plot': case 'house': case 'tree': case 'bio': case 'kingdom': case 'caravan': case 'case': case 'landmark':
      case 'foreign': case 'war': case 'army': case 'bank': case 'guild': case 'faith': this.openDetail(act, id); break;
      case 'world-mode': this.view.worldMode = id; this.renderSheet(true); break;
      case 'people-mode': this.view.peopleMode = id; this.renderSheet(true); $('sheet-body').scrollTop = 0; break;
      case 'overview': g.world?.overview(); this.sheet.set('peek'); break;
      case 'visit': this.visit(id); break;
      case 'home': this.visit('hearth'); break;
      case 'replay-battle': {
        const b = (this.sim.state.military?.battles ?? []).find((x) => x.id === id);
        if (b && g.world) { g.world.showBattle(b); this.setBanner(`⚔ ${b.name} · ${b.place}`); this.sheet.set('peek'); }
        break;
      }
      case 'cloud-signin': g.cloudSignIn(); break;
      case 'cloud-sync': g.cloudSync(); break;
      case 'cloud-keep': g.cloudResolve(id); break;
      case 'cloud-signout': g.cloud?.client.signOut().then(() => this.renderSheet(true)); break;
      case 'cloud-auto': g.cloud?.setAuto(el.checked); break;
      case 'region-mode': this.view.regionMode = id; this.view.detail = null; this.stack = []; this.renderSheet(true); $('sheet-body').scrollTop = 0; break;
      case 'region-tab': this.view.regionMode = id; this.openTab('region'); break;
      case 'pol-mode': this.view.polMode = id; this.renderSheet(true); $('sheet-body').scrollTop = 0; break;
      case 'follow-caravan': g.world?.followCaravan(id); this.sheet.set('peek'); break;
      case 'econ-mode': this.view.econMode = id; this.renderSheet(true); break;
      case 'hist-mode': this.view.historyMode = id; this.view.chronicle = {}; this.view.historyQuery = ''; this.renderSheet(true); $('sheet-body').scrollTop = 0; break;
      case 'hist-year': this.view.historyYear = Number(id); this.renderSheet(true); break;
      case 'memorial': this.openTab('history'); this.view.historyMode = 'eras'; this.renderSheet(true); break;
      case 'tab': this.openTab(id); break;
      case 'tab-filter': this.view.econMode = 'land'; this.openTab(id, { plotFilter: el.dataset.filter }); break;
      case 'plot-filter': this.view.plotFilter = id; this.renderSheet(true); break;
      case 'chronicle-filter': this.view.chronicle = { ...this.view.chronicle, category: id || null }; this.renderSheet(true); break;
      case 'chronicle-clear': this.view.chronicle = {}; this.renderSheet(true); break;
      case 'history': this.view.tab = 'history'; this.view.historyMode = 'timeline'; this.view.detail = null; this.stack = []; this.view.chronicle = { [el.dataset.kind]: id }; this.renderSheet(true); $('sheet-body').scrollTop = 0; break;
      case 'focus-citizen': { const c = byId(this.sim.state.citizens, id); if (c) { g.world?.follow(c.id); this.sheet.set('peek'); } break; }
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
      case 'restore': if (confirm('Roll back to the recovery snapshot taken at the start of the latest saved year? Progress since then will be lost.')) g.restoreSnapshot(); break;
      case 'new': if (confirm('Start a new kingdom? Your current village will be replaced. (Export it first if you want to keep it.)')) g.newKingdom(); break;
      default: break;
    }
  }

  /** Switch the 3D view to another kingdom (or back home). The simulation is unaffected. */
  visit(kid) {
    const w = this.game.world;
    if (!w) { this.toasts.show('The 3D view is not available on this device.', { bad: true }); return; }
    if (!kid || kid === 'hearth') { w.home(); this.setBanner(null); return; }
    noteVisit(this.sim.state, kid);
    w.visit(kid);
    this.setBanner(`🏰 Visiting ${KINGDOMS[kid].name}`);
    this.sheet.set('peek');
  }

  /** The banner over the 3D view while away from First Hearth, with a way home. */
  setBanner(text) {
    const el = $('view-banner');
    if (!el) return;
    el.hidden = !text;
    if (text) el.innerHTML = `<span>${text}</span><button class="btn small" id="go-home">⌂ First Hearth</button>`;
    const btn = $('go-home');
    if (btn) btn.onclick = () => this.visit('hearth');
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
    const text = `${dateLabel(s.day, { short: true })} · ${clock(s.minute)} · ${settlementStage(s.citizens.length)}`;
    const name = 'Kingdom of Nobodies';
    if ($('kingdom-name').textContent !== name) $('kingdom-name').textContent = name;
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
    if (detail?.kind === 'house') return houseDetail(this.sim, detail.id);
    if (detail?.kind === 'tree') return familyTree(this.sim, detail.id);
    if (detail?.kind === 'bio') return biographyView(this.sim, detail.id);
    if (detail?.kind === 'kingdom') return kingdomDetail(this.sim, detail.id);
    if (detail?.kind === 'caravan') return caravanDetail(this.sim, detail.id);
    if (detail?.kind === 'case') return caseDetail(this.sim, detail.id);
    if (detail?.kind === 'landmark') return landmarkDetail(this.sim, detail.id);
    if (detail?.kind === 'foreign') return foreignDetail(this.sim, detail.id);
    if (detail?.kind === 'war') return warDetail(this.sim, detail.id);
    if (detail?.kind === 'army') return armyDetail(this.sim, detail.id);
    if (detail?.kind === 'bank') return bankDetail(this.sim, detail.id);
    if (detail?.kind === 'guild') return guildDetail(this.sim, detail.id);
    if (detail?.kind === 'faith') return faithDetail(this.sim, detail.id);
    if (tab === 'world') return worldPanel(this.sim, this.view);
    if (tab === 'region') return regionPanel(this.sim, this.view);
    if (tab === 'economy') {
      const seg = `<div class="segmented scroll-seg">${[['business', 'Businesses'], ['trade', 'Trade'], ['banks', 'Banks'], ['guilds', 'Guilds'], ['land', 'Land']].map(([k, l]) => `<button class="${this.view.econMode === k ? 'active' : ''}" data-act="econ-mode" data-id="${k}">${l}</button>`).join('')}</div>`;
      const m = this.view.econMode;
      const inner = m === 'land' ? buildingsList(this.sim, this.view.plotFilter) : m === 'trade' ? tradePanel(this.sim) : m === 'banks' ? financePanel(this.sim) : m === 'guilds' ? guildPanel(this.sim) : economyOverview(this.sim);
      return { title: inner.title, html: seg + inner.html };
    }
    if (tab === 'families' || (tab === 'citizens' && this.view.peopleMode === 'families')) {
      const inner = familiesList(this.sim);
      return { title: inner.title, html: this.peopleSeg() + inner.html };
    }
    if (tab === 'politics') {
      const mode = this.view.polMode;
      const seg = `<div class="segmented scroll-seg">${[['government', 'Government'], ['law', 'Laws & courts'], ['faith', 'Faith'], ['foreign', 'Foreign']].map(([k, l]) => `<button class="${mode === k ? 'active' : ''}" data-act="pol-mode" data-id="${k}">${l}</button>`).join('')}</div>`;
      const inner = mode === 'law' ? lawPanel(this.sim) : mode === 'foreign' ? foreignPanel(this.sim) : mode === 'faith' ? religionPanel(this.sim) : politicsPanel(this.sim);
      return { title: inner.title, html: seg + inner.html };
    }
    if (tab === 'history') return historyPanel(this.sim, this.view);
    if (tab === 'council') return councilPanel(this.sim, { settings: this.game.settings, build: this.game.build, lastSaved: this.game.lastSavedText(), source: this.game.loadSource, cloud: cloudCard(this.game) });
    const inner = citizenList(this.sim, this.view);
    return { title: inner.title, html: this.peopleSeg() + inner.html };
  }

  peopleSeg() {
    const mode = this.view.peopleMode ?? 'people';
    return `<div class="segmented">${[['people', 'People'], ['families', 'Families']].map(([k, l]) => `<button class="${mode === k ? 'active' : ''}" data-act="people-mode" data-id="${k}">${l}</button>`).join('')}</div>`;
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
