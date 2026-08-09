import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import { loadConfig } from './config.js';
import { openDb, listSongs, getSongById } from './db.js';
import { reindexLibrary } from './indexer.js';
import { parseUsdxTxt, beatToMs } from './usdxParser.js';
import { readUsdxTxtFile } from './txtEncoding.js';
import { Room } from './room.js';
import { getOrCreateCert } from './tls.js';
import { ensureLetsEncryptCert } from './certManager.js';
import { loadSettings, saveSettings, normalizeMicMonitor } from './settings.js';
import { detectPitch } from './pitch.js';
import { ScoringSession, notesFromSongPayload } from './scoring.js';
import { detectLanIp } from './netinfo.js';
import { browseForFolder } from './folderDialog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const ANALYSIS_WINDOW_SAMPLES = 2048; // ~128ms at 16kHz, matches the old Python engine
const DETECTED_LAN_IP = process.env.SERVER_LAN_IP || detectLanIp();

// Paths typed in the settings UI or config.json may be relative (e.g.
// "./songs"); resolve them against the repo root so the indexer always
// gets absolute paths regardless of the process's cwd.
function resolveLibraryPath(p) {
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

const config = loadConfig();
let settings = loadSettings(config);

// A manual override saved from the settings UI wins over the LAN IP
// start.sh auto-detected for this machine — useful when a host has
// several network interfaces and auto-detect picks the wrong one.
const LAN_IP = settings.lanIpOverride || DETECTED_LAN_IP || null;

// Mic capture (getUserMedia) only works in a "secure context": HTTPS or
// localhost. Phones on the LAN need the former, so we serve everything
// over HTTPS. Prefer a real, browser-trusted cert (Let's Encrypt via
// Cloudflare DNS-01, see certManager.js) when the user configured a
// domain for it — no more "unsafe site" click-through — falling back to
// the self-signed one for the detected LAN IP otherwise.
let httpsOptions;
let certInfo = null;
if (settings.publicDomain && settings.cloudflareApiToken) {
  try {
    const { key, cert, validUntil } = await ensureLetsEncryptCert({
      domain: settings.publicDomain,
      cloudflareApiToken: settings.cloudflareApiToken,
      email: settings.acmeEmail || undefined,
    });
    httpsOptions = { key, cert };
    certInfo = { type: 'letsencrypt', domain: settings.publicDomain, validUntil };
    console.log(`Using Let's Encrypt cert for ${settings.publicDomain} (valid until ${validUntil})`);
  } catch (err) {
    console.error("Let's Encrypt cert setup failed, falling back to self-signed:", err.message);
  }
}
if (!httpsOptions && LAN_IP) {
  httpsOptions = getOrCreateCert(LAN_IP);
  certInfo = { type: 'self-signed', lanIp: LAN_IP };
}

const app = Fastify({
  logger: true,
  https: httpsOptions,
});
const db = openDb();
const room = new Room();

// Lets the Sala tell the server "this turn's playback ended" (see the
// 'endTurn' message on /ws/room) so the matching /ws/sing session finishes
// with a summary instead of streaming mic audio forever. Keyed by room
// userId, populated while that user's /ws/sing socket is open.
const activeSingSessions = new Map();

function currentLibraryPaths() {
  return settings.libraryPaths.map(resolveLibraryPath);
}

reindexLibrary(db, currentLibraryPaths(), app.log);

await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

await app.register(fastifyWebsocket);

function toPublicSong(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    language: row.language,
    year: row.year,
    bpm: row.bpm,
    hasVideo: Boolean(row.video_path),
    coverUrl: row.cover_path ? `/files/${row.id}/cover` : null,
  };
}

app.get('/api/songs', async () => {
  return listSongs(db).map(toPublicSong);
});

app.get('/api/songs/:id', async (request, reply) => {
  const row = getSongById(db, Number(request.params.id));
  if (!row) return reply.code(404).send({ error: 'song not found' });

  const raw = readUsdxTxtFile(row.txt_path);
  const parsed = parseUsdxTxt(raw);

  return {
    ...toPublicSong(row),
    videogap: row.videogap,
    gap: row.gap,
    mp3Url: row.mp3_path ? `/files/${row.id}/mp3` : null,
    videoUrl: row.video_path ? `/files/${row.id}/video` : null,
    lines: parsed.lines,
    isDuet: parsed.meta.isDuet,
    duetSingers: parsed.meta.duetSingers,
  };
});

app.post('/api/reindex', async () => {
  return reindexLibrary(db, currentLibraryPaths(), app.log);
});

app.get('/api/settings', async () => {
  return {
    libraryPaths: settings.libraryPaths,
    libraryPathStatus: settings.libraryPaths.map((p) => ({
      path: p,
      exists: existsSync(resolveLibraryPath(p)),
    })),
    lanIpOverride: settings.lanIpOverride,
    detectedLanIp: DETECTED_LAN_IP,
    effectiveLanIp: LAN_IP,
    publicDomain: settings.publicDomain,
    acmeEmail: settings.acmeEmail,
    cloudflareTokenSet: Boolean(settings.cloudflareApiToken),
    certInfo,
    localMics: settings.localMics,
    micMonitor: settings.micMonitor,
  };
});

app.put('/api/settings', async (request, reply) => {
  const body = request.body ?? {};
  const next = { ...settings };

  if (body.libraryPaths !== undefined) {
    if (!Array.isArray(body.libraryPaths) || body.libraryPaths.some((p) => typeof p !== 'string' || !p.trim())) {
      return reply.code(400).send({ error: 'libraryPaths must be a non-empty array of strings' });
    }
    next.libraryPaths = body.libraryPaths.map((p) => p.trim());
  }

  if (body.lanIpOverride !== undefined) {
    next.lanIpOverride = body.lanIpOverride ? String(body.lanIpOverride).trim() : null;
  }

  if (body.publicDomain !== undefined) {
    next.publicDomain = body.publicDomain ? String(body.publicDomain).trim() : null;
  }
  if (body.cloudflareApiToken !== undefined) {
    next.cloudflareApiToken = body.cloudflareApiToken ? String(body.cloudflareApiToken).trim() : null;
  }
  if (body.acmeEmail !== undefined) {
    next.acmeEmail = body.acmeEmail ? String(body.acmeEmail).trim() : null;
  }

  if (body.localMics !== undefined) {
    if (!Array.isArray(body.localMics)) {
      return reply.code(400).send({ error: 'localMics must be an array' });
    }
    // Mics are just *enabled* here (deviceId + a human label for the UI);
    // the singer's name is assigned per-turn on the Sala, not stored.
    next.localMics = body.localMics
      .filter((m) => m && typeof m.deviceId === 'string' && m.deviceId)
      .map((m) => ({
        deviceId: m.deviceId,
        label: typeof m.label === 'string' ? m.label : '',
      }));
  }

  if (body.micMonitor !== undefined) {
    next.micMonitor = normalizeMicMonitor(body.micMonitor);
  }

  settings = next;
  saveSettings(settings);

  const result = body.libraryPaths !== undefined
    ? reindexLibrary(db, currentLibraryPaths(), app.log)
    : null;

  // Issuing/renewing the cert happens right away (so a bad token/domain
  // fails fast, in the response), but it only takes effect on the next
  // restart — HTTPS options are fixed when the process boots.
  let certAttempt = null;
  const wantsCertCheck = body.publicDomain !== undefined || body.cloudflareApiToken !== undefined;
  if (wantsCertCheck && settings.publicDomain && settings.cloudflareApiToken) {
    try {
      const { validUntil } = await ensureLetsEncryptCert({
        domain: settings.publicDomain,
        cloudflareApiToken: settings.cloudflareApiToken,
        email: settings.acmeEmail || undefined,
      });
      certAttempt = { ok: true, validUntil };
    } catch (err) {
      certAttempt = { ok: false, error: err.message };
    }
  }

  return {
    libraryPaths: settings.libraryPaths,
    libraryPathStatus: settings.libraryPaths.map((p) => ({
      path: p,
      exists: existsSync(resolveLibraryPath(p)),
    })),
    lanIpOverride: settings.lanIpOverride,
    detectedLanIp: DETECTED_LAN_IP,
    effectiveLanIp: LAN_IP,
    lanIpRestartRequired: body.lanIpOverride !== undefined && next.lanIpOverride !== LAN_IP,
    publicDomain: settings.publicDomain,
    acmeEmail: settings.acmeEmail,
    cloudflareTokenSet: Boolean(settings.cloudflareApiToken),
    certAttempt,
    certRestartRequired: certAttempt?.ok === true,
    reindex: result,
    localMics: settings.localMics,
  };
});

app.post('/api/browse-folder', async (request, reply) => {
  try {
    const path = await browseForFolder();
    return { path };
  } catch (err) {
    app.log.warn({ err }, 'native folder dialog unavailable');
    return reply.code(501).send({ error: 'no native folder dialog available on this OS' });
  }
});

app.get('/api/qr', async (request, reply) => {
  const text = request.query.text;
  if (!text) return reply.code(400).send({ error: 'missing "text" query param' });
  const dataUrl = await QRCode.toDataURL(text, { margin: 1, width: 320 });
  return { dataUrl };
});

const FILE_KINDS = {
  mp3: { column: 'mp3_path' },
  video: { column: 'video_path' },
  cover: { column: 'cover_path' },
};

app.get('/files/:id/:kind', async (request, reply) => {
  const { id, kind } = request.params;
  const fileKind = FILE_KINDS[kind];
  if (!fileKind) return reply.code(404).send({ error: 'unknown file kind' });

  const row = getSongById(db, Number(id));
  const path = row?.[fileKind.column];
  if (!path) return reply.code(404).send({ error: 'file not available' });

  return reply.sendFile(path, '/');
});

function buildNotesPayload(row) {
  const raw = readUsdxTxtFile(row.txt_path);
  const parsed = parseUsdxTxt(raw);
  const notes = [];

  for (const line of parsed.lines) {
    if (line.type !== 'lyrics') continue;
    for (const note of line.notes) {
      notes.push({
        type: note.type,
        startMs: beatToMs(note.beat, row.bpm, row.gap),
        endMs: beatToMs(note.beat + note.length, row.bpm, row.gap),
        pitch: note.pitch,
      });
    }
  }

  return notes;
}

// Room control channel: used by both the pantalla principal (role
// "screen") and phones (role "guest"/"singer") to join, pick a song, and
// receive the live connected-users list + a WebSocket-based latency ping.
app.get('/ws/room', { websocket: true }, (socket, req) => {
  let userId = null;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      userId = room.join(socket, { nickname: msg.nickname, role: msg.role });
      socket.send(JSON.stringify({ type: 'welcome', userId }));
      room.broadcastState();
      return;
    }

    // A phone that reloaded or reconnected after a dropped WebSocket
    // (screen lock, brief network blip) reclaims its existing queue
    // position/state instead of starting over as a stranger — see
    // Room.reconnect and DISCONNECT_GRACE_MS in room.js.
    if (msg.type === 'rejoin') {
      const user = room.reconnect(msg.userId, socket);
      if (user) {
        userId = msg.userId;
        socket.send(JSON.stringify({
          type: 'welcome',
          userId,
          rejoined: true,
          role: user.role,
          nickname: user.nickname,
        }));
        room.broadcastState();
      } else {
        socket.send(JSON.stringify({ type: 'rejoinFailed' }));
      }
      return;
    }

    if (!userId) return; // must join before anything else

    if (msg.type === 'chooseSong') {
      const song = getSongById(db, Number(msg.songId));
      const duetMode = msg.duetMode === 'duo' || msg.duetMode === 'solo' ? msg.duetMode : null;
      room.update(userId, {
        songId: song?.id ?? null,
        songTitle: song ? `${song.artist} — ${song.title}` : null,
        duetMode,
      });
      if (song) room.enqueue(userId);
      room.broadcastState();
      return;
    }

    // Phone changes its duo/solo choice for a duet while queued.
    if (msg.type === 'setDuetMode') {
      const duetMode = msg.duetMode === 'duo' || msg.duetMode === 'solo' ? msg.duetMode : null;
      room.update(userId, { duetMode });
      room.broadcastState();
      return;
    }

    // Karaoke: the Sala relays its playback position so phones can sync the
    // lyrics without a scoring channel. Relayed to everyone (tiny payload).
    if (msg.type === 'karaokeProgress') {
      const user = room.users.get(userId);
      if (user?.role !== 'screen') return;
      room.broadcast({ type: 'karaokeProgress', songId: msg.songId, positionMs: msg.positionMs });
      return;
    }

    if (msg.type === 'advanceQueue') {
      room.advanceQueue();
      room.broadcastState();
      return;
    }

    // Sent by the pantalla principal when its <audio> playback for the
    // current turn ends (naturally or via "Volver al catálogo"), so the
    // singer's phone stops capturing mic audio and gets a final score
    // instead of streaming indefinitely.
    if (msg.type === 'endTurn') {
      const user = room.users.get(userId);
      if (user?.role !== 'screen') return;

      // Karaoke participant: no score, no lingering — just remove them so the
      // next turn is clean.
      const target = room.users.get(msg.userId);
      if (target?.role === 'karaoke') {
        room.remove(msg.userId);
        room.broadcastState();
        return;
      }

      const session = activeSingSessions.get(msg.userId);
      if (session) {
        session.stopWithSummary();
      } else if (room.users.has(msg.userId)) {
        // Phone hadn't opened its /ws/sing socket yet (still starting the
        // mic) — don't leave them stuck in "called"/"singing" forever.
        room.abandonTurn(msg.userId);
        room.broadcastState();
      }
      return;
    }

    if (msg.type === 'toggleLowLatency') {
      const user = room.users.get(userId);
      if (user?.role !== 'screen') return; // only the pantalla principal controls this (plan §9)
      room.setLowLatencyMode(msg.enabled);
      room.broadcastState();
      return;
    }

    // The pantalla principal picks the session mode (Karaoke / UltraStar) on
    // the landing, or resets to the picker (mode:null). Phones inherit it.
    if (msg.type === 'setMode') {
      const user = room.users.get(userId);
      if (user?.role !== 'screen') return;
      room.setMode(msg.mode);
      room.broadcastState();
      return;
    }

    // Karaoke mode: the Sala enqueues a phone-less participant (name + song).
    if (msg.type === 'addKaraokeSinger') {
      const user = room.users.get(userId);
      if (user?.role !== 'screen') return;
      const song = getSongById(db, Number(msg.songId));
      if (!song) return;
      room.addKaraokeSinger(msg.nickname, song.id, `${song.artist} — ${song.title}`);
      room.broadcastState();
      return;
    }

    if (msg.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', t0: msg.t0 }));
      return;
    }

    if (msg.type === 'reportLatency') {
      room.update(userId, { latencyMs: msg.ms });
      room.broadcastState();
      return;
    }
  });

  socket.on('close', () => {
    if (!userId) return;
    const user = room.users.get(userId);
    if (!user) return;

    // The pantalla principal doesn't hold a queue position worth saving —
    // it just reconnects as a fresh "Pantalla" entry on its own (app.js) —
    // so only give phones (singer/guest) the reconnect grace period.
    if (user.role === 'screen') {
      room.remove(userId);
      room.broadcastState();
      return;
    }

    room.scheduleDisconnect(userId, () => {
      room.remove(userId);
      room.broadcastState();
    });
    room.broadcastState();
  });
});

const SING_SAMPLE_RATE = 16000;
const FRAME_BYTES = ANALYSIS_WINDOW_SAMPLES * 2; // int16 = 2 bytes/sample

// Scores mic audio from a browser/phone client in-process (used to relay
// to a separate Python engine container; ported to JS so the whole app
// runs as one plain Node process, no Docker required — see pitch.js /
// scoring.js).
app.get('/ws/sing/:songId', { websocket: true }, (socket, req) => {
  const row = getSongById(db, Number(req.params.songId));
  if (!row) {
    socket.close(1008, 'song not found');
    return;
  }

  const roomUserId = req.query.userId || null;
  if (roomUserId) {
    room.update(roomUserId, { songId: row.id, songTitle: `${row.artist} — ${row.title}` });
    room.markSinging(roomUserId);
    room.broadcastState();
  }

  const notes = notesFromSongPayload(buildNotesPayload(row));
  const session = new ScoringSession(notes);
  req.log.info({ notes: notes.length, maxScore: session.maxScore }, 'sing session started');

  let buffer = Buffer.alloc(0);
  let samplesProcessed = 0;
  let stopped = false;

  if (roomUserId) activeSingSessions.set(roomUserId, { stopWithSummary });

  function stopWithSummary() {
    if (stopped) return;
    stopped = true;
    if (roomUserId) activeSingSessions.delete(roomUserId);
    const summary = { type: 'summary', totalScore: session.totalScore, maxScore: session.maxScore };
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(summary));
    if (roomUserId) {
      room.finishTurn(roomUserId, { total: summary.totalScore, max: summary.maxScore });
      room.broadcastState();
    }
  }

  socket.on('message', (data, isBinary) => {
    if (!isBinary) {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'stop') stopWithSummary();
      return;
    }

    buffer = Buffer.concat([buffer, data]);

    while (buffer.length >= FRAME_BYTES) {
      const chunk = buffer.subarray(0, FRAME_BYTES);
      buffer = buffer.subarray(FRAME_BYTES);

      const samples = new Float32Array(ANALYSIS_WINDOW_SAMPLES);
      for (let i = 0; i < ANALYSIS_WINDOW_SAMPLES; i++) {
        samples[i] = chunk.readInt16LE(i * 2) / 32768.0;
      }

      const freq = detectPitch(samples, SING_SAMPLE_RATE);
      samplesProcessed += ANALYSIS_WINDOW_SAMPLES;
      const elapsedMs = (samplesProcessed / SING_SAMPLE_RATE) * 1000.0;

      const result = session.scoreFrame(elapsedMs, freq);
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(result));
    }
  });

  // A client that disconnects without sending "stop" (dropped connection,
  // closed tab) didn't finish the song — mark the turn abandoned rather
  // than crediting a final score, matching the old relay's behavior.
  socket.on('close', () => {
    if (roomUserId) activeSingSessions.delete(roomUserId);
    if (stopped) return;
    if (roomUserId && room.users.get(roomUserId)?.state === 'singing') {
      room.abandonTurn(roomUserId);
      room.broadcastState();
    }
  });
});

try {
  await app.listen({ port: PORT, host: HOST });
  if (certInfo?.type === 'letsencrypt') {
    app.log.info(`HTTPS enabled (Let's Encrypt, trusted) — open https://${certInfo.domain}:${PORT} from the server and every phone`);
  } else if (certInfo?.type === 'self-signed') {
    app.log.info(`HTTPS enabled (self-signed) — open https://${certInfo.lanIp}:${PORT} from the server and every phone`);
  } else {
    app.log.warn('No LAN IP detected and no Let\'s Encrypt domain configured: serving plain HTTP — phone mic capture will NOT work (secure context required).');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
