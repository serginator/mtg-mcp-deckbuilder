import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../db.js';
import { ingestCards, ingestTags } from '../sync.js';

// Sends JSON-RPC lines to server.js and collects the responses.
// A trailing object with no `jsonrpc` field is options, not a request.
async function rpc(...args) {
  const opts = (args.at(-1) && !args.at(-1).jsonrpc) ? args.pop() : {};
  const proc = spawn('node', ['server.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    ...args,
  ];
  proc.stdin.write(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  proc.stdin.end();

  let out = '';
  for await (const chunk of proc.stdout) out += chunk;
  await new Promise((r) => proc.on('close', r));

  const byId = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    const msg = JSON.parse(line);
    if (msg.id !== undefined) byId.set(msg.id, msg);
  }
  return byId;
}

// Build a seeded database and point the server at it via MTG_MCP_DB.
async function seedDb() {
  const path = join(mkdtempSync(join(tmpdir(), 'mtgsrv-')), 'test.db');
  const db = openDb(path);
  await ingestCards(db, readFileSync(
    new URL('./fixtures/cards.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean));
  ingestTags(db, JSON.parse(readFileSync(
    new URL('./fixtures/tags.json', import.meta.url), 'utf8')));
  db.close();
  return path;
}

test('every documented tool is registered', async () => {
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = res.get(2).result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'edhrec', 'export_deck', 'find_combos', 'get_collection', 'import_collection',
    'list_collections', 'search_cards', 'search_decks', 'sync_data', 'validate_deck',
  ]);
});

test('import_collection then get_collection round-trips through MCP', async () => {
  const dbPath = await seedDb();
  const csv = fileURLToPath(new URL('./fixtures/manabox.csv', import.meta.url));

  const res = await rpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
      name: 'import_collection', arguments: { name: 'hobbit', path: csv } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'get_collection', arguments: { name: 'hobbit' } } },
    { env: { MTG_MCP_DB: dbPath } });

  const imported = JSON.parse(res.get(2).result.content[0].text);
  assert.equal(imported.imported, 3);
  assert.deepEqual(imported.unmatched, ['Unknown Card']);

  const cards = JSON.parse(res.get(3).result.content[0].text);
  assert.equal(cards.find((c) => c.name === 'Lightning Bolt').quantity, 3);
});

test('validate_deck reports missing cards and violations together', async () => {
  const dbPath = await seedDb();
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'validate_deck', arguments: {
      format: 'standard',
      cards: [{ name: 'Lightning Bolt', quantity: 5 }, { name: 'Mountain', quantity: 20 }],
    } } }, { env: { MTG_MCP_DB: dbPath } });

  const out = JSON.parse(res.get(2).result.content[0].text);
  assert.equal(out.valid, false);
  const rules = out.violations.map((v) => v.rule);
  assert.ok(rules.includes('deck_size'));
  assert.ok(rules.includes('copy_limit'));
});

test('tools report a helpful error when the database has never been synced', async () => {
  const empty = join(mkdtempSync(join(tmpdir(), 'mtgempty-')), 'x.db');
  const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'get_collection', arguments: { name: 'nope' } } }, { env: { MTG_MCP_DB: empty } });

  assert.match(res.get(2).result.content[0].text, /sync_data/);
});

export { rpc };
