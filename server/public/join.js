import { downsampleTo16k, floatTo16BitPCM, escapeHtml } from './audioUtils.js';

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

async function onJoined() {
  stepJoin.classList.add('hidden');
  if (role === 'singer') {
    stepSong.classList.remove('hidden');
    const res = await fetch('/api/songs');
    const songs = await res.json();
    songSelect.innerHTML = songs
      .map((s) => `<option value="${s.id}">${escapeHtml(s.artist)} — ${escapeHtml(s.title)}</option>`)
      .join('');
  } else {
    stepGuest.classList.remove('hidden');
  }
}

chooseSongBtn.addEventListener('click', () => {
  selectedSongId = songSelect.value;
  roomWs.send(JSON.stringify({ type: 'chooseSong', songId: Number(selectedSongId) }));
  stepSong.classList.add('hidden');
  stepSing.classList.remove('hidden');
  singStatus.textContent = 'Listo. Apretá "Empezar a cantar" cuando la pantalla principal arranque la canción.';
});

async function startMic() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      scoreEl.textContent = data.totalScore;
      maxScoreEl.textContent = data.maxScore;
      singStatus.textContent = 'Terminaste. ¡Buen trabajo!';
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  startMicBtn.disabled = true;
  stopMicBtn.disabled = false;
}

function stopMic() {
  if (singWs && singWs.readyState === WebSocket.OPEN) singWs.close();
  singWs = null;

  processorNode?.disconnect();
  sourceNode?.disconnect();
  silentGain?.disconnect();
  mediaStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();

  startMicBtn.disabled = false;
  stopMicBtn.disabled = true;
}

startMicBtn.addEventListener('click', () => startMic().catch((err) => {
  console.error(err);
  alert(`No se pudo acceder al micrófono: ${err.message}`);
}));
stopMicBtn.addEventListener('click', stopMic);
