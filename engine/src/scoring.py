"""Compares detected pitch against a song's expected notes and accumulates
a score, mirroring UltraStar Deluxe's convention: only 'normal' and 'golden'
notes are scored, 'freestyle'/'rap' lines are for display only.

USDX pitch values are relative semitones with 0 approximated as MIDI 60 (C4).
This mapping is a reasonable V1 approximation; refining it against real
UltraStar scoring behavior is an open question for a later phase.
"""
import math

SCORABLE_TYPES = {'normal', 'golden'}
HIT_TOLERANCE_SEMITONES = 2.5
GOLDEN_POINTS = 2
NORMAL_POINTS = 1


def freq_to_midi(freq_hz: float) -> float:
    return 69.0 + 12.0 * math.log2(freq_hz / 440.0)


def usdx_pitch_to_midi(pitch: int) -> float:
    return pitch + 60.0


def pitch_class_diff(detected_midi: float, expected_midi: float) -> float:
    """Semitone distance ignoring octave. A simple autocorrelation detector
    (and singers whose comfortable range sits an octave from the original
    recording) commonly land the right note in the wrong octave — without
    this, that scores zero despite being musically "in tune"."""
    diff = abs(detected_midi - expected_midi) % 12
    return min(diff, 12 - diff)


class ScoringSession:
    """Tracks scoring progress for one singer across a stream of frames.

    `notes` must be pre-sorted by start_ms and contain only scorable notes:
    [{start_ms, end_ms, pitch_midi, points}, ...]
    """

    def __init__(self, notes: list[dict]):
        self.notes = notes
        self.cursor = 0
        self.total_score = 0
        self.max_score = 0

    def _advance_cursor(self, elapsed_ms: float):
        while (self.cursor < len(self.notes)
               and self.notes[self.cursor]['end_ms'] < elapsed_ms):
            self.cursor += 1

    def score_frame(self, elapsed_ms: float, detected_freq_hz: float | None) -> dict:
        self._advance_cursor(elapsed_ms)

        expected = None
        if self.cursor < len(self.notes):
            note = self.notes[self.cursor]
            if note['start_ms'] <= elapsed_ms <= note['end_ms']:
                expected = note

        detected_midi = freq_to_midi(detected_freq_hz) if detected_freq_hz else None
        hit = False
        points = 0

        if expected is not None:
            self.max_score += expected['points']
            if detected_midi is not None:
                diff = pitch_class_diff(detected_midi, expected['pitch_midi'])
                if diff <= HIT_TOLERANCE_SEMITONES:
                    hit = True
                    points = expected['points']
                    self.total_score += points

        return {
            'type': 'frame',
            'elapsedMs': elapsed_ms,
            'detectedMidi': detected_midi,
            'expectedMidi': expected['pitch_midi'] if expected else None,
            'hit': hit,
            'points': points,
            'totalScore': self.total_score,
            'maxScore': self.max_score,
        }


def notes_from_song_payload(raw_notes: list[dict]) -> list[dict]:
    """Converts the note list sent by the Node server (USDX line/notes shape)
    into flat scorable notes with absolute ms timing and point values."""
    scorable = []
    for note in raw_notes:
        if note.get('type') not in SCORABLE_TYPES:
            continue
        points = GOLDEN_POINTS if note['type'] == 'golden' else NORMAL_POINTS
        scorable.append({
            'start_ms': note['startMs'],
            'end_ms': note['endMs'],
            'pitch_midi': usdx_pitch_to_midi(note['pitch']),
            'points': points,
        })
    scorable.sort(key=lambda n: n['start_ms'])
    return scorable
