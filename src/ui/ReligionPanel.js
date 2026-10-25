import { dateLabel } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { foodIn } from '../institutions/CommunityEvents.js';
import { ensureFaith, membersOf } from '../institutions/ReligiousInstitutions.js';
import { TRADITIONS, STANCES, affiliationCounts } from '../institutions/FaithManager.js';
import { esc, meter } from './util.js';

// Faith in the village: the traditions people hold to (or not), and what
// their communities do with what members give.

export function religionPanel(sim) {
  const s = sim.state;
  const counts = affiliationCounts(s);
  const total = Math.max(1, s.citizens.length);
  const communities = ensureFaith(s).communities.filter((f) => f.status === 'ACTIVE').map((f) => {
    const leader = s.citizens.find((c) => c.id === f.leaderId);
    return `<button class="item" data-act="faith" data-id="${f.id}"><span class="portrait" style="background:${TRADITIONS[f.tradition].color}">✦</span><span class="main"><strong>${esc(f.name)}</strong><small>${membersOf(s, f).length} followers · ${esc(f.tier ?? 'no building yet')} · elder ${esc(leader?.firstName ?? 'none')}</small><small>${f.stats.meals} meals given to ${f.stats.families} households · fund ${balance(s, f.id)}🪙</small></span></button>`;
  }).join('');
  const html = `<div class="card"><h3>Beliefs</h3>${Object.entries(TRADITIONS).map(([k, t]) => meter(`${t.name} — ${t.theme}`, (counts[k] / total) * 100)).join('')}${meter('No tradition, or sceptical', (counts.none / total) * 100)}
    <p class="muted" style="font-size:12px">Belief is personal. It shapes where people gather, what they celebrate and whom they turn to; it never decides anyone's honesty, temper or worth.</p></div>
    <div class="list">${communities || '<p class="empty">No faith community has formed yet (three followers are needed).</p>'}</div>`;
  return { title: 'Faith', html };
}

export function faithDetail(sim, id) {
  const s = sim.state;
  const f = ensureFaith(s).communities.find((x) => x.id === id);
  if (!f) return { title: 'Community', html: '<p class="empty">No such community.</p>' };
  const t = TRADITIONS[f.tradition];
  const members = membersOf(s, f);
  const leader = s.citizens.find((c) => c.id === f.leaderId);
  const html = `<div class="card"><p style="margin-top:0">${esc(t.name)}: ${esc(t.theme)}. Its rite, ${esc(t.rite)}, is kept each ${['spring', 'summer', 'autumn', 'winter'][t.season]}.</p>
    <dl class="kv"><dt>Elder</dt><dd>${leader ? `<button class="chip" data-act="citizen" data-id="${leader.id}">${esc(leader.firstName)} ${esc(leader.lastName)}</button>` : 'none'}</dd><dt>Followers</dt><dd>${members.length} (${members.filter((c) => c.belief.stance === 'devout').length} devout)</dd>
    <dt>Gathering place</dt><dd>${esc(f.tier ?? 'none yet')}</dd><dt>Fund</dt><dd>${balance(s, f.id)}🪙</dd><dt>Food store</dt><dd>${foodIn(f.stores)} portions</dd>
    <dt>Offerings received</dt><dd>${f.stats.donations}🪙</dd><dt>Meals given</dt><dd>${f.stats.meals} to ${f.stats.families} households</dd><dt>Bereaved consoled</dt><dd>${f.stats.consolations}</dd><dt>Rites held</dt><dd>${f.stats.rites}</dd><dt>School sponsored</dt><dd>${f.stats.schooling}🪙</dd><dt>Fire relief</dt><dd>${f.stats.relief}🪙</dd></dl>
    ${f.plotId ? `<button class="btn" data-act="focus-plot" data-id="${f.plotId}">📍 Show the ${esc(f.tier)}</button>` : ''}</div>
    <div class="card"><h3>Followers</h3>${members.map((c) => `<button class="chip" data-act="citizen" data-id="${c.id}">${esc(c.firstName)}${c.belief.stance === 'devout' ? ' ✦' : ''}</button>`).join(' ')}</div>
    <div class="card"><h3>History</h3>${f.history.slice().reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('')}</div>
    ${f.book.length ? `<div class="card"><h3>The community's book</h3>${f.book.slice(-8).reverse().map((b) => `<div class="belief">${esc(dateLabel(b.day))}: ${esc(b.text)}</div>`).join('')}</div>` : ''}`;
  return { title: f.name, html };
}

/** A line for a citizen's page. */
export const beliefLine = (c) => (c.belief ? `${c.belief.tradition ? `${TRADITIONS[c.belief.tradition].name} · ` : ''}${STANCES[c.belief.stance]}` : '');
