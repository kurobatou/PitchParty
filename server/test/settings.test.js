import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMicMonitor } from '../src/settings.js';

test('normalizeMicMonitor fills sane defaults from null/undefined', () => {
  assert.deepEqual(normalizeMicMonitor(null), {
    enabled: false,
    deviceId: null,
    musicVolume: 70,
  });
});

test('normalizeMicMonitor coerces and clamps musicVolume to 0..100', () => {
  assert.equal(normalizeMicMonitor({ musicVolume: 250 }).musicVolume, 100);
  assert.equal(normalizeMicMonitor({ musicVolume: -30 }).musicVolume, 0);
  assert.equal(normalizeMicMonitor({ musicVolume: 42 }).musicVolume, 42);
  assert.equal(normalizeMicMonitor({ musicVolume: 'nope' }).musicVolume, 70);
});

test('normalizeMicMonitor normalizes enabled and deviceId', () => {
  assert.equal(normalizeMicMonitor({ enabled: 1 }).enabled, true);
  assert.equal(normalizeMicMonitor({ deviceId: '' }).deviceId, null);
  assert.equal(normalizeMicMonitor({ deviceId: 'mic-1' }).deviceId, 'mic-1');
  assert.equal(normalizeMicMonitor({ deviceId: 123 }).deviceId, null);
});
