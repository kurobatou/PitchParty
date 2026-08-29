// Shared between join.js (send a message) and messages.js (review them) so
// the four kinds and their labels/emoji live in one place. Mirrors the
// `type` values validated server-side in server/src/messages.js.
export const MESSAGE_TYPES = [
  { id: 'bug', emoji: '🐞', label: 'Bug de la interfaz' },
  { id: 'sync', emoji: '🎵', label: 'Canción con mala sincronización' },
  { id: 'general', emoji: '💬', label: 'Mensaje general' },
  { id: 'song_request', emoji: '🎤', label: 'Pedir canción/artista' },
];

export function messageTypeInfo(id) {
  return MESSAGE_TYPES.find((t) => t.id === id) ?? { id, emoji: '❓', label: id };
}
