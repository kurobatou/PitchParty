import { randomUUID } from 'node:crypto';

export const MAX_ACTIVE_SINGERS = 4;

/**
 * Single in-memory "room" for the active session (V1 has no multi-room,
 * no persistence — see plan §12). Tracks connected phones/screens, the
 * turn queue, and the session ranking, broadcasting state to every open
 * /ws/room socket.
 */
// A dropped phone (screen lock, background, brief network blip) gets this
// long to reconnect and reclaim its queue position/state before being
// removed from the room outright — otherwise every lock screen would
// silently bump someone out of the queue and lose their song choice.
export const DISCONNECT_GRACE_MS = 90_000;

export class Room {
  constructor() {
    this.users = new Map(); // id -> { id, nickname, role, state, songId, songTitle, lastScore, latencyMs, socket, connected }
    this.queue = []; // userIds waiting their turn, FIFO
    this.activeSingers = new Set(); // userIds currently "called" or "singing"
    this.ranking = []; // [{ nickname, songTitle, total, max, at }]
    this.lowLatencyMode = false;
    this.nowPlaying = null; // { songId, songTitle } — drives Sala auto-playback
    this.disconnectTimers = new Map(); // id -> Timeout, pending removal after grace period
    this.mode = null; // 'karaoke' | 'ultrastar' | null — chosen once per Sala session on the landing
  }

  setLowLatencyMode(enabled) {
    this.lowLatencyMode = Boolean(enabled);
  }

  // The pantalla principal picks the session mode on the landing screen. null
  // means "not chosen yet" → phones and the Sala show the mode picker. Only
  // the two known modes (or a reset to null) are accepted.
  setMode(mode) {
    this.mode = mode === 'karaoke' || mode === 'ultrastar' ? mode : null;
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
      duetMode: null, // 'duo' | 'solo' | null — how a duet song should play
      lastScore: null,
      latencyMs: null,
      socket,
      connected: true,
    });
    return id;
  }

  update(id, patch) {
    const user = this.users.get(id);
    if (!user) return;
    Object.assign(user, patch);
  }

  remove(id) {
    this.cancelDisconnect(id);
    this.users.delete(id);
    this.queue = this.queue.filter((qid) => qid !== id);
    this.activeSingers.delete(id);
    // If the removed user was the one on stage, clear it so the Sala doesn't
    // stay stuck on a turn that no longer exists (e.g. a karaoke participant
    // removed when their song ends).
    if (this.nowPlaying?.userId === id) this.nowPlaying = null;
  }

  // Socket closed — don't drop the user immediately (see DISCONNECT_GRACE_MS
  // above); `onExpire` (passed by the caller) does the actual `remove` if
  // they never reconnect in time.
  scheduleDisconnect(id, onExpire) {
    const user = this.users.get(id);
    if (!user) return;
    user.connected = false;
    this.cancelDisconnect(id);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(id);
      onExpire();
    }, DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(id, timer);
  }

  cancelDisconnect(id) {
    const timer = this.disconnectTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(id);
    }
  }

  // Reclaims an existing user record for a fresh socket (page reload,
  // reconnect after the WS dropped) instead of starting a brand new one —
  // keeps their nickname, queue position, and current turn state intact.
  // Returns the user, or null if that id is gone (grace period expired,
  // or a session from before the server itself restarted).
  reconnect(id, socket) {
    const user = this.users.get(id);
    if (!user) return null;
    this.cancelDisconnect(id);
    user.socket = socket;
    user.connected = true;
    return user;
  }

  // Karaoke mode: the Sala adds a phone-less participant (a name + a song)
  // straight to the queue. They have no socket and never stream mic audio —
  // their turn just plays the song and, when it ends, they're removed (see the
  // 'endTurn' handling for role 'karaoke' in index.js). Returns the new id.
  addKaraokeSinger(nickname, songId, songTitle) {
    const id = randomUUID();
    this.users.set(id, {
      id,
      nickname: nickname || `Invitado-${id.slice(0, 4)}`,
      role: 'karaoke',
      state: 'queued',
      songId,
      songTitle,
      lastScore: null,
      latencyMs: null,
      socket: null,
      connected: true,
    });
    this.queue.push(id);
    return id;
  }

  // Called when a singer picks a song: puts them in line if they aren't
  // already queued or currently taking their turn.
  enqueue(id) {
    if (this.activeSingers.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
    this.update(id, { state: 'queued' });
  }

  // Manual "avanzar rotación" from the Sala screen: pulls the next queued
  // singer in, up to MAX_ACTIVE_SINGERS concurrent active turns, and tells
  // the pantalla principal which song to start playing.
  advanceQueue() {
    if (this.activeSingers.size >= MAX_ACTIVE_SINGERS) return null;
    const nextId = this.queue.shift();
    if (!nextId) return null;
    this.activeSingers.add(nextId);
    this.update(nextId, { state: 'called' });
    const user = this.users.get(nextId);
    this.nowPlaying = { userId: nextId, songId: user.songId, songTitle: user.songTitle, duetMode: user.duetMode ?? null };
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
    if (this.activeSingers.size === 0) this.nowPlaying = null;
  }

  // Turn ended without a score (disconnect mid-song, etc).
  abandonTurn(id) {
    this.activeSingers.delete(id);
    if (this.users.has(id)) this.update(id, { state: 'connected' });
    if (this.activeSingers.size === 0) this.nowPlaying = null;
  }

  toPublicList() {
    return [...this.users.values()]
      .filter((u) => u.role !== 'screen')
      .map(({ socket, ...pub }) => pub);
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    for (const user of this.users.values()) {
      // Karaoke virtual singers have no socket — skip them.
      if (user.socket && user.socket.readyState === user.socket.OPEN) {
        user.socket.send(payload);
      }
    }
  }

  broadcastState() {
    this.broadcast({
      type: 'roomState',
      users: this.toPublicList(),
      queue: this.queue.map((id) => {
        const user = this.users.get(id);
        return { id, nickname: user?.nickname ?? '?', songTitle: user?.songTitle ?? null };
      }),
      ranking: this.ranking.slice(0, 10),
      lowLatencyMode: this.lowLatencyMode,
      nowPlaying: this.nowPlaying,
      mode: this.mode,
    });
  }
}
