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
