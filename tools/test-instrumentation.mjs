#!/usr/bin/env node
/** Regression tests for the instrumentation parser: node --test tools/ */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInstrumentation, formatOboeScoring, requiredInstruments,
  mentionsOboeFamily, fromCategoryName, normalizeStringSection,
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

test('reads every doubling in one aside, not just the first', () => {
  // Ligeti's Le Grand Macabre: two instruments taken by two different chairs.
  const macabre = parseInstrumentation(
    "3 oboes (second doubling oboe d'amore, 3rd doubling cor anglais)");
  assert.equal(formatOboeScoring(macabre),
    "three oboes (2nd doubling oboe d'amore, 3rd doubling english horn)");
  // Reading only the first left the work unfindable by English horn.
  assert.deepEqual(requiredInstruments(macabre), ['oboe', 'oboeDamore', 'englishHorn']);
  assert.equal(macabre.counts.oboe, 3); // and still three players

  // His Chamber Concerto: two instruments, one player, named in text order.
  const chamber = parseInstrumentation("oboe (doubling English horn and oboe d'amore)");
  assert.deepEqual(requiredInstruments(chamber), ['oboe', 'oboeDamore', 'englishHorn']);
  assert.equal(formatOboeScoring(chamber),
    "oboe (doubling english horn, doubling oboe d'amore)");
});

test('a remark after a doubling does not repeat it', () => {
  // Mahler 6 names the cor anglais twice in one aside, once to describe it.
  const m6 = parseInstrumentation(
    '4 oboes (3rd and 4th doubling 2nd and 3rd cor anglais; 2nd cor anglais used only in Scherzo), cor anglais');
  assert.equal(m6.doublings.filter((d) => d.instrument === 'englishHorn').length, 1);
  assert.equal(m6.total, 5); // four oboes and the separate cor anglais
});

test('a chair written as a bare digit still reads as a chair', () => {
  // Verdi's Rigoletto: "Oboe 2 doubles English horn" means the 2nd oboe.
  assert.equal(scoring('2 oboes (Oboe 2 doubles English horn)'),
    'two oboes (2nd doubling english horn)');
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

// ── String-section normalization ──────────────────────────────────────────────
test('collapses a plain divided string section to "strings"', () => {
  assert.equal(
    normalizeStringSection('2 oboes, 4 horns, violins I, violins II, violas, cellos and double basses'),
    '2 oboes, 4 horns, strings');
  assert.equal(
    normalizeStringSection('2 oboes, Violins (1st and 2nd), Violas, Cellos, Double basses'),
    '2 oboes, Strings');
  assert.equal(
    normalizeStringSection('2 oboes, strings (1st & 2nd violins, violas, cellos, double basses)'),
    '2 oboes, strings');
  assert.equal(
    normalizeStringSection('timpani and the normal string section of first and second violins, violas, cellos and double basses'),
    'timpani and the normal string section');
  assert.equal(
    normalizeStringSection('two horns, and a string section containing first and second violins, violas, cellos and double basses'),
    'two horns, and a string section');
});

test('a "Strings" label absorbs the enumeration that follows it', () => {
  assert.equal(
    normalizeStringSection('Timpani, Strings, 1st Violins, 2nd Violins, Violas, Cellos, Double Basses'),
    'Timpani, Strings');
  assert.equal(
    normalizeStringSection('Timpani, Strings:, 1st violins, 2nd violins, violas, cellos, double basses'),
    'Timpani, Strings'); // a stray "label:," from upstream extraction is absorbed too
});

test('a harp filed under "Strings" is kept, not folded into the section', () => {
  assert.equal(
    normalizeStringSection('Piano, Strings, 2 Harps, Violins (1st and 2nd), Violas, Cellos, Double basses'),
    'Piano, Strings, 2 Harps');
  assert.equal(
    normalizeStringSection('Keyboard: piano, Strings: harp, violins, violas, cellos, double basses'),
    'Keyboard: piano, Strings, harp');
});

test('leaves a divided or reduced string section untouched', () => {
  // A specific, non-standard headcount is the point — Stravinsky's Bluebird
  // Pas de Deux is a deliberately reduced string section, not "strings".
  const reduced = 'timpani, and a string section consisting of five violins, four violas, three cellos and two double basses';
  assert.equal(normalizeStringSection(reduced), reduced);

  // A Concertino/Ripieno split names two differently-sized groups.
  const splitGroups = 'Concertino: 2 violins, 1 viola, 1 cello, 1 contrabass, Ripieno: 8 violins, 4 violas, 3 celli, 3 contrabasses';
  assert.equal(normalizeStringSection(splitGroups), splitGroups);
});

test('leaves a small chamber ensemble untouched', () => {
  // One violin part and no double bass: a chamber quintet, not an orchestra.
  const quintet = 'oboe, violin, viola, cello, double bass';
  assert.equal(normalizeStringSection(quintet), quintet);

  // A string quartet configuration (two violins, no double bass) is chamber
  // music, not the standard orchestral section.
  const quartet = 'oboe, 2 violins, viola, cello';
  assert.equal(normalizeStringSection(quartet), quartet);
});

test('leaves an annotated part untouched', () => {
  const annotated = 'harp, violins, violas (including an extensive solo viola part), cellos, double basses';
  assert.equal(normalizeStringSection(annotated), annotated);

  const trailingNote = 'violins, violas, cellos, double basses (seating chart varies)';
  assert.equal(normalizeStringSection(trailingNote), trailingNote);
});

test('is a no-op on text with nothing to collapse', () => {
  const text = 'oboe, clarinet, violin, cello';
  assert.equal(normalizeStringSection(text), text);
  assert.equal(normalizeStringSection(null), null);
});
