import { readFileSync } from 'node:fs';

// True only if the bytes contain at least one non-ASCII byte AND the whole
// buffer is valid UTF-8. A Latin-1/CP1252 file with accents (e.g. é=0xE9,
// which is an invalid UTF-8 lead byte) fails this and falls back to Latin-1,
// while a genuine UTF-8 file (smart quotes “”’, accents, ñ…) passes.
function looksLikeUtf8(buffer) {
  let hasHigh = false;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] >= 0x80) { hasHigh = true; break; }
  }
  if (!hasHigh) return false; // pure ASCII: latin1 and utf8 decode identically
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * UltraStar Deluxe .txt files are historically Latin-1/CP1252, with newer
 * ones opting into UTF-8 via an explicit "#ENCODING:UTF8" tag or a BOM.
 * We peek at the raw bytes to pick the right decoding instead of assuming one.
 */
export function readUsdxTxtFile(path) {
  const buffer = readFileSync(path);

  let text;
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    text = buffer.toString('utf8');
  } else {
    const preview = buffer.toString('latin1', 0, Math.min(buffer.length, 2000));
    const match = preview.match(/#ENCODING:\s*(\S+)/i);
    const declared = match?.[1]?.toUpperCase() ?? '';
    if (declared.includes('UTF8') || declared.includes('UTF-8')) {
      text = buffer.toString('utf8'); // explicit UTF-8
    } else if (declared) {
      text = buffer.toString('latin1'); // explicit non-UTF-8 (CP1252/ANSI/ISO…)
    } else {
      // No BOM and no #ENCODING tag: sniff. Many real-world UTF-8 files ship
      // without either (saved from a plain editor), so trust valid UTF-8.
      text = looksLikeUtf8(buffer) ? buffer.toString('utf8') : buffer.toString('latin1');
    }
  }

  // A UTF-8 BOM decodes to a U+FEFF character glued to the front of the
  // first line, which would break the "#TITLE:" tag detection (the parser
  // checks the line starts with "#"). Strip it so BOM'd files parse.
  return text.replace(/^\uFEFF/, '');
}
