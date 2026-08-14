import { test } from 'node:test';
import assert from 'node:assert';
import { validateDeck, isBasicLand } from '../rules.js';

const card = (name, over = {}) => ({
  name, quantity: 1, type_line: 'Creature — Human', color_identity: ['G'],
  legalities: { standard: 'legal', commander: 'legal' }, game_changer: false, ...over,
});
const forest = (n) => card('Forest', { quantity: n, type_line: 'Basic Land — Forest' });
// n distinct legal creatures
const filler = (n, over = {}) =>
  Array.from({ length: n }, (_, i) => card(`Filler ${i}`, over));
const rules = (r) => r.violations.map((v) => v.rule).sort();

test('basic lands are recognised, including snow and Wastes', () => {
  assert.ok(isBasicLand('Forest'));
  assert.ok(isBasicLand('Snow-Covered Island'));
  assert.ok(isBasicLand('Wastes'));
  assert.ok(!isBasicLand('Ancient Tomb'));
});

test('a legal 60-card Standard deck passes clean', () => {
  const res = validateDeck({ cards: [...filler(37), forest(23)], format: 'standard' });
  assert.equal(res.valid, true);
  assert.deepEqual(res.violations, []);
  assert.equal(res.counts.total, 60);
});

test('a 59-card Standard deck is too small', () => {
  const res = validateDeck({ cards: [...filler(36), forest(23)], format: 'standard' });
  assert.equal(res.valid, false);
  assert.ok(rules(res).includes('deck_size'));
});

test('5 copies of a nonbasic breaks the 4-of rule', () => {
  const cards = [...filler(33), card('Llanowar Elves', { quantity: 5 }), forest(22)];
  const res = validateDeck({ cards, format: 'standard' });
  assert.ok(rules(res).includes('copy_limit'));
  assert.deepEqual(res.violations.find((v) => v.rule === 'copy_limit').cards,
    ['Llanowar Elves']);
});

test('any number of basic lands is legal', () => {
  const res = validateDeck({ cards: [...filler(37), forest(23)], format: 'standard' });
  assert.ok(!rules(res).includes('copy_limit'));
});

test('a Standard-banned card is reported', () => {
  const banned = card('Badgermole Cub',
    { legalities: { standard: 'banned', commander: 'legal' } });
  const res = validateDeck({ cards: [...filler(36), banned, forest(23)], format: 'standard' });
  const v = res.violations.find((x) => x.rule === 'legality');
  assert.deepEqual(v.cards, ['Badgermole Cub']);
});

test('Standard reports an oversized sideboard', () => {
  const res = validateDeck({
    cards: [...filler(37), forest(23)], format: 'standard', sideboard: filler(16),
  });
  assert.ok(rules(res).includes('sideboard_size'));
});

test('a legal 100-card Commander deck passes clean', () => {
  const cmdr = card('Bilbo, Birthday Celebrant',
    { type_line: 'Legendary Creature — Halfling', color_identity: ['G', 'W'] });
  const cards = [cmdr, ...filler(60), forest(39)];
  const res = validateDeck({ cards, format: 'commander', commander: 'Bilbo, Birthday Celebrant' });
  assert.equal(res.valid, true, JSON.stringify(res.violations));
  assert.equal(res.counts.total, 100);
});

test('Commander rejects a card outside the commander color identity', () => {
  const cmdr = card('Bilbo, Birthday Celebrant',
    { type_line: 'Legendary Creature — Halfling', color_identity: ['G'] });
  const offColor = card('Lightning Bolt', { color_identity: ['R'] });
  const cards = [cmdr, offColor, ...filler(59), forest(39)];
  const res = validateDeck({ cards, format: 'commander', commander: 'Bilbo, Birthday Celebrant' });
  const v = res.violations.find((x) => x.rule === 'color_identity');
  assert.deepEqual(v.cards, ['Lightning Bolt']);
});

test('Commander rejects a duplicate nonbasic', () => {
  const cmdr = card('Bilbo, Birthday Celebrant',
    { type_line: 'Legendary Creature — Halfling' });
  const cards = [cmdr, card('Sol Ring', { quantity: 2 }), ...filler(58), forest(39)];
  const res = validateDeck({ cards, format: 'commander', commander: 'Bilbo, Birthday Celebrant' });
  const v = res.violations.find((x) => x.rule === 'copy_limit');
  assert.deepEqual(v.cards, ['Sol Ring']);
});

test('Commander rejects a non-legendary commander', () => {
  const cmdr = card('Llanowar Elves', { type_line: 'Creature — Elf Druid' });
  const cards = [cmdr, ...filler(60), forest(39)];
  const res = validateDeck({ cards, format: 'commander', commander: 'Llanowar Elves' });
  assert.ok(rules(res).includes('commander_eligibility'));
});

test('Commander requires exactly 100 cards, not a minimum', () => {
  const cmdr = card('Bilbo, Birthday Celebrant',
    { type_line: 'Legendary Creature — Halfling' });
  const res = validateDeck({ cards: [cmdr, ...filler(60), forest(40)],
    format: 'commander', commander: 'Bilbo, Birthday Celebrant' });
  assert.ok(rules(res).includes('deck_size'));
});

test('Commander counts game changers as a note, not a violation', () => {
  const cmdr = card('Bilbo, Birthday Celebrant',
    { type_line: 'Legendary Creature — Halfling' });
  const gc = card('Rhystic Study', { game_changer: true });
  const res = validateDeck({ cards: [cmdr, gc, ...filler(59), forest(39)],
    format: 'commander', commander: 'Bilbo, Birthday Celebrant' });
  assert.equal(res.counts.game_changers, 1);
  assert.ok(!rules(res).includes('game_changer'));
});

test('Limited allows 40 cards, duplicates, and Standard-illegal cards', () => {
  const old = card('Ancestral Recall',
    { legalities: { standard: 'not_legal', commander: 'banned' }, quantity: 7 });
  const res = validateDeck({ cards: [old, ...filler(16), forest(17)], format: 'limited' });
  assert.equal(res.valid, true, JSON.stringify(res.violations));
  assert.equal(res.counts.total, 40);
});

test('Limited rejects a 39-card deck', () => {
  const res = validateDeck({ cards: [...filler(22), forest(17)], format: 'limited' });
  assert.ok(rules(res).includes('deck_size'));
});

test('an unknown format is a violation, not a crash', () => {
  const res = validateDeck({ cards: filler(60), format: 'pioneer' });
  assert.equal(res.valid, false);
  assert.ok(rules(res).includes('unknown_format'));
});

test('all violations are reported together', () => {
  const banned = card('Badgermole Cub',
    { legalities: { standard: 'banned' }, quantity: 5 });
  const res = validateDeck({ cards: [banned, ...filler(20)], format: 'standard' });
  assert.deepEqual(rules(res), ['copy_limit', 'deck_size', 'legality']);
});
