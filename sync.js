import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { renameSync, rmSync, existsSync } from 'node:fs';
import { openDb, extractCard, extractPrinting, DB_PATH } from './db.js';

const UA = { 'User-Agent': 'mtg-mcp/0.1', Accept: '*/*' };
const KEEP_LANGS = new Set(['en', 'es']);

export async function bulkIndex() {
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: UA });
  if (!res.ok) throw new Error(`bulk-data index failed: ${res.status}`);
  const body = await res.json();
  return new Map(body.data.map((d) => [d.type, d]));
}

// Streams a gzipped JSONL URL as an async iterable of strings. Never buffers
// the whole file — all-cards is ~3.1 GB uncompressed.
async function* gzipLines(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const stream = Readable.fromWeb(res.body).pipe(createGunzip());
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (line) yield line;
  }
}

export async function ingestCards(db, lines) {
  const insCard = db.prepare(`
    INSERT OR IGNORE INTO cards (oracle_id, name, mana_cost, cmc, type_line,
      oracle_text, colors, color_identity, keywords, produced_mana, power,
      toughness, legalities, edhrec_rank, game_changer, raw)
    VALUES (:oracle_id, :name, :mana_cost, :cmc, :type_line, :oracle_text,
      :colors, :color_identity, :keywords, :produced_mana, :power, :toughness,
      :legalities, :edhrec_rank, :game_changer, :raw)`);
  const insPrint = db.prepare(`
    INSERT OR REPLACE INTO printings (scryfall_id, oracle_id, lang, set_code,
      collector_number, rarity, printed_name, printed_text, printed_type_line)
    VALUES (:scryfall_id, :oracle_id, :lang, :set_code, :collector_number,
      :rarity, :printed_name, :printed_text, :printed_type_line)`);

  let cards = 0, printings = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for await (const line of lines) {
      let card;
      try { card = JSON.parse(line); } catch { skipped++; continue; }
      if (!KEEP_LANGS.has(card.lang)) continue;

      const p = extractPrinting(card);
      if (!p) { skipped++; continue; }
      insPrint.run(p);
      printings++;

      // cards holds gameplay data only, sourced from English printings.
      // INSERT OR IGNORE means the first English printing seen wins; oracle
      // data is identical across printings so which one does not matter.
      if (card.lang === 'en') {
        const c = extractCard(card);
        if (c) cards += insCard.run(c).changes;
      }
    }
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('synced_at', ?)`)
      .run(new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { cards, printings, skipped };
}

export function ingestTags(db, tags) {
  const ins = db.prepare(
    `INSERT INTO tags (oracle_id, tag, weight) VALUES (?, ?, ?)`);
  let n = 0;
  db.exec('BEGIN');
  try {
    for (const tag of tags) {
      // Parent tags carry no taggings of their own; their children hold them.
      for (const tagging of tag.taggings ?? []) {
        if (!tagging.oracle_id) continue;
        ins.run(tagging.oracle_id, tag.slug, tagging.weight ?? null);
        n++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return n;
}

export function dataAge(db) {
  const row = db.prepare(`SELECT value FROM meta WHERE key='synced_at'`).get();
  if (!row) return null;
  return {
    synced_at: row.value,
    days_old: Math.floor((Date.now() - Date.parse(row.value)) / 86400_000),
  };
}

export async function syncData({ force = false, dbPath = DB_PATH } = {}) {
  const existing = openDb(dbPath);
  const age = dataAge(existing);
  existing.close();
  if (age && age.days_old < 1 && !force) {
    return { skipped: true, reason: 'synced less than a day ago', ...age };
  }

  const index = await bulkIndex();
  const cardsFile = index.get('all_cards');
  const tagsFile = index.get('oracle_tags');
  if (!cardsFile) throw new Error('all_cards missing from bulk index');

  // Build into a temp database and swap on success, so a failed 374 MB
  // download never leaves a half-populated database behind.
  const tmpPath = `${dbPath}.tmp`;
  if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
  const tmp = openDb(tmpPath);

  let stats;
  try {
    stats = await ingestCards(tmp, gzipLines(cardsFile.jsonl_download_uri));
    if (tagsFile) {
      const tags = [];
      for await (const line of gzipLines(tagsFile.jsonl_download_uri)) {
        try { tags.push(JSON.parse(line)); } catch { /* skip malformed lines */ }
      }
      stats.tags = ingestTags(tmp, tags);
    }
    tmp.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('bulk_updated_at', ?)`)
      .run(cardsFile.updated_at);
    tmp.close();
  } catch (e) {
    tmp.close();
    rmSync(tmpPath, { force: true });
    throw e;
  }

  // Collections live in the old database — carry them across before swapping.
  const carried = carryCollections(dbPath, tmpPath);
  renameSync(tmpPath, dbPath);
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  return { ...stats, collections_carried: carried, bulk_updated_at: cardsFile.updated_at };
}

// A sync rebuilds card data from scratch but must not destroy imported
// collections. Copy them from the live database into the temp one.
function carryCollections(fromPath, toPath) {
  if (!existsSync(fromPath)) return 0;
  const from = openDb(fromPath);
  const cols = from.prepare(`SELECT * FROM collections`).all();
  const cards = from.prepare(`SELECT * FROM collection_cards`).all();
  from.close();
  if (cols.length === 0) return 0;

  const to = openDb(toPath);
  const insCol = to.prepare(
    `INSERT OR REPLACE INTO collections (name, source, updated_at) VALUES (?, ?, ?)`);
  const insCard = to.prepare(
    `INSERT OR REPLACE INTO collection_cards (collection, scryfall_id, quantity, foil)
     VALUES (?, ?, ?, ?)`);
  to.exec('BEGIN');
  for (const c of cols) insCol.run(c.name, c.source, c.updated_at);
  for (const c of cards) insCard.run(c.collection, c.scryfall_id, c.quantity, c.foil);
  to.exec('COMMIT');
  to.close();
  return cols.length;
}
