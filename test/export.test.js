import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toDecklistText, toBreakdown, exportDeck } from '../export.js';

const CARDS = [
  { name: 'Lightning Bolt', quantity: 4, cmc: 1, type_line: 'Instant',
    mana_cost: '{R}', printed_name: 'Rayo' },
  { name: 'Goblin Guide', quantity: 4, cmc: 1, type_line: 'Creature — Goblin Scout',
    mana_cost: '{R}' },
  { name: 'Mountain', quantity: 20, cmc: 0, type_line: 'Basic Land — Mountain',
    mana_cost: '' },
];

test('decklist text uses English names, one line per card', () => {
  const out = toDecklistText(CARDS, {});
  assert.equal(out, '4 Lightning Bolt\n4 Goblin Guide\n20 Mountain\n');
});

test('decklist text puts the commander in its own section', () => {
  const out = toDecklistText(CARDS, { commander: 'Goblin Guide' });
  assert.match(out, /^Commander\n1 Goblin Guide\n\nDeck\n/);
  assert.match(out, /^3 Goblin Guide$/m);   // remaining copies stay in the deck
});

test('breakdown includes a curve, type counts, and validation result', () => {
  const md = toBreakdown({
    cards: CARDS, format: 'standard', notes: 'Aggro shell.',
    validation: { valid: true, violations: [], counts: { total: 28, lands: 20 } },
  });
  assert.match(md, /# .*standard/i);
  assert.match(md, /Aggro shell\./);
  assert.match(md, /\| 1 \| 8 \|/);      // 8 cards at mana value 1
  assert.match(md, /20 lands/);
  assert.match(md, /Legal/);
});

test('breakdown lists every violation when the deck is illegal', () => {
  const md = toBreakdown({
    cards: CARDS, format: 'standard',
    validation: { valid: false, counts: { total: 28, lands: 20 }, violations: [
      { rule: 'deck_size', message: 'standard requires at least 60 cards; found 28.' },
      { rule: 'legality', message: 'Not legal in standard.', cards: ['Goblin Guide'] },
    ] },
  });
  assert.match(md, /requires at least 60 cards/);
  assert.match(md, /Goblin Guide/);
});

test('exportDeck writes both files and returns their paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-'));
  const out = exportDeck({
    cards: CARDS, path: join(dir, 'burn'), format: 'standard',
    validation: { valid: true, violations: [], counts: { total: 28, lands: 20 } },
  });

  assert.equal(out.text_path, join(dir, 'burn.txt'));
  assert.equal(out.breakdown_path, join(dir, 'burn.md'));
  assert.match(readFileSync(out.text_path, 'utf8'), /4 Lightning Bolt/);
  assert.match(readFileSync(out.breakdown_path, 'utf8'), /# /);
});

test('lang=es adds a Spanish name column to the breakdown only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtg-'));
  const out = exportDeck({
    cards: CARDS, path: join(dir, 'burn'), format: 'standard', lang: 'es',
    validation: { valid: true, violations: [], counts: { total: 28, lands: 20 } },
  });

  assert.match(readFileSync(out.breakdown_path, 'utf8'), /Rayo/);
  // The importable list must stay English.
  assert.equal(readFileSync(out.text_path, 'utf8').includes('Rayo'), false);
});
