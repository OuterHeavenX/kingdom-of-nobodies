import { CUES } from '../audio/MusicLibrary.js';
import { SFX_KINDS } from '../audio/SoundEffects.js';
import { esc } from './util.js';

// Council → Sound & music and Graphics. Sound settings are kept on this
// device; the audio test panel appears only in development builds or with
// ?dev in the address.

const slider = (key, label, value, muteKey, muted) => `<div class="mixer-row"><span>${label}</span><input type="range" min="0" max="100" value="${Math.round(value * 100)}" data-act="audio-vol" data-key="${key}" aria-label="${label} volume"><label class="mute"><input type="checkbox" data-act="audio-mute" data-key="${muteKey}" ${muted ? 'checked' : ''}> mute</label></div>`;

export function audioCard(game) {
  const a = game.audio;
  if (!a) return '';
  const s = a.settings;
  const st = a.stats();
  const status = !a.supported ? 'This browser cannot play Web Audio.' : !s.enabled ? 'Sound is off.' : st.state === 'running' ? `Playing${st.music ? `: “${esc(CUES.find((c) => c.id === st.music)?.title ?? st.music)}”` : ''}.` : 'Tap anywhere to resume sound.';
  return `<div class="card" id="sound-settings"><h3>🔊 Sound & music</h3>
    <p class="muted" style="font-size:12px;margin:0 0 8px">${status} All music and sounds are original and made live in your browser.</p>
    <button class="btn ${s.enabled ? '' : 'primary'}" data-act="audio-toggle" style="width:100%" ${a.supported ? '' : 'disabled'}>${s.enabled ? '🔇 Turn sound off' : '🔊 Enable sound'}</button>
    <div class="mixer" ${s.enabled ? '' : 'aria-disabled="true"'}>
      ${slider('master', 'Master', s.master, null)}
      ${slider('music', 'Music', s.music, 'muteMusic', s.muteMusic)}
      ${slider('ambience', 'Ambience', s.ambience, 'muteAmbience', s.muteAmbience)}
      ${slider('sfx', 'Effects', s.sfx, 'muteSfx', s.muteSfx)}
      ${slider('ui', 'Interface', s.ui, 'muteUi', s.muteUi)}
    </div>
    <label class="toggle">Shuffle music<small>Any of the age's pieces, in any order, instead of by time of day</small> <input type="checkbox" data-act="audio-opt" data-key="shuffle" ${s.shuffle ? 'checked' : ''}></label>
    <label class="toggle">Reduced audio<small>Fewer, quieter one-off sounds</small> <input type="checkbox" data-act="audio-opt" data-key="reduced" ${s.reduced ? 'checked' : ''}></label>
    ${game.dev ? devAudio(a, st) : ''}
  </div>`;
}

function devAudio(a, st) {
  return `<div class="dev-audio"><h4>Audio test panel (development)</h4>
    <p class="muted" style="font-size:12px">Context ${esc(st.state)} · level ${st.level.toFixed(3)} · ${st.notes} notes · ${st.switches} cue changes · effects ${st.sfxPlayed} played / ${st.sfxSkipped} held back</p>
    <div class="chips scroll">${CUES.map((c) => `<button class="chip" data-act="audio-test-cue" data-id="${c.id}">${esc(c.title)}</button>`).join('')}</div>
    <div class="chips scroll">${SFX_KINDS.map((k) => `<button class="chip" data-act="audio-test-sfx" data-id="${k}">${esc(k)}</button>`).join('')}</div>
  </div>`;
}

export function graphicsCard(game) {
  const q = game.settings.quality ?? 'high';
  return `<div class="card"><h3>🖥 Graphics</h3>
    <div class="segmented" style="margin:6px 0 10px">${[['low', 'Low · battery saver'], ['medium', 'Medium'], ['high', 'High']].map(([k, l]) => `<button class="${q === k ? 'active' : ''}" data-act="quality" data-id="${k}">${l}</button>`).join('')}</div>
    <label class="toggle">See-through towers<small>Tall buildings near the view centre fade to glass</small> <input type="checkbox" data-act="gfx" data-key="seeThrough" ${game.settings.seeThrough ? 'checked' : ''}></label>
    <label class="toggle">Adaptive resolution<small>Lower the resolution a little when the city gets busy, to keep it smooth</small> <input type="checkbox" data-act="gfx" data-key="adaptive" ${game.settings.adaptive !== false ? 'checked' : ''}></label>
    <p class="muted" style="font-size:12px;margin-top:6px">${game.fps ? `About ${game.fps} frames a second at ${Math.round((game.world?.resolutionScale ?? 1) * 100)}% resolution.` : ''}</p>
  </div>`;
}
