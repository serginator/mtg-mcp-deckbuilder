import { writeFileSync } from 'node:fs';

export function toDecklistText(cards, { commander = null } = {}) {
  const lines = [];
  if (commander) {
    lines.push('Commander', `1 ${commander}`, '', 'Deck');
  }
  for (const c of cards) {
    const qty = commander && c.name === commander ? c.quantity - 1 : c.quantity;
    if (qty > 0) lines.push(`${qty} ${c.name}`);
  }
  return lines.join('\n') + '\n';
}

const isLand = (c) => (c.type_line ?? '').includes('Land');

function curveTable(cards) {
  const buckets = new Map();
  for (const c of cards) {
    if (isLand(c)) continue;
    const mv = Math.min(Math.floor(c.cmc ?? 0), 7);
    buckets.set(mv, (buckets.get(mv) ?? 0) + c.quantity);
  }
  const rows = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  return ['| Mana value | Cards |', '|---|---|',
    ...rows.map(([mv, n]) => `| ${mv === 7 ? '7+' : mv} | ${n} |`)].join('\n');
}

function typeCounts(cards) {
  const order = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment',
                 'Planeswalker', 'Battle', 'Land'];
  const counts = new Map(order.map((t) => [t, 0]));
  for (const c of cards) {
    for (const t of order) {
      if ((c.type_line ?? '').includes(t)) { counts.set(t, counts.get(t) + c.quantity); break; }
    }
  }
  return ['| Type | Cards |', '|---|---|',
    ...[...counts].filter(([, n]) => n > 0).map(([t, n]) => `| ${t} | ${n} |`)].join('\n');
}

export function toBreakdown({ cards, format, commander = null, notes = '',
                              validation, lang = null }) {
  const title = commander ? `${commander} — ${format}` : `${format} deck`;
  const showEs = lang === 'es';

  const listRows = cards.map((c) => {
    const cells = [c.quantity, c.name, c.mana_cost || '—', c.type_line ?? ''];
    if (showEs) cells.splice(2, 0, c.printed_name ?? '—');
    return `| ${cells.join(' | ')} |`;
  });
  const header = showEs
    ? '| Qty | Name | Nombre | Cost | Type |\n|---|---|---|---|---|'
    : '| Qty | Name | Cost | Type |\n|---|---|---|---|';

  const status = validation.valid
    ? '**Legal** — passes all construction rules.'
    : ['**Illegal** — the following must be fixed:', '',
       ...validation.violations.map((v) =>
         `- **${v.rule}**: ${v.message}${v.cards ? ` (${v.cards.join(', ')})` : ''}`)]
      .join('\n');

  return [
    `# ${title}`, '',
    notes ? `${notes}\n` : '',
    '## Legality', '', status, '',
    `Total ${validation.counts.total} cards, ${validation.counts.lands} lands.`, '',
    '## Mana curve', '', curveTable(cards), '',
    '## Composition', '', typeCounts(cards), '',
    '## Decklist', '', header, ...listRows, '',
  ].join('\n');
}

export function exportDeck({ cards, path, format, commander = null, notes = '',
                             validation, lang = null }) {
  const base = path.replace(/\.(txt|md)$/, '');
  const text_path = `${base}.txt`;
  const breakdown_path = `${base}.md`;
  writeFileSync(text_path, toDecklistText(cards, { commander }));
  writeFileSync(breakdown_path,
    toBreakdown({ cards, format, commander, notes, validation, lang }));
  return { text_path, breakdown_path };
}
