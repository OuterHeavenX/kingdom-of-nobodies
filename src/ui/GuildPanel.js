import { dateLabel } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { ensureGuilds, GUILD_TYPES } from '../institutions/GuildManager.js';
import { esc } from './util.js';

// Guilds: members, master, fund, hall, elections and quarrels.

const who = (s, id) => s.citizens.find((c) => c.id === id);

export function guildPanel(sim) {
  const s = sim.state;
  const g = ensureGuilds(s);
  const list = g.list.filter((x) => x.status === 'ACTIVE').map((x) => {
    const master = who(s, x.leaderId);
    return `<button class="item" data-act="guild" data-id="${x.id}"><span class="portrait" style="background:#8a5a3a">⚒️</span><span class="main"><strong>${esc(x.name)}</strong><small>${x.members.length} members · master ${esc(master ? `${master.firstName} ${master.lastName}` : 'vacant')}</small><small>fund ${balance(s, x.id)}🪙${x.plotId ? ' · has a hall' : ''}${x.privileges.length ? ' · holds a market privilege' : ''}${x.creditBankId ? ' · credit fund' : ''}</small></span></button>`;
  }).join('');
  const disputes = g.disputes.slice(-5).reverse().map((d) => `<div class="belief">${esc(dateLabel(d.day))}: ${esc(d.guilds.map((id) => g.list.find((x) => x.id === id)?.name).join(' vs '))} over ${esc(d.over.map((k) => (k === 'tariffLevel' ? 'tariffs' : k)).join(', '))}</div>`).join('');
  const html = `<div class="list">${list || '<p class="empty">No guilds yet: a trade needs at least three practitioners to found one.</p>'}</div>
    ${disputes ? `<div class="card"><h3>Disagreements</h3>${disputes}</div>` : ''}
    <div class="card"><h3>What the guilds want</h3>${Object.values(GUILD_TYPES).map((t) => `<div class="belief"><strong>${esc(t.name)}</strong> (${esc(t.professions.join(', '))}): ${esc(t.cause)}</div>`).join('')}</div>`;
  return { title: 'Guilds', html };
}

export function guildDetail(sim, id) {
  const s = sim.state;
  const g = ensureGuilds(s).list.find((x) => x.id === id);
  if (!g) return { title: 'Guild', html: '<p class="empty">No such guild.</p>' };
  const master = who(s, g.leaderId);
  const members = g.members.map((m) => who(s, m)).filter(Boolean);
  const last = g.elections.at(-1);
  const html = `<div class="card"><dl class="kv"><dt>Master</dt><dd>${master ? `<button class="chip" data-act="citizen" data-id="${master.id}">${esc(master.firstName)} ${esc(master.lastName)}</button>` : 'vacant'}</dd><dt>Founded</dt><dd>${esc(dateLabel(g.foundedDay))}</dd><dt>Fund</dt><dd>${balance(s, g.id)}🪙</dd>
    <dt>Dues collected</dt><dd>${g.stats.dues}🪙</dd><dt>Spent on training</dt><dd>${g.stats.training}🪙</dd><dt>Hardship aid</dt><dd>${g.stats.aid}🪙</dd><dt>Public works sponsored</dt><dd>${g.stats.sponsored}🪙</dd>
    <dt>Hall</dt><dd>${g.plotId ? esc(s.plots.find((p) => p.id === g.plotId)?.name ?? '') : 'not yet'}</dd>${g.privileges.length ? `<dt>Privileges</dt><dd>reduced market levy for members' shops</dd>` : ''}</dl>
    ${last ? `<p class="muted" style="font-size:12px">Last election ${esc(dateLabel(last.day))} (${esc(last.why)}): ${Object.entries(last.votes).map(([cid, n]) => `${esc(who(s, cid)?.firstName ?? '?')} ${n}`).join(', ')}.</p>` : ''}
    ${g.plotId ? `<button class="btn" data-act="focus-plot" data-id="${g.plotId}">📍 Show the hall</button>` : ''}</div>
    <div class="card"><h3>Members (${members.length})</h3>${members.map((c) => `<button class="chip" data-act="citizen" data-id="${c.id}">${esc(c.firstName)} · ${esc(c.profession)}</button>`).join(' ')}</div>
    <div class="card"><h3>History</h3>${g.history.slice().reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day))}: ${esc(h.text)}</div>`).join('')}</div>`;
  return { title: g.name, html };
}
