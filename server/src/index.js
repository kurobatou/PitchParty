import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from './config.js';
import { openDb, listSongs, getSongById } from './db.js';
import { reindexLibrary } from './indexer.js';
import { parseUsdxTxt, beatToMs } from './usdxParser.js';
import { readUsdxTxtFile } from './txtEncoding.js';
import { Room } from './room.js';
import { getOrCreateCert } from './tls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const ENGINE_WS_URL = process.env.ENGINE_WS_URL ?? 'ws://engine:8765';
const LAN_IP = process.env.SERVER_LAN_IP;

// Mic capture (getUserMedia) only works in a "secure context": HTTPS or
// localhost. Phones on the LAN need the former, so when a LAN IP is
// configured we serve everything over HTTPS with a self-signed cert
// instead of plain HTTP (see tls.js for why).
const app = Fastify({
  logger: true,
  https: LAN_IP ? getOrCreateCert(LAN_IP) : undefined,
});
const db = openDb();
const config = loadConfig();
const room = new Room();

reindexLibrary(db, config.libraryPaths, app.log);

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
  };
});

app.post('/api/reindex', async () => {
  return reindexLibrary(db, config.libraryPaths, app.log);
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

    if (!userId) return; // must join before anything else

    if (msg.type === 'chooseSong') {
      const song = getSongById(db, Number(msg.songId));
      room.update(userId, {
        songId: song?.id ?? null,
        songTitle: song ? `${song.artist} — ${song.title}` : null,
      });
      if (song) room.enqueue(userId);
      room.broadcastState();
      return;
    }

    if (msg.type === 'advanceQueue') {
      room.advanceQueue();
      room.broadcastState();
      return;
    }

    if (msg.type === 'toggleLowLatency') {
      const user = room.users.get(userId);
      if (user?.role !== 'screen') return; // only the pantalla principal controls this (plan §9)
      room.setLowLatencyMode(msg.enabled);
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
    if (userId) {
      room.remove(userId);
      room.broadcastState();
    }
  });
});

// Proxies mic audio from a browser/phone client to the Python scoring
// engine, and relays score messages back. Kept as a thin relay so the
// engine (and its scoring logic) stays fully containerized and reusable
// across client types (test page now, phone PWA in Fase 2).
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

  const notes = buildNotesPayload(row);
  const engineSocket = new WebSocket(ENGINE_WS_URL);
  const pending = [];
  let engineReady = false;
  let clientClosed = false;
  let summaryReceived = false;

  engineSocket.on('open', () => {
    engineReady = true;
    engineSocket.send(JSON.stringify({ type: 'start', sampleRate: 16000, notes }));
    for (const msg of pending) engineSocket.send(msg);
    pending.length = 0;
  });

  engineSocket.on('message', (data) => {
    const text = data.toString();
    if (socket.readyState === WebSocket.OPEN) socket.send(text);

    if (roomUserId) {
      try {
        const parsed = JSON.parse(text);
        if (parsed.type === 'summary') {
          summaryReceived = true;
          room.finishTurn(roomUserId, { total: parsed.totalScore, max: parsed.maxScore });
          room.broadcastState();
          if (engineSocket.readyState === WebSocket.OPEN) engineSocket.close();
        }
      } catch {
        // ignore non-JSON/unexpected engine messages
      }
    }
  });

  engineSocket.on('close', () => {
    if (!clientClosed && socket.readyState === WebSocket.OPEN) socket.close();
  });

  engineSocket.on('error', (err) => {
    req.log.error({ err }, 'engine socket error');
  });

  socket.on('message', (data) => {
    if (!engineReady) {
      pending.push(data);
      return;
    }
    engineSocket.send(data);
  });

  socket.on('close', () => {
    clientClosed = true;
    if (engineSocket.readyState === WebSocket.OPEN) {
      engineSocket.send(JSON.stringify({ type: 'stop' }));
      // Give the engine a moment to reply with "summary" before giving up
      // on it and closing — closing immediately would race the reply.
      setTimeout(() => {
        if (engineSocket.readyState === WebSocket.OPEN) engineSocket.close();
      }, 1500);
    }
    if (roomUserId) {
      setTimeout(() => {
        if (!summaryReceived && room.users.get(roomUserId)?.state === 'singing') {
          room.abandonTurn(roomUserId);
          room.broadcastState();
        }
      }, 1500);
    }
  });
});

try {
  await app.listen({ port: PORT, host: HOST });
  if (LAN_IP) {
    app.log.info(`HTTPS enabled (self-signed) — open https://${LAN_IP}:${PORT} from the server and every phone`);
  } else {
    app.log.warn('SERVER_LAN_IP not set: serving plain HTTP — phone mic capture will NOT work (secure context required). See .env.example.');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
