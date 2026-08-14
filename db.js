import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isBasicLand } from './rules.js';

export const DB_PATH = join(homedir(), '.mtg-mcp', 'mtg.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  oracle_id      TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  mana_cost      TEXT,
  cmc            REAL,
  type_line      TEXT,
  oracle_text    TEXT,
  colors         TEXT,
  color_identity TEXT,
  keywords       TEXT,
  produced_mana  TEXT,
  power          TEXT,
  toughness      TEXT,
  legalities     TEXT,
  edhrec_rank    INTEGER,
  game_changer   INTEGER,
  raw            TEXT
);
CREATE INDEX IF NOT EXISTS cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS cards_cmc  ON cards(cmc);

CREATE TABLE IF NOT EXISTS printings (
  scryfall_id       TEXT PRIMARY KEY,
  oracle_id         TEXT NOT NULL,
  lang              TEXT NOT NULL,
  set_code          TEXT,
  collector_number  TEXT,
  rarity            TEXT,
  printed_name      TEXT,
  printed_text      TEXT,
  printed_type_line TEXT
);
CREATE INDEX IF NOT EXISTS printings_oracle ON printings(oracle_id, lang);

CREATE TABLE IF NOT EXISTS tags (
  oracle_id TEXT NOT NULL,
  tag       TEXT NOT NULL,
  weight    TEXT
);
CREATE INDEX IF NOT EXISTS tags_oracle ON tags(oracle_id);
CREATE INDEX IF NOT EXISTS tags_tag    ON tags(tag);

CREATE TABLE IF NOT EXISTS collections (
  name       TEXT PRIMARY KEY,
  source     TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS collection_cards (
  collection  TEXT NOT NULL REFERENCES collections(name) ON DELETE CASCADE,
  scryfall_id TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  foil        TEXT,
  PRIMARY KEY (collection, scryfall_id, foil)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

export function applySchema(db) {
  db.exec(SCHEMA);
}

export function openDb(path = DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL`);
  db.exec(`PRAGMA foreign_keys = ON`);
  applySchema(db);
  return db;
}

// Multi-face cards (adventure, transform, modal_dfc, split) put oracle_text —
// and sometimes mana_cost — only on the faces. Join them so a single column
// holds everything the card does.
function faceJoin(card, field) {
  if (card[field] != null && card[field] !== '') return card[field];
  const faces = card.card_faces ?? [];
  const parts = faces.map((f) => f[field]).filter((v) => v != null && v !== '');
  if (parts.length === 0) return null;
  return field === 'oracle_text' ? parts.join('\n//\n') : parts[0];
}

export function extractCard(card) {
  if (!card.oracle_id) return null;
  return {
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: faceJoin(card, 'mana_cost'),
    cmc: card.cmc ?? null,
    type_line: faceJoin(card, 'type_line'),
    oracle_text: faceJoin(card, 'oracle_text'),
    colors: JSON.stringify(card.colors ?? []),
    color_identity: JSON.stringify(card.color_identity ?? []),
    keywords: JSON.stringify(card.keywords ?? []),
    produced_mana: JSON.stringify(card.produced_mana ?? []),
    power: faceJoin(card, 'power'),
    toughness: faceJoin(card, 'toughness'),
    legalities: JSON.stringify(card.legalities ?? {}),
    edhrec_rank: card.edhrec_rank ?? null,
    game_changer: card.game_changer ? 1 : 0,
    raw: JSON.stringify(card),
  };
}

export function extractPrinting(card) {
  if (!card.oracle_id) return null;
  return {
    scryfall_id: card.id,
    oracle_id: card.oracle_id,
    lang: card.lang,
    set_code: card.set ?? null,
    collector_number: card.collector_number ?? null,
    rarity: card.rarity ?? null,
    printed_name: card.printed_name ?? null,
    printed_text: card.printed_text ?? null,
    printed_type_line: card.printed_type_line ?? null,
  };
}

// The shape Claude reads. Print-level fields are stripped — a 150-card
// collection lands around 15k tokens like this, small enough to read whole.
function toCard(row, tags = []) {
  return {
    name: row.name,
    mana_cost: row.mana_cost,
    cmc: row.cmc,
    type_line: row.type_line,
    oracle_text: row.oracle_text,
    color_identity: JSON.parse(row.color_identity ?? '[]'),
    keywords: JSON.parse(row.keywords ?? '[]'),
    legalities: JSON.parse(row.legalities ?? '{}'),
    game_changer: row.game_changer === 1,
    tags,
  };
}

function tagsFor(db, oracleIds) {
  const map = new Map(oracleIds.map((id) => [id, []]));
  if (oracleIds.length === 0) return map;
  const marks = oracleIds.map(() => '?').join(',');
  for (const r of db.prepare(
    `SELECT oracle_id, tag FROM tags WHERE oracle_id IN (${marks})`).all(...oracleIds)) {
    map.get(r.oracle_id)?.push(r.tag);
  }
  return map;
}

export function getCollection(db, name, { lang = null } = {}) {
  const rows = db.prepare(`
    SELECT c.*, SUM(cc.quantity) AS quantity
    FROM collection_cards cc
    JOIN printings p ON p.scryfall_id = cc.scryfall_id
    JOIN cards c     ON c.oracle_id   = p.oracle_id
    WHERE cc.collection = ?
    GROUP BY c.oracle_id
    ORDER BY c.cmc, c.name`).all(name);

  const tags = tagsFor(db, rows.map((r) => r.oracle_id));
  const printed = lang
    ? db.prepare(`SELECT oracle_id, printed_name FROM printings WHERE lang = ?`)
        .all(lang)
    : [];
  const printedBy = new Map(printed.map((p) => [p.oracle_id, p.printed_name]));

  return rows.map((r) => {
    const card = { ...toCard(r, tags.get(r.oracle_id) ?? []), quantity: r.quantity };
    if (lang && printedBy.get(r.oracle_id)) card.printed_name = printedBy.get(r.oracle_id);
    return card;
  });
}

export function searchCards(db, filters = {}) {
  const {
    colors, color_identity, types, text, cmc_min, cmc_max,
    tags: wantTags, format, collection, limit = 100,
  } = filters;

  const where = [];
  const params = [];
  const from = collection
    ? `FROM cards c
       JOIN printings p       ON p.oracle_id   = c.oracle_id
       JOIN collection_cards cc ON cc.scryfall_id = p.scryfall_id AND cc.collection = ?`
    : `FROM cards c`;
  if (collection) params.push(collection);

  if (types) { where.push(`c.type_line LIKE ?`); params.push(`%${types}%`); }
  if (text)  { where.push(`c.oracle_text LIKE ?`); params.push(`%${text}%`); }
  if (cmc_min != null) { where.push(`c.cmc >= ?`); params.push(cmc_min); }
  if (cmc_max != null) { where.push(`c.cmc <= ?`); params.push(cmc_max); }
  if (format) {
    where.push(`json_extract(c.legalities, '$.' || ?) = 'legal'`);
    params.push(format);
  }
  for (const col of colors ?? []) {
    where.push(`c.colors LIKE ?`); params.push(`%"${col}"%`);
  }
  for (const col of color_identity ?? []) {
    where.push(`c.color_identity LIKE ?`); params.push(`%"${col}"%`);
  }
  for (const tag of wantTags ?? []) {
    where.push(`EXISTS (SELECT 1 FROM tags t WHERE t.oracle_id = c.oracle_id AND t.tag = ?)`);
    params.push(tag);
  }

  const sql = `SELECT c.*, ${collection ? 'SUM(cc.quantity)' : 'NULL'} AS quantity
    ${from}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY c.oracle_id
    ORDER BY c.cmc, c.name
    LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit);

  const tagMap = tagsFor(db, rows.map((r) => r.oracle_id));
  return rows.map((r) => {
    const card = toCard(r, tagMap.get(r.oracle_id) ?? []);
    if (r.quantity != null) card.quantity = r.quantity;
    return card;
  });
}

// Basic lands are always available even when the card table has no row for the
// printing the user owns — they are never "missing".
function basicLandCard(name) {
  const type = name.replace('Snow-Covered ', '');
  const colorOf = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
  const color = colorOf[type];
  return {
    name, mana_cost: '', cmc: 0,
    type_line: `Basic ${name.startsWith('Snow-Covered') ? 'Snow ' : ''}Land — ${type}`,
    oracle_text: color ? `({T}: Add {${color}}.)` : '({T}: Add {C}.)',
    color_identity: [], keywords: [],
    legalities: { standard: 'legal', commander: 'legal' },
    game_changer: false, tags: ['land'],
  };
}

export function hydrateDeck(db, entries) {
  const byName = db.prepare(`SELECT * FROM cards WHERE name = ? LIMIT 1`);
  const cards = [];
  const missing = [];
  for (const { name, quantity = 1 } of entries) {
    if (isBasicLand(name)) {
      cards.push({ ...basicLandCard(name), quantity });
      continue;
    }
    const row = byName.get(name);
    if (!row) { missing.push(name); continue; }
    cards.push({ ...toCard(row, []), quantity });
  }
  return { cards, missing };
}
