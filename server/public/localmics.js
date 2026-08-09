import { downsampleTo16k, floatTo16BitPCM, escapeHtml } from './audioUtils.js';

// Physical-mic support for the Sala. A mic plugged into (or paired with)
// this machine is just another audio input the browser can capture. In
// Settings you only *enable* which mics are available; here in the Sala you
// add a phone-less singer (name + song) — they queue like everyone else —
// and right before their turn a prep screen (owned by app.js) lets you pick
// and test the actual mic, then start. This module owns: the per-singer
// /ws/room sockets and the audio capture; app.js owns the turn UI/playback
// and drives us through `window.localMics`.

const panelEl = document.getElementById('local-mics');
const listEl = document.getElementById('local-mics-list');
const addBtn = document.getElementById('add-mic-singer-btn');

// Must match the Sala's 3-2-1 countdown (app.js) so streaming starts when
// the song audio starts — the mic is opened earlier (during the prep
// screen) so a slow Bluetooth mic is already warm.
const COUNTDOWN_MS = 4 * 850;

let allSongs = [];
let enabledMics = []; // [{ deviceId, label }]

const micSingers = new Map(); // userId -> { nickname, songId, songTitle, state, roomWs }

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

async function openMicStream(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
  } catch (err) {
    if (err.name === 'OverconstrainedError' || err.name === 'NotFoundError') {
      return navigator.mediaDevices.getUserMedia({ audio: { deviceId } });
    }
    throw err;
  }
}

// ---- One capture at a time (the singer whose turn is active) ----
let capture = null; // { userId, deviceId, songId, stream, ctx, source, analyser, processor, gain, singWs, meterRaf, streamTimer, onLevel, onSummary }

function stopCapture() {
  if (!capture) return;
  const c = capture;
  capture = null;
  if (c.streamTimer) clearTimeout(c.streamTimer);
  if (c.meterRaf) cancelAnimationFrame(c.meterRaf);
  if (c.singWs && c.singWs.readyState === WebSocket.OPEN) {
    try { c.singWs.send(JSON.stringify({ type: 'stop' })); } catch {}
  }
  c.processor?.disconnect();
  c.analyser?.disconnect();
  c.source?.disconnect();
  c.gain?.disconnect();
  c.stream?.getTracks().forEach((t) => t.stop());
  c.ctx?.close();
}

// Open the mic and start a live level meter (used by the prep screen so the
// operator can test the mic before the countdown). Does NOT stream yet.
async function primeAndMeter(userId, deviceId, onLevel) {
  stopCapture();
  const singer = micSingers.get(userId);
  const stream = await openMicStream(deviceId);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try { await ctx.resume(); } catch {}

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  processor.onaudioprocess = (event) => {
    const c = capture;
    if (!c || !c.singWs || c.singWs.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    c.singWs.send(floatTo16BitPCM(downsampleTo16k(input, ctx.sampleRate)).buffer);
  };
  source.connect(processor);
  processor.connect(gain);
  gain.connect(ctx.destination);

  capture = { userId, deviceId, songId: singer?.songId ?? null, stream, ctx, source, analyser, processor, gain, singWs: null, meterRaf: null, streamTimer: null };

  const buf = new Uint8Array(analyser.frequencyBinCount);
  const loop = () => {
    if (!capture || capture.ctx !== ctx) return;
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128);
      if (v > peak) peak = v;
    }
    onLevel?.(Math.min(1, (peak / 128) * 1.6));
    capture.meterRaf = requestAnimationFrame(loop);
  };
  loop();
}

// Called on "▶ Empezar": schedule the actual streaming to /ws/sing so the
// first sample lines up with the song start (after the Sala countdown).
function startStreaming(userId, onSummary) {
  if (!capture || capture.userId !== userId) return;
  const c = capture;
  const singer = micSingers.get(userId);
  if (!singer) return;
  c.streamTimer = setTimeout(() => {
    if (capture !== c) return;
    c.singWs = new WebSocket(wsUrl(`/ws/sing/${singer.songId}?userId=${userId}`));
    c.singWs.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === 'summary') {
        onSummary?.({ total: data.totalScore, max: data.maxScore });
        stopCapture();
      }
    };
  }, COUNTDOWN_MS);
}

// ---- Sala-added singers (a phone-less person + their song) ----
function addMicSinger(nickname, song) {
  const roomWs = new WebSocket(wsUrl('/ws/room'));
  let userId = null;
  roomWs.onopen = () => roomWs.send(JSON.stringify({ type: 'join', nickname, role: 'singer' }));
  roomWs.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'welcome') {
      userId = data.userId;
      micSingers.set(userId, { nickname, songId: song.id, songTitle: `${song.artist} — ${song.title}`, state: 'queued', roomWs });
      roomWs.send(JSON.stringify({ type: 'chooseSong', songId: song.id }));
      renderPanel();
    } else if (data.type === 'roomState') {
      const me = data.users.find((u) => u.id === userId);
      const singer = userId && micSingers.get(userId);
      if (me && singer && me.state !== singer.state) {
        singer.state = me.state;
        renderPanel();
      }
    }
  };
  roomWs.onclose = () => {
    if (userId) micSingers.delete(userId);
    renderPanel();
  };
}

function renderPanel() {
  const rows = [...micSingers.values()].map((s) => {
    const label = {
      queued: 'En la cola', called: '¡Su turno!', singing: '🎤 Cantando', scored: '✓ Terminó',
    }[s.state] || s.state;
    return `<li class="local-mic"><div class="local-mic-head">
      <strong>🎙️ ${escapeHtml(s.nickname)}</strong><span class="local-mic-status">${escapeHtml(label)}</span>
    </div><div class="local-mic-song">${escapeHtml(s.songTitle)}</div></li>`;
  }).join('');
  listEl.innerHTML = rows || '<li class="settings-hint">Nadie con micrófono todavía.</li>';
}

// ---- Add-singer modal ----
function openAddModal() {
  const overlay = document.createElement('div');
  overlay.className = 'mic-modal-overlay';
  overlay.innerHTML = `
    <div class="mic-modal">
      <h3>Cantante con micrófono</h3>
      <label class="mic-modal-label">Nombre</label>
      <input type="text" id="mic-add-name" placeholder="Nombre del cantante" />
      <label class="mic-modal-label">Canción</label>
      <input type="text" id="mic-add-search" placeholder="Buscar canción…" />
      <ul id="mic-add-results" class="mic-song-results"></ul>
      <div class="mic-modal-selected" id="mic-add-selected"></div>
      <div class="mic-modal-actions">
        <button type="button" id="mic-add-cancel">Cancelar</button>
        <button type="button" id="mic-add-confirm" class="primary-btn" disabled>Agregar a la cola</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameEl = overlay.querySelector('#mic-add-name');
  const searchEl = overlay.querySelector('#mic-add-search');
  const resultsEl = overlay.querySelector('#mic-add-results');
  const selectedEl = overlay.querySelector('#mic-add-selected');
  const confirmBtn = overlay.querySelector('#mic-add-confirm');
  let chosenSong = null;

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#mic-add-cancel').addEventListener('click', close);

  const refreshConfirm = () => { confirmBtn.disabled = !(nameEl.value.trim() && chosenSong); };
  nameEl.addEventListener('input', refreshConfirm);

  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ''; return; }
    const matches = allSongs.filter((s) => `${s.artist} ${s.title}`.toLowerCase().includes(q)).slice(0, 10);
    resultsEl.innerHTML = matches
      .map((s) => `<li><button type="button" data-id="${s.id}">${escapeHtml(s.artist)} — ${escapeHtml(s.title)}</button></li>`)
      .join('');
    resultsEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        chosenSong = allSongs.find((s) => s.id === Number(btn.dataset.id));
        selectedEl.textContent = `Elegida: ${chosenSong.artist} — ${chosenSong.title}`;
        resultsEl.innerHTML = '';
        searchEl.value = '';
        refreshConfirm();
      });
    });
  });

  confirmBtn.addEventListener('click', () => {
    addMicSinger(nameEl.value.trim(), chosenSong);
    close();
  });
  nameEl.focus();
}

// ---- Public API for app.js ----
window.localMics = {
  hasEnabledMics: () => enabledMics.length > 0,
  enabledMics: () => enabledMics,
  isMicSinger: (userId) => micSingers.has(userId),
  singerName: (userId) => micSingers.get(userId)?.nickname ?? null,
  primeAndMeter,
  startStreaming,
  stopCapture,
};

async function init() {
  let settings;
  try {
    settings = await (await fetch('/api/settings')).json();
  } catch {
    return;
  }
  enabledMics = settings.localMics || [];
  if (enabledMics.length === 0) return; // panel hidden if no mics enabled

  allSongs = await (await fetch('/api/songs')).json();
  panelEl.classList.remove('hidden');
  renderPanel();
  addBtn?.addEventListener('click', openAddModal);
}

init();
