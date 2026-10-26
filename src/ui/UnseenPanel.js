import { byId } from '../core/EntityRegistry.js';
import { dateLabel, yearOf, firstDayOfYear } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { TRADITIONS } from '../institutions/FaithManager.js';
import { activeCommunities, membersOf } from '../institutions/ReligiousInstitutions.js';
import { KINGDOMS } from '../region/RegionData.js';
import { DIVINE, INSCRIPTIONS, INSCRIPTION_IDS, GLYPHS, glyphsFor, INTERPRETATIONS, INTERPRETATION_IDS, OUTLOOKS, SOCIETIES, SITE_WORKS } from '../divine/Config.js';
import { ensureDivine } from '../divine/State.js';
import { BLESSINGS, BLESSING_IDS, cooldownLeft, blessingProblem, prayerTarget } from '../divine/Blessings.js';
import { OMENS, OMEN_IDS, omenProblem } from '../divine/Omens.js';
import { openPrayers } from '../divine/Prayers.js';
import { suggestedSites, stoneSummary, placeName } from '../divine/Stone.js';
import { stoneCounts, worldviewCounts, worldviewLabel } from '../divine/Worldview.js';
import { activeSocieties, societyMembers } from '../divine/Movements.js';
import { FINDINGS } from '../divine/Stone.js';
import { esc } from './util.js';

// The Unseen Influence: the player's private panel. It never covers the whole
// world (it lives in the bottom sheet, emerald and gold) and every action in
// it is subtle, costed and optional. Doing nothing is always allowed.

export const UNSEEN_SECTIONS = [['blessings', 'Blessings', '✦'], ['signs', 'Signs & Omens', '☄'], ['prayers', 'Prayers', '🕯'], ['mysteries', 'Mysteries', '◈'], ['sacred', 'Sacred Places', '⛩'], ['history', 'Divine History', '📜']];

/** An eye: the panel's mark (inline SVG, no external files). */
export const eyeSvg = (size = 26) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="M2 16 C8 7, 24 7, 30 16 C24 25, 8 25, 2 16 Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="16" r="5.2" fill="currentColor" opacity=".9"/><circle cx="17.6" cy="14.4" r="1.6" fill="#0b2a1f"/></svg>`;

/** The carved inscription as the player sees it: the original script, line by line. */
export function glyphSvg(inscription, { cell = 13, cols = 4 } = {}) {
  const seq = glyphsFor(inscription);
  const rows = Math.ceil(seq.length / cols);
  const pad = 2;
  const paths = seq.map((g, i) => {
    const ox = (i % cols) * cell + pad, oy = Math.floor(i / cols) * cell + pad, s = cell - pad * 2;
    return GLYPHS[g].map(([x1, y1, x2, y2]) => `M${(ox + x1 * s).toFixed(1)} ${(oy + y1 * s).toFixed(1)}L${(ox + x2 * s).toFixed(1)} ${(oy + y2 * s).toFixed(1)}`).join('');
  }).join('');
  return `<svg class="glyphs" width="${cols * cell + pad}" height="${rows * cell + pad}" viewBox="0 0 ${cols * cell + pad} ${rows * cell + pad}" aria-label="An inscription in an unknown script"><path d="${paths}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}

const whisperDots = (n) => `<span class="hh-cost" title="${n} Whispers">${'◉'.repeat(n)}</span>`;

function header(s) {
  const d = ensureDivine(s);
  const pct = Math.round((d.whispers / d.maxWhispers) * 100);
  return `<div class="hh-head"><span class="hh-eye">${eyeSvg(22)}</span><div class="hh-whispers"><div class="row between"><strong>Whispers</strong><span>${Math.floor(d.whispers)} / ${d.maxWhispers}</span></div>
    <div class="hh-meter"><i style="width:${pct}%"></i></div><small class="muted">Return with time alone (${DIVINE.whispers.perDay * 12} a year). Worship and belief never add to them.</small></div></div>`;
}

function seg(view) {
  const mode = view.unseen ?? 'blessings';
  return `<div class="segmented scroll-seg hh-seg">${UNSEEN_SECTIONS.map(([k, l, i]) => `<button class="${mode === k ? 'active' : ''}" data-act="hh-mode" data-id="${k}"><span aria-hidden="true">${i}</span> ${l}</button>`).join('')}</div>`;
}

// --- Blessings ------------------------------------------------------------------------------------

function blessings(s, view) {
  const open = view.unseenBlessing;
  return BLESSING_IDS.map((id) => {
    const b = BLESSINGS[id];
    const cd = cooldownLeft(s, id);
    const targets = b.targets(s);
    const short = ensureDivine(s).whispers + 1e-9 < b.cost;
    const status = cd ? `again in ${cd} day${cd === 1 ? '' : 's'}` : short ? 'not enough Whispers' : targets.length ? `${targets.length} could receive it` : 'nobody needs it now';
    const expanded = open === id && !cd && !short && targets.length;
    return `<div class="card hh-card${expanded ? ' open' : ''}"><div class="row between"><strong>${b.icon} ${esc(b.name)}</strong>${whisperDots(b.cost)}</div>
      <p>${esc(b.about)}</p><div class="row between"><small class="muted">${esc(status)} · lasts ${b.days} days</small>
      <button class="btn small hh-btn" data-act="hh-pick" data-id="${id}" ${cd || short || !targets.length ? 'disabled' : ''}>${expanded ? 'Close' : 'Choose…'}</button></div>
      ${expanded ? `<div class="hh-targets">${targets.slice(0, 14).map((t) => `<button class="item hh-target" data-act="hh-bless" data-id="${id}" data-target="${esc(t.id)}"><span class="main"><strong>${esc(t.label)}</strong><small>${esc(t.why)}</small></span><span class="side">${b.icon}</span></button>`).join('')}</div>` : ''}</div>`;
  }).join('');
}

// --- Signs ------------------------------------------------------------------------------------------

function signs(s) {
  return `<p class="muted hh-note">A sign appears where you are looking (stone signs at the stone). Who sees it, and what they make of it, is up to them.</p>` + OMEN_IDS.map((id) => {
    const o = OMENS[id];
    const problem = omenProblem(s, id);
    return `<div class="card hh-card"><div class="row between"><strong>${o.icon} ${esc(o.name)}</strong>${whisperDots(o.cost)}</div>
      <div class="row between"><small class="muted">${esc(problem ?? (o.scope === 'sky' ? 'Seen across the sky' : o.scope === 'stone' ? 'At the stone' : 'Where you are looking'))}</small>
      <button class="btn small hh-btn" data-act="hh-omen" data-id="${id}" ${problem ? 'disabled' : ''}>Send</button></div></div>`;
  }).join('');
}

// --- Prayers -----------------------------------------------------------------------------------------

function prayers(s, view) {
  const d = ensureDivine(s);
  const open = openPrayers(s).slice(0, 25);
  const answering = view.unseenPrayer;
  // Being shown counts as being seen (the record keeps whether you looked).
  for (const p of open) p.viewed = true;
  const rows = open.map((p) => {
    const c = byId(s.citizens, p.citizenId);
    const options = answering === p.id ? p.blessings.filter((b) => !blessingProblem(s, b, prayerTarget(s, p, b))) : [];
    return `<div class="card hh-card hh-prayer"><div class="row between"><strong>${c ? `<button class="chip" data-act="citizen" data-id="${c.id}">${esc(c.firstName)} ${esc(c.lastName)}</button>` : esc(p.name)}</strong><small class="muted">${esc(dateLabel(p.day, { short: true }))}</small></div>
      <p class="quote">“${esc(p.text)}”</p>
      ${answering === p.id ? `<div class="hh-targets">${options.length ? options.map((b) => `<button class="item hh-target" data-act="hh-answer" data-id="${p.id}" data-blessing="${b}"><span class="main"><strong>${BLESSINGS[b].icon} ${esc(BLESSINGS[b].name)}</strong><small>${BLESSINGS[b].cost} Whispers</small></span></button>`).join('') : '<p class="muted">No blessing can help with this just now.</p>'}</div>` : ''}
      <div class="hh-actions"><button class="btn small hh-btn" data-act="hh-answer-open" data-id="${p.id}" ${p.blessings.length ? '' : 'disabled'}>✦ Offer a blessing</button><button class="btn small" data-act="hh-mode" data-id="signs">☄ Send a sign</button><button class="btn small ghost" data-act="hh-silence" data-id="${p.id}">Do nothing</button></div></div>`;
  }).join('');
  const done = d.prayers.filter((p) => p.resolvedDay).slice(-8).reverse().map((p) => `<div class="belief"><strong>${esc(p.name)}</strong>: “${esc(p.text)}” <span class="muted">— ${esc(p.outcome)}${p.response && p.response !== 'silence' ? ` · you answered (${esc(p.responseLabel ?? p.response)})` : p.response === 'silence' ? ' · you kept silent' : ' · unanswered'}</span></div>`).join('');
  return `<p class="muted hh-note">These are prayers villagers actually made about their own lives. Silence is always allowed; nothing happens to anyone because you did not answer.</p>
    ${rows || '<p class="empty">No one is praying just now.</p>'}
    <div class="card"><h3>Recently settled</h3>${done || '<p class="muted">Nothing yet.</p>'}<p class="muted" style="font-size:12px">${d.stats.prayersMade} prayers made · ${d.stats.prayersAnswered} answered · ${d.stats.prayersUnanswered} left unanswered</p></div>`;
}

// --- Mysteries (the stone) ---------------------------------------------------------------------

function bars(counts, keys, labelOf, colorOf) {
  const total = Math.max(1, keys.reduce((t, k) => t + (counts[k] ?? 0), 0));
  const strip = keys.filter((k) => counts[k]).map((k) => `<i style="flex:${counts[k]};background:${colorOf(k)}" title="${esc(labelOf(k))}: ${counts[k]}"></i>`).join('');
  const legend = keys.filter((k) => counts[k]).map((k) => `<span><b style="background:${colorOf(k)}"></b>${esc(labelOf(k))} ${Math.round((counts[k] / total) * 100)}%</span>`).join('');
  return `<div class="hh-strip">${strip}</div><div class="hh-legend">${legend}</div>`;
}

function mysteries(s, view) {
  const d = ensureDivine(s);
  if (!d.unlocked) {
    const left = 200 - yearOf(s.day);
    return `<div class="card hh-card hh-locked"><h3>◈ The Mysterious Stone</h3><p>Something extraordinary becomes possible in Year ${DIVINE.unlockYear}. ${left > 0 ? `${left} year${left === 1 ? '' : 's'} remain (it is now Year ${yearOf(s.day)}).` : ''}</p>
      <p class="muted">Until then you may watch, bless and send signs. Nothing is lost by waiting.</p></div>`;
  }
  if (!d.stone) {
    const pick = view.unseenInscription ?? 'glyphs';
    const sites = suggestedSites(s);
    return `<div class="card hh-card"><h3>◈ Leave a question carved in stone</h3><p>Choose what is carved. The villagers will not be able to read it; only you know what it means.</p>
      <div class="hh-inscriptions">${INSCRIPTION_IDS.map((id) => `<button class="hh-insc${pick === id ? ' active' : ''}" data-act="hh-insc" data-id="${id}">${glyphSvg(id, { cell: 9 })}<strong>${esc(INSCRIPTIONS[id].title)}</strong><small>${esc(INSCRIPTIONS[id].text ? `“${INSCRIPTIONS[id].text}”` : 'Symbols with no meaning in any tongue')}</small></button>`).join('')}</div></div>
      <div class="card hh-card"><h3>Where should it stand?</h3>
      <button class="btn primary hh-gold" data-act="hh-place-map">✦ Choose a spot on the land</button>
      <div class="list" style="margin-top:8px">${sites.map((x) => `<button class="item" data-act="hh-place-site" data-id="${x.key}" ${x.problem ? 'disabled' : ''}><span class="main"><strong>${esc(x.label)}</strong><small>${esc(x.problem ?? 'Open land: no plot, road or building')}</small></span><span class="side">${x.problem ? '' : '▸'}</span></button>`).join('')}</div>
      <p class="muted" style="font-size:12px">The stone may not stand on a property, road, planned street or in the river. ${d.postponed ? 'You chose to wait; the choice remains yours.' : ''}</p></div>`;
  }
  const st = d.stone;
  const sum = stoneSummary(s);
  const counts = stoneCounts(s);
  const known = INTERPRETATION_IDS.reduce((t, k) => t + counts[k], 0);
  const studies = st.studies.map((x) => `<div class="belief">${esc(dateLabel(x.day, { short: true }))}: ${esc(x.byName)} found that ${esc(FINDINGS.find((f) => f.id === x.id)?.text ?? x.id)}.</div>`).join('');
  const works = Object.entries(st.site).map(([k, w]) => `<span class="chip">${esc(SITE_WORKS[k]?.label ?? k)} · ${esc(w.by)}</span>`).join(' ');
  return `<div class="card hh-card hh-stone"><div class="row" style="align-items:flex-start;gap:12px">${glyphSvg(st.inscription, { cell: 10 })}<div>
      <h3>◈ The Mysterious Stone</h3><p>Raised ${esc(sum.placed)}, ${esc(sum.where)}.</p>
      <p>${sum.discovered ? `Found ${esc(sum.discovered)}.` : '<em>Nobody has found it yet.</em>'}</p>
      ${INSCRIPTIONS[st.inscription].text ? `<p class="muted">You carved: “${esc(INSCRIPTIONS[st.inscription].text)}”. No one living can read it.</p>` : '<p class="muted">You carved symbols that mean nothing in any tongue.</p>'}</div></div>
      <dl class="kv"><dt>Villagers who know of it</dt><dd>${known}</dd><dt>Visits</dt><dd>${st.visits}</dd><dt>Studies</dt><dd>${st.investigations}</dd></dl>
      <button class="btn" data-act="hh-show-stone">📍 Show the stone</button></div>
    ${known ? `<div class="card"><h3>What they make of it</h3>${bars(counts, INTERPRETATION_IDS, (k) => INTERPRETATIONS[k].short, (k) => INTERPRETATIONS[k].color)}<p class="muted" style="font-size:12px">${counts.unaware} have never heard of it. Each view comes from that person's own temperament, faith, friends and experience.</p></div>` : ''}
    ${studies ? `<div class="card"><h3>What the scholars found</h3>${studies}</div>` : ''}
    ${works ? `<div class="card"><h3>Around the stone</h3><div class="chips">${works}</div></div>` : ''}
    ${st.history.length ? `<div class="card"><h3>Its history</h3>${st.history.slice(-10).reverse().map((h) => `<div class="belief">${esc(dateLabel(h.day, { short: true }))}: ${esc(h.text)}</div>`).join('')}</div>` : ''}`;
}

// --- Sacred places ------------------------------------------------------------------------------

function sacred(s) {
  const d = ensureDivine(s);
  const wv = worldviewCounts(s);
  const total = Math.max(1, s.citizens.length);
  const keys = Object.keys(wv).sort((a, b) => wv[b] - wv[a]);
  const colorOf = (k) => TRADITIONS[k]?.color ?? { reason: '#7fa7c9', agnostic: '#9aa6ad', atheist: '#6f7a90', personal: '#c9a0d9' }[k] ?? '#888';
  const places = s.plots.filter((p) => ['shrine', 'chapel', 'temple'].includes(p.building?.type)).map((p) => {
    const f = activeCommunities(s).find((x) => x.id === p.ownerId);
    return `<button class="item" data-act="focus-plot" data-id="${p.id}"><span class="portrait" style="background:${f ? TRADITIONS[f.tradition].color : '#888'}">⛩</span><span class="main"><strong>${esc(p.building.name ?? p.building.type)}</strong><small>${esc(p.name)} · ${f ? esc(f.name) : 'no community'}</small></span></button>`;
  }).join('');
  const comms = activeCommunities(s).map((f) => `<button class="item" data-act="faith" data-id="${f.id}"><span class="portrait" style="background:${TRADITIONS[f.tradition].color}">✦</span><span class="main"><strong>${esc(f.name)}</strong><small>${membersOf(s, f).length} followers · fund ${balance(s, f.id)}🪙</small></span></button>`).join('');
  const socs = activeSocieties(s).map((x) => `<div class="item"><span class="portrait" style="background:${SOCIETIES[x.kind].color}">${SOCIETIES[x.kind].icon}</span><span class="main"><strong>${esc(x.name)}</strong><small>${societyMembers(s, x).length} members · purse ${balance(s, x.id)}🪙 · since Year ${yearOf(x.foundedDay)}</small></span></div>`).join('');
  const abroad = Object.entries(d.foreign).map(([k, f]) => `<div class="belief"><strong>${esc(KINGDOMS[k]?.name ?? k)}</strong>: ${f.heard} have heard of the stone from visitors; ${f.believers} believe, ${f.interested} are interested, ${f.rejected} turned the idea away.${f.circle ? ' A small circle meets there.' : ''}</div>`).join('');
  return `<div class="card"><h3>How the kingdom meets the world</h3>${bars(wv, keys, (k) => worldviewLabel(k), colorOf)}<p class="muted" style="font-size:12px">Of ${total} villagers. Faith or its absence never decides anyone's honesty, intelligence or worth.</p></div>
    ${d.stone ? `<button class="item" data-act="hh-show-stone"><span class="portrait hh-gold-bg">◈</span><span class="main"><strong>The carved stone</strong><small>${esc(placeName(s))}</small></span></button>` : ''}
    <div class="card"><h3>Faith communities</h3><div class="list">${comms || '<p class="muted">None yet.</p>'}</div></div>
    <div class="card"><h3>Places of worship</h3><div class="list">${places || '<p class="muted">No shrine, chapel or temple has been built.</p>'}</div></div>
    <div class="card"><h3>Societies</h3><div class="list">${socs || '<p class="muted">No society has formed.</p>'}</div></div>
    ${abroad ? `<div class="card"><h3>Beyond the valley</h3>${abroad}</div>` : ''}`;
}

// --- Divine history (the Hidden Chronicle) -----------------------------------------------------

const FILTERS = [['all', 'All'], ['mine', 'Your actions'], ['world', 'What followed'], ['prayers', 'Prayers']];

/** Developments in the Hidden Chronicle that followed one of your actions (same people, soon after). */
function followUps(d, e) {
  const people = new Set(e.refs?.citizens ?? []);
  return d.hidden.filter((x) => x.id !== e.id && !x.actual && x.day >= e.day && x.day - e.day <= DIVINE.prayerWindowDays * 2 && ((x.refs?.citizens ?? []).some((id) => people.has(id)) || (e.refs?.effect && x.refs?.effect === e.refs.effect))).slice(0, 3);
}

function history(s, view) {
  const d = ensureDivine(s);
  const f = view.unseenFilter ?? 'all';
  const pick = (e) => f === 'all' || (f === 'mine' && e.actual) || (f === 'world' && !e.actual && !e.kind.startsWith('prayer')) || (f === 'prayers' && e.kind.startsWith('prayer'));
  const rows = d.hidden.filter(pick).slice(-40).reverse().map((e) => {
    const after = e.actual ? followUps(d, e) : [];
    return `<div class="hh-entry${e.actual ? ' mine' : ''}"><small>${esc(dateLabel(e.day, { short: true }))}</small><p>${esc(e.text)}</p>${after.length ? `<div class="hh-after">${after.map((x) => `<span>↳ ${esc(x.text)}</span>`).join('')}</div>` : ''}</div>`;
  }).join('');
  return `<p class="muted hh-note">Only you can read this. The kingdom's own Chronicle records only what its people experienced; a good turn of events is not proof of your hand.</p>
    <div class="chips scroll">${FILTERS.map(([k, l]) => `<button class="chip${f === k ? ' active' : ''}" data-act="hh-filter" data-id="${k}">${l}</button>`).join('')}</div>
    <div class="card hh-chronicle">${rows || '<p class="muted">Nothing recorded yet.</p>'}</div>
    <p class="muted" style="font-size:12px">${d.stats.blessings} blessings · ${d.stats.omens} signs · ${d.stats.whispersSpent} Whispers spent · ${d.stats.conversions} came to the Hidden Hand · ${d.stats.leavings} left it · ${d.stats.missions} journeys</p>`;
}

export function unseenPanel(sim, view) {
  const s = sim.state;
  const mode = view.unseen ?? 'blessings';
  const body = { blessings, signs, prayers, mysteries, sacred, history }[mode] ?? blessings;
  return { title: 'The Unseen Influence', html: `<div class="hh-panel">${header(s)}${seg(view)}${body(s, view)}</div>` };
}

/** The entry on the Council tab (main navigation), so the panel is reachable when the eye is hidden. */
export function unseenEntryCard(sim, settings = {}) {
  const d = ensureDivine(sim.state);
  const where = settings.unseenEye ?? 'right';
  return `<div class="card hh-card hh-entry-card"><div class="row between"><strong><span class="hh-eye-inline">${eyeSvg(18)}</span> The Unseen Influence</strong><span class="muted">${Math.floor(d.whispers)} Whispers</span></div>
    <p>Blessings, signs, prayers and mysteries.${d.unlocked && !d.stone ? ' The stone may be raised.' : ''}</p>
    <button class="btn hh-gold" data-act="hh-open">Open</button>
    <div class="row between" style="margin-top:8px"><small class="muted">Eye button</small><div class="segmented">${[['right', 'Right'], ['left', 'Left'], ['hidden', 'Hidden']].map(([k, l]) => `<button class="${where === k ? 'active' : ''}" data-act="hh-eye" data-id="${k}">${l}</button>`).join('')}</div></div></div>`;
}

/** The Year 200 notice: visible only to the player. */
export const WHISPER_NOTICE = { title: 'A Whisper Across the Ages', text: '“For two centuries, they have lived without knowing you are there. Now, you may leave a question carved in stone.”' };

export { firstDayOfYear, OUTLOOKS };
