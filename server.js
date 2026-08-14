#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { openDb, DB_PATH, getCollection, searchCards, hydrateDeck } from './db.js';
import { syncData, dataAge } from './sync.js';
import { importCollection, listCollections } from './collection.js';
import { validateDeck } from './rules.js';
import { findCombos, edhrecCommander, searchDecks, scryfallSearch } from './external.js';
import { exportDeck } from './export.js';

const dbPath = process.env.MTG_MCP_DB ?? DB_PATH;

const text = (value) => ({
  content: [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 1),
  }],
});
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

// Opens the database and refuses to proceed if sync_data has never run —
// every card query would silently return nothing otherwise.
function withDb(fn, { requireSync = true } = {}) {
  return async (args) => {
    const db = openDb(dbPath);
    try {
      if (requireSync && dataAge(db) === null) {
        return fail('No card data yet. Run sync_data first — it downloads ~374 MB '
          + 'from Scryfall and takes several minutes.');
      }
      return await fn(db, args);
    } catch (e) {
      return fail(`${e.message}`);
    } finally {
      db.close();
    }
  };
}

const server = new McpServer({ name: 'mtg-mcp', version: '0.1.0' });

const deckCardSchema = z.array(z.object({
  name: z.string(),
  quantity: z.number().int().positive().default(1),
}));

server.registerTool('sync_data', {
  description: 'Download Scryfall bulk card data into the local database. '
    + 'Downloads ~374 MB and takes several minutes. Run once, then after each set release.',
  inputSchema: { force: z.boolean().default(false)
    .describe('Re-sync even if the data is less than a day old') },
}, async ({ force }) => {
  try {
    return text(await syncData({ force, dbPath }));
  } catch (e) {
    return fail(`Sync failed: ${e.message}`);
  }
});

server.registerTool('import_collection', {
  description: 'Import a ManaBox CSV export under a name. Re-importing the same '
    + 'name replaces the previous contents entirely.',
  inputSchema: {
    name: z.string().describe('Name to store this collection under, e.g. "hobbit"'),
    path: z.string().describe('Absolute path to the ManaBox CSV export'),
  },
}, withDb(async (db, { name, path }) => text(importCollection(db, name, path)), { requireSync: false }));

server.registerTool('list_collections', {
  description: 'List imported collections with card counts and colors present.',
  inputSchema: {},
}, withDb(async (db) => text(listCollections(db)), { requireSync: false }));

server.registerTool('get_collection', {
  description: 'Every card in a collection with its full gameplay data — oracle text, '
    + 'type, mana value, color identity, functional tags, legalities, and quantity owned.',
  inputSchema: {
    name: z.string(),
    lang: z.enum(['es']).optional()
      .describe('Add printed_name in this language for finding physical cards'),
  },
}, withDb(async (db, { name, lang }) => text(getCollection(db, name, { lang }))));

server.registerTool('search_cards', {
  description: 'Search cards. Structured filters run against the local database. '
    + 'Use scryfall_query for the full Scryfall syntax against the live API.',
  inputSchema: {
    colors: z.array(z.string()).optional().describe('e.g. ["R","G"]'),
    color_identity: z.array(z.string()).optional(),
    types: z.string().optional().describe('Substring of the type line, e.g. "Creature"'),
    text: z.string().optional().describe('Substring of the oracle text'),
    cmc_min: z.number().optional(),
    cmc_max: z.number().optional(),
    tags: z.array(z.string()).optional().describe('Functional tags, e.g. ["removal","ramp"]'),
    format: z.string().optional().describe('Only cards legal in this format'),
    collection: z.string().optional().describe('Restrict to cards in this collection'),
    limit: z.number().int().positive().default(100),
    scryfall_query: z.string().optional()
      .describe('Raw Scryfall syntax; bypasses all other filters'),
  },
}, withDb(async (db, args) => {
  if (args.scryfall_query) return text(await scryfallSearch(args.scryfall_query, args.limit));
  return text(searchCards(db, args));
}));

server.registerTool('validate_deck', {
  description: 'Check a decklist against a format. Returns every violation at once. '
    + 'Basic lands are always available and never reported as missing.',
  inputSchema: {
    cards: deckCardSchema,
    format: z.enum(['standard', 'commander', 'limited']),
    commander: z.string().optional(),
    sideboard: deckCardSchema.optional(),
  },
}, withDb(async (db, { cards, format, commander, sideboard = [] }) => {
  const main = hydrateDeck(db, cards);
  const side = hydrateDeck(db, sideboard);
  const result = validateDeck({
    cards: main.cards, format, commander, sideboard: side.cards,
  });
  const missing = [...main.missing, ...side.missing];
  if (missing.length > 0) {
    result.violations.push({
      rule: 'unknown_card',
      message: 'Not found in the card database. Check spelling, or run sync_data '
        + 'if these are from a new set.',
      cards: missing,
    });
    result.valid = false;
  }
  return text(result);
}));

server.registerTool('find_combos', {
  description: 'Find card combos present in a list, plus combos it is one card away from. '
    + 'Uses Commander Spellbook.',
  inputSchema: { cards: z.array(z.string()).describe('Card names') },
}, async ({ cards }) => text(await findCombos(cards)));

server.registerTool('edhrec', {
  description: 'EDHREC synergy data for a commander: high-synergy cards, top cards, '
    + 'and themes.',
  inputSchema: { commander: z.string() },
}, async ({ commander }) => text(await edhrecCommander(commander)));

server.registerTool('search_decks', {
  description: 'Search decks other people have built, via Archidekt.',
  inputSchema: {
    format: z.enum(['standard', 'commander']),
    query: z.string().default(''),
    limit: z.number().int().positive().default(10),
  },
}, async (args) => text(await searchDecks(args)));

server.registerTool('export_deck', {
  description: 'Write a decklist to disk: a .txt importable by Archidekt and Moxfield, '
    + 'and a .md breakdown with curve, composition, and reasoning.',
  inputSchema: {
    cards: deckCardSchema,
    path: z.string().describe('Path without extension; .txt and .md are both written'),
    format: z.enum(['standard', 'commander', 'limited']),
    commander: z.string().optional(),
    notes: z.string().default('').describe('The gameplan and synergy explanation'),
    lang: z.enum(['es']).optional().describe('Add a Spanish name column to the breakdown'),
  },
}, withDb(async (db, { cards, path, format, commander, notes, lang }) => {
  const { cards: hydrated, missing } = hydrateDeck(db, cards);
  if (missing.length > 0) return fail(`Unknown cards: ${missing.join(', ')}`);
  const validation = validateDeck({ cards: hydrated, format, commander });
  return text(exportDeck({
    cards: hydrated, path, format, commander, notes, validation, lang,
  }));
}));

const transport = new StdioServerTransport();
await server.connect(transport);
