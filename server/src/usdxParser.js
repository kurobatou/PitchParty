const NOTE_TYPES = {
  ':': 'normal',
  '*': 'golden',
  'F': 'freestyle',
  'R': 'rap',
  'G': 'rapgolden',
};

function parseNumber(value) {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parses the raw text of a UltraStar Deluxe .txt song file into structured
 * metadata + lyric/note lines. Only single-BPM songs are handled precisely;
 * mid-song BPM changes ("B" lines) are recorded but not applied to timing yet.
 */
export function parseUsdxTxt(rawText) {
  const lines = rawText.split(/\r?\n/);

  const meta = {};
  const lyricLines = [];
  let currentLine = null;
  const bpmChanges = [];
  let relative = false;
  let relativeOffset = 0;

  const pushCurrentLine = () => {
    if (currentLine && currentLine.notes.length > 0) {
      lyricLines.push(currentLine);
    }
    currentLine = null;
  };

  for (const line of lines) {
    if (line.length === 0) continue;

    if (line.startsWith('#')) {
      const sepIndex = line.indexOf(':');
      if (sepIndex === -1) continue;
      const key = line.slice(1, sepIndex).trim().toUpperCase();
      const value = line.slice(sepIndex + 1).trim();
      meta[key] = value;
      if (key === 'RELATIVE' && value.toLowerCase() === 'yes') relative = true;
      continue;
    }

    const type = line[0];

    if (type === 'E') {
      break;
    }

    if (type === '-') {
      pushCurrentLine();
      const parts = line.slice(1).trim().split(/\s+/).map(parseNumber);
      const breakBeat = relative ? parts[0] + relativeOffset : parts[0];
      lyricLines.push({ type: 'linebreak', breakBeat });
      if (relative && parts.length > 1) {
        relativeOffset += parts[1];
      }
      continue;
    }

    if (type === 'B') {
      const [, beat, bpm] = line.trim().split(/\s+/);
      bpmChanges.push({ beat: parseNumber(beat), bpm: parseNumber(bpm) });
      continue;
    }

    if (NOTE_TYPES[type]) {
      const rest = line.slice(1).trim();
      const match = rest.match(/^(-?\d+)\s+(-?\d+)\s+(-?\d+)\s?(.*)$/);
      if (!match) continue;
      const [, beatStr, lengthStr, pitchStr, text] = match;
      const beat = parseNumber(beatStr) + (relative ? relativeOffset : 0);
      const note = {
        type: NOTE_TYPES[type],
        beat,
        length: parseNumber(lengthStr),
        pitch: parseNumber(pitchStr),
        text,
      };
      if (!currentLine) currentLine = { type: 'lyrics', notes: [] };
      currentLine.notes.push(note);
      continue;
    }
  }
  pushCurrentLine();

  const bpm = parseNumber(meta.BPM);
  const gap = parseNumber(meta.GAP);

  return {
    meta: {
      title: meta.TITLE ?? '',
      artist: meta.ARTIST ?? '',
      language: meta.LANGUAGE ?? null,
      edition: meta.EDITION ?? null,
      genre: meta.GENRE ?? null,
      year: meta.YEAR ? parseNumber(meta.YEAR) : null,
      bpm,
      gap,
      videogap: meta.VIDEOGAP ? parseNumber(meta.VIDEOGAP) : 0,
      mp3: meta.MP3 ?? null,
      cover: meta.COVER ?? null,
      video: meta.VIDEO ?? null,
      background: meta.BACKGROUND ?? null,
    },
    bpmChanges,
    lines: lyricLines,
  };
}

/**
 * Converts a beat number to milliseconds from the start of playback, using
 * the single-BPM formula UltraStar Deluxe files rely on: each beat is a
 * sixteenth note at the given (quadrupled) BPM, offset by GAP milliseconds.
 */
export function beatToMs(beat, bpm, gap) {
  const msPerBeat = 60000 / (bpm * 4);
  return gap + beat * msPerBeat;
}
