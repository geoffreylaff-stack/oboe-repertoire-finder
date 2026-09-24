#!/usr/bin/env node
/** Regression tests for the instrumentation parser: node --test tools/ */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstrumentation, formatOboeScoring, requiredInstruments,
  mentionsOboeFamily, fromCategoryName,
} from '../lib/instrumentation.mjs';

const scoring = (text) => formatOboeScoring(parseInstrumentation(text));

test('counts plain oboe parts', () => {
  assert.equal(scoring('oboe, violin, viola, cello'), 'oboe');
  assert.equal(scoring('2 oboes, 2 clarinets, 2 horns'), 'two oboes');
  assert.equal(scoring('3 oboes, strings'), 'three oboes');
  assert.equal(scoring('24 oboes, 12 bassoons'), '24 oboes');
});

test('distinguishes members of the oboe family', () => {
  assert.equal(scoring("oboe d'amore, strings, continuo"), "oboe d'amore");
  assert.equal(scoring('flute, oboe da caccia, harpsichord'), 'oboe da caccia');
  assert.equal(scoring('cor anglais, harp'), 'english horn');
  assert.equal(scoring('bass oboe, heckelphone'), 'bass oboe, heckelphone');
});

test('reads alternative and foreign names', () => {
  assert.equal(scoring('4 Oboes, 2 Corni Inglesi'), 'four oboes, two english horns');
  assert.equal(scoring('2 Hautbois'), 'two oboes');
  assert.equal(scoring('Englischhorn, Streicher'), 'english horn');
});

test('spells out number words in the input', () => {
  assert.equal(scoring('two oboes and english horn'), 'two oboes, english horn');
});

test('attaches doublings to the instrument that doubles', () => {
  assert.equal(
    scoring('3 oboes (3rd doubling english horn), 2 clarinets'),
    'three oboes (3rd doubling english horn)');
  assert.equal(
    scoring("2 oboes (2nd doubling oboe d'amore), english horn"),
    "two oboes (2nd doubling oboe d'amore), english horn");
});

test('reads ordinal words in doublings, as Wikipedia writes them', () => {
  // Wikipedia: "three oboes (third doubling bass oboe)"; scores say "3rd".
  assert.equal(scoring('three oboes (third doubling bass oboe), one cor anglais'),
    'three oboes (3rd doubling bass oboe), english horn');
  assert.equal(scoring('4 oboes (fourth doubling second cor anglais)'),
    'four oboes (4th doubling english horn)');
});

test('names every chair that doubles, not just the first', () => {
  // Mahler 2 is "4 Oboen (3. und 4. auch Englisch Horn)": both chairs switch.
  assert.equal(scoring('4 oboes (3rd and 4th doubling english horn)'),
    'four oboes (3rd and 4th doubling english horn)');
  assert.equal(scoring('5 oboes (2nd, 3rd and 4th doubling english horn)'),
    'five oboes (2nd, 3rd and 4th doubling english horn)');
  assert.equal(scoring('2 oboes (both doubling english horn)'),
    'two oboes (doubling english horn)');
});

test('ordinals after the cue name the instrument, not the chairs', () => {
  // Mahler 6: "3rd and 4th doubling 2nd and 3rd cor anglais" — four ordinals,
  // but only the two before "doubling" are players.
  const m6 = parseInstrumentation('4 oboes (3rd and 4th doubling 2nd and 3rd cor anglais)');
  assert.equal(m6.doublings[0].player, '3rd and 4th');
});

test('reads German scoring lists', () => {
  // The plural "Oboen" is not the English "oboes"; missing it dropped the
  // whole section and left only the English horn behind.
  const m8 = parseInstrumentation('4 Oboen, Englischhorn');
  assert.deepEqual(m8.counts, { oboe: 4, englishHorn: 1 });
  assert.equal(m8.total, 5); // same reading as the English "4 oboes, cor anglais"
  assert.equal(scoring('2 Oboen, 2 Englischhörner'), 'two oboes, two english horns');
  assert.equal(scoring('Hoboen, Streicher'), 'two oboes');
});

test('a doubled instrument still counts as required', () => {
  const dvorak = parseInstrumentation('2 oboes (2nd doubling english horn)');
  assert.deepEqual(requiredInstruments(dvorak), ['oboe', 'englishHorn']);
  // ...but it does not inflate the number of players.
  assert.equal(dvorak.counts.oboe, 2);
  assert.equal(dvorak.counts.englishHorn ?? 0, 0);
});

test('ignores works with no oboe-family instrument', () => {
  assert.equal(scoring('soprano, alto, mixed chorus (SATB), orchestra'), '');
  assert.equal(scoring('piano solo'), '');
  assert.equal(mentionsOboeFamily('violin, viola, cello'), false);
  assert.equal(mentionsOboeFamily('2 oboes, strings'), true);
});

test('does not mistake d\'amore or da caccia for a plain oboe', () => {
  const p = parseInstrumentation("oboe d'amore");
  assert.equal(p.counts.oboe ?? 0, 0);
  assert.equal(p.counts.oboeDamore, 1);
});

test('does not add up repeated mentions of the same instrument', () => {
  // Shostakovich Piano Concerto No. 2: the scoring says two oboes, and the
  // article later discusses the oboes again. That is still two oboes.
  assert.equal(
    scoring('scored for solo piano, two flutes, two oboes, two clarinets, four horns, '
      + 'and strings. The oboes are silent for the second movement.'),
    'two oboes');

  // Saint-Saëns Requiem lists a second, reduced orchestration further down.
  assert.equal(
    scoring('four flutes, two oboes, two English horns, four bassoons. '
      + 'A version with a reduced orchestra uses two oboes, two English horns.'),
    'two oboes, two english horns');

  // A narrative singular must not top up an explicit count either.
  assert.equal(
    scoring('The work is scored for 2 oboes, 2 horns and strings. '
      + 'The central movements feature both oboe and horn.'),
    'two oboes');
});

test('an explicit count outranks a plural guess and clears the estimate flag', () => {
  const p = parseInstrumentation('two oboes, strings. The oboes carry the theme.');
  assert.equal(p.counts.oboe, 2);
  assert.deepEqual(p.uncertain, [], 'an explicit number was given, so nothing is inferred');
});

test('flags a bare plural as an inferred count', () => {
  const p = parseInstrumentation('oboes, bassoons, strings');
  assert.ok(p.uncertain.includes('oboe'));
  assert.equal(p.counts.oboe, 2);
});

test('parses IMSLP category names', () => {
  assert.deepEqual(fromCategoryName('For 2 oboes, english horn (arr)'),
    { text: '2 oboes, english horn', arrangement: true });
  assert.deepEqual(fromCategoryName('For oboe, violin, viola, cello'),
    { text: 'oboe, violin, viola, cello', arrangement: false });
});

test('a singular name is not an inferred count', () => {
  // "oboe" states one oboe outright; only a bare plural is a genuine guess.
  const solo = parseInstrumentation('oboe, violin, viola, cello');
  assert.equal(solo.counts.oboe, 1);
  assert.deepEqual(solo.uncertain, []);

  const plural = parseInstrumentation('oboes, bassoons, strings');
  assert.deepEqual(plural.uncertain, ['oboe']);
});
