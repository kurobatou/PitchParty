import { warnIfInsecureContext } from './audioUtils.js';

const playerStage = document.getElementById('player-stage');
const catalogEl = document.getElementById('catalog');
const searchEl = document.getElementById('search');
const backBtn = document.getElementById('back-btn');

const audioEl = document.getElementById('audio');
const bgVideoEl = document.getElementById('bg-video');
const bgFallbackEl = document.getElementById('bg-fallback');
const bgWavesEl = document.getElementById('bg-waves');
const titleEl = document.getElementById('player-title');
const artistEl = document.getElementById('player-artist');
const prevEl = document.getElementById('lyrics-prev');
const currentEl = document.getElementById('lyrics-current');
const nextEl = document.getElementById('lyrics-next');
const progressFillEl = document.getElementById('progress-fill');

let allSongs = [];
let activeLines = [];
let rafHandle = null;
let currentSongId = null;

function beatToMs(beat, bpm, gap) {
  const msPerBeat = 60000 / (bpm * 4);
  return gap + beat * msPerBeat;
}

function lineText(line) {
  return line.notes.map((n) => n.text).join('');
}

// Songs without their own video fall back to a visual driven by the
// actual playback audio (Web Audio AnalyserNode) instead of a flat
// gradient. Once created, audioEl's sound is routed ENTIRELY through this
// graph (createMediaElementSource reroutes it — audioEl no longer plays
// straight to speakers on its own), so if this AudioContext ever gets
// stuck "suspended" by the browser's autoplay policy, that song goes
// completely silent, not just visually flat.
//
// AudioContext.resume() only reliably unlocks when called synchronously
// inside a real user gesture handler (click/keydown) — NOT from inside an
// async callback several microtasks removed from one, which is exactly
// what happens when a song opens via handleNowPlaying (triggered by a
// WebSocket message, no gesture at all) or after an `await fetch(...)` in
// openSong(). So the graph is built and unlocked as early as possible, on
// the very first real interaction anywhere on this page — by the time any
// song opens, it's already unlocked.
let vizAudioCtx = null;
let analyser = null;
let freqData = null;
let timeData = null;
let wavesCanvasCtx = null;
let vizFailed = false;

function ensureAudioGraph() {
  if (vizAudioCtx || vizFailed) return;
  try {
    vizAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = vizAudioCtx.createMediaElementSource(audioEl);
    analyser = vizAudioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    analyser.connect(vizAudioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
    wavesCanvasCtx = bgWavesEl.getContext('2d');
    drawWaves();
  } catch (err) {
    console.warn('audio visualizer unavailable, using plain gradient background', err);
    vizFailed = true;
  }
}

function unlockPlaybackAudio() {
  ensureAudioGraph();
  vizAudioCtx?.resume().catch(() => {});
  document.getElementById('audio-unlock-banner')?.classList.add('hidden');
}

// once:false — resume() is a no-op once already running, and re-unlocking
// on every early interaction is cheap insurance against a suspended
// context (e.g. the tab regained focus after being backgrounded). The
// banner (see index.html) exists so a fully hands-off Sala — nobody ever
// clicking the TV directly, only phones — still gets one deliberate tap.
document.addEventListener('pointerdown', unlockPlaybackAudio);
document.addEventListener('keydown', unlockPlaybackAudio);

// A handful of distinct looks so 200+ songs without video don't all render
// the same pattern. Picked deterministically from the song id so a given
// song always looks the same, but the catalog as a whole rotates through
// all of them.
const VIZ_THEMES = [drawBars, drawMirrorBars, drawRadial, drawScope];
let currentTheme = drawBars;
let themeHue = 255;

function pickTheme(songId) {
  currentTheme = VIZ_THEMES[songId % VIZ_THEMES.length];
  themeHue = (songId * 47) % 360;
}

// Temporary on-screen readout (no devtools needed — useful on TVs/set-top
// boxes) showing whether the audio graph is actually alive and receiving
// signal. Safe to remove once the visualizer is confirmed working
// everywhere.
const vizDebugEl = document.getElementById('viz-debug');
let debugFrameCount = 0;

function drawWaves() {
  requestAnimationFrame(drawWaves);

  debugFrameCount++;
  if (vizDebugEl && debugFrameCount % 15 === 0) {
    if (vizFailed) {
      vizDebugEl.textContent = 'viz: failed to init (ver consola)';
    } else if (!vizAudioCtx) {
      vizDebugEl.textContent = 'viz: sin inicializar (tocá la pantalla)';
    } else {
      const avgFreq = freqData ? freqData.reduce((a, b) => a + b, 0) / freqData.length : 0;
      vizDebugEl.textContent = `viz: ctx=${vizAudioCtx.state} canvas=${bgWavesEl.width}x${bgWavesEl.height} amp=${avgFreq.toFixed(1)}`;
    }
  }

  if (bgWavesEl.classList.contains('hidden') || !analyser) return;

  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);
  const { width, height } = bgWavesEl;
  wavesCanvasCtx.clearRect(0, 0, width, height);
  currentTheme(wavesCanvasCtx, width, height, freqData, timeData, themeHue);
}

function drawBars(ctx, width, height, freq, time, hue) {
  const barCount = freq.length;
  const barWidth = width / barCount;
  for (let i = 0; i < barCount; i++) {
    const barHeight = (freq[i] / 255) * height * 0.85;
    ctx.fillStyle = `hsl(${hue + i * 1.5}, 70%, 60%)`;
    ctx.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
  }
}

function drawMirrorBars(ctx, width, height, freq, time, hue) {
  const barCount = freq.length;
  const barWidth = width / barCount;
  const mid = height / 2;
  for (let i = 0; i < barCount; i++) {
    const barHeight = (freq[i] / 255) * mid * 0.9;
    ctx.fillStyle = `hsl(${hue + i * 1.5}, 75%, 65%)`;
    ctx.fillRect(i * barWidth, mid - barHeight, barWidth - 1, barHeight * 2);
  }
}

function drawRadial(ctx, width, height, freq, time, hue) {
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.42;
  const rings = 24;
  ctx.lineWidth = 3;
  for (let i = 0; i < rings; i++) {
    const amp = freq[i % freq.length] / 255;
    const radius = (i / rings) * maxRadius + amp * 24;
    ctx.strokeStyle = `hsla(${(hue + i * 10) % 360}, 75%, 65%, ${0.15 + amp * 0.5})`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawScope(ctx, width, height, freq, time, hue) {
  const mid = height / 2;
  ctx.lineWidth = 4;
  ctx.strokeStyle = `hsl(${hue}, 80%, 65%)`;
  ctx.beginPath();
  const step = width / time.length;
  for (let i = 0; i < time.length; i++) {
    const y = mid + ((time[i] - 128) / 128) * mid * 0.8;
    const x = i * step;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Soft glow dots along a few frequency bins for extra texture.
  const dotCount = 16;
  for (let i = 0; i < dotCount; i++) {
    const amp = freq[i * 4] / 255;
    const x = (i / dotCount) * width;
    ctx.fillStyle = `hsla(${(hue + i * 20) % 360}, 80%, 65%, ${0.3 + amp * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, mid - amp * mid * 0.9, 3 + amp * 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

const letterIndexEl = document.getElementById('letter-index');
let activeLetter = null;

function artistLetter(artist) {
  const c = (artist || '').trim().charAt(0).toUpperCase();
  // Strip accents (é→E, ñ→N...) so songs group under the plain letter.
  const plain = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /[A-Z]/.test(plain) ? plain : '#';
}

async function loadCatalog() {
  const res = await fetch('/api/songs');
  allSongs = await res.json();
  renderLetterIndex();
  applyFilters();
}

// Only the catalog is large enough (200+ songs with a NAS library) to
// warrant a jump index — build it from the letters actually present
// instead of always showing the full alphabet.
function renderLetterIndex() {
  const present = new Set(allSongs.map((s) => artistLetter(s.artist)));
  if (present.size < 8) {
    letterIndexEl.innerHTML = '';
    return;
  }

  const letters = ['#', ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('')].filter((l) => present.has(l));
  letterIndexEl.innerHTML = letters.map((l) =>
    `<button type="button" class="letter-btn${l === activeLetter ? ' active' : ''}" data-letter="${l}">${l}</button>`
  ).join('');

  letterIndexEl.querySelectorAll('.letter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeLetter = activeLetter === btn.dataset.letter ? null : btn.dataset.letter;
      renderLetterIndex();
      applyFilters();
    });
  });
}

function applyFilters() {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = allSongs.filter((s) => {
    const matchesQuery = !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q);
    const matchesLetter = !activeLetter || artistLetter(s.artist) === activeLetter;
    return matchesQuery && matchesLetter;
  });
  renderCatalog(filtered);
}

function renderCatalog(songs) {
  catalogEl.innerHTML = '';

  if (songs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No hay canciones indexadas todavía. Revisá la configuración de la biblioteca.';
    catalogEl.appendChild(empty);
    return;
  }

  for (const song of songs) {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.addEventListener('click', () => openSong(song.id));

    const cover = document.createElement('img');
    cover.className = 'song-cover';
    if (song.coverUrl) cover.src = song.coverUrl;
    card.appendChild(cover);

    const meta = document.createElement('div');
    meta.className = 'song-meta';
    meta.innerHTML = `
      <div class="song-title">${escapeHtml(song.title)}</div>
      <div class="song-artist">${escapeHtml(song.artist)}</div>
    `;
    card.appendChild(meta);

    catalogEl.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

searchEl.addEventListener('input', applyFilters);

async function openSong(id) {
  const res = await fetch(`/api/songs/${id}`);
  if (!res.ok) return;
  const song = await res.json();

  currentSongId = song.id;
  titleEl.textContent = song.title;
  artistEl.textContent = song.artist;

  activeLines = song.lines
    .filter((l) => l.type === 'lyrics')
    .map((l) => {
      const startBeat = l.notes[0].beat;
      const lastNote = l.notes[l.notes.length - 1];
      const endBeat = lastNote.beat + lastNote.length;
      return {
        text: lineText(l),
        startMs: beatToMs(startBeat, song.bpm, song.gap),
        endMs: beatToMs(endBeat, song.bpm, song.gap),
      };
    });

  audioEl.src = song.mp3Url;
  progressFillEl.style.width = '0%';
  catalogEl.classList.add('hidden');
  playerStage.classList.remove('hidden');

  const useVideo = song.hasVideo && song.videoUrl && !lowLatencyMode;

  if (useVideo) {
    bgVideoEl.src = song.videoUrl;
    bgVideoEl.classList.remove('hidden');
    bgFallbackEl.classList.add('hidden');
    bgWavesEl.classList.add('hidden');
    bgVideoEl.currentTime = 0;
  } else {
    bgVideoEl.classList.add('hidden');
    bgVideoEl.removeAttribute('src');
    bgFallbackEl.classList.remove('hidden');
    bgWavesEl.classList.remove('hidden');
    bgWavesEl.width = bgWavesEl.clientWidth;
    bgWavesEl.height = bgWavesEl.clientHeight;
    pickTheme(song.id);
    unlockPlaybackAudio();
  }

  audioEl.play().catch(() => {});
  if (useVideo) bgVideoEl.play().catch(() => {});

  cancelAnimationFrame(rafHandle);
  tickLyrics();
}

function tickLyrics() {
  const nowMs = audioEl.currentTime * 1000;
  let idx = activeLines.findIndex((l) => nowMs < l.endMs);
  if (idx === -1) idx = activeLines.length - 1;

  if (idx >= 0 && nowMs < activeLines[idx].startMs) {
    prevEl.textContent = idx > 0 ? activeLines[idx - 1].text : '';
    currentEl.textContent = '';
    nextEl.textContent = activeLines[idx].text;
  } else if (idx >= 0) {
    prevEl.textContent = idx > 0 ? activeLines[idx - 1].text : '';
    currentEl.textContent = activeLines[idx].text;
    nextEl.textContent = activeLines[idx + 1]?.text ?? '';
  }
  rafHandle = requestAnimationFrame(tickLyrics);
}

function stopPlayer() {
  cancelAnimationFrame(rafHandle);
  audioEl.pause();
  audioEl.removeAttribute('src');
  bgVideoEl.pause();
  bgVideoEl.removeAttribute('src');
  currentSongId = null;
  playerStage.classList.add('hidden');
  catalogEl.classList.remove('hidden');

  // Tell the server this turn's playback is over so the singer's phone
  // stops capturing mic audio and gets a final score, instead of
  // streaming indefinitely (see the 'endTurn' handler on /ws/room).
  if (nowPlayingUserId && roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'endTurn', userId: nowPlayingUserId }));
  }
  nowPlayingUserId = null;
  lastAutoPlayedSongId = null;
}

backBtn.addEventListener('click', stopPlayer);
audioEl.addEventListener('ended', stopPlayer);

audioEl.addEventListener('timeupdate', () => {
  if (!audioEl.duration) return;
  progressFillEl.style.width = `${(audioEl.currentTime / audioEl.duration) * 100}%`;
});

loadCatalog();

// --- Sala: QR de acceso + lista de usuarios conectados en tiempo real ---

const STATE_LABELS = {
  connected: 'Conectado',
  queued: 'En cola',
  called: '¡Es su turno!',
  singing: 'Cantando',
  scored: 'Puntaje',
};

let roomWs = null;
let lowLatencyMode = false;

const LATENCY_WARN_MS = 150;
const LATENCY_HIGH_MS = 300;

async function loadQr() {
  const joinUrl = `${location.origin}/join.html`;
  const res = await fetch(`/api/qr?text=${encodeURIComponent(joinUrl)}`);
  const { dataUrl } = await res.json();
  document.getElementById('qr-img').src = dataUrl;
}

function renderUsers(users) {
  const list = document.getElementById('users-list');
  const count = document.getElementById('users-count');
  count.textContent = users.length;

  if (users.length === 0) {
    list.innerHTML = '<li style="color:#9c9db3">Nadie conectado todavía</li>';
    return;
  }

  list.innerHTML = users.map((u) => {
    const stateLabel = STATE_LABELS[u.state] ?? u.state;
    const scoreLabel = u.lastScore ? ` (${u.lastScore.total}/${u.lastScore.max})` : '';
    const latencyLabel = u.latencyMs != null
      ? `<span class="latency-badge ${u.latencyMs > 200 ? 'high' : ''}">${u.latencyMs}ms</span>`
      : '';
    return `
      <li>
        <span>
          <div class="user-name">${escapeHtml(u.nickname)}</div>
          <div class="user-state state-${u.state}">${escapeHtml(stateLabel)}${scoreLabel}</div>
        </span>
        ${latencyLabel}
      </li>
    `;
  }).join('');
}

function renderQueue(queueNicknames) {
  const list = document.getElementById('queue-list');
  list.innerHTML = queueNicknames.length === 0
    ? '<li style="color:#9c9db3">Nadie en cola</li>'
    : queueNicknames.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
}

function renderRanking(ranking) {
  const list = document.getElementById('ranking-list');
  list.innerHTML = ranking.length === 0
    ? '<li style="color:#9c9db3">Todavía nadie puntuó</li>'
    : ranking.map((r) => {
      const pct = r.max ? Math.round((r.total / r.max) * 100) : 0;
      return `<li>${escapeHtml(r.nickname)} — ${pct}% <span style="color:#9c9db3">(${escapeHtml(r.songTitle ?? '')})</span></li>`;
    }).join('');
}

function renderNetworkStatus(users) {
  const active = users.filter((u) => (u.state === 'singing' || u.state === 'called') && u.latencyMs != null);
  const dot = document.getElementById('network-dot');
  const label = document.getElementById('network-label');

  if (active.length === 0) {
    dot.className = 'network-dot';
    label.textContent = 'Red: sin cantantes activos';
    return;
  }

  const worst = Math.max(...active.map((u) => u.latencyMs));
  if (worst >= LATENCY_HIGH_MS) {
    dot.className = 'network-dot high';
    label.textContent = `Red: latencia alta (${worst}ms)`;
  } else if (worst >= LATENCY_WARN_MS) {
    dot.className = 'network-dot warn';
    label.textContent = `Red: algo de latencia (${worst}ms)`;
  } else {
    dot.className = 'network-dot ok';
    label.textContent = `Red: buena (${worst}ms)`;
  }
}

let lastAutoPlayedSongId = null;
let nowPlayingUserId = null;

function handleNowPlaying(nowPlaying) {
  if (!nowPlaying || !nowPlaying.songId) return;
  if (nowPlaying.songId === lastAutoPlayedSongId) return;
  lastAutoPlayedSongId = nowPlaying.songId;
  nowPlayingUserId = nowPlaying.userId ?? null;
  openSong(nowPlaying.songId);
}

function renderLowLatencyToggle(enabled) {
  lowLatencyMode = enabled;
  const btn = document.getElementById('low-latency-toggle');
  btn.textContent = `Modo baja latencia: ${enabled ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', enabled);
}

function connectRoom() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  roomWs = new WebSocket(`${proto}://${location.host}/ws/room`);

  roomWs.onopen = () => {
    roomWs.send(JSON.stringify({ type: 'join', nickname: 'Pantalla', role: 'screen' }));
  };

  roomWs.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'roomState') {
      renderUsers(data.users);
      renderQueue(data.queue);
      renderRanking(data.ranking);
      renderNetworkStatus(data.users);
      renderLowLatencyToggle(data.lowLatencyMode);
      handleNowPlaying(data.nowPlaying);
    }
  };

  roomWs.onclose = () => {
    setTimeout(connectRoom, 2000);
  };
}

document.getElementById('advance-btn').addEventListener('click', () => {
  if (roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'advanceQueue' }));
  }
});

document.getElementById('low-latency-toggle').addEventListener('click', () => {
  if (roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'toggleLowLatency', enabled: !lowLatencyMode }));
  }
});

loadQr();
connectRoom();
warnIfInsecureContext();
