import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { openDb } from '../db.js';
import { ingestCards, ingestTags, dataAge } from '../sync.js';

const lines = () =>
  readFileSync(new URL('./fixtures/cards.jsonl', import.meta.url), 'utf8')
    .split('\n').filter(Boolean);

test('ingests English and Spanish, drops other languages', async () => {
  const db = openDb(':memory:');
  const stats = await ingestCards(db, lines());

  // 2 unique oracle_ids with English printings
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM cards`).get().n, 2);
  // en-1, en-2, en-3, es-1 — fr-1 filtered, weird-1 skipped
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM printings`).get().n, 4);
  assert.equal(db.prepare(
    `SELECT COUNT(*) AS n FROM printings WHERE lang='fr'`).get().n, 0);
  assert.equal(stats.skipped, 1);
  db.close();
});

test('a card with several printings yields exactly one cards row', async () => {
  const db = openDb(':memory:');
  await ingestCards(db, lines());

  const n = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE oracle_id='o-bolt'`).get().n;
  assert.equal(n, 1);
  const prints = db.prepare(
    `SELECT COUNT(*) AS n FROM printings WHERE oracle_id='o-bolt'`).get().n;
  assert.equal(prints, 3);   // en-1, en-2, es-1
  db.close();
});

test('Spanish printed_name is queryable by oracle_id', async () => {
  const db = openDb(':memory:');
  await ingestCards(db, lines());

  const row = db.prepare(
    `SELECT printed_name FROM printings WHERE oracle_id=? AND lang='es'`).get('o-bolt');
  assert.equal(row.printed_name, 'Rayo');
  db.close();
});

test('multi-face card keeps joined oracle text through ingest', async () => {
  const db = openDb(':memory:');
  await ingestCards(db, lines());

  const row = db.prepare(`SELECT oracle_text FROM cards WHERE oracle_id='o-precious'`).get();
  assert.match(row.oracle_text, /hexproof/);
  assert.match(row.oracle_text, /draws two cards/);
  db.close();
});

test('ingestTags writes one row per tagging and skips empty parents', () => {
  const db = openDb(':memory:');
  const tags = JSON.parse(
    readFileSync(new URL('./fixtures/tags.json', import.meta.url), 'utf8'));

  const n = ingestTags(db, tags);

  assert.equal(n, 2);
  const row = db.prepare(`SELECT tag, weight FROM tags WHERE oracle_id='o-bolt'`).get();
  assert.equal(row.tag, 'removal');
  assert.equal(row.weight, 'very_strong');
  db.close();
});

test('dataAge returns null before any sync', () => {
  const db = openDb(':memory:');
  assert.equal(dataAge(db), null);
  db.close();
});

test('dataAge reports days since the recorded sync', async () => {
  const db = openDb(':memory:');
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  db.prepare(`INSERT INTO meta (key, value) VALUES ('synced_at', ?)`).run(threeDaysAgo);

  const age = dataAge(db);

  assert.equal(age.days_old, 3);
  db.close();
});
