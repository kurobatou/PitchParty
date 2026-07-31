import { downsampleTo16k, floatTo16BitPCM, escapeHtml, warnIfInsecureContext } from './audioUtils.js';
import { toggleTheme, themeIcon } from './theme.js';

warnIfInsecureContext();

const nicknameEl = document.getElementById('nickname');
const roleSingerBtn = document.getElementById('role-singer');
const roleGuestBtn = document.getElementById('role-guest');
const joinBtn = document.getElementById('join-btn');

const stepJoin = document.getElementById('step-join');
const stepSong = document.getElementById('step-song');
const stepSing = document.getElementById('step-sing');
const stepGuest = document.getElementById('step-guest');

const songSearchEl = document.getElementById('song-search');
const songResultsEl = document.getElementById('song-results');
const singStatus = document.getElementById('sing-status');
const startMicBtn = document.getElementById('start-mic-btn');
const stopMicBtn = document.getElementById('stop-mic-btn');
const scoreEl = document.getElementById('score');
const maxScoreEl = document.getElementById('max-score');
const singAgainBtn = document.getElementById('sing-again-btn');
const lyricsPreviewEl = document.getElementById('lyrics-preview');
const phoneLyricsPrevEl = document.getElementById('phone-lyrics-prev');
const phoneLyricsNextEl = document.getElementById('phone-lyrics-next');
const phoneLyricsCurrentEl = document.getElementById('phone-lyrics-current');
const pageTitleEl = document.getElementById('page-title');
const advanceRowEl = document.getElementById('advance-row');
const advanceQueueBtn = document.getElementById('advance-queue-btn');
const singSongInfoEl = document.getElementById('sing-song-info');
const avatarEl = document.getElementById('avatar');
const themeToggleBtn = document.getElementById('theme-toggle');
const equalizerBoxEl = document.getElementById('equalizer-box');
const eqBars = Array.from(document.querySelectorAll('#equalizer .eq-bar'));
const pitchPctEl = document.getElementById('pitch-pct');

let role = null;
let userId = null;
let roomWs = null;
let selectedSongId = null;
let selectedSongTitle = null;
let allSongs = [];

let audioCtx = null;
let processorNode = null;
let sourceNode = null;
let silentGain = null;
let mediaStream = null;
let singWs = null;
let activeLines = [];

// 'unknown' | 'granted' | 'denied' — primed while the singer waits in the
// queue (see primeMicPermission) so the OS permission prompt happens then,
// not at the exact moment they're called to sing.
let micPermissionState = 'unknown';
let startingMic = false;

// A separate, short-lived context just for the "it's your turn" alert.
// iOS only allows starting audio from a user gesture, and the alert has
// to fire from a WebSocket message (no gesture) — so we create/unlock it
// here, on the last button tap before the phone just sits and waits.
let alertCtx = null;

// iOS requires an actual sound to start *inside* the gesture handler, not
// just the AudioContext to be constructed there — otherwise it stays
// "unlocked but silent" and the later programmatic beep never plays.
function unlockAlertAudio() {
  if (!alertCtx) alertCtx = new (window.AudioContext || window.webkitAudioContext)();
  alertCtx.resume();

  const osc = alertCtx.createOscillator();
  const gain = alertCtx.createGain();
  gain.gain.value = 0.0001; // effectively silent, just for the unlock
  osc.connect(gain);
  gain.connect(alertCtx.destination);
  osc.start();
  osc.stop(alertCtx.currentTime + 0.05);
}

function playCallAlert() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

  if (!alertCtx) return;
  alertCtx.resume();

  const osc = alertCtx.createOscillator();
  const gain = alertCtx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, alertCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.35, alertCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, alertCtx.currentTime + 0.5);
  osc.connect(gain);
  gain.connect(alertCtx.destination);
  osc.start();
  osc.stop(alertCtx.currentTime + 0.5);
}

// Keeps the screen from auto-locking while waiting in the queue — a
// locked/backgrounded phone is the main reason the WebSocket drops and
// the singer disappears from the room. Only fights the OS's idle-timeout
// auto-lock (while this tab stays the active foreground tab); it can't
// stop someone from pressing the power button, and the browser releases
// it automatically when the tab is backgrounded — re-acquired below.
let wakeLock = null;
async function requestWakeLock() {
  if (!navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('wake lock unavailable', err);
  }
}
document.addEventListener('visibilitychange', () => {
  // Only re-acquire once actually joined (stepJoin hidden) — no point
  // fighting the screen timeout on the initial nickname/role form.
  if (document.visibilityState === 'visible' && stepJoin.classList.contains('hidden')) {
    requestWakeLock();
  }
});

themeToggleBtn.textContent = themeIcon(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
themeToggleBtn.addEventListener('click', () => {
  themeToggleBtn.textContent = themeIcon(toggleTheme());
});

function setAvatar(nickname) {
  const initial = (nickname || '?').trim().charAt(0).toUpperCase() || '?';
  avatarEl.textContent = initial;
  avatarEl.classList.remove('hidden');
}

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
}

function beatToMs(beat, bpm, gap) {
  const msPerBeat = 60000 / (bpm * 4);
  return gap + beat * msPerBeat;
}

function lineText(line) {
  return line.notes.map((n) => n.text).join('');
}

roleSingerBtn.addEventListener('click', () => {
  role = 'singer';
  roleSingerBtn.classList.add('selected');
  roleGuestBtn.classList.remove('selected');
  joinBtn.disabled = false;
});

roleGuestBtn.addEventListener('click', () => {
  role = 'guest';
  roleGuestBtn.classList.add('selected');
  roleSingerBtn.classList.remove('selected');
  joinBtn.disabled = false;
});

// Persisted so a dropped connection (screen lock, backgrounded tab, brief
// network blip) can reclaim the same room userId — and queue position —
// instead of showing up as a stranger with no song chosen. See
// Room.reconnect / DISCONNECT_GRACE_MS server-side (room.js).
const SESSION_KEY = 'karaoke.session';

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, role, nickname: nicknameEl.value.trim() }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

let latencyPingStarted = false;
function startLatencyPing() {
  if (latencyPingStarted) return;
  latencyPingStarted = true;
  setInterval(() => {
    if (roomWs?.readyState === WebSocket.OPEN) {
      roomWs.send(JSON.stringify({ type: 'ping', t0: performance.now() }));
    }
  }, 5000);
}

function handleRoomMessage(evt) {
  const data = JSON.parse(evt.data);
  if (data.type === 'welcome') {
    userId = data.userId;
    role = data.role || role;
    if (data.nickname) nicknameEl.value = data.nickname;
    saveSession();
    stepJoin.classList.add('hidden');
    const displayName = data.nickname || nicknameEl.value.trim() || 'Invitado';
    pageTitleEl.textContent = `Conectado como ${displayName}`;
    setAvatar(displayName);
    advanceRowEl.classList.remove('hidden');
    if (!data.rejoined) onJoined();
    // If rejoined, the step (stepSong vs. stepSing vs. stepGuest) is
    // decided by the roomState broadcast the server sends right after —
    // handled generically by onRoomState below, since it now runs
    // regardless of which step is currently visible.
  } else if (data.type === 'rejoinFailed') {
    // Grace period expired, or the server restarted since — nothing to
    // reclaim, so start over with a normal join.
    clearSession();
    pageTitleEl.textContent = '🎤 Unirse a la sala';
    advanceRowEl.classList.add('hidden');
    stepJoin.classList.remove('hidden');
    stepSong.classList.add('hidden');
    stepSing.classList.add('hidden');
    stepGuest.classList.add('hidden');
  } else if (data.type === 'pong') {
    const rtt = performance.now() - data.t0;
    roomWs.send(JSON.stringify({ type: 'reportLatency', ms: Math.round(rtt) }));
  } else if (data.type === 'roomState') {
    onRoomState(data);
  }
}

let reconnectTimer = null;
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const session = loadSession();
    if (session?.userId) attemptRejoin(session);
  }, 3000);
}

function attemptRejoin(session) {
  roomWs = new WebSocket(wsUrl('/ws/room'));
  roomWs.onopen = () => {
    roomWs.send(JSON.stringify({ type: 'rejoin', userId: session.userId }));
  };
  roomWs.onmessage = handleRoomMessage;
  roomWs.onclose = scheduleReconnect;
  startLatencyPing();
}

joinBtn.addEventListener('click', () => {
  roomWs = new WebSocket(wsUrl('/ws/room'));

  roomWs.onopen = () => {
    roomWs.send(JSON.stringify({
      type: 'join',
      nickname: nicknameEl.value.trim() || undefined,
      role,
    }));
  };
  roomWs.onmessage = handleRoomMessage;
  roomWs.onclose = scheduleReconnect;

  startLatencyPing();
});

// A saved session from before a reload/reconnect means we were already
// past the nickname/role form — try to walk straight back in instead of
// making the singer re-type everything and lose their queue spot.
const savedSession = loadSession();
if (savedSession?.userId) {
  role = savedSession.role;
  stepJoin.classList.add('hidden');
  singStatus.textContent = 'Reconectando...';
  stepSing.classList.remove('hidden');
  attemptRejoin(savedSession);
}

async function loadAllSongs() {
  const res = await fetch('/api/songs');
  allSongs = await res.json();
  renderSongResults(allSongs);
}

function renderSongResults(songs) {
  if (songs.length === 0) {
    songResultsEl.innerHTML = '<li class="no-results">Ninguna canción coincide.</li>';
    return;
  }
  songResultsEl.innerHTML = songs.map((s) => `
    <li data-id="${s.id}">
      <div>${escapeHtml(s.title)}</div>
      <div class="song-artist">${escapeHtml(s.artist)}</div>
    </li>
  `).join('');

  songResultsEl.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => selectSong(Number(li.dataset.id)));
  });
}

songSearchEl.addEventListener('input', () => {
  const q = songSearchEl.value.trim().toLowerCase();
  if (!q) {
    renderSongResults(allSongs);
    return;
  }
  const filtered = allSongs.filter((s) =>
    s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
  renderSongResults(filtered);
});

async function onJoined() {
  stepJoin.classList.add('hidden');
  if (role === 'singer') {
    stepSong.classList.remove('hidden');
    await loadAllSongs();
  } else {
    stepGuest.classList.remove('hidden');
  }
}

// After being scored, go back to picking a song instead of leaving the
// singer stuck on the "Terminaste" screen with no way to queue again.
singAgainBtn.addEventListener('click', async () => {
  singAgainBtn.classList.add('hidden');
  scoreEl.textContent = '0';
  maxScoreEl.textContent = '0';
  stepSing.classList.add('hidden');
  stepSong.classList.remove('hidden');
  songSearchEl.value = '';
  await loadAllSongs();
});

// Asking for mic access here — right after picking a song, while there's
// still a natural reason for it — means the OS permission prompt (and any
// confusion around it) happens during the queue wait, not at the moment
// they're called to sing. Once granted, the browser remembers it for this
// site, so the real startMic() later needs no prompt at all.
async function primeMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    micPermissionState = 'granted';
    if (!stepSing.classList.contains('hidden') && previousSelfState !== 'called') {
      singStatus.textContent = 'Estás en la cola. El micrófono ya está listo — cuando te llamen, arranca solo.';
    }
  } catch (err) {
    micPermissionState = 'denied';
    console.warn('mic permission priming failed', err);
  }
}

function selectSong(songId) {
  selectedSongId = songId;
  const song = allSongs.find((s) => s.id === songId);
  selectedSongTitle = song ? `${song.artist} — ${song.title}` : null;
  roomWs.send(JSON.stringify({ type: 'chooseSong', songId }));
  stepSong.classList.add('hidden');
  stepSing.classList.remove('hidden');
  singStatus.textContent = 'Estás en la cola. Preparando el micrófono...';

  unlockAlertAudio();
  primeMicPermission();
  requestWakeLock();
}

let hasStartedThisTurn = false;
let previousSelfState = null;

// Shows whichever step matches the server's view of this user — needed
// so a rejoin (page reload, reconnect after a dropped WS) lands back on
// the right screen (still queued? mid-turn? just scored?) instead of
// defaulting to the song picker every time.
//
// Only runs when the state actually *changes* (see lastRoutedState below),
// not on every roomState heartbeat — otherwise "scored" (which stays true
// server-side until the singer actually picks a new song) would keep
// forcing stepSing back open a few seconds after tapping "Elegir otra
// canción", since that click alone doesn't change anything server-side.
const ACTIVE_TURN_STATES = ['queued', 'called', 'singing', 'scored'];
function routeToStep(self) {
  if (self.role === 'guest') {
    stepSong.classList.add('hidden');
    stepSing.classList.add('hidden');
    stepGuest.classList.remove('hidden');
    return;
  }

  if (ACTIVE_TURN_STATES.includes(self.state)) {
    if (!selectedSongId && self.songId) {
      selectedSongId = self.songId;
      selectedSongTitle = self.songTitle ?? null;
    }
    stepGuest.classList.add('hidden');
    stepSong.classList.add('hidden');
    stepSing.classList.remove('hidden');
    if (self.state === 'scored') singAgainBtn.classList.remove('hidden');
  } else {
    stepGuest.classList.add('hidden');
    stepSing.classList.add('hidden');
    stepSong.classList.remove('hidden');
    if (allSongs.length === 0) loadAllSongs();
  }
}

let lastRoutedState = null;

function onRoomState(data) {
  if (!userId) return;

  const self = data.users.find((u) => u.id === userId);
  if (!self) return;

  if (self.state !== lastRoutedState) {
    routeToStep(self);
    lastRoutedState = self.state;
  }

  if (self.state === 'called' && previousSelfState !== 'called') {
    playCallAlert();
  }
  previousSelfState = self.state;

  if (self.state === 'called' && !hasStartedThisTurn && !startingMic) {
    if (micPermissionState === 'denied') {
      // Priming failed (permission blocked) — fall back to the manual
      // tap, which lets the browser retry the prompt from a fresh gesture.
      startMicBtn.disabled = false;
      singStatus.textContent = '¡Es tu turno! Apretá "Empezar a cantar" para dar permiso de micrófono.';
    } else {
      singStatus.textContent = '¡Es tu turno! Arrancando el micrófono...';
      startMic().catch((err) => {
        console.error(err);
        startMicBtn.disabled = false;
        singStatus.textContent = `No se pudo activar el micrófono automáticamente: ${err.message}. Apretá "Empezar a cantar".`;
      });
    }
  } else if (self.state === 'queued') {
    const position = data.queue.findIndex((q) => q.id === self.id) + 1;
    startMicBtn.disabled = true;
    singStatus.textContent = position > 0
      ? `Esperando tu turno (posición ${position} en la cola)...`
      : 'Esperando tu turno...';
  } else if (self.state === 'scored') {
    hasStartedThisTurn = false;
    singAgainBtn.classList.remove('hidden');
  }
}

// Loads the song's lyric lines (same shape the Sala uses) so the previous
// and current line can be shown in sync with the score frames below —
// the phone has no local audio playback of its own to sync against, but
// each scoring 'frame' message already carries elapsedMs, which starts
// counting from roughly the same moment the Sala starts playing the song.
async function loadLyricsFor(songId) {
  try {
    const res = await fetch(`/api/songs/${songId}`);
    if (!res.ok) return;
    const song = await res.json();
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
  } catch (err) {
    console.warn('could not load lyrics for phone preview', err);
    activeLines = [];
  }
}

// The phone's "clock" is samples-processed-since-mic-started, which lags
// the Sala's actual playback position a bit (getUserMedia + a beat of
// buffering before the first frame). This is a rough, fixed correction —
// not a real measurement of the actual lag on this connection — but it
// nudges the typical ~0.3-0.5s late feeling back in line.
const LYRICS_LEAD_MS = 400;

// Live "afinación" equalizer — purely client-side, derived from the same
// per-frame hit/expectedMidi the score already uses. No backend change:
// a rolling window of recent hits is enough for a convincing live bar
// animation without needing a smoothed value from the server.
const EQ_HISTORY_SIZE = 24; // ~24 frames * ~128ms ≈ 3s of singing history
let hitHistory = [];

function setBarsIdle() {
  eqBars.forEach((bar) => { bar.style.height = '20%'; });
}

function resetEqualizer() {
  hitHistory = [];
  setBarsIdle();
  pitchPctEl.textContent = '0%';
}

function updateEqualizer(hit, expectedMidi) {
  if (expectedMidi == null) {
    // Nothing to sing right now (instrumental/rest) — rest the bars low
    // instead of letting silence drag the rolling percentage toward 0.
    setBarsIdle();
    return;
  }

  hitHistory.push(hit ? 1 : 0);
  if (hitHistory.length > EQ_HISTORY_SIZE) hitHistory.shift();

  const pct = Math.round((hitHistory.reduce((a, b) => a + b, 0) / hitHistory.length) * 100);
  pitchPctEl.textContent = `${pct}%`;

  const barsCount = eqBars.length;
  const chunkSize = Math.max(1, Math.ceil(hitHistory.length / barsCount));
  for (let i = 0; i < barsCount; i++) {
    const chunk = hitHistory.slice(i * chunkSize, (i + 1) * chunkSize);
    const ratio = chunk.length ? chunk.reduce((a, b) => a + b, 0) / chunk.length : 0;
    eqBars[i].style.height = `${20 + ratio * 70}%`;
  }
}

function updateLyricsPreview(elapsedMs) {
  if (activeLines.length === 0) return;
  elapsedMs += LYRICS_LEAD_MS;
  let idx = activeLines.findIndex((l) => elapsedMs < l.endMs);
  if (idx === -1) idx = activeLines.length - 1;

  phoneLyricsPrevEl.textContent = idx > 0 ? activeLines[idx - 1].text : '';

  if (elapsedMs < activeLines[idx].startMs) {
    // Between lines: nothing active yet, so what's "current" is really
    // still coming up — show it as the preview instead of leaving both
    // blank.
    phoneLyricsCurrentEl.textContent = '';
    phoneLyricsNextEl.textContent = activeLines[idx].text;
  } else {
    phoneLyricsCurrentEl.textContent = activeLines[idx].text;
    phoneLyricsNextEl.textContent = activeLines[idx + 1]?.text ?? '';
  }
}

async function startMic() {
  startingMic = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } finally {
    startingMic = false;
  }

  hasStartedThisTurn = true;
  mediaStream = stream;

  if (selectedSongTitle) {
    singSongInfoEl.textContent = selectedSongTitle;
    singSongInfoEl.classList.remove('hidden');
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

  activeLines = [];
  loadLyricsFor(selectedSongId).then(() => {
    if (activeLines.length > 0) lyricsPreviewEl.classList.remove('hidden');
  });

  resetEqualizer();
  equalizerBoxEl.classList.remove('hidden');

  singWs = new WebSocket(wsUrl(`/ws/sing/${selectedSongId}?userId=${userId}`));

  processorNode.onaudioprocess = (event) => {
    if (!singWs || singWs.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16k(input, audioCtx.sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    singWs.send(pcm16.buffer);
  };

  singWs.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'frame') {
      scoreEl.textContent = data.totalScore;
      maxScoreEl.textContent = data.maxScore;
      singStatus.textContent = data.hit ? '✓ afinado' : 'Cantando...';
      updateLyricsPreview(data.elapsedMs);
      updateEqualizer(data.hit, data.expectedMidi);
    } else if (data.type === 'summary') {
      // Sent either because we asked to stop, or because the Sala's
      // screen finished playing this turn's song — either way the mic
      // must stop capturing now, not keep streaming forever.
      scoreEl.textContent = data.totalScore;
      maxScoreEl.textContent = data.maxScore;
      singStatus.textContent = 'Terminaste. ¡Buen trabajo!';
      finishSingingTurn();
      singAgainBtn.classList.remove('hidden');
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  startMicBtn.disabled = true;
  stopMicBtn.disabled = false;
}

// Releases the mic/AudioContext so the phone is actually idle between
// turns, and leaves it ready for the next "called" state to auto-start
// again (see onRoomState).
function teardownMicPipeline() {
  processorNode?.disconnect();
  sourceNode?.disconnect();
  silentGain?.disconnect();
  mediaStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  processorNode = null;
  sourceNode = null;
  silentGain = null;
  mediaStream = null;
  audioCtx = null;

  startMicBtn.disabled = true;
  stopMicBtn.disabled = true;
  lyricsPreviewEl.classList.add('hidden');
  phoneLyricsPrevEl.textContent = '';
  phoneLyricsNextEl.textContent = '';
  phoneLyricsCurrentEl.textContent = '';
  singSongInfoEl.classList.add('hidden');
  equalizerBoxEl.classList.add('hidden');
  resetEqualizer();
}

function finishSingingTurn() {
  teardownMicPipeline();
  if (singWs && singWs.readyState === WebSocket.OPEN) singWs.close();
  singWs = null;
  hasStartedThisTurn = false;
}

// Manual "Detener" — ask the server to score up to now and reply with a
// summary (same path the Sala's automatic end-of-song takes), instead of
// just closing the socket and leaving the turn "abandoned" with no score.
function stopMic() {
  if (singWs && singWs.readyState === WebSocket.OPEN) {
    singWs.send(JSON.stringify({ type: 'stop' }));
  } else {
    finishSingingTurn();
  }
}

startMicBtn.addEventListener('click', () => startMic().catch((err) => {
  console.error(err);
  alert(`No se pudo acceder al micrófono: ${err.message}`);
}));
stopMicBtn.addEventListener('click', stopMic);

// Anyone connected — not just the pantalla principal — can call the next
// turn from their phone; handy when nobody's standing at the TV.
advanceQueueBtn.addEventListener('click', () => {
  if (roomWs?.readyState === WebSocket.OPEN) {
    roomWs.send(JSON.stringify({ type: 'advanceQueue' }));
  }
});
