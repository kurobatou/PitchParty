// Compares detected pitch against a song's expected notes and accumulates
// a score, mirroring UltraStar Deluxe's convention: only 'normal' and
// 'golden' notes are scored, 'freestyle'/'rap' lines are for display only.
//
// USDX pitch values are relative semitones with 0 approximated as MIDI 60
// (C4). This mapping is a reasonable V1 approximation. Ported from the
// original Python engine (engine/src/scoring.py).

const SCORABLE_TYPES = new Set(['normal', 'golden']);
const HIT_TOLERANCE_SEMITONES = 2.5;
const GOLDEN_POINTS = 2;
const NORMAL_POINTS = 1;

export function freqToMidi(freqHz) {
  return 69.0 + 12.0 * Math.log2(freqHz / 440.0);
}

export function usdxPitchToMidi(pitch) {
  return pitch + 60.0;
}

// Semitone distance ignoring octave. A simple autocorrelation detector
// (and singers whose comfortable range sits an octave from the original
// recording) commonly land the right note in the wrong octave — without
// this, that scores zero despite being musically "in tune".
export function pitchClassDiff(detectedMidi, expectedMidi) {
  const diff = Math.abs(detectedMidi - expectedMidi) % 12;
  return Math.min(diff, 12 - diff);
}

export class ScoringSession {
  constructor(notes) {
    this.notes = notes; // pre-sorted by start_ms, only scorable notes
    this.cursor = 0;
    this.totalScore = 0;
    this.maxScore = 0;
  }

  _advanceCursor(elapsedMs) {
    while (this.cursor < this.notes.length && this.notes[this.cursor].endMs < elapsedMs) {
      this.cursor += 1;
    }
  }

  scoreFrame(elapsedMs, detectedFreqHz) {
    this._advanceCursor(elapsedMs);

    let expected = null;
    if (this.cursor < this.notes.length) {
      const note = this.notes[this.cursor];
      if (note.startMs <= elapsedMs && elapsedMs <= note.endMs) {
        expected = note;
      }
    }

    const detectedMidi = detectedFreqHz ? freqToMidi(detectedFreqHz) : null;
    let hit = false;
    let points = 0;

    if (expected !== null) {
      this.maxScore += expected.points;
      if (detectedMidi !== null) {
        const diff = pitchClassDiff(detectedMidi, expected.pitchMidi);
        if (diff <= HIT_TOLERANCE_SEMITONES) {
          hit = true;
          points = expected.points;
          this.totalScore += points;
        }
      }
    }

    return {
      type: 'frame',
      elapsedMs,
      detectedMidi,
      expectedMidi: expected ? expected.pitchMidi : null,
      hit,
      points,
      totalScore: this.totalScore,
      maxScore: this.maxScore,
    };
  }
}

// Converts the note list built from USDX line/notes shape (see
// buildNotesPayload in index.js) into flat scorable notes with absolute
// ms timing and point values.
export function notesFromSongPayload(rawNotes) {
  const scorable = [];
  for (const note of rawNotes) {
    if (!SCORABLE_TYPES.has(note.type)) continue;
    const points = note.type === 'golden' ? GOLDEN_POINTS : NORMAL_POINTS;
    scorable.push({
      startMs: note.startMs,
      endMs: note.endMs,
      pitchMidi: usdxPitchToMidi(note.pitch),
      points,
    });
  }
  scorable.sort((a, b) => a.startMs - b.startMs);
  return scorable;
}
