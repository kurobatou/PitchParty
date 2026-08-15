import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../src/pitch.js';

const SAMPLE_RATE = 16000;
const WINDOW = 2048; // matches the analysis window the server uses

function sine(freqHz, amplitude = 0.5, size = WINDOW, sampleRate = SAMPLE_RATE) {
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

test('detects a 220 Hz tone within ~3%', () => {
  const detected = detectPitch(sine(220), SAMPLE_RATE);
  assert.ok(detected !== null, 'should detect a pitch');
  assert.ok(Math.abs(detected - 220) / 220 < 0.03, `got ${detected}`);
});

test('detects a 440 Hz tone within ~3%', () => {
  const detected = detectPitch(sine(440), SAMPLE_RATE);
  assert.ok(detected !== null);
  assert.ok(Math.abs(detected - 440) / 440 < 0.03, `got ${detected}`);
});

test('returns null for silence (below RMS threshold)', () => {
  assert.equal(detectPitch(new Float32Array(WINDOW), SAMPLE_RATE), null);
  // Very low amplitude counts as silence too.
  assert.equal(detectPitch(sine(220, 0.001), SAMPLE_RATE), null);
});

test('returns null for an empty frame', () => {
  assert.equal(detectPitch(new Float32Array(0), SAMPLE_RATE), null);
});
