import { test } from 'node:test';
import assert from 'node:assert';
import { slugify, shapeCombos, findCombos, edhrecCommander, scryfallSearch } from '../external.js';

test('slugify matches the EDHREC URL convention', () => {
  assert.equal(slugify('Bilbo, Birthday Celebrant'), 'bilbo-birthday-celebrant');
  assert.equal(slugify('Kiki-Jiki, Mirror Breaker'), 'kiki-jiki-mirror-breaker');
  assert.equal(slugify("Sisay, Weatherlight Captain"), 'sisay-weatherlight-captain');
  assert.equal(slugify('Jodah, the Unifier'), 'jodah-the-unifier');
});

test('shapeCombos strips the image-heavy payload down to names', () => {
  const raw = { results: { identity: 'R',
    included: [{ id: '618-1537',
      uses: [{ card: { name: 'Kiki-Jiki, Mirror Breaker',
                       imageUriFrontPng: 'https://…', oracleId: 'x' } },
              { card: { name: 'Zealous Conscripts', imageUriFrontPng: 'https://…' } }],
      produces: [{ feature: { name: 'Infinite hasty creatures' } }],
      description: 'Tap Kiki-Jiki…' }],
    almostIncluded: [{ id: '1-2',
      uses: [{ card: { name: 'Grumgully' } }, { card: { name: 'Thornbite Staff' } }],
      produces: [{ feature: { name: 'Infinite ETB' } }] }] } };

  const out = shapeCombos(raw, new Set(['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts',
    'Grumgully']));

  assert.equal(out.identity, 'R');
  assert.deepEqual(out.included[0].cards,
    ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts']);
  assert.deepEqual(out.included[0].produces, ['Infinite hasty creatures']);
  assert.deepEqual(out.almost[0].missing, ['Thornbite Staff']);
  assert.equal(JSON.stringify(out).includes('imageUri'), false);
});

test('live: find-my-combos finds the Kiki-Jiki combo', { skip: !process.env.LIVE }, async () => {
  const out = await findCombos(['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts']);
  assert.ok(!out.error, out.error);
  assert.ok(out.included.length >= 1);
});

test('live: EDHREC returns synergy lists', { skip: !process.env.LIVE }, async () => {
  const out = await edhrecCommander('Bilbo, Birthday Celebrant');
  assert.ok(!out.error, out.error);
  assert.ok(out.lists.length > 0);
  assert.ok(typeof out.lists[0].cards[0].synergy === 'number');
});

test('live: Scryfall passthrough runs a raw query', { skip: !process.env.LIVE }, async () => {
  const out = await scryfallSearch('t:goblin c:r cmc=1', 5);
  assert.ok(!out.error, out.error);
  assert.ok(out.length > 0);
  assert.ok(out[0].name);
});

test('a dead host returns an error object rather than throwing', async () => {
  const out = await edhrecCommander('___definitely-not-a-commander___');
  assert.ok(out.error, 'expected an error field');
});
