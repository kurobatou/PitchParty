import { warnIfInsecureContext } from './audioUtils.js';
import { toggleTheme, themeIcon } from './theme.js';

const playerStage = document.getElementById('player-stage');
const catalogEl = document.getElementById('catalog');
const searchEl = document.getElementById('search');
const backBtn = document.getElementById('back-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

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

const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const resultsOverlay = document.getElementById('results-overlay');
const resultsTitle = document.getElementById('results-title');
const resultsScore = document.getElementById('results-score');
const resultsNext = document.getElementById('results-next');
const resultsContinue = document.getElementById('results-continue');

let allSongs = [];
let activeLines = [];
let rafHandle = null;
let currentSongId = null;

// Latest roomState snapshot, so the results/countdown screens can look up
// the current singer's score and who's next in the queue.
let latestUsers = [];
let latestQueue = [];
let currentTurnNickname = null;

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

function drawWaves() {
  requestAnimationFrame(drawWaves);
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
    card.addEventListener('click', () => onCatalogPick(song));

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

function showWavesBackground(song) {
  bgFallbackEl.classList.remove('hidden');
  bgWavesEl.classList.remove('hidden');
  bgWavesEl.width = bgWavesEl.clientWidth;
  bgWavesEl.height = bgWavesEl.clientHeight;
  pickTheme(song.id);
  unlockPlaybackAudio();
}

// The 3-2-1-¡A cantar! countdown. Both the Sala (here) and the phone
// (join.js) run an identical-length countdown, started from the same
// roomState broadcast, so the phone's mic clock stays aligned with the
// Sala's audio playback — see COUNTDOWN_STEP_MS below and its twin in
// join.js.
const COUNTDOWN_STEP_MS = 850;

function runCountdown() {
  return new Promise((resolve) => {
    const steps = [
      { text: '3', go: false },
      { text: '2', go: false },
      { text: '1', go: false },
      { text: '¡A cantar!', go: true },
    ];
    countdownOverlay.classList.remove('hidden');
    let i = 0;
    const tick = () => {
      if (i >= steps.length) {
        countdownOverlay.classList.add('hidden');
        resolve();
        return;
      }
      const step = steps[i++];
      countdownNumber.textContent = step.text;
      countdownNumber.classList.toggle('go', step.go);
      countdownNumber.classList.remove('pop');
      void countdownNumber.offsetWidth; // restart the pop animation
      countdownNumber.classList.add('pop');
      setTimeout(tick, COUNTDOWN_STEP_MS);
    };
    tick();
  });
}

async function openSong(id, { withCountdown = false, ask = false, duetMode = null } = {}) {
  const res = await fetch(`/api/songs/${id}`);
  if (!res.ok) return;
  const song = await res.json();

  currentSongId = song.id;
  titleEl.textContent = song.title;
  artistEl.textContent = song.artist;

  // Decide how this duet plays: an explicit duetMode wins (e.g. from the
  // queue); otherwise ask when it's a manual catalog pick; default to duo.
  currentDuetSingers = song.isDuet ? song.duetSingers : null;
  duetPlayMode = 'duo';
  if (song.isDuet) {
    if (duetMode === 'solo' || duetMode === 'duo') duetPlayMode = duetMode;
    else if (ask) duetPlayMode = await askDuetMode(song);
  }

  activeLines = song.lines
    .filter((l) => l.type === 'lyrics')
    .map((l) => {
      const startBeat = l.notes[0].beat;
      const lastNote = l.notes[l.notes.length - 1];
      const endBeat = lastNote.beat + lastNote.length;
      return {
        text: lineText(l),
        player: l.player ?? 1,
        startMs: beatToMs(startBeat, song.bpm, song.gap),
        endMs: beatToMs(endBeat, song.bpm, song.gap),
      };
    })
    // Duet files list voice 1's whole track then voice 2's; sort by time so
    // both voices interleave chronologically (harmless for solo songs, which
    // are already ordered).
    .sort((a, b) => a.startMs - b.startMs);

  applyDuetForMode();

  audioEl.src = song.mp3Url;
  progressFillEl.style.width = '0%';
  catalogEl.classList.add('hidden');
  playerStage.classList.remove('hidden');

  const useVideo = song.hasVideo && song.videoUrl && !lowLatencyMode;

  // Started once playback actually begins (see startPlayback) rather than
  // at load time — otherwise the countdown's few seconds of paused video
  // would trip the "no playable data" watchdog on a perfectly good video
  // that's just still buffering.
  let startVideoWatchdog = null;

  if (useVideo) {
    bgVideoEl.src = song.videoUrl;
    bgVideoEl.classList.remove('hidden');
    bgFallbackEl.classList.add('hidden');
    bgWavesEl.classList.add('hidden');
    bgVideoEl.currentTime = 0;

    // hasVideo just means the .txt pointed at a file that exists — it
    // doesn't mean this browser can actually decode it (old .avi/Xvid
    // files from an UltraStar library are a common case). If the video
    // errors out or never gets any playable data, fall back to the wave
    // visualizer instead of leaving a blank black screen with silent
    // (audio-only) playback.
    let fellBack = false;
    const fallbackToWaves = (reason) => {
      if (fellBack || currentSongId !== song.id) return;
      fellBack = true;
      console.warn(`video playback failed (${reason}), falling back to waves for song ${song.id}`);
      bgVideoEl.pause();
      bgVideoEl.removeAttribute('src');
      showWavesBackground(song);
    };
    bgVideoEl.onerror = () => fallbackToWaves('error event');
    startVideoWatchdog = () => {
      setTimeout(() => {
        if (bgVideoEl.readyState < 2) fallbackToWaves('no playable data after 3s');
      }, 3000);
    };
  } else {
    bgVideoEl.classList.add('hidden');
    bgVideoEl.removeAttribute('src');
    showWavesBackground(song);
  }

  const startPlayback = () => {
    // A newer turn may have superseded this one during the countdown wait.
    if (currentSongId !== song.id) return;
    // Karaoke mic monitor: duck the music and play the mic through the speakers.
    if (currentMode === 'karaoke' && micMonitorConfig.enabled) {
      audioEl.volume = Math.max(0, Math.min(1, micMonitorConfig.musicVolume / 100));
      startMicMonitor();
    } else {
      audioEl.volume = 1;
    }
    audioEl.play().catch(() => {});
    if (useVideo) {
      bgVideoEl.play().catch(() => {});
      startVideoWatchdog?.();
    }
    cancelAnimationFrame(rafHandle);
    tickLyrics();

    // Karaoke: stream the playback position to phones so they can sync the
    // lyrics (they have no scoring channel to get the time from).
    clearInterval(karaokeProgressTimer);
    if (currentMode === 'karaoke') {
      karaokeProgressTimer = setInterval(() => {
        if (roomWs?.readyState === WebSocket.OPEN) {
          roomWs.send(JSON.stringify({ type: 'karaokeProgress', songId: song.id, positionMs: Math.round(audioEl.currentTime * 1000) }));
        }
      }, 400);
    }
  };

  if (withCountdown) {
    await runCountdown();
    startPlayback();
  } else {
    startPlayback();
  }
}

// Sets a lyric slot's text and, for duets, tags it with the voice so CSS can
// color it. `line` null clears both.
function setLine(el, line) {
  el.textContent = line ? line.text : '';
  if (line) el.dataset.player = line.player;
  else delete el.dataset.player;
}

function tickLyrics() {
  const nowMs = audioEl.currentTime * 1000;
  let idx = activeLines.findIndex((l) => nowMs < l.endMs);
  if (idx === -1) idx = activeLines.length - 1;

  const prev = idx > 0 ? activeLines[idx - 1] : null;
  if (idx >= 0 && nowMs < activeLines[idx].startMs) {
    setLine(prevEl, prev);
    setLine(currentEl, null);
    setLine(nextEl, activeLines[idx]);
  } else if (idx >= 0) {
    setLine(prevEl, prev);
    setLine(currentEl, activeLines[idx]);
    setLine(nextEl, activeLines[idx + 1] ?? null);
  }
  rafHandle = requestAnimationFrame(tickLyrics);
}

// Duet play mode for the current song: 'duo' colors the two voices and shows
// the legend; 'solo' merges them into one plain stream (one person sings all).
// currentDuetSingers is the song's { 1, 2, 3 } names, or null when it's a solo
// song (then the toggle stays hidden and mode is irrelevant).
let duetPlayMode = 'duo';
let currentDuetSingers = null;
const duetLegendEl = document.getElementById('duet-legend');
const duetToggleBtn = document.getElementById('duet-toggle');

// Paints the lyric colors + legend from `singers`, or clears them (solo/no
// duet) when passed null.
function applyDuet(singers) {
  if (!singers) {
    delete document.documentElement.dataset.duet;
    duetLegendEl.classList.add('hidden');
    duetLegendEl.innerHTML = '';
    return;
  }
  document.documentElement.dataset.duet = '1';
  const labels = { 1: singers[1] || 'Voz 1', 2: singers[2] || 'Voz 2', 3: singers[3] || 'Ambos' };
  const voices = singers[3] ? [1, 2, 3] : [1, 2];
  duetLegendEl.innerHTML = voices
    .map((p) => `<span class="duet-voice" data-player="${p}"><span class="duet-dot"></span>${escapeHtml(labels[p])}</span>`)
    .join('');
  duetLegendEl.classList.remove('hidden');
}

// Reflects currentDuetSingers + duetPlayMode into the lyric colors and the
// player toggle button.
function applyDuetForMode() {
  applyDuet(currentDuetSingers && duetPlayMode === 'duo' ? currentDuetSingers : null);
  if (currentDuetSingers) {
    duetToggleBtn.textContent = duetPlayMode === 'duo' ? '🎭 Dúo' : '🙂 Solista';
    duetToggleBtn.classList.remove('hidden');
  } else {
    duetToggleBtn.classList.add('hidden');
  }
}

duetToggleBtn.addEventListener('click', () => {
  if (!currentDuetSingers) return;
  duetPlayMode = duetPlayMode === 'duo' ? 'solo' : 'duo';
  applyDuetForMode();
});

// Small blocking chooser shown when a duet is picked from the catalog. Resolves
// to 'duo' or 'solo'.
const duetChooseOverlay = document.getElementById('duet-choose-overlay');
const duetChooseSong = document.getElementById('duet-choose-song');
function askDuetMode(song) {
  return new Promise((resolve) => {
    duetChooseSong.textContent = `${song.artist} — ${song.title}`;
    duetChooseOverlay.classList.remove('hidden');
    const done = (mode) => {
      duetChooseOverlay.classList.add('hidden');
      document.getElementById('duet-choose-duo').removeEventListener('click', onDuo);
      document.getElementById('duet-choose-solo').removeEventListener('click', onSolo);
      resolve(mode);
    };
    const onDuo = () => done('duo');
    const onSolo = () => done('solo');
    document.getElementById('duet-choose-duo').addEventListener('click', onDuo);
    document.getElementById('duet-choose-solo').addEventListener('click', onSolo);
  });
}

// Pure UI teardown: stop playback and go back to the catalog. Does NOT
// tell the server the turn ended — callers that need that (manual "Volver",
// natural end) send 'endTurn' themselves so it happens exactly once.
function returnToCatalog() {
  cancelAnimationFrame(rafHandle);
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.volume = 1; // undo any Karaoke ducking
  bgVideoEl.pause();
  bgVideoEl.removeAttribute('src');
  currentSongId = null;
  hideResults();
  currentDuetSingers = null;
  duetPlayMode = 'duo';
  applyDuetForMode();
  clearInterval(announceTimer);
  clearInterval(karaokeProgressTimer);
  karaokeAnnounceEl.classList.add('hidden');
  countdownOverlay.classList.add('hidden');
  playerStage.classList.add('hidden');
  catalogEl.classList.remove('hidden');
  nowPlayingUserId = null;
  lastAutoPlayedSongId = null;
  lastTurnKey = null;
}

// Manual "Volver al catálogo" mid-song: end the turn right away, no results
// screen (the singer chose to bail out, not finish).
function stopPlayer() {
  const finishedUserId = nowPlayingUserId;
  returnToCatalog();
  // Tell the server this turn's playback is over so the singer's phone
  // stops capturing mic audio and gets a final score, instead of
  // streaming indefinitely (see the 'endTurn' handler on /ws/room).
  if (finishedUserId && roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'endTurn', userId: finishedUserId }));
  }
}

// Natural end of the song: keep the stage up and show the results screen
// (gracias + puntaje + quién sigue) instead of jumping straight back to the
// catalog. The final score arrives in a later roomState (endTurn triggers
// the phone's summary), so showResults fills it in when it lands.
function onSongEnded() {
  cancelAnimationFrame(rafHandle);
  audioEl.pause();
  bgVideoEl.pause();

  const finishedUserId = nowPlayingUserId;
  if (finishedUserId && roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'endTurn', userId: finishedUserId }));
  }
  // Allow this same song to be re-queued later; a fresh nowPlaying replaces
  // the results/announce with the next turn.
  lastAutoPlayedSongId = null;
  lastTurnKey = null;

  // Karaoke: no score screen. Go back to the catalog and pull the next singer
  // in — the next roomState's nowPlaying will announce + play them (or nothing
  // if the queue is empty).
  if (currentMode === 'karaoke') {
    returnToCatalog();
    if (roomWs?.readyState === WebSocket.OPEN) {
      roomWs.send(JSON.stringify({ type: 'advanceQueue' }));
    }
    return;
  }

  showResults(finishedUserId);
}

let pendingResultsUserId = null;

function setResultsScore(score) {
  const pct = score.max ? Math.round((score.total / score.max) * 100) : 0;
  resultsScore.textContent = `${score.total} / ${score.max} — ${pct}%`;
}

function renderResultsNext() {
  const next = latestQueue[0];
  resultsNext.innerHTML = next
    ? `Sigue: <strong>${escapeHtml(next.nickname)}</strong>${next.songTitle ? ` — ${escapeHtml(next.songTitle)}` : ''}`
    : 'No hay nadie más en la cola.';
}

function showResults(finishedUserId) {
  resultsTitle.textContent = currentTurnNickname
    ? `¡Gracias, ${currentTurnNickname}!`
    : '¡Gracias por participar!';

  // Wait for THIS turn's score: the singer only reaches 'scored' after the
  // server finishes this turn, so keying on that state avoids showing a
  // stale lastScore left over from an earlier turn by the same person.
  const singer = latestUsers.find((u) => u.id === finishedUserId);
  if (singer?.state === 'scored' && singer.lastScore) {
    setResultsScore(singer.lastScore);
    pendingResultsUserId = null;
  } else {
    resultsScore.textContent = 'Calculando puntaje...';
    pendingResultsUserId = finishedUserId;
  }

  renderResultsNext();
  resultsOverlay.classList.remove('hidden');
}

function hideResults() {
  resultsOverlay.classList.add('hidden');
  pendingResultsUserId = null;
}

resultsContinue.addEventListener('click', returnToCatalog);
backBtn.addEventListener('click', stopPlayer);

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    playerStage.requestFullscreen().catch((err) => console.warn('fullscreen unavailable', err));
  }
});
audioEl.addEventListener('ended', onSongEnded);

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

function renderQueue(queue) {
  const list = document.getElementById('queue-list');
  list.innerHTML = queue.length === 0
    ? '<li style="color:#9c9db3">Nadie en cola</li>'
    : queue.map((q) => `
      <li>
        ${escapeHtml(q.nickname)}
        ${q.songTitle ? `<span style="color:#9c9db3"> — ${escapeHtml(q.songTitle)}</span>` : ''}
      </li>
    `).join('');
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

// --- Karaoke: catalog pick → name modal → queue; announce before each turn ---
const karaokeAnnounceEl = document.getElementById('karaoke-announce');
const karaokeAnnounceName = document.getElementById('karaoke-announce-name');
const karaokeAnnounceSong = document.getElementById('karaoke-announce-song');
const karaokeAnnounceCount = document.getElementById('karaoke-announce-count');
// Wait between songs in Karaoke: the announce card counts down this long so
// the next singer can get ready before the song starts.
const KARAOKE_ANNOUNCE_SECONDS = 15;
let announceTimer = null;

// Clicking a catalog song: in UltraStar it plays right away (asking duo/solo
// for duets); in Karaoke it asks who's singing and queues them.
function onCatalogPick(song) {
  if (currentMode === 'karaoke') openKaraokeNameModal(song);
  else openSong(song.id, { ask: true });
}

function openKaraokeNameModal(song) {
  const overlay = document.createElement('div');
  overlay.className = 'mic-modal-overlay';
  overlay.innerHTML = `
    <div class="mic-modal">
      <h3>Agregar a la cola</h3>
      <div class="karaoke-modal-song">${escapeHtml(song.artist)} — ${escapeHtml(song.title)}</div>
      <label class="mic-modal-label">¿Quién canta?</label>
      <input type="text" id="karaoke-name" placeholder="Nombre del participante" autocomplete="off" />
      <div class="mic-modal-actions">
        <button type="button" id="karaoke-cancel">Cancelar</button>
        <button type="button" id="karaoke-confirm" class="primary-btn" disabled>Agregar a la cola</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const nameEl = overlay.querySelector('#karaoke-name');
  const confirmBtn = overlay.querySelector('#karaoke-confirm');
  const close = () => overlay.remove();
  const submit = () => {
    const nickname = nameEl.value.trim();
    if (!nickname) return;
    if (roomWs?.readyState === WebSocket.OPEN) {
      roomWs.send(JSON.stringify({ type: 'addKaraokeSinger', nickname, songId: song.id }));
    }
    close();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#karaoke-cancel').addEventListener('click', close);
  nameEl.addEventListener('input', () => { confirmBtn.disabled = !nameEl.value.trim(); });
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  confirmBtn.addEventListener('click', submit);
  nameEl.focus();
}

// Full-stage "Ahora canta X" card, shown with a live countdown before playback.
function showKaraokeAnnounce(nickname, songTitle, onDone) {
  karaokeAnnounceName.textContent = nickname || 'Invitado';
  karaokeAnnounceSong.textContent = songTitle || '';
  catalogEl.classList.add('hidden');
  playerStage.classList.remove('hidden');
  karaokeAnnounceEl.classList.remove('hidden');
  clearInterval(announceTimer);
  let remaining = KARAOKE_ANNOUNCE_SECONDS;
  karaokeAnnounceCount.textContent = `Empieza en ${remaining}s`;
  announceTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      karaokeAnnounceCount.textContent = `Empieza en ${remaining}s`;
    } else {
      clearInterval(announceTimer);
      karaokeAnnounceEl.classList.add('hidden');
      onDone?.();
    }
  }, 1000);
}

// --- Karaoke mic monitor: play a local mic through the speakers while songs
// play, ducking the music. Config comes from Settings (/api/settings). The
// stream stays open for the whole Karaoke session (not per song) so a
// Bluetooth mic doesn't re-handshake between turns. ---
let micMonitorConfig = { enabled: false, deviceId: null, musicVolume: 70 };
let micMonitor = null; // { stream, ctx, source }
let karaokeProgressTimer = null; // broadcasts playback position to phones

fetch('/api/settings')
  .then((r) => r.json())
  .then((s) => { if (s.micMonitor) micMonitorConfig = s.micMonitor; })
  .catch(() => {});

async function startMicMonitor() {
  if (micMonitor || !micMonitorConfig.enabled) return;
  micMonitor = { pending: true }; // guard against a double-start race
  try {
    // Raw mic (no AGC/NS/echo processing) so singing sounds natural.
    const audio = micMonitorConfig.deviceId
      ? { deviceId: { exact: micMonitorConfig.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try { await ctx.resume(); } catch {}
    const source = ctx.createMediaStreamSource(stream);
    source.connect(ctx.destination);
    micMonitor = { stream, ctx, source };
  } catch (err) {
    console.warn('mic monitor failed', err);
    micMonitor = null;
  }
}

function stopMicMonitor() {
  if (!micMonitor) return;
  const m = micMonitor;
  micMonitor = null;
  try { m.source?.disconnect(); } catch {}
  try { m.stream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { m.ctx?.close(); } catch {}
}

let lastAutoPlayedSongId = null;
let lastTurnKey = null;
let nowPlayingUserId = null;

function handleNowPlaying(nowPlaying) {
  if (!nowPlaying || !nowPlaying.songId) return;
  // Dedupe by turn (user + song), not just song, so two people can queue the
  // same song back to back and both play.
  const turnKey = `${nowPlaying.userId ?? ''}:${nowPlaying.songId}`;
  if (turnKey === lastTurnKey) return;
  lastTurnKey = turnKey;
  lastAutoPlayedSongId = nowPlaying.songId;
  nowPlayingUserId = nowPlaying.userId ?? null;
  const singer = latestUsers.find((u) => u.id === nowPlayingUserId);
  currentTurnNickname = singer?.nickname ?? nowPlaying.nickname ?? null;
  hideResults(); // a new turn supersedes any lingering results screen

  // Karaoke: no scoring, no mic, no countdown. Announce the participant, then
  // just play the song.
  if (currentMode === 'karaoke') {
    showKaraokeAnnounce(currentTurnNickname, nowPlaying.songTitle, () => {
      openSong(nowPlaying.songId, { withCountdown: false, duetMode: nowPlaying.duetMode });
    });
    return;
  }

  // Physical-mic singer: don't auto-play. Show the prep screen so the
  // operator picks and tests the mic; starting the turn (countdown + song)
  // happens from there. Phone singers are unaffected.
  if (window.localMics?.isMicSinger(nowPlayingUserId)) {
    showMicPrep(nowPlaying);
    return;
  }
  openSong(nowPlaying.songId, { withCountdown: true, duetMode: nowPlaying.duetMode });
}

// --- Pre-turn prep screen for physical-mic singers ---
const micPrepOverlay = document.getElementById('mic-prep-overlay');
const micPrepTitle = document.getElementById('mic-prep-title');
const micPrepSong = document.getElementById('mic-prep-song');
const micPrepMics = document.getElementById('mic-prep-mics');
const micPrepMeterFill = document.getElementById('mic-prep-meter-fill');
const micPrepStart = document.getElementById('mic-prep-start');
const micPrepCancel = document.getElementById('mic-prep-cancel');
let micPrepUserId = null;
let micPrepDeviceId = null;

function selectPrepMic(deviceId) {
  micPrepDeviceId = deviceId;
  micPrepMics.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('selected', b.dataset.deviceId === deviceId);
  });
  window.localMics.primeAndMeter(micPrepUserId, deviceId, (level) => {
    micPrepMeterFill.style.width = `${Math.round(level * 100)}%`;
  }).catch((err) => {
    micPrepSong.textContent = `No se pudo abrir el micrófono: ${err.message}`;
  });
}

function showMicPrep(nowPlaying) {
  micPrepUserId = nowPlaying.userId;
  const name = window.localMics.singerName(micPrepUserId) || currentTurnNickname || '';
  micPrepTitle.textContent = name ? `Prepará el micrófono de ${name}` : 'Prepará el micrófono';
  micPrepSong.textContent = nowPlaying.songTitle || '';

  const mics = window.localMics.enabledMics();
  micPrepMics.innerHTML = mics
    .map((m) => `<button type="button" data-device-id="${escapeHtml(m.deviceId)}">${escapeHtml(m.label || 'Micrófono')}</button>`)
    .join('');
  micPrepMics.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => selectPrepMic(b.dataset.deviceId));
  });

  micPrepMeterFill.style.width = '0%';
  micPrepOverlay.classList.remove('hidden');
  if (mics.length > 0) selectPrepMic(mics[0].deviceId); // preview the first mic
}

function hideMicPrep() {
  micPrepOverlay.classList.add('hidden');
}

micPrepStart.addEventListener('click', () => {
  if (!micPrepDeviceId) return;
  window.localMics.startStreaming(micPrepUserId);
  hideMicPrep();
  openSong(lastAutoPlayedSongId, { withCountdown: true });
});

micPrepCancel.addEventListener('click', () => {
  window.localMics.stopCapture();
  hideMicPrep();
  // Abandon the called turn so the singer isn't stuck; operator can re-add.
  if (micPrepUserId && roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'endTurn', userId: micPrepUserId }));
  }
  lastAutoPlayedSongId = null;
  micPrepUserId = null;
});

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
      applyMode(data.mode);
      latestUsers = data.users;
      latestQueue = data.queue;
      renderUsers(data.users);
      renderQueue(data.queue);
      renderRanking(data.ranking);
      renderNetworkStatus(data.users);
      renderLowLatencyToggle(data.lowLatencyMode);

      // Fill in the final score on the results screen once it lands, and
      // keep "who's next" fresh if the queue shifts while it's showing.
      if (!resultsOverlay.classList.contains('hidden')) {
        if (pendingResultsUserId) {
          const singer = latestUsers.find((u) => u.id === pendingResultsUserId);
          if (singer?.state === 'scored' && singer.lastScore) {
            setResultsScore(singer.lastScore);
            pendingResultsUserId = null;
          } else if (!singer || singer.state === 'connected' || singer.state === 'guest') {
            // The turn ended without a score (mic never streamed, singer
            // dropped, etc.) — don't leave "Calculando puntaje..." stuck.
            resultsScore.textContent = 'No se registró puntaje para este turno.';
            pendingResultsUserId = null;
          }
        }
        renderResultsNext();
      }

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

const themeToggleBtn = document.getElementById('theme-toggle');
themeToggleBtn.textContent = themeIcon(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
themeToggleBtn.addEventListener('click', () => {
  themeToggleBtn.textContent = themeIcon(toggleTheme());
});

// --- Modo de sesión (Karaoke / UltraStar) ---
// The mode is global for the Sala session: the landing sets it via /ws/room,
// the server echoes it back in roomState, and applyMode() reflects it here.
const modeLanding = document.getElementById('mode-landing');
const modeChip = document.getElementById('mode-chip');
let currentMode = null;

function applyMode(mode) {
  const next = mode === 'karaoke' || mode === 'ultrastar' ? mode : null;
  currentMode = next;
  const advanceBtn = document.getElementById('advance-btn');
  if (next) {
    document.documentElement.dataset.mode = next;
    modeLanding.classList.add('hidden');
    modeChip.classList.remove('hidden');
    modeChip.textContent = next === 'karaoke' ? '🎤 Karaoke ⇄' : '🏆 UltraStar ⇄';
    advanceBtn.textContent = next === 'karaoke' ? '▶ Reproducir siguiente' : '▶ Avanzar rotación';
  } else {
    delete document.documentElement.dataset.mode;
    modeLanding.classList.remove('hidden');
    modeChip.classList.add('hidden');
  }
  if (next !== 'karaoke') stopMicMonitor(); // free the mic when leaving Karaoke
}

function sendMode(mode) {
  if (roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'setMode', mode }));
  }
}

modeLanding.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => sendMode(card.dataset.mode));
});
modeChip.addEventListener('click', () => sendMode(null)); // volver al landing

applyMode(null); // mostrar el landing hasta que el primer roomState diga el modo

loadQr();
connectRoom();
warnIfInsecureContext();
