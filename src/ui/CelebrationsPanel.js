import { HOLIDAYS, SEASON_THEMES, HOLIDAY_BY_ID } from '../holidays/HolidayRegistry.js';
import { TRADITIONS } from '../institutions/FaithManager.js';
import { holidayNow, ensureHolidays } from '../culture/Holidays.js';
import { nextHoliday } from '../holidays/HolidayCalendar.js';
import { snowCover, snowLevel } from '../effects/SnowAccumulation.js';
import { dateLabel } from '../core/Calendar.js';
import { clock, esc } from './util.js';

// Council → Seasons & celebrations: what is being celebrated, a preview of
// every season and holiday (visual only), which holidays the kingdom keeps,
// and the graphics settings for snow, fireworks and the rest.

const seg = (key, value, options) => `<div class="segmented">${options.map(([v, label]) => `<button class="${value === v ? 'active' : ''}" data-act="hset" data-key="${key}" data-value="${v}">${label}</button>`).join('')}</div>`;
const toggle = (key, label, on, hint = '') => `<label class="toggle">${label}${hint ? `<small>${hint}</small>` : ''} <input type="checkbox" data-act="hset" data-key="${key}" ${on ? 'checked' : ''}></label>`;

export function untilText(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h >= 24 ? `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'}` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

export function celebrationsCard(game) {
  const s = game.sim.state;
  const h = ensureHolidays(s);
  const themes = game.world?.themes;
  const status = themes?.status;
  const settings = game.settings.holidays;
  const kingdomNow = holidayNow(s);
  const next = nextHoliday(s.day, s.minute, { enabled: h.enabled });
  const snow = snowCover(s);
  const showing = status?.holiday ? `${status.holiday.icon} ${esc(status.holiday.name)}` : ['🌸 Spring', '☀️ Summer', '🍂 Autumn', '❄️ Winter'][status?.season ?? 0];
  const source = status?.source === 'preview' ? ' (preview)' : status?.source === 'real' ? ' (your calendar)' : '';
  const preview = status?.preview;
  const previewButtons = [...SEASON_THEMES, ...HOLIDAYS].map((t) => `<button class="chip ${preview === t.id ? 'active' : ''}" data-act="preview" data-id="${t.id}">${t.icon} ${esc(t.name)}</button>`).join('');
  const keeps = HOLIDAYS.map((d) => {
    const faiths = d.religious ? `a feast of the ${d.traditions.map((x) => TRADITIONS[x]?.name ?? x).join(' and ')} traditions; others may join or keep their own` : '';
    return `<label class="toggle">${d.icon} ${esc(d.name)}${faiths ? `<small>${esc(faiths)}</small>` : ''} <input type="checkbox" data-act="holiday-toggle" data-id="${d.id}" ${h.enabled[d.id] !== false ? 'checked' : ''}></label>`;
  }).join('');
  const recent = h.log.slice(-6).reverse().map((e) => {
    const d = HOLIDAY_BY_ID[e.id];
    return `<div class="belief">${d?.icon ?? '🎉'} <strong>${esc(d?.name ?? e.id)}</strong>, Year ${e.year}: ${e.celebrants} villager${e.celebrants === 1 ? '' : 's'} celebrated${e.couples ? `, ${e.couples} couple${e.couples === 1 ? '' : 's'} walked out` : ''}${e.gifts ? `, ${e.gifts} gift${e.gifts === 1 ? '' : 's'} exchanged` : ''}${e.sales ? `, ${e.sales}🪙 spent at the stalls` : ''}</div>`;
  }).join('');
  return `<div class="card celebrations" id="celebrations">
    <h3>🎉 Seasons & celebrations</h3>
    <dl class="kv"><dt>Kingdom date</dt><dd>${esc(dateLabel(s.day))}</dd>
      <dt>Showing</dt><dd>${showing}${source}</dd>
      <dt>Kingdom holiday</dt><dd>${kingdomNow ? `${kingdomNow.icon} ${esc(kingdomNow.name)}` : 'none right now'}</dd>
      <dt>Next</dt><dd>${next ? `${next.icon} ${esc(next.name)}, ${esc(dateLabel(Math.floor(next.start / 1440) + 1, { short: true }))} at ${clock(Math.round(next.start % 1440))}` : '—'}</dd>
      <dt>Snow on the ground</dt><dd>${snowLevel(snow.cover)}${snow.frost ? ', frost' : ''}</dd></dl>
    <h4>Holiday preview</h4>
    <p class="muted" style="font-size:12px;margin:0 0 6px">See any season or holiday now. Only the picture changes: time, people, money, the chronicle and your save are untouched.</p>
    <div class="chips">${previewButtons}</div>
    ${preview ? `<div class="grid2" style="margin-top:8px"><button class="btn" data-act="preview-night">${themes?.preview?.hour >= 20 ? '☀️ Daytime' : '🌙 Night-time'}</button>${HOLIDAY_BY_ID[preview]?.fireworks ? '<button class="btn" data-act="preview-fireworks">🎆 Fireworks again</button>' : ''}<button class="btn primary" data-act="preview-exit">✓ Exit preview</button></div>` : ''}
    <h4>Holidays the kingdom keeps</h4>
    <p class="muted" style="font-size:12px;margin:0 0 6px">Saved with the kingdom. A holiday that is off is neither decorated nor celebrated; each villager still decides whether to join in those that are on.</p>
    ${keeps}
    <h4>Graphics</h4>
    ${seg('quality', game.settings.quality ?? 'high', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
    ${toggle('effects', 'Holiday decorations & effects', settings.effects)}
    ${toggle('snow', 'Snow particles', settings.snow)}
    ${toggle('fireworks', 'Fireworks', settings.fireworks)}
    ${toggle('atmosphere', 'Seasonal atmosphere', settings.atmosphere, 'colours, light, leaves, butterflies, mist')}
    <div class="setting-row"><span>Decoration density</span>${seg('density', settings.density, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}</div>
    <div class="setting-row"><span>Reduced motion</span>${seg('reducedMotion', settings.reducedMotion, [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])}</div>
    <div class="setting-row"><span>Holiday length</span>${seg('duration', settings.duration, [['short', 'Short'], ['normal', 'Normal'], ['long', 'Long']])}</div>
    <div class="setting-row"><span>Keep each holiday's look at least</span>${seg('linger', String(settings.linger), [['0', 'Off'], ['20', '20 s'], ['40', '40 s'], ['90', '90 s']])}</div>
    ${toggle('realCalendar', 'Match my calendar', settings.realCalendar, 'show today\'s real season and holiday; the kingdom\'s own time is unchanged')}
    ${toggle('sound', 'Bells at New Year', settings.sound)}
    ${recent ? `<h4>Recent celebrations</h4>${recent}` : ''}
  </div>`;
}
