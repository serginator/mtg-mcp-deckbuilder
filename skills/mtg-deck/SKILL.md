---
name: mtg-deck
description: Use when building a Magic: The Gathering deck from a collection the user owns, analysing a collection for synergies, or checking whether a decklist is legal in a format. Requires the mtg-mcp server.
---

# Building Magic Decks From a Collection

The `mtg-mcp` server holds the user's card collections and the full Scryfall
card database. It serves data and enforces rules. You build the deck.

## Before anything else

Call `list_collections`. If it errors asking for `sync_data`, tell the user the
database needs a one-time ~374 MB download taking several minutes, and ask
before starting it. Do not start a sync unprompted.

If the collection they want is not listed, ask for the path to the ManaBox CSV
and call `import_collection`.

## The workflow

### 1. Read the collection

Call `get_collection`. Read all of it — a typical collection is small enough
that skimming loses you the deck. Note the `tags` on each card; they are
functional labels like `removal`, `ramp`, `sacrifice-outlet`, and
`token-generation`, and they are the fastest route to spotting a theme.

If `import_collection` reported unmatched rows, mention them. They usually mean
the card data predates the set.

### 2. Survey before deciding

Report to the user, briefly:

- Color distribution by card count, not by card presence. Two red cards is not
  a red deck.
- The most common tags, and the most common creature types.
- The curve — how many cards at each mana value.
- Any card that is obviously more powerful than the rest of the pool.

### 3. Find two or three candidate themes

A theme is real when the collection has **both** payoffs and enablers:

- **Enablers** — cards that produce the thing (tokens, +1/+1 counters, cards in
  the graveyard, artifacts).
- **Payoffs** — cards that reward having it ("whenever a creature dies…",
  "creatures you control get +1/+1 for each…").

Rules of thumb:

- Fewer than 5 payoffs is not a theme, it is a coincidence. Say so and move on.
- 8+ payoffs with 12+ enablers is a strong theme.
- Two colors is the default. Three needs real fixing in the pool; a sealed
  collection almost never has it.

Call `find_combos` with every card name in the collection. Combos are the
strongest possible synergy signal, and a two-card combo you already own often
decides the theme by itself.

For Commander, also call `edhrec` on each candidate commander. Treat its
high-synergy list as suggestions, not requirements — the user builds from what
they own.

### 4. Choose, and say why the others lost

Present the candidates with their payoff and enabler counts, recommend one, and
give the reason in a sentence. Then build it.

### 5. Build the nonlands first

Target counts, before lands:

| Format | Nonland cards | Lands |
|---|---|---|
| Standard | 36–38 | 22–24 |
| Commander | 62–64 (+ commander) | 36–38 |
| Limited | 22–23 | 17–18 |

Composition for a creature-based deck:

- 14–18 creatures
- 6–10 removal and interaction
- 2–4 card draw or selection
- The rest: the theme's payoffs

Adjust the land count by curve, not by superstition:

- Average mana value under 2.5 → the low end (Standard 22, Commander 36)
- Average 2.5–3.5 → the middle
- Average over 3.5, or heavy 5+ drops → the high end, plus ramp

In Commander, count ramp separately: 8–12 mana rocks and ramp spells is normal,
and every one of them lets you shave roughly half a land.

### 6. Build the mana base

Count colored pips across the nonland cards — every `{R}` in every mana cost,
weighted by how many copies. Split the basics in that ratio. A card that costs
`{R}{R}` and appears 4 times contributes 8 red pips.

Cards you cannot cast on curve are worse than cards you do not play. If a
splash colour has fewer than 6 pips and no fixing in the pool, cut the splash.

Basic lands are always available in unlimited quantity — the user owns plenty.
Never restrict the mana base to lands in the collection.

### 7. Validate, fix, revalidate

Call `validate_deck` with the full list. It returns every violation at once, so
fix them all before calling again. Common results:

- `unknown_card` — a typo, or a card from a set newer than the last sync.
- `legality` — the card is banned or outside the format's pool. Swap it.
- `color_identity` — Commander only. The card is off-colour; cut it.
- `deck_size` — adjust lands first, then the least essential spells.

Do not present a deck that has not passed validation.

### 8. Present and export

Give the user, in the conversation:

- The decklist, grouped by type, with quantities.
- The gameplan in two or three sentences — how the deck wins.
- The three or four cards that carry the synergy, and why.
- What to cut first if they want to change direction.

Then call `export_deck`. Put the gameplan and synergy explanation in `notes` —
it becomes the Markdown breakdown. If the user's collection is Spanish, pass
`lang: "es"` so the breakdown carries Spanish names for finding the physical
cards.

## Things that go wrong

**Building the deck you wish they owned.** Every card must come from the
collection or be a basic land. Check each one against `get_collection` output.

**Counting a card twice.** `quantity` is how many they own. A 4-of in the deck
needs `quantity >= 4` in the collection.

**Ignoring the curve.** A collection's best cards are often its most expensive.
A deck of them does not function. Six or more two-drops in a 60-card deck.

**Treating Spanish text as rules text.** Printed foreign text can lag the
current Oracle wording. Reason from `oracle_text`, always.

**Silently dropping a card the user asked for.** If they name a card and it
does not fit, say so and say why.
