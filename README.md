# mtg-mcp-deckbuilder

An MCP server for building Magic: The Gathering decks from a collection you own.

Card data comes from Scryfall's bulk export, stored locally in SQLite via Node.js's built-in `node:sqlite` — no ORM, no external database process. The server serves data and enforces format rules; Claude reads the collection and builds the deck.

---

## Install

```bash
npm install
claude mcp add mtg -s local -- node "$PWD/server.js"
```

Then sync the card database. This downloads about 374 MB from Scryfall and takes several minutes. Run it once, and again after each set release.

```bash
node -e "import('./sync.js').then(m => m.syncData({ force: true }).then(console.log))"
```

Expected output: `{ cards: ~38000, printings: ~167000, skipped: …, tags: ~229000, … }`

---

## Use

Export your collection from ManaBox as CSV, then in Claude Code:

> Import ~/Downloads/hobbit.csv as my "hobbit" collection and build a Limited deck from it.

The `skills/mtg-deck` skill carries the deckbuilding workflow. Copy or symlink the `skills/mtg-deck/` directory into your Claude Code skills directory so Claude picks it up automatically.

---

## Tools

The server exposes 10 MCP tools.

### `sync_data`

Downloads Scryfall's bulk card export into the local SQLite database. Ingests English and Spanish printings; all other languages are dropped. Also downloads `oracle_tags` from Scryfall Tagger, which powers tag-based searches like `removal` and `ramp`.

**Parameters**

| Name | Type | Default | Description |
|---|---|---|---|
| `force` | boolean | `false` | Re-sync even if data is less than a day old |

**Returns** `{ cards, printings, skipped, tags, collections_carried, bulk_updated_at }` on success, or an error message if the download fails.

---

### `import_collection`

Imports a ManaBox CSV export under a name. Re-importing the same name replaces the previous contents entirely (replace-by-name semantics — no append, no merge).

The CSV is matched against the `printings` table by `scryfall_id`. Any rows that do not match a known printing are returned as `unmatched` so you can investigate. An `unmatched: []` result means every card in the CSV was found in the database.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | string | Name to store this collection under, e.g. `"hobbit"` |
| `path` | string | Absolute path to the ManaBox CSV export |

**Returns** `{ name, imported, quantity, unmatched }` — `imported` is the number of distinct CSV rows ingested, `quantity` is the total card count (sum of all quantities), and `unmatched` is a list of rows that could not be matched to any printing.

---

### `list_collections`

Lists all imported collections with summary statistics.

**Parameters** None.

**Returns** An array of `{ name, source, updated_at, unique_cards, total_cards, colors }` — one entry per collection. `colors` is the set of color identities present across all cards in the collection.

---

### `get_collection`

Returns every card in a collection with its full gameplay data: oracle text, type line, mana cost, CMC, color identity, functional tags, legalities, EDHREC rank, power/toughness, keywords, and quantity owned. Quantities are summed across all printings in the collection (owning the same card in two different sets counts as one card with quantity 2).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `name` | string | Collection name as registered with `import_collection` |
| `lang` | `"es"` (optional) | Add a `printed_name` field in Spanish for locating physical cards |

**Returns** An array of card objects. Each card has `quantity` (total owned), `oracle_id`, `name`, `mana_cost`, `cmc`, `type_line`, `oracle_text`, `color_identity`, `tags`, `legalities`, plus `printed_name` if `lang` was specified.

---

### `search_cards`

Searches cards using structured filters against the local database, or passes a raw Scryfall query to the live API.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `colors` | string[] | e.g. `["R","G"]` — cards whose colors are a subset |
| `color_identity` | string[] | Filter by Commander color identity |
| `types` | string | Substring of the type line, e.g. `"Creature"` |
| `text` | string | Substring of oracle text |
| `cmc_min` | number | Minimum converted mana cost |
| `cmc_max` | number | Maximum converted mana cost |
| `tags` | string[] | Functional tags, e.g. `["removal","ramp"]` |
| `format` | string | Only cards legal in this format |
| `collection` | string | Restrict to cards in this named collection |
| `limit` | number | Default 100 |
| `scryfall_query` | string | Raw Scryfall syntax; bypasses all other filters |

When `scryfall_query` is supplied, all other filters are ignored and the query goes directly to `https://api.scryfall.com/cards/search`.

**Returns** An array of card objects matching the filters.

---

### `validate_deck`

Checks a decklist against a format and returns every violation at once. Basic lands (Plains, Island, Swamp, Mountain, Forest, Snow-Covered basics, Wastes) are always available and never reported as missing.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cards` | `{ name, quantity }[]` | Main deck |
| `format` | `"standard"`, `"commander"`, `"limited"` | Format to validate against |
| `commander` | string (optional) | Required for Commander |
| `sideboard` | `{ name, quantity }[]` (optional) | Sideboard cards |

**Returns** `{ valid, violations, notes }`. `violations` is an array of `{ rule, message, cards }` objects — one entry per violated rule. `notes` carries non-error observations like Commander game-changer designations. If any card name is not found in the database, an `unknown_card` violation is added.

---

### `find_combos`

Looks up card combinations in Commander Spellbook. Returns combos that are fully present in the provided list, and combos that need exactly one more card (so you know what to search for to complete them).

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cards` | string[] | Card names to check |

**Returns** `{ found, almost }` — `found` is an array of complete combos (each with the cards, result description, and steps), and `almost` is combos one card away from completion.

---

### `edhrec`

Returns EDHREC synergy data for a Commander: high-synergy cards, top cards in the format, and thematic archetypes the commander supports.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `commander` | string | Commander card name |

**Returns** EDHREC recommendation data including `highSynergy`, `top` card lists, and `themes`. Useful for identifying which cards from a collection pair best with a particular commander.

---

### `search_decks`

Searches published decklists via Archidekt.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `format` | `"standard"`, `"commander"` | Format to search within |
| `query` | string | Search terms (default empty) |
| `limit` | number | Default 10 |

**Returns** An array of deck summaries including name, author, and card list. Useful for seeing how other players have built a theme before committing to a build.

---

### `export_deck`

Writes the finished decklist to disk in two formats: a `.txt` file importable by Archidekt and Moxfield, and a `.md` Markdown breakdown with mana curve, type composition, and the gameplan explanation.

The `.txt` file always uses English card names — even if the physical cards are in Spanish. The `.md` breakdown can optionally include a Spanish name column so the player can find the physical cards.

**Parameters**

| Name | Type | Description |
|---|---|---|
| `cards` | `{ name, quantity }[]` | The deck to export |
| `path` | string | Output path without extension; `.txt` and `.md` are both written |
| `format` | `"standard"`, `"commander"`, `"limited"` | Format |
| `commander` | string (optional) | Commander card name |
| `notes` | string | Gameplan and synergy explanation (goes into the `.md`) |
| `lang` | `"es"` (optional) | Add a Spanish name column to the Markdown breakdown |

**Returns** `{ txt, md, validation }` — paths to both written files, and the validation result at export time.

---

## The `mtg-deck` Skill

The `skills/mtg-deck/SKILL.md` file is a Claude Code skill that carries the complete deckbuilding workflow. When the skill is installed, Claude follows this 8-step process automatically:

### Step 0 — Pre-flight
Call `list_collections`. If the database has never been synced, tell the user and ask before starting the download. If the target collection is not listed, ask for the ManaBox CSV path and call `import_collection`.

### Step 1 — Read the collection
Call `get_collection` and read every card. Note the `tags` field on each card — functional labels like `removal`, `ramp`, `sacrifice-outlet`, and `token-generation` are the fastest route to spotting a theme.

### Step 2 — Survey
Report to the user:
- Color distribution by card count (two red cards is not a red deck)
- The most common tags and creature types
- The mana curve
- Any card that is obviously more powerful than the rest

### Step 3 — Find two or three candidate themes
A theme is real when the collection has both payoffs (cards that reward a behaviour) and enablers (cards that produce the input). The skill uses the rule that fewer than 5 payoffs is a coincidence, not a theme. Call `find_combos` with every card name — a two-card combo you already own often decides the theme. For Commander, also call `edhrec` on each candidate commander.

### Step 4 — Choose, and say why the others lost
Present the candidates with their payoff and enabler counts, recommend one, and give the reason.

### Step 5 — Build the nonlands first
Target counts before lands: Standard 36–38 nonlands + 22–24 lands; Commander 62–64 nonlands (plus the commander) + 36–38 lands; Limited 22–23 nonlands + 17–18 lands.

### Step 6 — Build the mana base
Count colored pips across all nonland cards weighted by copies. Split basics in that ratio. Cards you cannot cast on curve are worse than cards you do not play.

### Step 7 — Validate, fix, revalidate
Call `validate_deck`. Fix all violations before calling again. Do not present a deck that has not passed validation.

### Step 8 — Present and export
Give the user the decklist grouped by type, the gameplan in two or three sentences, the three or four key synergy cards, and what to cut first. Then call `export_deck`. If the collection is Spanish, pass `lang: "es"` so the breakdown carries Spanish names for finding physical cards.

### Installing the skill

Copy or symlink `skills/mtg-deck/` into your Claude Code skills directory:

```bash
# macOS/Linux — symlink so skill edits take effect immediately
ln -s "$PWD/skills/mtg-deck" ~/.claude/skills/mtg-deck
```

---

## Spanish Collection Support

The server handles Spanish (and English) printed names throughout. When Scryfall includes a Spanish printing, the `printed_name` and `printed_text` fields are stored in the `printings` table. Passing `lang: "es"` to `get_collection` or `export_deck` adds a `printed_name` column wherever the Spanish name is available.

**Important:** Oracle text (the rules text used for deck analysis) is always English. Spanish printed text can lag the current Oracle wording; the server and skill always reason from `oracle_text`, never from `printed_text`. Spanish names in the export breakdown are for locating physical cards only.

---

## Format Rules

### Standard
- Minimum 60 cards in the main deck
- Maximum 4 copies of any nonbasic card
- Sideboard: 0 or 15 cards
- Banned cards are reported as violations
- Basic lands (including Snow-Covered basics and Wastes) are always available in unlimited quantity

### Commander
- Exactly 100 cards total (99 + commander)
- Maximum 1 copy of any nonbasic card
- Every card's color identity must be within the commander's color identity
- The commander must be a legendary creature (or have the designated "can be your commander" text)
- Cards designated as "game changers" are noted (not violations)
- Basic lands are always available

### Limited (Sealed / Draft)
- Minimum 40 cards
- No copy limit on nonbasic cards
- Format legality is not checked (Limited pools include cards from any set)
- Basic lands are always available

---

## Collection Management

Collections are stored by name. Re-importing a collection with the same name **replaces** the previous contents entirely — there is no append or merge mode. This makes it easy to re-export from ManaBox after acquiring new cards and have the database reflect the current state.

A full database resync (`sync_data`) rebuilds the card tables from scratch but carries all collections across before swapping the database, so collections are never lost on resync.

---

## Manual End-to-End Verification

Step 6 of the integration checklist requires building a real deck in a live Claude Code session. This cannot be automated — it requires Claude to be running interactively with the `mtg` MCP server connected.

To run this verification yourself:

1. Open a Claude Code session (the `mtg` server must show `✔ Connected` in `claude mcp list`).
2. Send: **"Using the mtg-deck skill, build me a Limited deck from my `hobbit` collection."**
3. Verify the output:
   - Every nonland card in the decklist appears in your CSV.
   - No card's quantity exceeds what the CSV says you own.
   - `validate_deck` was called and returned `valid: true`.
   - `export_deck` wrote both a `.txt` and a `.md` file, and the `.txt` contains no Spanish card names.
   - Land count is between 16 and 18.

If any of these checks fail: a skill wording problem is fixed in `skills/mtg-deck/SKILL.md`; a wrong number from a tool is fixed in the module that produced it (`collection.js`, `rules.js`, `export.js`, etc.).

---

## Data and Attribution

Card data is from [Scryfall](https://scryfall.com), which is unofficial Fan Content permitted under the [Wizards of the Coast Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Card names and text are © Wizards of the Coast.

Combo data is from [Commander Spellbook](https://commanderspellbook.com).

Synergy data is from [EDHREC](https://edhrec.com). EDHREC's terms permit personal, non-commercial use only. This is a local tool for personal use and is not published or distributed.

Decklists are sourced from [Archidekt](https://archidekt.com).

---

## Testing

```bash
npm test
```

All 59 tests run offline using in-memory SQLite and fixture files. Live third-party endpoint tests are skipped by default:

```bash
LIVE=1 npm test
```

Live tests hit Commander Spellbook, EDHREC, Scryfall, and Archidekt directly. They are skipped in CI to avoid network flakiness.
