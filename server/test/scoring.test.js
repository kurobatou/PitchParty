import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freqToMidi,
  usdxPitchToMidi,
  pitchClassDiff,
  notesFromSongPayload,
  ScoringSession,
} from '../src/scoring.js';

// MIDI note 69 == A4 == 440 Hz; each octave doubles the frequency.
test('freqToMidi maps 440 Hz to 69 and 880 Hz to 81', () => {
  assert.equal(Math.round(freqToMidi(440)), 69);
  assert.equal(Math.round(freqToMidi(880)), 81);
});

test('usdxPitchToMidi anchors relative 0 at MIDI 60 (C4)', () => {
  assert.equal(usdxPitchToMidi(0), 60);
  assert.equal(usdxPitchToMidi(12), 72);
});

test('pitchClassDiff ignores octave and wraps around', () => {
  assert.equal(pitchClassDiff(60, 72), 0); // same class, octave apart
  assert.equal(pitchClassDiff(60, 61), 1);
  assert.equal(pitchClassDiff(60, 59), 1);
  assert.equal(pitchClassDiff(60, 66), 6); // tritone: max distance
  assert.equal(pitchClassDiff(60, 67), 5); // wraps: min(7, 5)
});

test('notesFromSongPayload keeps only scorable notes, assigns points, sorts', () => {
  const raw = [
    { type: 'golden', startMs: 500, endMs: 900, pitch: 2 },
    { type: 'freestyle', startMs: 0, endMs: 100, pitch: 0 },
    { type: 'normal', startMs: 0, endMs: 400, pitch: 0 },
    { type: 'rap', startMs: 1000, endMs: 1200, pitch: 0 },
  ];
  const notes = notesFromSongPayload(raw);
  assert.equal(notes.length, 2, 'only normal + golden are scorable');
  assert.deepEqual(notes.map((n) => n.startMs), [0, 500], 'sorted by startMs');
  assert.equal(notes[0].points, 1); // normal
  assert.equal(notes[1].points, 2); // golden
  assert.equal(notes[0].pitchMidi, 60); // usdx 0 -> MIDI 60
});

function singleNote(overrides = {}) {
  return notesFromSongPayload([{ type: 'normal', startMs: 0, endMs: 1000, pitch: 0, ...overrides }]);
}

test('scoreFrame: in-tune frame within the note window scores a hit', () => {
  const s = new ScoringSession(singleNote()); // expects MIDI 60 (~261.6 Hz)
  const r = s.scoreFrame(500, 261.6);
  assert.equal(r.hit, true);
  assert.equal(r.points, 1);
  assert.equal(r.totalScore, 1);
  assert.equal(r.maxScore, 1);
  assert.equal(r.expectedMidi, 60);
});

test('scoreFrame: out-of-tune frame still counts toward maxScore only', () => {
  const s = new ScoringSession(singleNote());
  const r = s.scoreFrame(500, 440); // MIDI ~69, far from 60
  assert.equal(r.hit, false);
  assert.equal(r.totalScore, 0);
  assert.equal(r.maxScore, 1);
});

test('scoreFrame: silence (null freq) during a note is no hit but counts maxScore', () => {
  const s = new ScoringSession(singleNote());
  const r = s.scoreFrame(500, null);
  assert.equal(r.detectedMidi, null);
  assert.equal(r.hit, false);
  assert.equal(r.maxScore, 1);
});

test('scoreFrame: no active note -> expectedMidi null and maxScore unchanged', () => {
  const s = new ScoringSession(singleNote({ startMs: 2000, endMs: 3000 }));
  const r = s.scoreFrame(500, 261.6);
  assert.equal(r.expectedMidi, null);
  assert.equal(r.maxScore, 0);
});

test('scoreFrame: right note class an octave off still hits (tolerance)', () => {
  const s = new ScoringSession(singleNote()); // expects MIDI 60
  const r = s.scoreFrame(500, 523.25); // C5, MIDI ~72 — same class, octave up
  assert.equal(r.hit, true);
});

test('scoreFrame: cursor advances past ended notes', () => {
  const notes = notesFromSongPayload([
    { type: 'normal', startMs: 0, endMs: 400, pitch: 0 },
    { type: 'normal', startMs: 500, endMs: 900, pitch: 0 },
  ]);
  const s = new ScoringSession(notes);
  const r = s.scoreFrame(700, 261.6); // past the first note, inside the second
  assert.equal(r.hit, true);
  assert.equal(s.cursor, 1);
});
