import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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
