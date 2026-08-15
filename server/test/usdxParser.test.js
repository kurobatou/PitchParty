import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsdxTxt, beatToMs } from '../src/usdxParser.js';

const SOLO = [
  '#TITLE:Test Song',
  '#ARTIST:The Testers',
  '#LANGUAGE:English',
  '#YEAR:1999',
  '#BPM:120',
  '#GAP:1000',
  ': 0 4 0 Hel',
  ': 4 4 2 lo ',
  '- 8',
  '* 8 4 4 world',
  'F 12 4 0 (ah)',
  'R 16 4 0 yeah',
  'E',
  ': 99 4 0 ignored',
  '',
].join('\n');

test('parses metadata (title/artist/language/year/bpm/gap)', () => {
  const { meta } = parseUsdxTxt(SOLO);
  assert.equal(meta.title, 'Test Song');
  assert.equal(meta.artist, 'The Testers');
  assert.equal(meta.language, 'English');
  assert.equal(meta.year, 1999);
  assert.equal(meta.bpm, 120);
  assert.equal(meta.gap, 1000);
});

test('maps note type characters to names', () => {
  const { lines } = parseUsdxTxt(SOLO);
  const notes = lines.filter((l) => l.type === 'lyrics').flatMap((l) => l.notes);
  const byText = Object.fromEntries(notes.map((n) => [n.text.trim() || n.text, n.type]));
  assert.equal(byText['Hel'], 'normal');
  assert.equal(byText['world'], 'golden');
  assert.equal(byText['(ah)'], 'freestyle');
  assert.equal(byText['yeah'], 'rap');
});

test('preserves syllable edge spaces (does not glue words)', () => {
  const { lines } = parseUsdxTxt(SOLO);
  const notes = lines.filter((l) => l.type === 'lyrics').flatMap((l) => l.notes);
  const lo = notes.find((n) => n.text.startsWith('lo'));
  assert.equal(lo.text, 'lo ', 'trailing space after "lo" must survive');
});

test('E terminates parsing (notes after E are ignored)', () => {
  const { lines } = parseUsdxTxt(SOLO);
  const notes = lines.filter((l) => l.type === 'lyrics').flatMap((l) => l.notes);
  assert.ok(!notes.some((n) => n.text.includes('ignored')));
});

test('linebreak lines produce {type:linebreak, breakBeat}', () => {
  const { lines } = parseUsdxTxt(SOLO);
  const breaks = lines.filter((l) => l.type === 'linebreak');
  assert.equal(breaks.length, 1);
  assert.equal(breaks[0].breakBeat, 8);
});

test('accepts comma decimals in BPM/GAP', () => {
  const { meta } = parseUsdxTxt(['#TITLE:X', '#BPM:123,45', '#GAP:250,5', ': 0 1 0 a', 'E'].join('\n'));
  assert.equal(meta.bpm, 123.45);
  assert.equal(meta.gap, 250.5);
});

test('solo song is not a duet, all notes in player 1', () => {
  const { meta, lines } = parseUsdxTxt(SOLO);
  assert.equal(meta.isDuet, false);
  const lyricLines = lines.filter((l) => l.type === 'lyrics');
  assert.ok(lyricLines.every((l) => l.player === 1));
});

test('P markers split voices and mark the song as a duet', () => {
  const raw = [
    '#TITLE:Duet',
    '#BPM:100',
    'P 1',
    ': 0 4 0 uno',
    'P 2',
    ': 8 4 0 dos',
    'E',
  ].join('\n');
  const { meta, lines } = parseUsdxTxt(raw);
  assert.equal(meta.isDuet, true);
  const lyricLines = lines.filter((l) => l.type === 'lyrics');
  const p1 = lyricLines.find((l) => l.notes.some((n) => n.text === 'uno'));
  const p2 = lyricLines.find((l) => l.notes.some((n) => n.text === 'dos'));
  assert.equal(p1.player, 1);
  assert.equal(p2.player, 2);
});

test('DUETSINGERP2 header alone marks a duet', () => {
  const raw = ['#TITLE:X', '#BPM:100', '#DUETSINGERP2:Someone', ': 0 4 0 a', 'E'].join('\n');
  const { meta } = parseUsdxTxt(raw);
  assert.equal(meta.isDuet, true);
  assert.equal(meta.duetSingers[2], 'Someone');
});

test('RELATIVE mode offsets beats and accumulates across linebreaks', () => {
  const raw = [
    '#TITLE:Rel',
    '#BPM:100',
    '#RELATIVE:yes',
    ': 0 4 0 a',
    '- 8 8',
    ': 0 4 0 b',
    'E',
  ].join('\n');
  const { lines } = parseUsdxTxt(raw);
  const lyricLines = lines.filter((l) => l.type === 'lyrics');
  // Second line's beat 0 is offset by the linebreak's second number (8).
  assert.equal(lyricLines[0].notes[0].beat, 0);
  assert.equal(lyricLines[1].notes[0].beat, 8);
});

test('beatToMs uses gap + beat * (60000 / (bpm*4))', () => {
  // At 120 BPM, one beat = 60000 / 480 = 125 ms.
  assert.equal(beatToMs(0, 120, 1000), 1000);
  assert.equal(beatToMs(4, 120, 1000), 1500);
});
