import { readFileSync } from 'node:fs';

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
    const isUtf8 = declared.includes('UTF8') || declared.includes('UTF-8');
    text = buffer.toString(isUtf8 ? 'utf8' : 'latin1');
  }

  // A UTF-8 BOM decodes to a U+FEFF character glued to the front of the
  // first line, which would break the "#TITLE:" tag detection (the parser
  // checks the line starts with "#"). Strip it so BOM'd files parse.
  return text.replace(/^\uFEFF/, '');
}
