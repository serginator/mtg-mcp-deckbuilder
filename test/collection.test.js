import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { ingestCards } from '../sync.js';
import { parseCsv, importCollection, listCollections } from '../collection.js';

const CSV = fileURLToPath(new URL('./fixtures/manabox.csv', import.meta.url));

async function seeded() {
  const db = openDb(':memory:');
  const lines = readFileSync(new URL('./fixtures/cards.jsonl', import.meta.url), 'utf8')
    .split('\n').filter(Boolean);
  await ingestCards(db, lines);
  return db;
}

test('parses quoted fields containing commas', () => {
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  assert.equal(rows.length, 4);
  assert.equal(rows[1].Name, 'Kiki-Jiki, Mirror Breaker');
  assert.equal(rows[1]['Scryfall ID'], 'en-3');
  assert.equal(rows[0].Quantity, '2');
});

test('imports matched rows and reports unmatched ones', async () => {
  const db = await seeded();
  const result = importCollection(db, 'hobbit', CSV);

  assert.equal(result.imported, 3);
  assert.deepEqual(result.unmatched, ['Unknown Card']);
  assert.equal(result.quantity, 4);   // 2 + 1 + 1
  db.close();
});

test('re-importing a name replaces the previous contents entirely', async () => {
  const db = await seeded();
  importCollection(db, 'hobbit', CSV);
  importCollection(db, 'hobbit', CSV);

  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM collection_cards WHERE collection='hobbit'`).get().n;
  assert.equal(n, 3);   // not 6
  db.close();
});

test('the same card in two sets is stored as two rows', async () => {
  const db = await seeded();
  importCollection(db, 'hobbit', CSV);

  const ids = db.prepare(
    `SELECT scryfall_id FROM collection_cards WHERE collection='hobbit' ORDER BY scryfall_id`)
    .all().map((r) => r.scryfall_id);
  assert.deepEqual(ids, ['en-1', 'en-2', 'en-3']);
  db.close();
});

test('listCollections summarises colors and counts', async () => {
  const db = await seeded();
  importCollection(db, 'hobbit', CSV);

  const [col] = listCollections(db);

  assert.equal(col.name, 'hobbit');
  assert.equal(col.unique_cards, 2);   // o-bolt and o-precious
  assert.equal(col.total_cards, 4);
  assert.deepEqual(col.colors.sort(), ['B', 'R']);
  db.close();
});
