// Pure validation for the "send a message from the phone" feature (see
// docs on the `messages` table in db.js). Kept dependency-free so it's
// unit-testable without touching SQLite — server/src/index.js is the one
// that resolves a `sync` report's songId against the real catalog
// (getSongById) and actually persists the row (insertMessage).

export const MESSAGE_TYPES = ['bug', 'sync', 'general', 'song_request'];

const NICKNAME_MAX_LEN = 40;

function trimmedOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validateMessagePayload(body) {
  const type = body?.type;
  if (!MESSAGE_TYPES.includes(type)) {
    return { ok: false, error: `type must be one of: ${MESSAGE_TYPES.join(', ')}` };
  }

  const nickname = trimmedOrNull(body?.nickname)?.slice(0, NICKNAME_MAX_LEN) ?? null;

  if (type === 'bug' || type === 'general') {
    const text = trimmedOrNull(body?.text);
    if (!text) return { ok: false, error: 'text is required' };
    return { ok: true, value: { type, text, nickname } };
  }

  if (type === 'sync') {
    const songId = Number(body?.songId);
    if (!Number.isFinite(songId) || songId <= 0) {
      return { ok: false, error: 'songId is required' };
    }
    const text = trimmedOrNull(body?.text);
    return { ok: true, value: { type, songId, text, nickname } };
  }

  // song_request
  const requestedTitle = trimmedOrNull(body?.requestedTitle);
  if (!requestedTitle) return { ok: false, error: 'requestedTitle is required' };
  const requestedArtist = trimmedOrNull(body?.requestedArtist);
  const text = trimmedOrNull(body?.text);
  return { ok: true, value: { type, requestedTitle, requestedArtist, text, nickname } };
}
