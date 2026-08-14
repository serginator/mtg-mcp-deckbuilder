const UA = { 'User-Agent': 'mtg-mcp/0.1', Accept: '*/*' };

// Archidekt's deckFormat is an integer. Only the formats this server supports
// are mapped; anything else is rejected before the request goes out.
const ARCHIDEKT_FORMATS = { standard: 1, commander: 3, limited: null };

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The find-my-combos response embeds full card objects with image URLs and
// runs to hundreds of KB. Reduce it to names and outcomes.
export function shapeCombos(raw, owned) {
  const names = (combo) => (combo.uses ?? []).map((u) => u.card?.name).filter(Boolean);
  const shape = (combo) => ({
    id: combo.id,
    cards: names(combo),
    produces: (combo.produces ?? []).map((p) => p.feature?.name).filter(Boolean),
  });
  const r = raw.results ?? {};
  return {
    identity: r.identity ?? null,
    included: (r.included ?? []).map(shape),
    almost: (r.almostIncluded ?? []).map((combo) => ({
      ...shape(combo),
      missing: names(combo).filter((n) => !owned.has(n)),
    })),
  };
}

export async function findCombos(cardNames) {
  try {
    const raw = await getJson('https://backend.commanderspellbook.com/find-my-combos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ main: cardNames.map((card) => ({ card, quantity: 1 })) }),
    });
    return shapeCombos(raw, new Set(cardNames));
  } catch (e) {
    return { error: `Commander Spellbook unavailable: ${e.message}` };
  }
}

export async function edhrecCommander(name) {
  const slug = slugify(name);
  try {
    const body = await getJson(`https://json.edhrec.com/pages/commanders/${slug}.json`);
    const cardlists = body.container?.json_dict?.cardlists ?? [];
    return {
      commander: name,
      slug,
      themes: Object.keys(body.tag_counts ?? {}),
      lists: cardlists.map((l) => ({
        header: l.header,
        cards: (l.cardviews ?? []).slice(0, 25).map((c) => ({
          name: c.name,
          synergy: c.synergy,
          inclusion: c.potential_decks ? c.num_decks / c.potential_decks : null,
        })),
      })),
    };
  } catch (e) {
    return { error: `EDHREC has no page for "${name}" (slug ${slug}): ${e.message}` };
  }
}

export async function searchDecks({ format, query = '', limit = 10 }) {
  const formatId = ARCHIDEKT_FORMATS[format];
  if (!formatId) {
    return { error: `Archidekt has no deck search for format "${format}".` };
  }
  try {
    const url = new URL('https://archidekt.com/api/decks/v3/');
    url.searchParams.set('formats', String(formatId));
    url.searchParams.set('orderBy', '-viewCount');
    url.searchParams.set('pageSize', String(limit));
    if (query) url.searchParams.set('name', query);
    const body = await getJson(url);
    return (body.results ?? []).map((d) => ({
      id: d.id, name: d.name, size: d.size, views: d.viewCount,
      updated: d.updatedAt, url: `https://archidekt.com/decks/${d.id}`,
    }));
  } catch (e) {
    return { error: `Archidekt unavailable: ${e.message}` };
  }
}

export async function scryfallSearch(query, limit = 25) {
  try {
    const url = new URL('https://api.scryfall.com/cards/search');
    url.searchParams.set('q', query);
    const body = await getJson(url);
    return (body.data ?? []).slice(0, limit).map((c) => ({
      name: c.name, mana_cost: c.mana_cost, cmc: c.cmc, type_line: c.type_line,
      oracle_text: c.oracle_text, color_identity: c.color_identity,
      legalities: c.legalities,
    }));
  } catch (e) {
    return { error: `Scryfall search failed: ${e.message}` };
  }
}
