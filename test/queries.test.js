import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, getCollection, searchCards, hydrateDeck } from '../db.js';
import { ingestCards, ingestTags } from '../sync.js';
import { importCollection } from '../collection.js';

const CSV = fileURLToPath(new URL('./fixtures/manabox.csv', import.meta.url));

async function seeded() {
  const db = openDb(':memory:');
  await ingestCards(db, readFileSync(
    new URL('./fixtures/cards.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean));
  ingestTags(db, JSON.parse(readFileSync(
    new URL('./fixtures/tags.json', import.meta.url), 'utf8')));
  importCollection(db, 'hobbit', CSV);
  return db;
}

test('getCollection returns hydrated cards with quantities summed per card', async () => {
  const db = await seeded();
  const cards = await getCollection(db, 'hobbit');

  const bolt = cards.find((c) => c.name === 'Lightning Bolt');
  assert.equal(bolt.quantity, 3);          // 2 from LEA + 1 from M10
  assert.equal(bolt.cmc, 1);
  assert.deepEqual(bolt.color_identity, ['R']);
  assert.deepEqual(bolt.tags, ['removal']);
  assert.equal(bolt.legalities.modern, 'legal');
  assert.equal(bolt.printed_name, undefined);   // no lang requested
  db.close();
});

test('getCollection with lang=es adds printed_name', async () => {
  const db = await seeded();
  const cards = await getCollection(db, 'hobbit', { lang: 'es' });

  const bolt = cards.find((c) => c.name === 'Lightning Bolt');
  assert.equal(bolt.printed_name, 'Rayo');
  db.close();
});

test('getCollection omits print-level noise', async () => {
  const db = await seeded();
  const [card] = await getCollection(db, 'hobbit');
  for (const key of ['raw', 'prices', 'image_uris', 'collector_number']) {
    assert.equal(card[key], undefined, `${key} should be stripped`);
  }
  db.close();
});

test('searchCards filters by color identity', async () => {
  const db = await seeded();
  const red = await searchCards(db, { color_identity: ['R'] });
  assert.deepEqual(red.map((c) => c.name), ['Lightning Bolt']);
  db.close();
});

test('searchCards filters by type and oracle text', async () => {
  const db = await seeded();
  assert.equal((await searchCards(db, { types: 'Instant' })).length, 1);
  assert.equal((await searchCards(db, { text: 'hexproof' })).length, 1);
  db.close();
});

test('searchCards filters by cmc range and tag', async () => {
  const db = await seeded();
  assert.equal((await searchCards(db, { cmc_min: 2, cmc_max: 5 })).length, 1);
  assert.deepEqual(
    (await searchCards(db, { tags: ['removal'] })).map((c) => c.name), ['Lightning Bolt']);
  db.close();
});

test('searchCards can be scoped to a collection', async () => {
  const db = await seeded();
  const owned = await searchCards(db, { collection: 'hobbit', types: 'Instant' });
  assert.equal(owned[0].quantity, 3);
  db.close();
});

test('hydrateDeck resolves names and reports unknown ones', async () => {
  const db = await seeded();
  const { cards, missing } = hydrateDeck(db, [
    { name: 'Lightning Bolt', quantity: 4 },
    { name: 'Forest', quantity: 20 },
    { name: 'Nonexistent Card', quantity: 1 },
  ]);

  assert.deepEqual(missing, ['Nonexistent Card']);
  const bolt = cards.find((c) => c.name === 'Lightning Bolt');
  assert.equal(bolt.quantity, 4);
  assert.equal(bolt.legalities.modern, 'legal');
  // Basic lands resolve even though they are not in the card fixtures.
  const forest = cards.find((c) => c.name === 'Forest');
  assert.equal(forest.quantity, 20);
  assert.match(forest.type_line, /Basic Land/);
  db.close();
});
