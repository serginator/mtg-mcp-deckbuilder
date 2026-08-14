const BASIC_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];

export const BASIC_LANDS = new Set([
  ...BASIC_TYPES,
  ...BASIC_TYPES.map((t) => `Snow-Covered ${t}`),
]);

export function isBasicLand(name) {
  return BASIC_LANDS.has(name);
}

const FORMATS = {
  standard: { size: 60, exact: false, copies: 4, sideboard: 15, legality: 'standard' },
  commander: { size: 100, exact: true, copies: 1, sideboard: 0, legality: 'commander' },
  limited: { size: 40, exact: false, copies: Infinity, sideboard: Infinity, legality: null },
};

const total = (cards) => cards.reduce((n, c) => n + (c.quantity ?? 1), 0);

export function validateDeck({ cards = [], format, commander = null, sideboard = [] }) {
  const rules = FORMATS[format];
  if (!rules) {
    return {
      valid: false, format, counts: { total: total(cards) },
      violations: [{ rule: 'unknown_format',
        message: `Unknown format "${format}". Known: ${Object.keys(FORMATS).join(', ')}.` }],
      notes: [],
    };
  }

  const violations = [];
  const notes = [];
  const count = total(cards);

  if (rules.exact ? count !== rules.size : count < rules.size) {
    violations.push({
      rule: 'deck_size',
      message: rules.exact
        ? `${format} requires exactly ${rules.size} cards; found ${count}.`
        : `${format} requires at least ${rules.size} cards; found ${count}.`,
    });
  }

  if (sideboard.length > 0 && total(sideboard) > rules.sideboard) {
    violations.push({
      rule: 'sideboard_size',
      message: `${format} allows at most ${rules.sideboard} sideboard cards; found ${total(sideboard)}.`,
    });
  }

  // Basic lands are exempt from copy limits in every format.
  const overLimit = cards
    .filter((c) => !isBasicLand(c.name) && (c.quantity ?? 1) > rules.copies)
    .map((c) => c.name);
  if (overLimit.length > 0) {
    violations.push({
      rule: 'copy_limit',
      message: `${format} allows at most ${rules.copies} copies of a nonbasic card.`,
      cards: overLimit,
    });
  }

  if (rules.legality) {
    const illegal = cards
      .filter((c) => (c.legalities?.[rules.legality] ?? 'not_legal') !== 'legal')
      .map((c) => c.name);
    if (illegal.length > 0) {
      violations.push({
        rule: 'legality',
        message: `Not legal in ${format} (banned or not in the card pool).`,
        cards: illegal,
      });
    }
  }

  const counts = { total: count, lands: cards.filter(
    (c) => (c.type_line ?? '').includes('Land')).reduce((n, c) => n + (c.quantity ?? 1), 0) };

  if (format === 'commander') {
    const cmdr = cards.find((c) => c.name === commander);
    if (!commander) {
      violations.push({ rule: 'commander_missing',
        message: 'Commander decks require a commander.' });
    } else if (!cmdr) {
      violations.push({ rule: 'commander_missing',
        message: `Commander "${commander}" is not in the deck list.` });
    } else {
      const legendaryCreature = /Legendary/.test(cmdr.type_line ?? '')
        && /Creature/.test(cmdr.type_line ?? '');
      const saysSo = /can be your commander/i.test(cmdr.oracle_text ?? '');
      if (!legendaryCreature && !saysSo) {
        violations.push({
          rule: 'commander_eligibility',
          message: `"${commander}" is not a legendary creature and does not say it can be your commander.`,
        });
      }
      const allowed = new Set(cmdr.color_identity ?? []);
      const offColor = cards
        .filter((c) => (c.color_identity ?? []).some((col) => !allowed.has(col)))
        .map((c) => c.name);
      if (offColor.length > 0) {
        violations.push({
          rule: 'color_identity',
          message: `Outside the commander's color identity {${[...allowed].join('')}}.`,
          cards: offColor,
        });
      }
    }
    counts.game_changers = cards.filter((c) => c.game_changer)
      .reduce((n, c) => n + (c.quantity ?? 1), 0);
    if (counts.game_changers > 0) {
      notes.push(`${counts.game_changers} Game Changer card(s) — relevant to Commander bracket.`);
    }
  }

  return { valid: violations.length === 0, format, counts, violations, notes };
}
