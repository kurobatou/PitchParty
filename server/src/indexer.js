import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseUsdxTxt } from './usdxParser.js';
import { readUsdxTxtFile } from './txtEncoding.js';
import { upsertSong, removeMissingSongs, listSongs } from './db.js';

function findTxtFile(folderAbsPath) {
  const entries = readdirSync(folderAbsPath);
  // Skip macOS AppleDouble sidecar files ("._Song.txt") that appear on
  // non-native volumes (e.g. a NAS) — they're binary metadata, not songs.
  return entries.find((name) => name.toLowerCase().endsWith('.txt') && !name.startsWith('._')) ?? null;
}

function resolveAssetPath(folderAbsPath, fileName) {
  if (!fileName) return null;
  const candidate = join(folderAbsPath, fileName);
  return existsSync(candidate) ? candidate : null;
}

/**
 * Scans every configured library root (one folder per song, non-recursive
 * below the root) and rebuilds the SQLite catalog. Multiple roots (local
 * folder, NAS mount, ...) are merged into a single catalog, keyed by the
 * song's absolute folder path so re-scans update rather than duplicate.
 */
export function reindexLibrary(db, libraryPaths, logger = console) {
  const keepFolderPaths = new Set();
  let indexed = 0;
  let skipped = 0;

  for (const root of libraryPaths) {
    if (!existsSync(root)) {
      logger.warn?.(`[indexer] library root not found, skipping: ${root}`);
      continue;
    }

    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderAbsPath = join(root, entry.name);

      try {
        const txtFileName = findTxtFile(folderAbsPath);
        if (!txtFileName) {
          skipped += 1;
          continue;
        }

        const txtAbsPath = join(folderAbsPath, txtFileName);
        const raw = readUsdxTxtFile(txtAbsPath);
        const parsed = parseUsdxTxt(raw);

        if (!parsed.meta.title || !parsed.meta.bpm) {
          logger.warn?.(`[indexer] missing title/bpm, skipping: ${txtAbsPath}`);
          skipped += 1;
          continue;
        }

        upsertSong(db, {
          folder_path: folderAbsPath,
          source_root: root,
          title: parsed.meta.title,
          artist: parsed.meta.artist,
          language: parsed.meta.language,
          year: parsed.meta.year,
          bpm: parsed.meta.bpm,
          gap: parsed.meta.gap,
          videogap: parsed.meta.videogap,
          txt_path: txtAbsPath,
          mp3_path: resolveAssetPath(folderAbsPath, parsed.meta.mp3),
          cover_path: resolveAssetPath(folderAbsPath, parsed.meta.cover),
          video_path: resolveAssetPath(folderAbsPath, parsed.meta.video),
        });

        keepFolderPaths.add(folderAbsPath);
        indexed += 1;
      } catch (err) {
        logger.warn?.(`[indexer] failed to index ${folderAbsPath}: ${err.message}`);
        skipped += 1;
      }
    }
  }

  const removed = removeMissingSongs(db, keepFolderPaths);
  logger.info?.(`[indexer] indexed=${indexed} skipped=${skipped} removed=${removed}`);

  return { indexed, skipped, removed, total: listSongs(db).length };
}
