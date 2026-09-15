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

// Every name that enters the room goes through here, whether it arrives on
// `join` or on a later `setNickname`. The UI caps the field at 24, but the
// server can't rely on that: a crafted WebSocket client would otherwise
// park a 300-character name in the queue and wreck the Sala layout.
export const NICKNAME_MAX_LEN = 24;

function cleanNickname(nickname) {
  return String(nickname ?? '').trim().slice(0, NICKNAME_MAX_LEN);
}

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
    this.phoneMicEnabled = false; // global switch: phones may be used as wireless mics (Karaoke)
    this.duetInvites = new Map(); // inviteeId -> { fromId, songId, songTitle } — at most one per invitee
  }

  setLowLatencyMode(enabled) {
    this.lowLatencyMode = Boolean(enabled);
  }

  // The pantalla principal picks the session mode on the landing screen. null
  // means "not chosen yet" → phones and the Sala show the mode picker. Only
  // the two known modes (or a reset to null) are accepted.
  // Whether phones may be used as wireless mics (global switch from the
  // settings UI). Broadcast in roomState so phones know to offer the button.
  setPhoneMicEnabled(enabled) {
    this.phoneMicEnabled = Boolean(enabled);
  }

  // Which voice this phone's audio belongs to in the current turn: 1 for the
  // singer who owns the turn, 2 for their duet partner, null for everyone
  // else. The server tags each relayed frame with this so the Sala can mix
  // the two streams apart (see /ws/mic in index.js).
  micVoiceOf(userId) {
    if (!this.phoneMicEnabled || !this.nowPlaying) return null;
    if (this.nowPlaying.userId === userId) return 1;
    if (this.nowPlaying.partnerId === userId) return 2;
    return null;
  }

  // The rule that keeps a phone from talking over the room: audio is relayed
  // only while the feature is on AND that phone is part of the current turn.
  // Checked per audio frame, so it follows the turn as it changes.
  canRelayMic(userId) {
    return this.micVoiceOf(userId) !== null;
  }

  setMode(mode) {
    this.mode = mode === 'karaoke' || mode === 'ultrastar' ? mode : null;
  }

  join(socket, { nickname, role }) {
    const id = randomUUID();
    this.users.set(id, {
      id,
      nickname: cleanNickname(nickname) || `Invitado-${id.slice(0, 4)}`,
      role, // 'guest' | 'singer' | 'screen'
      state: 'connected',
      songId: null,
      songTitle: null,
      duetMode: null, // 'duo' | 'solo' | null — how a duet song should play
      duetPartnerId: null, // the other phone singing this duet, both ways
      duetVoice: null, // 1 = owns the turn, 2 = accompanies it
      lastScore: null,
      latencyMs: null,
      socket,
      connected: true,
    });
    return id;
  }

  // Renames a user in place. Keeps their queue spot and turn state — only
  // the display name changes. Falls back to the current name when the new
  // one is blank, so nobody can end up nameless.
  setNickname(id, nickname) {
    const user = this.users.get(id);
    if (!user) return null;
    const clean = cleanNickname(nickname);
    if (clean) user.nickname = clean;
    return user.nickname;
  }

  update(id, patch) {
    const user = this.users.get(id);
    if (!user) return;
    Object.assign(user, patch);
  }

  // Returns who was left hanging by this removal (a pending invitation in
  // either direction, or an accepted partner) so the caller can tell them —
  // otherwise someone sits waiting for a duet that can no longer happen.
  remove(id) {
    this.cancelDisconnect(id);
    const invitedBy = this.duetInvites.get(id)?.fromId ?? null;
    this.duetInvites.delete(id);
    const invitee = this.cancelDuetInviteFrom(id);
    const partner = this.endDuetPartnership(id);
    this.users.delete(id);
    this.queue = this.queue.filter((qid) => qid !== id);
    this.activeSingers.delete(id);
    // If the removed user was the one on stage, clear it so the Sala doesn't
    // stay stuck on a turn that no longer exists (e.g. a karaoke participant
    // removed when their song ends).
    if (this.nowPlaying?.userId === id) this.nowPlaying = null;
    return { invitedBy, invitee, partner };
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
    const partner = this.partnerOf(nextId);
    this.nowPlaying = {
      userId: nextId,
      songId: user.songId,
      songTitle: user.songTitle,
      duetMode: user.duetMode ?? null,
      partnerId: partner?.id ?? null,
      partnerNickname: partner?.nickname ?? null,
    };
    // The partner walks on stage with the host but deliberately stays out of
    // activeSingers: the duet is one performance and consumes one slot.
    if (partner) this.update(partner.id, { state: 'called' });
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
    this.endDuetPartnership(id);
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
    this.endDuetPartnership(id);
    if (this.users.has(id)) this.update(id, { state: 'connected' });
    if (this.activeSingers.size === 0) this.nowPlaying = null;
  }

  // --- Duets sung from two phones (Karaoke) ---------------------------------
  //
  // A duet is ONE turn: the host (voice 1) holds the queue entry, and the
  // partner (voice 2) rides along without consuming a slot of
  // MAX_ACTIVE_SINGERS. The link is stored on both users so "who sings with
  // whom" never means scanning the whole room, and so breaking it from
  // either side is the same call.
  //
  // Everything here returns plain facts — who to tell, and why. The wire
  // messages live in index.js; Room doesn't know the protocol.

  partnerOf(id) {
    const partnerId = this.users.get(id)?.duetPartnerId;
    return partnerId ? this.users.get(partnerId) ?? null : null;
  }

  // Records an invitation from `fromId` to `toId`. Every reason to refuse is
  // checked here and not on the phone: the invitee list the phone builds is a
  // convenience, not a guarantee (any WebSocket client can send this).
  inviteDuetPartner(fromId, toId) {
    const from = this.users.get(fromId);
    const to = this.users.get(toId);
    if (!from || !to) return { ok: false, reason: 'unknown' };
    if (fromId === toId) return { ok: false, reason: 'self' };
    // No socket means nobody to ask: 'karaoke' participants exist only as a
    // name in the queue, and the Sala doesn't sing.
    if (!to.socket || to.role === 'screen' || to.role === 'karaoke') return { ok: false, reason: 'unreachable' };
    if (!from.songId) return { ok: false, reason: 'noSong' };
    if (from.duetMode !== 'duo') return { ok: false, reason: 'notDuo' };
    if (from.duetPartnerId) return { ok: false, reason: 'alreadyPartnered' };
    // One invitation at a time, no queue of invitations (and never yank
    // someone who is already on stage).
    if (this.duetInvites.has(toId) || to.duetPartnerId) return { ok: false, reason: 'busy' };
    if (to.state === 'called' || to.state === 'singing') return { ok: false, reason: 'busy' };

    // The host has a single song, so they can have a single live invitation:
    // a new one replaces the previous (whoever that was gets told).
    const superseded = this.cancelDuetInviteFrom(fromId);
    this.duetInvites.set(toId, { fromId, songId: from.songId, songTitle: from.songTitle });
    return { ok: true, superseded, songTitle: from.songTitle, songId: from.songId };
  }

  // Answers the pending invitation addressed to `toId`. Returns null when
  // there wasn't one (a stale tap, or the host already withdrew it).
  respondDuetInvite(toId, accept) {
    const invite = this.duetInvites.get(toId);
    if (!invite) return null;
    this.duetInvites.delete(toId);

    const from = this.users.get(invite.fromId);
    const to = this.users.get(toId);
    if (!from || !to) return { accepted: false, fromId: invite.fromId, reason: 'gone' };
    if (!accept) return { accepted: false, fromId: invite.fromId, reason: 'declined' };

    // Accepting a duet means accepting THIS turn: a duet is one queue entry,
    // and nobody can hold two turns at once, so the partner releases their
    // own spot if they had one. The phone says so before they accept — it
    // must never come as a surprise.
    const gaveUpQueueSpot = this.queue.includes(toId);
    this.queue = this.queue.filter((qid) => qid !== toId);

    from.duetPartnerId = toId;
    from.duetVoice = 1;
    to.duetPartnerId = invite.fromId;
    to.duetVoice = 2;
    // The partner borrows the host's song so their phone can follow the same
    // lyrics; they still have no queue entry of their own.
    to.songId = from.songId;
    to.songTitle = from.songTitle;
    to.duetMode = 'duo';
    to.state = this.activeSingers.has(invite.fromId) ? 'called' : 'queued';

    if (this.nowPlaying?.userId === invite.fromId) {
      this.nowPlaying = { ...this.nowPlaying, partnerId: toId, partnerNickname: to.nickname };
    }
    return { accepted: true, fromId: invite.fromId, partnerId: toId, gaveUpQueueSpot };
  }

  // Drops the invitation `fromId` sent, if any. Returns who it was for, so
  // the caller can tell them it's off.
  cancelDuetInviteFrom(fromId) {
    for (const [toId, invite] of this.duetInvites) {
      if (invite.fromId === fromId) {
        this.duetInvites.delete(toId);
        return toId;
      }
    }
    return null;
  }

  // Breaks the pairing from either side. Returns the other person's id (or
  // null when there was no duet), so the caller can notify them — nobody
  // gets taken off the stage without being told.
  endDuetPartnership(id) {
    const user = this.users.get(id);
    const otherId = user?.duetPartnerId ?? null;
    if (!otherId) return null;

    for (const member of [user, this.users.get(otherId)]) {
      if (!member) continue;
      const wasAccompanying = member.duetVoice === 2;
      member.duetPartnerId = null;
      member.duetVoice = null;
      // Voice 2 was only ever borrowing the host's song. Without the duet
      // there's nothing for them to sing, so hand them back a clean slate;
      // the host keeps their own song and their place in the queue.
      if (wasAccompanying) {
        member.songId = null;
        member.songTitle = null;
        member.duetMode = null;
        member.state = 'connected';
      }
    }

    if (this.nowPlaying && (this.nowPlaying.partnerId === id || this.nowPlaying.partnerId === otherId)) {
      this.nowPlaying = { ...this.nowPlaying, partnerId: null, partnerNickname: null };
    }
    return otherId;
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
        return {
          id,
          nickname: user?.nickname ?? '?',
          songTitle: user?.songTitle ?? null,
          // A duet shows both names on a single line: it's one performance,
          // not two turns back to back.
          partnerNickname: this.partnerOf(id)?.nickname ?? null,
        };
      }),
      ranking: this.ranking.slice(0, 10),
      lowLatencyMode: this.lowLatencyMode,
      nowPlaying: this.nowPlaying,
      mode: this.mode,
      phoneMicEnabled: this.phoneMicEnabled,
    });
  }
}
