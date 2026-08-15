import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, MAX_ACTIVE_SINGERS } from '../src/room.js';

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
  assert.deepEqual(room.nowPlaying, { userId: ids[0], songId: 1, songTitle: 'song 1', duetMode: null });

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
