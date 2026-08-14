import { test } from 'node:test';
import assert from 'node:assert';
import { extractCard, extractPrinting } from '../db.js';

const BOLT = {
  object: 'card', id: 'aaa-1', oracle_id: 'oracle-bolt', lang: 'en',
  name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
  type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  colors: ['R'], color_identity: ['R'], keywords: [],
  set: 'lea', collector_number: '161', rarity: 'common',
  legalities: { standard: 'not_legal', modern: 'legal', commander: 'legal' },
  edhrec_rank: 400,
};

// Adventure layout: no top-level oracle_text, both faces in card_faces.
const PRECIOUS = {
  object: 'card', id: 'bbb-1', oracle_id: 'oracle-precious', lang: 'en',
  name: 'My Precious // Allure of Power', mana_cost: '{3}', cmc: 3,
  type_line: 'Legendary Artifact — Equipment // Instant — Adventure',
  colors: [], color_identity: ['B'], keywords: [],
  set: 'hob', collector_number: '176', rarity: 'rare',
  legalities: { commander: 'legal' },
  card_faces: [
    { name: 'My Precious', mana_cost: '{3}',
      type_line: 'Legendary Artifact — Equipment',
      oracle_text: 'Equipped creature has hexproof.' },
    { name: 'Allure of Power', mana_cost: '{1}{B}',
      type_line: 'Instant — Adventure',
      oracle_text: 'Target player draws two cards.' },
  ],
};

// Transform layout: no top-level mana_cost either.
const WEREWOLF = {
  object: 'card', id: 'ccc-1', oracle_id: 'oracle-wolf', lang: 'en',
  name: 'Village Watch // Village Reavers', cmc: 4,
  type_line: 'Creature — Human // Creature — Werewolf',
  colors: ['R'], color_identity: ['R'], keywords: ['Transform'],
  set: 'mid', collector_number: '10', rarity: 'uncommon', legalities: {},
  card_faces: [
    { name: 'Village Watch', mana_cost: '{3}{R}', type_line: 'Creature — Human',
      oracle_text: 'Vigilance.' },
    { name: 'Village Reavers', mana_cost: '', type_line: 'Creature — Werewolf',
      oracle_text: 'Haste.' },
  ],
};

const SPANISH = {
  object: 'card', id: 'ddd-1', oracle_id: 'oracle-crooked', lang: 'es',
  name: 'Along the Crooked Way', printed_name: 'Por un camino tortuoso',
  printed_text: 'Cuando este encantamiento entre...',
  printed_type_line: 'Encantamiento',
  set: 'hob', collector_number: '60', rarity: 'common',
  cmc: 3, type_line: 'Enchantment', oracle_text: 'When this enchantment enters...',
  colors: ['G'], color_identity: ['G'], keywords: [], legalities: {},
};

test('extracts a simple single-faced card', () => {
  const row = extractCard(BOLT);
  assert.equal(row.oracle_id, 'oracle-bolt');
  assert.equal(row.name, 'Lightning Bolt');
  assert.equal(row.mana_cost, '{R}');
  assert.equal(row.oracle_text, 'Lightning Bolt deals 3 damage to any target.');
  assert.equal(row.colors, '["R"]');
  assert.equal(row.game_changer, 0);
  assert.equal(JSON.parse(row.legalities).modern, 'legal');
});

test('joins faces when top-level oracle_text is absent', () => {
  const row = extractCard(PRECIOUS);
  assert.equal(row.oracle_text,
    'Equipped creature has hexproof.\n//\nTarget player draws two cards.');
  assert.equal(row.mana_cost, '{3}');    // top-level wins when present
});

test('joins face mana costs when top-level mana_cost is absent', () => {
  const row = extractCard(WEREWOLF);
  assert.equal(row.mana_cost, '{3}{R}');  // first face with a cost
  assert.equal(row.oracle_text, 'Vigilance.\n//\nHaste.');
});

test('returns null for records with no oracle_id', () => {
  assert.equal(extractCard({ object: 'card', name: 'Weird Token' }), null);
  assert.equal(extractPrinting({ object: 'card', name: 'Weird Token' }), null);
});

test('extracts a Spanish printing with printed fields', () => {
  const p = extractPrinting(SPANISH);
  assert.equal(p.scryfall_id, 'ddd-1');
  assert.equal(p.oracle_id, 'oracle-crooked');
  assert.equal(p.lang, 'es');
  assert.equal(p.printed_name, 'Por un camino tortuoso');
  assert.equal(p.set_code, 'hob');
  assert.equal(p.collector_number, '60');
});

test('English printing has null printed_name when Scryfall omits it', () => {
  const p = extractPrinting(BOLT);
  assert.equal(p.printed_name, null);
  assert.equal(p.lang, 'en');
});
