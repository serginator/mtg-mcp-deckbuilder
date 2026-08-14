import { readFileSync } from 'node:fs';

// ManaBox emits RFC-4180-ish CSV: quoted fields when a value contains a comma,
// doubled quotes for a literal quote. It never emits embedded newlines, so a
// line-based parse is safe.
function splitLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

export function importCollection(db, name, path) {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const known = db.prepare(`SELECT 1 FROM printings WHERE scryfall_id = ?`);

  db.exec('BEGIN');
  try {
    // Replacing, not merging: a fresh ManaBox export is the truth.
    db.prepare(`DELETE FROM collections WHERE name = ?`).run(name);
    db.prepare(`DELETE FROM collection_cards WHERE collection = ?`).run(name);
    db.prepare(`INSERT INTO collections (name, source, updated_at) VALUES (?, ?, ?)`)
      .run(name, path, new Date().toISOString());

    const ins = db.prepare(`
      INSERT INTO collection_cards (collection, scryfall_id, quantity, foil)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(collection, scryfall_id, foil)
      DO UPDATE SET quantity = quantity + excluded.quantity`);

    let imported = 0, quantity = 0;
    const unmatched = [];
    for (const row of rows) {
      const id = row['Scryfall ID'];
      const qty = Number.parseInt(row.Quantity, 10) || 0;
      if (!id || !known.get(id)) { unmatched.push(row.Name); continue; }
      ins.run(name, id, qty, row.Foil || 'normal');
      imported++;
      quantity += qty;
    }
    db.exec('COMMIT');
    return { name, imported, quantity, unmatched };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listCollections(db) {
  return db.prepare(`SELECT * FROM collections ORDER BY name`).all().map((col) => {
    const stats = db.prepare(`
      SELECT COUNT(DISTINCT p.oracle_id) AS unique_cards,
             SUM(cc.quantity)            AS total_cards
      FROM collection_cards cc
      JOIN printings p ON p.scryfall_id = cc.scryfall_id
      WHERE cc.collection = ?`).get(col.name);

    const ids = db.prepare(`
      SELECT DISTINCT c.color_identity
      FROM collection_cards cc
      JOIN printings p ON p.scryfall_id = cc.scryfall_id
      JOIN cards c     ON c.oracle_id   = p.oracle_id
      WHERE cc.collection = ?`).all(col.name);

    const colors = [...new Set(ids.flatMap((r) => JSON.parse(r.color_identity)))].sort();
    return { ...col, unique_cards: stats.unique_cards ?? 0,
             total_cards: stats.total_cards ?? 0, colors };
  });
}
