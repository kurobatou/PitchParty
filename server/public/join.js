import { downsampleTo16k, floatTo16BitPCM, escapeHtml, warnIfInsecureContext } from './audioUtils.js';

warnIfInsecureContext();

const nicknameEl = document.getElementById('nickname');
const roleSingerBtn = document.getElementById('role-singer');
const roleGuestBtn = document.getElementById('role-guest');
const joinBtn = document.getElementById('join-btn');

const stepJoin = document.getElementById('step-join');
const stepSong = document.getElementById('step-song');
const stepSing = document.getElementById('step-sing');
const stepGuest = document.getElementById('step-guest');

const songSelect = document.getElementById('song-select');
const chooseSongBtn = document.getElementById('choose-song-btn');
const singStatus = document.getElementById('sing-status');
const startMicBtn = document.getElementById('start-mic-btn');
const stopMicBtn = document.getElementById('stop-mic-btn');
const scoreEl = document.getElementById('score');
const maxScoreEl = document.getElementById('max-score');
const singAgainBtn = document.getElementById('sing-again-btn');

let role = null;
let userId = null;
let roomWs = null;
let selectedSongId = null;

let audioCtx = null;
let processorNode = null;
let sourceNode = null;
let silentGain = null;
let mediaStream = null;
let singWs = null;

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

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${path}`;
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

joinBtn.addEventListener('click', () => {
  roomWs = new WebSocket(wsUrl('/ws/room'));

  roomWs.onopen = () => {
    roomWs.send(JSON.stringify({
      type: 'join',
      nickname: nicknameEl.value.trim() || undefined,
      role,
    }));
  };

  roomWs.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'welcome') {
      userId = data.userId;
      onJoined();
    } else if (data.type === 'pong') {
      const rtt = performance.now() - data.t0;
      roomWs.send(JSON.stringify({ type: 'reportLatency', ms: Math.round(rtt) }));
    } else if (data.type === 'roomState') {
      onRoomState(data);
    }
  };

  startLatencyPing();
});

function startLatencyPing() {
  setInterval(() => {
    if (roomWs?.readyState === WebSocket.OPEN) {
      roomWs.send(JSON.stringify({ type: 'ping', t0: performance.now() }));
    }
  }, 5000);
}

async function loadSongOptions() {
  const res = await fetch('/api/songs');
  const songs = await res.json();
  songSelect.innerHTML = songs
    .map((s) => `<option value="${s.id}">${escapeHtml(s.artist)} — ${escapeHtml(s.title)}</option>`)
    .join('');
}

async function onJoined() {
  stepJoin.classList.add('hidden');
  if (role === 'singer') {
    stepSong.classList.remove('hidden');
    await loadSongOptions();
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
  await loadSongOptions();
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

chooseSongBtn.addEventListener('click', () => {
  selectedSongId = songSelect.value;
  roomWs.send(JSON.stringify({ type: 'chooseSong', songId: Number(selectedSongId) }));
  stepSong.classList.add('hidden');
  stepSing.classList.remove('hidden');
  singStatus.textContent = 'Estás en la cola. Preparando el micrófono...';

  unlockAlertAudio();
  primeMicPermission();
});

let hasStartedThisTurn = false;
let previousSelfState = null;

function onRoomState(data) {
  if (!userId || stepSing.classList.contains('hidden')) return;

  const self = data.users.find((u) => u.id === userId);
  if (!self) return;

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
    const position = data.queue.indexOf(self.nickname) + 1;
    startMicBtn.disabled = true;
    singStatus.textContent = position > 0
      ? `Esperando tu turno (posición ${position} en la cola)...`
      : 'Esperando tu turno...';
  } else if (self.state === 'scored') {
    hasStartedThisTurn = false;
    singAgainBtn.classList.remove('hidden');
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
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

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
