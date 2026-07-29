import { randomUUID } from 'node:crypto';

/**
 * Single in-memory "room" for the active session (V1 has no multi-room,
 * no persistence — see plan §12). Tracks connected phones/screens and
 * broadcasts state to every open /ws/room socket.
 */
export class Room {
  constructor() {
    this.users = new Map(); // id -> { id, nickname, role, state, songId, songTitle, lastScore, latencyMs, socket }
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
    this.broadcast({ type: 'roomState', users: this.toPublicList() });
  }
}
