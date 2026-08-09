import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseUsdxTxt } from './usdxParser.js';
import { readUsdxTxtFile } from './txtEncoding.js';
import { upsertSong, removeMissingSongs, listSongs } from './db.js';

// Non-song .txt files that show up in real UltraStar libraries.
const JUNK_TXT = /^(readme|leeme|lisezmoi|liesmich|info|www\.)/i;

// A song folder often has several .txt files: duplicates ("Song (2).txt"),
// alternate versions ("Song [MULTI].txt"), and plain junk (readmes). Return
// the plausible song candidates, best first, so the caller can try each and
// keep the first that actually parses — this survives a wrong/blank/phantom
// file instead of blindly trusting whatever readdir lists first.
function txtCandidates(folderAbsPath) {
  const names = readdirSync(folderAbsPath).filter(
    (name) =>
      name.toLowerCase().endsWith('.txt') &&
      !name.startsWith('._') && // macOS AppleDouble sidecar (binary, not a song)
      !JUNK_TXT.test(name),
  );
  // Prefer the .txt whose name matches the folder (the canonical one) over
  // "(2)"/"[MULTI]" variants.
  const folderBase = basename(folderAbsPath).toLowerCase();
  return names.sort((a, b) => {
    const am = a.toLowerCase().startsWith(folderBase) ? 0 : 1;
    const bm = b.toLowerCase().startsWith(folderBase) ? 0 : 1;
    return am - bm || a.length - b.length;
  });
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

  // Pre-count song folders so we can report progress. On a big NAS library the
  // scan takes many seconds; without this the startup log looks frozen. We
  // report by percentage (not names) just to prove the process is alive.
  const roots = libraryPaths.filter((root) => existsSync(root));
  const totalFolders = roots.reduce((sum, root) => {
    try {
      return sum + readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    } catch {
      return sum;
    }
  }, 0);
  let processed = 0;
  let nextProgressPct = 10; // log at 10%, 20%, ... 90%
  const reportProgress = () => {
    if (totalFolders === 0) return;
    const pct = Math.floor((processed / totalFolders) * 100);
    if (pct >= nextProgressPct && pct < 100) {
      logger.info?.(`[indexer] escaneando... ${pct}% (${processed}/${totalFolders} carpetas, ${indexed} indexadas)`);
      nextProgressPct = Math.floor(pct / 10) * 10 + 10;
    }
  };

  for (const root of libraryPaths) {
    if (!existsSync(root)) {
      logger.warn?.(`[indexer] library root not found, skipping: ${root}`);
      continue;
    }

    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      processed += 1;
      reportProgress();
      const folderAbsPath = join(root, entry.name);

      try {
        const candidates = txtCandidates(folderAbsPath);
        if (candidates.length === 0) {
          skipped += 1;
          continue;
        }

        // Try each candidate; keep the first that reads and parses to a real
        // song (title + bpm). A candidate that throws (e.g. a phantom
        // "(2).txt" that readdir lists but can't be opened on a NAS) or that
        // lacks tags just falls through to the next one.
        //
        // When a folder ships both a solo and a duet arrangement (e.g.
        // "Song.txt" + "Song [MULTI].txt"), prefer the DUET one so the Sala
        // shows the song as it really is (two colored voices). We keep the
        // first valid candidate as a fallback but upgrade to a duet as soon as
        // we find one.
        let txtAbsPath = null;
        let parsed = null;
        for (const name of candidates) {
          const candidatePath = join(folderAbsPath, name);
          try {
            const candidateParsed = parseUsdxTxt(readUsdxTxtFile(candidatePath));
            if (candidateParsed.meta.title && candidateParsed.meta.bpm) {
              if (!parsed) {
                txtAbsPath = candidatePath;
                parsed = candidateParsed;
              }
              if (candidateParsed.meta.isDuet) {
                txtAbsPath = candidatePath;
                parsed = candidateParsed;
                break;
              }
            }
          } catch {
            // unreadable candidate — try the next one
          }
        }

        if (!parsed) {
          logger.warn?.(`[indexer] no usable .txt (title/bpm), skipping: ${folderAbsPath}`);
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
