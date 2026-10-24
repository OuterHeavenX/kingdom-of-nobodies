import { balance } from '../economy/Transactions.js';
import { isTrading } from '../economy/Businesses.js';
import { person, parentsOf, childrenOf, siblingsOf, generationsOf, descendantIds } from '../citizens/FamilyTree.js';
import { ageOn, yearOf } from '../core/Calendar.js';
import { esc } from './util.js';

// Families and dynasties. Houses are family names; the tree view is centred
// on one person (parents above, spouses beside, children below) so it stays
// usable on a phone however many generations a family spans.

const living = (s, p) => s.citizens.includes(p);

function houseStats(s, name) {
  const members = [...s.citizens.filter((c) => c.lastName === name), ...Object.values(s.archive).filter((p) => p.lastName === name)];
  const alive = members.filter((p) => living(s, p));
  const wealth = alive.reduce((t, c) => t + balance(s, c.id), 0);
  const plots = s.plots.filter((p) => alive.some((c) => c.id === p.ownerId)).length;
  const businesses = s.businesses.filter((b) => isTrading(b) && alive.some((c) => c.id === b.ownerId));
  const offices = (s.government?.elections ?? []).filter((e) => members.some((m) => m.id === e.winnerId)).length;
  const gens = new Set(members.map((m) => m.generation ?? 1)).size;
  const founder = members.some((m) => m.founder);
  const achievements = members.reduce((t, m) => t + (m.achievements ?? []).filter((a) => !['married', 'trained'].includes(a.type)).length, 0);
  return { name, members, alive, wealth, plots, businesses, offices, gens, founder, achievements, score: wealth + plots * 30 + businesses.length * 60 + offices * 80 + achievements * 10 + alive.length * 5 };
}

export function familiesList(sim) {
  const s = sim.state;
  const names = new Set([...s.citizens.map((c) => c.lastName), ...Object.values(s.archive).map((p) => p.lastName)]);
  const houses = [...names].map((n) => houseStats(s, n)).filter((h) => h.members.length > 1 || h.founder || h.alive.length).sort((a, b) => b.score - a.score);
  const rows = houses.slice(0, 40).map((h) => `
    <button class="item" data-act="house" data-id="${esc(h.name)}">
      <span class="portrait" style="background:${esc(h.alive[0]?.color ?? h.members[0]?.color ?? '#ccc')}">${esc(h.name[0])}</span>
      <span class="main"><strong>House ${esc(h.name)}${h.founder ? ' · founders' : ''}</strong>
        <small>${h.alive.length} living · ${h.members.length - h.alive.length} remembered · ${h.gens} generation${h.gens > 1 ? 's' : ''}${h.offices ? ` · ${h.offices} term${h.offices > 1 ? 's' : ''} in office` : ''}</small></span>
      <span class="side">${h.wealth}🪙<br>${h.businesses.length ? `🏪 ${h.businesses.length}` : ''}</span>
    </button>`).join('');
  return { title: `Families · ${houses.length}`, html: `<p class="muted" style="font-size:12.5px;margin:0">Houses ranked by wealth, land, businesses, offices and achievements. Fortunes rise and fall with each generation.</p><div class="list">${rows}</div>` };
}

export function houseDetail(sim, name) {
  const s = sim.state;
  const h = houseStats(s, name);
  const gens = generationsOf(s, name);
  const card = (p) => {
    const dead = !living(s, p);
    const age = dead ? p.ageAtEnd : ageOn(p.birthDay, s.day);
    return `<button class="item" data-act="tree" data-id="${p.id}" style="min-height:46px;padding:7px 9px${dead ? ';opacity:.7' : ''}">
      <span class="portrait" style="background:${esc(p.color)}">${esc(p.firstName[0])}</span>
      <span class="main"><strong>${esc(p.firstName)}${dead ? ' †' : ''}${p.founder ? ' ★' : ''}</strong><small>${dead ? `${p.status === 'emigrated' ? 'left' : 'died'} aged ${age}` : `aged ${age}`} · ${esc(p.profession)}</small></span></button>`;
  };
  const html = `
  <div class="card">
    <h3>House ${esc(name)}</h3>
    <dl class="kv">
      <dt>Living members</dt><dd>${h.alive.length}</dd>
      <dt>Remembered</dt><dd>${h.members.length - h.alive.length}</dd>
      <dt>Generations</dt><dd>${h.gens}</dd>
      <dt>Family wealth</dt><dd>${h.wealth}🪙</dd>
      <dt>Land held</dt><dd>${h.plots} plot${h.plots === 1 ? '' : 's'}</dd>
      <dt>Businesses</dt><dd>${h.businesses.map((b) => esc(b.name)).join(', ') || 'none'}</dd>
      <dt>Terms in office</dt><dd>${h.offices}</dd>
    </dl>
  </div>
  ${gens.map((g) => `<div class="card"><h3>Generation ${g.gen}</h3><div class="list">${g.members.map(card).join('')}</div></div>`).join('')}`;
  return { title: `House ${name}`, html };
}

/** Person-centred family tree. */
export function familyTree(sim, id) {
  const s = sim.state;
  const p = person(s, id);
  if (!p) return { title: 'Family tree', html: '<p class="empty">Unknown person.</p>' };
  const chip = (x, rel) => {
    if (!x) return '';
    const dead = !living(s, x);
    return `<button class="tree-node${dead ? ' dead' : ''}" data-act="tree" data-id="${x.id}"><span class="dot" style="background:${esc(x.color)}"></span>
      <strong>${esc(x.firstName)} ${esc(x.lastName)}${dead ? ' †' : ''}</strong><small>${esc(rel)} · ${dead ? `${yearOf(x.birthDay)}–${yearOf(x.deathDay ?? x.leftDay ?? s.day)}` : `aged ${ageOn(x.birthDay, s.day)}`}</small></button>`;
  };
  const parents = parentsOf(s, id);
  const grand = parents.flatMap((x) => parentsOf(s, x.id));
  const spouses = [p.family.spouseId, ...(p.family.formerSpouseIds ?? [])].filter(Boolean).map((x) => person(s, x)).filter(Boolean);
  const kids = childrenOf(s, id).sort((a, b) => a.birthDay - b.birthDay);
  const sibs = siblingsOf(s, id);
  const desc = descendantIds(s, id).size;
  const html = `
  <div class="tree">
    ${grand.length ? `<div class="tree-row">${grand.map((x) => chip(x, 'grandparent')).join('')}</div><div class="tree-link">│</div>` : ''}
    ${parents.length ? `<div class="tree-row">${parents.map((x) => chip(x, x.family.childIds.includes(id) && p.family.adoptive ? 'parent (adoptive)' : 'parent')).join('')}</div><div class="tree-link">│</div>` : '<p class="muted center">Parents unknown: arrived from beyond the valley.</p>'}
    <div class="tree-row focus">${chip(p, p.founder ? 'founder' : 'selected')}${spouses.map((x, i) => chip(x, i === 0 && p.family.spouseId === x.id ? 'spouse' : 'former spouse')).join('')}</div>
    ${kids.length ? `<div class="tree-link">│</div><div class="tree-row">${kids.map((x) => chip(x, 'child')).join('')}</div>` : ''}
    ${sibs.length ? `<p class="muted" style="margin-top:10px;font-size:12px">Siblings</p><div class="tree-row">${sibs.map((x) => chip(x, 'sibling')).join('')}</div>` : ''}
  </div>
  <p class="muted" style="font-size:12px">${desc} descendant${desc === 1 ? '' : 's'} recorded.</p>
  <div class="grid2">
    <button class="btn" data-act="bio" data-id="${p.id}">📖 Biography</button>
    <button class="btn" data-act="house" data-id="${esc(p.lastName)}">🏠 House ${esc(p.lastName)}</button>
    ${living(s, p) ? `<button class="btn" data-act="citizen" data-id="${p.id}">👤 Their life now</button>` : ''}
  </div>`;
  return { title: `${p.firstName}'s family`, html };
}
