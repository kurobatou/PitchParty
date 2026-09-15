import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, MAX_ACTIVE_SINGERS, NICKNAME_MAX_LEN } from '../src/room.js';

function fakeSocket() {
  return { OPEN: 1, readyState: 1, sent: [], send(p) { this.sent.push(p); } };
}

test('join creates a user with defaults and a fallback nickname', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: '', role: 'singer' });
  const user = room.users.get(id);
  assert.equal(user.role, 'singer');
  assert.equal(user.state, 'connected');
  assert.equal(user.connected, true);
  assert.ok(user.nickname.startsWith('Invitado-'), 'blank nickname gets a default');
});

test('join applies the same name rules as setNickname (the UI cap is not a guarantee)', () => {
  const room = new Room();

  const long = room.join(fakeSocket(), { nickname: 'x'.repeat(300), role: 'singer' });
  assert.equal(room.users.get(long).nickname, 'x'.repeat(NICKNAME_MAX_LEN), 'caps a crafted long name');

  const padded = room.join(fakeSocket(), { nickname: '  Batou  ', role: 'guest' });
  assert.equal(room.users.get(padded).nickname, 'Batou', 'trims whitespace');

  const blank = room.join(fakeSocket(), { nickname: '   ', role: 'guest' });
  assert.ok(room.users.get(blank).nickname.startsWith('Invitado-'), 'whitespace-only falls back');
});

test('setNickname renames in place, trims/caps, and keeps the queue spot', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: '', role: 'singer' });
  room.enqueue(id);

  assert.equal(room.setNickname(id, '  Batou  '), 'Batou', 'trims whitespace');
  assert.equal(room.users.get(id).nickname, 'Batou');
  assert.deepEqual(room.queue, [id], 'renaming keeps the queue position');
  assert.equal(room.users.get(id).state, 'queued');

  assert.equal(room.setNickname(id, 'x'.repeat(40)), 'x'.repeat(24), 'caps at 24 chars');
  assert.equal(room.setNickname(id, '   '), 'x'.repeat(24), 'blank keeps the current name');
  assert.equal(room.setNickname('nope', 'Ana'), null, 'unknown id returns null');
});

test('setPhoneMicEnabled is off by default and rides along in roomState', () => {
  const room = new Room();
  assert.equal(room.phoneMicEnabled, false, 'off unless explicitly enabled');

  const socket = fakeSocket();
  room.join(socket, { nickname: 'Ana', role: 'singer' });
  room.setPhoneMicEnabled(1);
  assert.equal(room.phoneMicEnabled, true);

  room.broadcastState();
  const state = JSON.parse(socket.sent.at(-1));
  assert.equal(state.phoneMicEnabled, true, 'phones learn the switch from roomState');

  room.setPhoneMicEnabled(false);
  room.broadcastState();
  assert.equal(JSON.parse(socket.sent.at(-1)).phoneMicEnabled, false);
});

test('canRelayMic only lets the current turn through', () => {
  const room = new Room();
  const singer = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  const other = room.join(fakeSocket(), { nickname: 'Beto', role: 'singer' });
  room.update(singer, { songId: 1, songTitle: 'X' });
  room.enqueue(singer);
  room.setPhoneMicEnabled(true);

  assert.equal(room.canRelayMic(singer), false, 'nobody is on stage yet');

  room.advanceQueue();
  assert.equal(room.nowPlaying.userId, singer);
  assert.equal(room.canRelayMic(singer), true, 'the singer on stage is heard');
  assert.equal(room.canRelayMic(other), false, 'a bystander is never relayed');

  room.setPhoneMicEnabled(false);
  assert.equal(room.canRelayMic(singer), false, 'global switch off silences everyone');

  room.setPhoneMicEnabled(true);
  room.abandonTurn(singer);
  assert.equal(room.canRelayMic(singer), false, 'the turn ended, so does the audio');
});

test('enqueue queues once and sets state; no double-enqueue', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  room.enqueue(id);
  room.enqueue(id);
  assert.deepEqual(room.queue, [id]);
  assert.equal(room.users.get(id).state, 'queued');
});

test('advanceQueue calls the next singer, sets nowPlaying, respects the cap', () => {
  const room = new Room();
  const ids = [];
  for (let i = 0; i < MAX_ACTIVE_SINGERS + 1; i++) {
    const id = room.join(fakeSocket(), { nickname: `S${i}`, role: 'singer' });
    room.update(id, { songId: i + 1, songTitle: `song ${i + 1}` });
    room.enqueue(id);
    ids.push(id);
  }

  const first = room.advanceQueue();
  assert.equal(first, ids[0]);
  assert.equal(room.users.get(first).state, 'called');
  assert.deepEqual(room.nowPlaying, {
    userId: ids[0], songId: 1, songTitle: 'song 1', duetMode: null, partnerId: null, partnerNickname: null,
  });

  // Fill the rest of the active slots, then the next advance is blocked.
  for (let i = 1; i < MAX_ACTIVE_SINGERS; i++) assert.equal(room.advanceQueue(), ids[i]);
  assert.equal(room.activeSingers.size, MAX_ACTIVE_SINGERS);
  assert.equal(room.advanceQueue(), null, 'over the cap -> null');
});

test('advanceQueue on an empty queue returns null', () => {
  assert.equal(new Room().advanceQueue(), null);
});

test('markSinging moves a called singer to singing', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  room.enqueue(id);
  room.advanceQueue();
  room.markSinging(id);
  assert.equal(room.users.get(id).state, 'singing');
  assert.ok(room.activeSingers.has(id));
});

test('finishTurn scores, ranks by percentage desc, clears nowPlaying when idle', () => {
  const room = new Room();
  const low = room.join(fakeSocket(), { nickname: 'Low', role: 'singer' });
  const high = room.join(fakeSocket(), { nickname: 'High', role: 'singer' });
  room.enqueue(low);
  room.enqueue(high);
  room.advanceQueue(); // low called
  room.advanceQueue(); // high called

  room.finishTurn(low, { total: 3, max: 10 });   // 30%
  room.finishTurn(high, { total: 9, max: 10 });   // 90%

  assert.equal(room.users.get(low).state, 'scored');
  assert.deepEqual(room.users.get(low).lastScore, { total: 3, max: 10 });
  assert.deepEqual(room.ranking.map((r) => r.nickname), ['High', 'Low']);
  assert.equal(room.nowPlaying, null, 'no active singers left');
});

test('abandonTurn resets state and clears nowPlaying when idle', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  room.enqueue(id);
  room.advanceQueue();
  room.abandonTurn(id);
  assert.equal(room.users.get(id).state, 'connected');
  assert.equal(room.nowPlaying, null);
});

test('remove drops the user from queue/active and clears their nowPlaying', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  room.enqueue(id);
  room.advanceQueue();
  room.remove(id);
  assert.equal(room.users.has(id), false);
  assert.equal(room.queue.includes(id), false);
  assert.equal(room.activeSingers.has(id), false);
  assert.equal(room.nowPlaying, null);
});

test('reconnect reclaims a known id and rejects an unknown one', () => {
  const room = new Room();
  const id = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  const newSock = fakeSocket();
  const user = room.reconnect(id, newSock);
  assert.equal(user.id, id);
  assert.equal(user.socket, newSock);
  assert.equal(user.connected, true);
  assert.equal(room.reconnect('does-not-exist', fakeSocket()), null);
});

test('addKaraokeSinger adds a socketless queued participant', () => {
  const room = new Room();
  const id = room.addKaraokeSinger('Coro', 7, 'Artist — Hit');
  const user = room.users.get(id);
  assert.equal(user.role, 'karaoke');
  assert.equal(user.socket, null);
  assert.equal(user.state, 'queued');
  assert.deepEqual(room.queue, [id]);
});

test('setMode accepts the two known modes, else null', () => {
  const room = new Room();
  room.setMode('karaoke');
  assert.equal(room.mode, 'karaoke');
  room.setMode('ultrastar');
  assert.equal(room.mode, 'ultrastar');
  room.setMode('nonsense');
  assert.equal(room.mode, null);
});

test('toPublicList hides screens and keeps sockets out of the payload', () => {
  const room = new Room();
  room.join(fakeSocket(), { nickname: 'Screen', role: 'screen' });
  room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  const list = room.toPublicList();
  assert.equal(list.length, 1);
  assert.equal(list[0].nickname, 'Ana');
  assert.ok(!('socket' in list[0]));
});

test('broadcast skips socketless (karaoke) users and closed sockets', () => {
  const room = new Room();
  const open = fakeSocket();
  const closed = fakeSocket();
  closed.readyState = 3; // CLOSED
  room.join(open, { nickname: 'Open', role: 'singer' });
  room.join(closed, { nickname: 'Closed', role: 'singer' });
  room.addKaraokeSinger('Coro', 1, 'x'); // socket: null

  room.broadcast({ type: 'ping' });
  assert.equal(open.sent.length, 1);
  assert.equal(closed.sent.length, 0);
});

// Note: we assert the observable state and the pending-timer bookkeeping
// rather than fast-forwarding time. node:test's mock timers only exist on
// Node >= 20.4, and the CI matrix still includes 18.x — and the actual
// firing is just Node's setTimeout, not our logic.
test('scheduleDisconnect marks the user offline and registers a pending timer', () => {
  const room = new Room();
  const a = room.join(fakeSocket(), { nickname: 'A', role: 'singer' });
  room.scheduleDisconnect(a, () => {});
  assert.equal(room.users.get(a).connected, false);
  assert.ok(room.disconnectTimers.has(a), 'a removal timer is pending');
});

test('cancelDisconnect clears the pending timer', () => {
  const room = new Room();
  const a = room.join(fakeSocket(), { nickname: 'A', role: 'singer' });
  room.scheduleDisconnect(a, () => {});
  room.cancelDisconnect(a);
  assert.equal(room.disconnectTimers.has(a), false);
});

test('reconnect cancels a pending disconnect and marks the user online', () => {
  const room = new Room();
  const a = room.join(fakeSocket(), { nickname: 'A', role: 'singer' });
  room.scheduleDisconnect(a, () => {});
  room.reconnect(a, fakeSocket());
  assert.equal(room.users.get(a).connected, true);
  assert.equal(room.disconnectTimers.has(a), false);
});

// --- Duet sung from two phones (Karaoke) ------------------------------------

// A host already queued for a duet song in 'duo', plus a free guest to invite.
function duetRoom() {
  const room = new Room();
  const host = room.join(fakeSocket(), { nickname: 'Ana', role: 'singer' });
  const guest = room.join(fakeSocket(), { nickname: 'Beto', role: 'singer' });
  room.update(host, { songId: 7, songTitle: 'Artist — Duet', duetMode: 'duo' });
  room.enqueue(host);
  room.setPhoneMicEnabled(true);
  return { room, host, guest };
}

test('inviteDuetPartner refuses everyone who cannot take the second voice', () => {
  const { room, host, guest } = duetRoom();

  assert.equal(room.inviteDuetPartner(host, host).reason, 'self');
  assert.equal(room.inviteDuetPartner(host, 'nobody').reason, 'unknown');

  // Socketless participants exist only as a name in the queue: there is
  // nobody on the other end to ask.
  const karaoke = room.addKaraokeSinger('Coro', 7, 'Artist — Duet');
  assert.equal(room.inviteDuetPartner(host, karaoke).reason, 'unreachable');

  const screen = room.join(fakeSocket(), { nickname: 'Pantalla', role: 'screen' });
  assert.equal(room.inviteDuetPartner(host, screen).reason, 'unreachable');

  // Someone mid-turn is not up for grabs.
  room.update(guest, { state: 'singing' });
  assert.equal(room.inviteDuetPartner(host, guest).reason, 'busy');
  room.update(guest, { state: 'connected' });

  const noSong = room.join(fakeSocket(), { nickname: 'Sin canción', role: 'singer' });
  assert.equal(room.inviteDuetPartner(noSong, guest).reason, 'noSong');

  room.update(host, { duetMode: 'solo' });
  assert.equal(room.inviteDuetPartner(host, guest).reason, 'notDuo');
});

test('a second invitation to the same person is refused, not queued up', () => {
  const { room, host, guest } = duetRoom();
  const other = room.join(fakeSocket(), { nickname: 'Cami', role: 'singer' });
  room.update(other, { songId: 7, songTitle: 'Artist — Duet', duetMode: 'duo' });
  room.enqueue(other);

  assert.equal(room.inviteDuetPartner(host, guest).ok, true);
  assert.equal(room.inviteDuetPartner(other, guest).reason, 'busy', 'one invitation at a time');
  assert.equal(room.duetInvites.get(guest).fromId, host, 'the first one still stands');
});

test('inviting someone else withdraws the invitation already sent', () => {
  const { room, host, guest } = duetRoom();
  const third = room.join(fakeSocket(), { nickname: 'Cami', role: 'singer' });

  room.inviteDuetPartner(host, guest);
  const result = room.inviteDuetPartner(host, third);
  assert.equal(result.ok, true);
  assert.equal(result.superseded, guest, 'the first invitee is reported so they can be told');
  assert.equal(room.duetInvites.has(guest), false);
});

test('accepting pairs both voices into a single queue entry', () => {
  const { room, host, guest } = duetRoom();
  room.inviteDuetPartner(host, guest);
  const result = room.respondDuetInvite(guest, true);

  assert.equal(result.accepted, true);
  assert.equal(room.users.get(host).duetVoice, 1, 'the host sings voice 1');
  assert.equal(room.users.get(guest).duetVoice, 2, 'the invitee sings voice 2');
  assert.equal(room.users.get(host).duetPartnerId, guest);
  assert.equal(room.users.get(guest).duetPartnerId, host);
  assert.deepEqual(room.queue, [host], 'a duet is ONE performance, one queue spot');
  assert.equal(room.users.get(guest).songId, 7, 'voice 2 borrows the song to follow the lyrics');
  assert.equal(room.users.get(guest).state, 'queued');

  room.broadcastState();
  const state = JSON.parse(room.users.get(host).socket.sent.at(-1));
  assert.deepEqual(state.queue.map((q) => q.partnerNickname), ['Beto'], 'the queue shows both names');
});

test('accepting releases the invitee\'s own queue spot (nobody holds two turns)', () => {
  const { room, host, guest } = duetRoom();
  room.update(guest, { songId: 9, songTitle: 'Otra' });
  room.enqueue(guest);
  assert.deepEqual(room.queue, [host, guest]);

  room.inviteDuetPartner(host, guest);
  const result = room.respondDuetInvite(guest, true);
  assert.equal(result.gaveUpQueueSpot, true, 'reported so the phone can warn before accepting');
  assert.deepEqual(room.queue, [host]);
  assert.equal(room.users.get(guest).songId, 7, "and they're on the host's song now");
});

test('declining leaves the host in duo without a partner, never demoted to solo', () => {
  const { room, host, guest } = duetRoom();
  room.inviteDuetPartner(host, guest);
  const result = room.respondDuetInvite(guest, false);

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'declined');
  assert.equal(result.fromId, host, 'the host is told instead of waiting in silence');
  assert.equal(room.users.get(host).duetMode, 'duo', 'a "no" must not switch off the per-voice colours');
  assert.equal(room.users.get(host).duetPartnerId, null);
  assert.deepEqual(room.queue, [host], 'the turn is untouched');
});

test('answering an invitation that is no longer there does nothing', () => {
  const { room, guest } = duetRoom();
  assert.equal(room.respondDuetInvite(guest, true), null);
});

test('a duet takes one slot, and both voices are relayed — nobody else is', () => {
  const { room, host, guest } = duetRoom();
  const bystander = room.join(fakeSocket(), { nickname: 'Cami', role: 'singer' });
  room.inviteDuetPartner(host, guest);
  room.respondDuetInvite(guest, true);

  room.advanceQueue();
  assert.equal(room.activeSingers.size, 1, 'the partner rides along without consuming a slot');
  assert.equal(room.activeSingers.has(guest), false);
  assert.equal(room.users.get(guest).state, 'called', 'but they are on stage');
  assert.equal(room.nowPlaying.partnerId, guest);
  assert.equal(room.nowPlaying.partnerNickname, 'Beto');

  assert.equal(room.micVoiceOf(host), 1);
  assert.equal(room.micVoiceOf(guest), 2, 'each phone is tagged with its own voice');
  assert.equal(room.micVoiceOf(bystander), null);
  assert.equal(room.canRelayMic(host), true);
  assert.equal(room.canRelayMic(guest), true);
  assert.equal(room.canRelayMic(bystander), false);

  room.setPhoneMicEnabled(false);
  assert.equal(room.canRelayMic(guest), false, 'the global switch silences the partner too');
});

test('one half of a duet dropping out does not silence the other', () => {
  const { room, host, guest } = duetRoom();
  room.inviteDuetPartner(host, guest);
  room.respondDuetInvite(guest, true);
  room.advanceQueue();

  // Lost socket: still inside the 90s grace period, so the duet stands.
  room.scheduleDisconnect(guest, () => {});
  assert.equal(room.canRelayMic(host), true, 'the one still singing keeps being heard');
  assert.equal(room.canRelayMic(guest), true, 'and a reconnect within the grace period resumes');

  // Grace expired: the partner is gone for good and the host is told.
  const dropped = room.remove(guest);
  assert.equal(dropped.partner, host);
  assert.equal(room.users.get(host).duetPartnerId, null);
  assert.equal(room.nowPlaying.partnerId, null);
  assert.equal(room.canRelayMic(host), true, 'the host finishes the song alone');
});

test('switching to solo cancels the partnership and says who to tell', () => {
  const { room, host, guest } = duetRoom();
  room.inviteDuetPartner(host, guest);
  room.respondDuetInvite(guest, true);

  assert.equal(room.endDuetPartnership(host), guest, 'reported so nobody is dropped in silence');
  assert.equal(room.users.get(host).duetPartnerId, null);
  assert.equal(room.users.get(host).songId, 7, 'the host keeps their own song and turn');
  assert.deepEqual(room.queue, [host]);

  const ex = room.users.get(guest);
  assert.equal(ex.duetVoice, null);
  assert.equal(ex.songId, null, 'voice 2 was only borrowing it');
  assert.equal(ex.state, 'connected');
});

test('a host who leaves takes their pending invitation with them', () => {
  const { room, host, guest } = duetRoom();
  room.inviteDuetPartner(host, guest);

  const dropped = room.remove(host);
  assert.equal(dropped.invitee, guest, 'the invitee is told instead of waiting forever');
  assert.equal(room.duetInvites.size, 0);

  // And the mirror case: the invitee vanishes before answering.
  const { room: room2, host: host2, guest: guest2 } = duetRoom();
  room2.inviteDuetPartner(host2, guest2);
  assert.equal(room2.remove(guest2).invitedBy, host2);
});

test('when the turn ends both voices go back to normal', () => {
  const { room, host, guest } = duetRoom();
  room.inviteDuetPartner(host, guest);
  room.respondDuetInvite(guest, true);
  room.advanceQueue();

  room.abandonTurn(host);
  assert.equal(room.users.get(host).state, 'connected');
  assert.equal(room.users.get(guest).state, 'connected');
  assert.equal(room.users.get(host).duetPartnerId, null);
  assert.equal(room.users.get(guest).duetPartnerId, null);
  assert.equal(room.nowPlaying, null);
  assert.equal(room.canRelayMic(guest), false, 'and neither one is still on the mic');
});
