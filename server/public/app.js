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

  if (song.hasVideo && song.videoUrl) {
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
  if (song.hasVideo && song.videoUrl) bgVideoEl.play().catch(() => {});

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
