import { downsampleTo16k, floatTo16BitPCM, midiToNoteName, escapeHtml } from './audioUtils.js';

const songSelect = document.getElementById('song-select');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const scoreEl = document.getElementById('score');
const maxScoreEl = document.getElementById('max-score');
const detectedEl = document.getElementById('detected');
const expectedEl = document.getElementById('expected');
const hitEl = document.getElementById('hit-indicator');

let audioCtx = null;
let processorNode = null;
let sourceNode = null;
let silentGain = null;
let mediaStream = null;
let ws = null;

async function loadSongs() {
  const res = await fetch('/api/songs');
  const songs = await res.json();
  songSelect.innerHTML = songs
    .map((s) => `<option value="${s.id}">${escapeHtml(s.artist)} — ${escapeHtml(s.title)}</option>`)
    .join('');
}

async function start() {
  const songId = songSelect.value;
  if (!songId) return;

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/sing/${songId}`);

  processorNode.onaudioprocess = (event) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleTo16k(input, audioCtx.sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    ws.send(pcm16.buffer);
  };

  ws.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.type === 'frame') {
      scoreEl.textContent = data.totalScore;
      maxScoreEl.textContent = data.maxScore;
      detectedEl.textContent = midiToNoteName(data.detectedMidi);
      expectedEl.textContent = midiToNoteName(data.expectedMidi);
      hitEl.textContent = data.hit ? '✓ afinado' : '—';
      hitEl.className = data.hit ? 'hit-yes' : 'hit-no';
    } else if (data.type === 'summary') {
      scoreEl.textContent = data.totalScore;
      maxScoreEl.textContent = data.maxScore;
      hitEl.textContent = 'Sesión finalizada';
      hitEl.className = '';
    }
  };

  sourceNode.connect(processorNode);
  processorNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  startBtn.disabled = true;
  stopBtn.disabled = false;
  songSelect.disabled = true;
}

function stop() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  ws = null;

  processorNode?.disconnect();
  sourceNode?.disconnect();
  silentGain?.disconnect();
  mediaStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();

  startBtn.disabled = false;
  stopBtn.disabled = true;
  songSelect.disabled = false;
}

startBtn.addEventListener('click', () => start().catch((err) => {
  console.error(err);
  alert(`No se pudo acceder al micrófono: ${err.message}`);
}));
stopBtn.addEventListener('click', stop);

loadSongs();
