import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig } from './config.js';
import { openDb, listSongs, getSongById } from './db.js';
import { reindexLibrary } from './indexer.js';
import { parseUsdxTxt } from './usdxParser.js';
import { readUsdxTxtFile } from './txtEncoding.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });
const db = openDb();
const config = loadConfig();

reindexLibrary(db, config.libraryPaths, app.log);

await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

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

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
