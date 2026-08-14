import { test } from 'node:test';
import assert from 'node:assert';
import { openDb, applySchema } from '../db.js';

test('openDb creates every table', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);

  for (const t of ['cards', 'printings', 'tags', 'collections', 'collection_cards', 'meta']) {
    assert.ok(names.includes(t), `missing table ${t} in ${names}`);
  }
  db.close();
});

test('applySchema is idempotent', () => {
  const db = openDb(':memory:');
  applySchema(db);
  applySchema(db);            // must not throw
  assert.ok(true);
  db.close();
});

test('deleting a collection cascades to its cards', () => {
  const db = openDb(':memory:');
  db.exec(`PRAGMA foreign_keys = ON`);
  db.prepare(`INSERT INTO collections (name, source, updated_at) VALUES (?, ?, ?)`)
    .run('hobbit', '/tmp/x.csv', '2026-08-14');
  db.prepare(`INSERT INTO collection_cards (collection, scryfall_id, quantity, foil)
              VALUES (?, ?, ?, ?)`).run('hobbit', 'abc', 2, 'normal');

  db.prepare(`DELETE FROM collections WHERE name = ?`).run('hobbit');

  const left = db.prepare(`SELECT COUNT(*) AS n FROM collection_cards`).get().n;
  assert.equal(left, 0);
  db.close();
});
