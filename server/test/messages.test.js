import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessagePayload, MESSAGE_TYPES } from '../src/messages.js';

test('rejects a missing or unknown type', () => {
  assert.equal(validateMessagePayload({}).ok, false);
  assert.equal(validateMessagePayload({ type: 'nonsense' }).ok, false);
});

test('bug: requires non-empty text, trims it, carries nickname', () => {
  assert.equal(validateMessagePayload({ type: 'bug' }).ok, false);
  assert.equal(validateMessagePayload({ type: 'bug', text: '   ' }).ok, false);

  const result = validateMessagePayload({ type: 'bug', text: '  se traba el botón  ', nickname: 'Ana' });
  assert.deepEqual(result, {
    ok: true,
    value: { type: 'bug', text: 'se traba el botón', nickname: 'Ana' },
  });
});

test('general: same rules as bug', () => {
  assert.equal(validateMessagePayload({ type: 'general' }).ok, false);
  const result = validateMessagePayload({ type: 'general', text: 'lindo el sistema' });
  assert.deepEqual(result, { ok: true, value: { type: 'general', text: 'lindo el sistema', nickname: null } });
});

test('sync: requires a numeric songId, text is optional', () => {
  assert.equal(validateMessagePayload({ type: 'sync' }).ok, false);
  assert.equal(validateMessagePayload({ type: 'sync', songId: 'nope' }).ok, false);
  assert.equal(validateMessagePayload({ type: 'sync', songId: 0 }).ok, false);
  assert.equal(validateMessagePayload({ type: 'sync', songId: -3 }).ok, false);

  const noText = validateMessagePayload({ type: 'sync', songId: '12' });
  assert.deepEqual(noText, { ok: true, value: { type: 'sync', songId: 12, text: null, nickname: null } });

  const withText = validateMessagePayload({ type: 'sync', songId: 12, text: 'la letra va adelantada' });
  assert.equal(withText.value.text, 'la letra va adelantada');
});

test('song_request: requires requestedTitle, artist and note are optional', () => {
  assert.equal(validateMessagePayload({ type: 'song_request' }).ok, false);
  assert.equal(validateMessagePayload({ type: 'song_request', requestedTitle: '  ' }).ok, false);

  const titleOnly = validateMessagePayload({ type: 'song_request', requestedTitle: 'Bohemian Rhapsody' });
  assert.deepEqual(titleOnly, {
    ok: true,
    value: { type: 'song_request', requestedTitle: 'Bohemian Rhapsody', requestedArtist: null, text: null, nickname: null },
  });

  const full = validateMessagePayload({
    type: 'song_request', requestedTitle: 'Bohemian Rhapsody', requestedArtist: 'Queen', text: 'la de siempre',
  });
  assert.equal(full.value.requestedArtist, 'Queen');
  assert.equal(full.value.text, 'la de siempre');
});

test('nickname is trimmed and capped at 40 chars', () => {
  const long = 'x'.repeat(60);
  const result = validateMessagePayload({ type: 'general', text: 'hola', nickname: `  ${long}  ` });
  assert.equal(result.value.nickname, long.slice(0, 40));
  assert.equal(validateMessagePayload({ type: 'general', text: 'hola', nickname: '' }).value.nickname, null);
});

test('MESSAGE_TYPES exposes the four known kinds', () => {
  assert.deepEqual(MESSAGE_TYPES, ['bug', 'sync', 'general', 'song_request']);
});
