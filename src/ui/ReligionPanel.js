import { dateLabel } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { foodIn } from '../institutions/CommunityEvents.js';
import { ensureFaith, membersOf } from '../institutions/ReligiousInstitutions.js';
import { TRADITIONS, STANCES, affiliationCounts } from '../institutions/FaithManager.js';
import { esc, meter } from './util.js';
import { worldviewOf, worldviewCounts, worldviewLabel, stoneCounts, reasonsFor, viewPhrase, primaryWorldview } from '../divine/Worldview.js';
import { INTERPRETATIONS, INTERPRETATION_IDS, OUTLOOKS, ROLES } from '../divine/Config.js';
import { activeSocieties, societyMembers } from '../divine/Movements.js';

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
  const wv = worldviewCounts(s);
  const rows = [...Object.entries(TRADITIONS).filter(([k, t]) => !t.emergent || wv[k]).map(([k, t]) => meter(`${t.name} — ${t.theme}`, ((wv[k] ?? 0) / total) * 100)),
    ...Object.entries(OUTLOOKS).filter(([k]) => wv[k]).map(([k, o]) => meter(`${o.label} — ${o.theme}`, (wv[k] / total) * 100))].join('');
  const stone = s.divine?.stone?.discovered ? stoneCounts(s) : null;
  const socs = activeSocieties(s).map((x) => `<div class="belief"><strong>${esc(x.name)}</strong> · ${societyMembers(s, x).length} members · purse ${balance(s, x.id)}🪙</div>`).join('');
  const html = `<div class="card"><h3>Faiths and philosophies</h3>${rows}
    <p class="muted" style="font-size:12px">Belief is personal. It shapes where people gather, what they celebrate and whom they turn to; it never decides anyone's honesty, temper or worth.</p></div>
    ${stone ? `<div class="card"><h3>The carved stone</h3>${INTERPRETATION_IDS.filter((k) => stone[k]).map((k) => meter(INTERPRETATIONS[k].label, (stone[k] / total) * 100)).join('')}${meter('Have never heard of it', (stone.unaware / total) * 100)}</div>` : ''}
    ${socs ? `<div class="card"><h3>Societies</h3>${socs}</div>` : ''}
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
export const beliefLine = (c) => (c.belief ? `${c.belief.tradition ? `${TRADITIONS[c.belief.tradition].name} · ` : ''}${STANCES[c.belief.stance]}${!c.belief.tradition || c.belief.stance === 'skeptical' || c.belief.stance === 'none' ? (c.worldview?.outlook ? ` · ${OUTLOOKS[c.worldview.outlook].label}` : '') : ''}` : '');

/** The worldview part of a citizen's page: their outlook, temperament, calling and view of the stone (with their reasons). */
export function worldviewCard(sim, c) {
  const s = sim.state;
  if (!c.belief) return '';
  const wv = worldviewOf(s, c);
  const k = wv.stone;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const how = k ? { saw: 'saw it with their own eyes', heard: 'heard of it', read: 'read about it', taught: 'were taught about it as a child' }[k.how] : null;
  const from = k?.from ? s.citizens.find((x) => x.id === k.from) : null;
  const reasons = k ? reasonsFor(s, c) : [];
  const recent = wv.exp.slice(0, 3).map((e) => e.text ?? `${e.kind} (${INTERPRETATIONS[e.interp]?.short ?? e.interp})`);
  return `<div class="card"><h3>Belief</h3><p style="margin:0">${esc(beliefLine(c))}</p>${wv.role ? `<p><strong>Calling:</strong> ${esc(ROLES[wv.role])}</p>` : ''}
    <dl class="kv" style="margin-top:6px"><dt>Curiosity</dt><dd>${pct(wv.cur)}</dd><dt>Wants evidence</dt><dd>${pct(wv.skep)}</dd><dt>Open to other views</dt><dd>${pct(wv.open)}</dd><dt>Tolerance</dt><dd>${pct(wv.tol)}</dd></dl>
    ${k ? `<p style="margin-top:8px"><strong>The carved stone:</strong> thinks it is ${esc(viewPhrase(k.interp))} (${pct(k.conf)} sure, ${k.interp === 'indifferent' ? 'and does not care much' : `interest ${pct(k.interest)}`}). ${esc(c.firstName)} ${esc(how)}${from ? ` from ${esc(from.firstName)}` : ''}${k.visits ? `, and has visited it ${k.visits} time${k.visits === 1 ? '' : 's'}` : ''}.</p>
      ${reasons.length ? `<p class="muted" style="font-size:12px">Why: ${reasons.map(esc).join('; ')}.</p>` : ''}` : ''}
    ${recent.length ? `<p class="muted" style="font-size:12px">Lately: ${recent.map(esc).join(' · ')}</p>` : ''}
    ${c.militia ? '<p class="muted">Serving in the militia.</p>' : ''}${c.refugee ? `<p class="muted">Came as a refugee from ${esc(c.refugee.from)}.</p>` : ''}</div>`;
}
