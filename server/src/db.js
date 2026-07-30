import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const DB_PATH = process.env.DB_PATH ?? join(DEFAULT_DATA_DIR, 'karaoke.db');

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_path TEXT UNIQUE NOT NULL,
      source_root TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      language TEXT,
      year INTEGER,
      bpm REAL NOT NULL,
      gap REAL NOT NULL,
      videogap REAL NOT NULL DEFAULT 0,
      txt_path TEXT NOT NULL,
      mp3_path TEXT,
      cover_path TEXT,
      video_path TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

export function upsertSong(db, song) {
  db.prepare(`
    INSERT INTO songs (
      folder_path, source_root, title, artist, language, year,
      bpm, gap, videogap, txt_path, mp3_path, cover_path, video_path, updated_at
    ) VALUES (
      @folder_path, @source_root, @title, @artist, @language, @year,
      @bpm, @gap, @videogap, @txt_path, @mp3_path, @cover_path, @video_path, datetime('now')
    )
    ON CONFLICT(folder_path) DO UPDATE SET
      source_root = excluded.source_root,
      title = excluded.title,
      artist = excluded.artist,
      language = excluded.language,
      year = excluded.year,
      bpm = excluded.bpm,
      gap = excluded.gap,
      videogap = excluded.videogap,
      txt_path = excluded.txt_path,
      mp3_path = excluded.mp3_path,
      cover_path = excluded.cover_path,
      video_path = excluded.video_path,
      updated_at = datetime('now')
  `).run(song);
}

export function removeMissingSongs(db, keepFolderPaths) {
  const existing = db.prepare('SELECT id, folder_path FROM songs').all();
  const toRemove = existing.filter((row) => !keepFolderPaths.has(row.folder_path));
  if (toRemove.length === 0) return 0;
  const stmt = db.prepare('DELETE FROM songs WHERE id = ?');
  const tx = db.transaction((rows) => {
    for (const row of rows) stmt.run(row.id);
  });
  tx(toRemove);
  return toRemove.length;
}

export function listSongs(db) {
  return db.prepare('SELECT * FROM songs ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE').all();
}

export function getSongById(db, id) {
  return db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
}
