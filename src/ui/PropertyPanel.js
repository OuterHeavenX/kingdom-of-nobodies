import { STAGES, REFIT_STAGE } from '../core/Config.js';
import { LAND_TYPES, BUILDING_INFO, plotValue } from '../property/LandRegistry.js';
import { projectProgress } from '../property/Construction.js';
import { esc, badge, link } from './util.js';
import { architectureCard } from './EraPanel.js';
import { formOf } from '../civilization/ArchitectureData.js';

const FILTERS = [['all', 'All'], ['sale', 'For sale'], ['building', 'Construction'], ['business', 'Businesses'], ['homes', 'Homes']];

function owner(s, id) { return id === 'council' ? 'Council' : s.citizens.find((c) => c.id === id)?.firstName ?? '—'; }

function status(p) {
  if (p.projectId) return badge('BUILDING', p.constructionStatus === 'DEMOLISHING' ? 'Demolishing' : p.constructionStatus.toLowerCase());
  if (p.marketStatus === 'FOR_SALE') return badge('FOR_SALE', `For sale ${p.price}🪙`);
  return '';
}

export function buildingsList(sim, filter = 'all') {
  const s = sim.state;
  const match = {
    all: () => true,
    sale: (p) => p.marketStatus === 'FOR_SALE',
    building: (p) => !!p.projectId,
    business: (p) => !!p.businessId,
    homes: (p) => p.building?.type === 'cottage' || p.building?.type === 'hall',
  }[filter];
  const rows = s.plots.filter(match).map((p) => {
    const b = p.businessId ? s.businesses.find((x) => x.id === p.businessId) : null;
    return `<button class="item" data-act="plot" data-id="${p.id}">
      <span class="main"><strong>${esc(p.name)}</strong><small>${esc(b?.name ?? (p.building ? p.building.name : 'Vacant ' + LAND_TYPES[p.landType].label.toLowerCase()))} · ${esc(owner(s, p.ownerId))}</small></span>
      <span class="side">${status(p)}</span></button>`;
  }).join('');
  const chips = FILTERS.map(([k, label]) => `<button class="chip ${k === filter ? 'active' : ''}" data-act="plot-filter" data-id="${k}">${label}</button>`).join('');
  return { title: 'Buildings & land', html: `<div class="chips scroll">${chips}</div><div class="list">${rows || '<p class="empty">Nothing here right now.</p>'}</div>` };
}

export function plotDetail(sim, id) {
  const s = sim.state;
  const p = s.plots.find((x) => x.id === id);
  if (!p) return { title: 'Plot', html: '<p class="empty">Not found.</p>' };
  const b = p.businessId ? s.businesses.find((x) => x.id === p.businessId) : null;
  const project = p.projectId ? s.projects.find((x) => x.id === p.projectId) : null;
  const residents = p.residents.map((rid) => s.citizens.find((c) => c.id === rid)).filter(Boolean);
  const ownerC = s.citizens.find((c) => c.id === p.ownerId);
  let construction = '';
  if (project) {
    const stages = project.stages ?? (project.kind === 'construction' ? STAGES : project.kind === 'refit' ? [REFIT_STAGE] : [{ name: 'DEMOLISHING' }]);
    const crew = Object.keys(project.crew).map((cid) => s.citizens.find((c) => c.id === cid)?.firstName).filter(Boolean);
    construction = `<div class="card">
      <h3>${project.kind === 'demolition' ? 'Demolition' : project.kind === 'refit' ? 'Refit' : project.kind === 'rebuild' ? 'Rebuilding' : 'Construction'}</h3>
      <p>${project.kind === 'demolition' ? 'Taking down the old building' : `Building a ${esc((project.targetEra ? formOf(project.buildingType, project.targetEra).labels[0] : BUILDING_INFO[project.buildingType].label).toLowerCase())}`} for ${esc(owner(s, project.ownerId))}, started day ${project.startedDay}.</p>
      <div class="progress"><i style="width:${Math.round(projectProgress(project) * 100)}%"></i></div>
      <ol class="steps" style="margin-top:8px"><li class="${project.stageIndex >= 0 ? 'done' : 'current'}">Planning & materials</li>${stages.map((st, i) => `<li class="${i < project.stageIndex ? 'done' : i === project.stageIndex ? 'current' : ''}">${esc(st.name.toLowerCase())}</li>`).join('')}</ol>
      <p class="muted" style="margin-top:6px">${project.waiting ? `⚠ ${esc(project.waiting)}` : `Timber on site: ${project.materials}`} · Crew now: ${crew.length ? esc(crew.join(', ')) : 'nobody'}</p>
      <p class="muted">Spent so far: ${project.materialsPaid}🪙 materials, ${project.labourPaid}🪙 labour${project.estimate ? ` of about ${project.estimate}🪙` : ''}${project.contracted ? ` · ${project.contracted} days of contracted crews` : ''}</p>
    </div>`;
  }
  const html = `
  <div class="card">
    <div class="row between"><strong style="font-size:16px">📍 ${esc(p.name)}</strong>${status(p)}</div>
    <dl class="kv" style="margin-top:8px">
      <dt>Land</dt><dd>${LAND_TYPES[p.landType].label} · ${p.w}×${p.d}</dd>
      <dt>Owner</dt><dd>${esc(owner(s, p.ownerId))}</dd>
      <dt>Building</dt><dd>${esc(p.building?.name ?? 'None')}</dd>
      <dt>Status</dt><dd>${esc(p.constructionStatus === 'NONE' ? (p.building ? 'Standing' : 'Vacant') : p.constructionStatus.toLowerCase())}</dd>
      <dt>Value</dt><dd>${plotValue(p)}🪙</dd>
      ${p.marketStatus === 'FOR_SALE' ? `<dt>Asking price</dt><dd>${p.price}🪙</dd>` : ''}
      <dt>Suitable for</dt><dd>${LAND_TYPES[p.landType].allows.map((t) => BUILDING_INFO[t].label).join(', ')}</dd>
    </dl>
    <div class="chips" style="margin-top:9px">${ownerC ? link('citizen', ownerC.id, `👤 ${ownerC.firstName}`) : ''}${b ? link('business', b.id, `🏪 ${b.name}`) : ''}${residents.map((r) => link('citizen', r.id, `🏠 ${r.firstName}`)).join('')}</div>
  </div>
  ${construction}
  ${architectureCard(sim, p)}
  ${b ? `<div class="card"><h3>Business</h3><p>${esc(b.name)} ${badge(b.status)}</p><p class="muted">${b.employees.length} employees · ${b.totals.customers} customers served</p></div>` : ''}
  <div class="card"><h3>History of this property</h3><div class="timeline">${[...p.history].reverse().map((h) => `<div class="entry"><small>DAY ${h.day}</small>${esc(h.text)}</div>`).join('') || '<p class="muted">No recorded history yet.</p>'}</div></div>
  <div class="grid2">
    <button class="btn" data-act="focus-plot" data-id="${p.id}">📍 Show in village</button>
    <button class="btn" data-act="history" data-kind="plot" data-id="${p.id}">📜 Chronicle</button>
  </div>`;
  return { title: p.name, html };
}
