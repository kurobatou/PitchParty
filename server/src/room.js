import { randomUUID } from 'node:crypto';

export const MAX_ACTIVE_SINGERS = 4;

/**
 * Single in-memory "room" for the active session (V1 has no multi-room,
 * no persistence — see plan §12). Tracks connected phones/screens, the
 * turn queue, and the session ranking, broadcasting state to every open
 * /ws/room socket.
 */
export class Room {
  constructor() {
    this.users = new Map(); // id -> { id, nickname, role, state, songId, songTitle, lastScore, latencyMs, socket }
    this.queue = []; // userIds waiting their turn, FIFO
    this.activeSingers = new Set(); // userIds currently "called" or "singing"
    this.ranking = []; // [{ nickname, songTitle, total, max, at }]
    this.lowLatencyMode = false;
  }

  setLowLatencyMode(enabled) {
    this.lowLatencyMode = Boolean(enabled);
  }

  join(socket, { nickname, role }) {
    const id = randomUUID();
    this.users.set(id, {
      id,
      nickname: nickname || `Invitado-${id.slice(0, 4)}`,
      role, // 'guest' | 'singer' | 'screen'
      state: 'connected',
      songId: null,
      songTitle: null,
      lastScore: null,
      latencyMs: null,
      socket,
    });
    return id;
  }

  update(id, patch) {
    const user = this.users.get(id);
    if (!user) return;
    Object.assign(user, patch);
  }

  remove(id) {
    this.users.delete(id);
    this.queue = this.queue.filter((qid) => qid !== id);
    this.activeSingers.delete(id);
  }

  // Called when a singer picks a song: puts them in line if they aren't
  // already queued or currently taking their turn.
  enqueue(id) {
    if (this.activeSingers.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
    this.update(id, { state: 'queued' });
  }

  // Manual "avanzar rotación" from the Sala screen: pulls the next queued
  // singer in, up to MAX_ACTIVE_SINGERS concurrent active turns.
  advanceQueue() {
    if (this.activeSingers.size >= MAX_ACTIVE_SINGERS) return null;
    const nextId = this.queue.shift();
    if (!nextId) return null;
    this.activeSingers.add(nextId);
    this.update(nextId, { state: 'called' });
    return nextId;
  }

  // The singer actually started streaming mic audio for their called turn.
  markSinging(id) {
    if (!this.users.has(id)) return;
    this.activeSingers.add(id);
    this.update(id, { state: 'singing' });
  }

  finishTurn(id, { total, max }) {
    const user = this.users.get(id);
    this.activeSingers.delete(id);
    if (!user) return;
    this.update(id, { state: 'scored', lastScore: { total, max } });
    this.ranking.push({
      nickname: user.nickname,
      songTitle: user.songTitle,
      total,
      max,
      at: Date.now(),
    });
    this.ranking.sort((a, b) => (b.max ? b.total / b.max : 0) - (a.max ? a.total / a.max : 0));
  }

  // Turn ended without a score (disconnect mid-song, etc).
  abandonTurn(id) {
    this.activeSingers.delete(id);
    if (this.users.has(id)) this.update(id, { state: 'connected' });
  }

  toPublicList() {
    return [...this.users.values()]
      .filter((u) => u.role !== 'screen')
      .map(({ socket, ...pub }) => pub);
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const user of this.users.values()) {
      if (user.socket.readyState === user.socket.OPEN) {
        user.socket.send(payload);
      }
    }
  }

  broadcastState() {
    this.broadcast({
      type: 'roomState',
      users: this.toPublicList(),
      queue: this.queue.map((id) => this.users.get(id)?.nickname ?? '?'),
      ranking: this.ranking.slice(0, 10),
      lowLatencyMode: this.lowLatencyMode,
    });
  }
}
