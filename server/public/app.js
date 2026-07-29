import { warnIfInsecureContext } from './audioUtils.js';

const catalogView = document.getElementById('catalog-view');
const playerView = document.getElementById('player-view');
const catalogEl = document.getElementById('catalog');
const searchEl = document.getElementById('search');
const backBtn = document.getElementById('back-btn');

const audioEl = document.getElementById('audio');
const bgVideoEl = document.getElementById('bg-video');
const bgFallbackEl = document.getElementById('bg-fallback');
const titleEl = document.getElementById('player-title');
const artistEl = document.getElementById('player-artist');
const prevEl = document.getElementById('lyrics-prev');
const currentEl = document.getElementById('lyrics-current');
const nextEl = document.getElementById('lyrics-next');

let allSongs = [];
let activeLines = [];
let rafHandle = null;

function beatToMs(beat, bpm, gap) {
  const msPerBeat = 60000 / (bpm * 4);
  return gap + beat * msPerBeat;
}

function lineText(line) {
  return line.notes.map((n) => n.text).join('');
}

async function loadCatalog() {
  const res = await fetch('/api/songs');
  allSongs = await res.json();
  renderCatalog(allSongs);
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

searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim().toLowerCase();
  const filtered = allSongs.filter((s) =>
    s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
  renderCatalog(filtered);
});

async function openSong(id) {
  const res = await fetch(`/api/songs/${id}`);
  if (!res.ok) return;
  const song = await res.json();

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

  const useVideo = song.hasVideo && song.videoUrl && !lowLatencyMode;

  if (useVideo) {
    bgVideoEl.src = song.videoUrl;
    bgVideoEl.classList.remove('hidden');
    bgFallbackEl.classList.add('hidden');
    bgVideoEl.currentTime = 0;
  } else {
    bgVideoEl.classList.add('hidden');
    bgFallbackEl.classList.remove('hidden');
    bgVideoEl.removeAttribute('src');
  }

  audioEl.src = song.mp3Url;
  catalogView.classList.add('hidden');
  playerView.classList.remove('hidden');

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
  playerView.classList.add('hidden');
  catalogView.classList.remove('hidden');
}

backBtn.addEventListener('click', stopPlayer);
audioEl.addEventListener('ended', stopPlayer);

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
