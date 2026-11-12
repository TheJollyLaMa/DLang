const test = require('node:test');
const assert = require('node:assert/strict');
test('family curriculum: six honest levels, consistent packs, marked machine seed and cautious Diné bizaad coverage', async () => {
  const { LEVELS, CURRICULUM_CONCEPTS, EXTENDED, WORDMAP_LANGUAGES, SEED_REVIEW, poolForDay, levelFor } = await import('../public/dlang/curriculum.mjs');
  const { PACKS, LANGUAGE_TAGS } = await import('../public/dlang/packs.mjs');
  assert.equal(CURRICULUM_CONCEPTS.length, 72);
  assert.equal(new Set(CURRICULUM_CONCEPTS).size, 72);
  assert.deepEqual(LEVELS.map(level => level.kind), ['nouns', 'nouns', 'numbers', 'feelings', 'colors', 'verbs']);
  assert.ok(LEVELS.every((level, i) => i === 0 || level.startDay > LEVELS[i - 1].startDay));
  for (const concept of CURRICULUM_CONCEPTS) {
    assert.ok(levelFor(concept));
    for (const tag of LANGUAGE_TAGS) {
      assert.ok(PACKS[tag][concept]?.label, `${tag} pack label for ${concept}`);
      assert.match(PACKS[tag][concept].review, /pending/);
    }
    const extended = EXTENDED[concept];
    assert.equal(extended.review, SEED_REVIEW);
    for (const key of ['de', 'ar', 'fi', 'ga', 'el', 'ru', 'he'])
      if (extended[key] !== null) assert.ok(typeof extended[key] === 'string' && extended[key].length > 0);
  }
  // Scripts are real, not transliterated placeholders.
  assert.match(EXTENDED.dog.ar, /[\u0600-\u06ff]/); assert.match(EXTENDED.dog.el, /[\u0370-\u03ff]/);
  assert.match(EXTENDED.dog.ru, /[\u0400-\u04ff]/); assert.match(EXTENDED.dog.he, /[\u0590-\u05ff]/);
  // Diné bizaad: attested everyday nouns/numbers/colors only, never guessed feelings/verbs.
  const nv = Object.entries(EXTENDED).filter(([, entry]) => entry.nv);
  assert.ok(nv.length >= 20);
  for (const [concept] of nv) assert.ok(!['feelings', 'verbs'].includes(levelFor(concept).kind), `nv seed for ${concept}`);
  assert.equal(poolForDay(0).length, 12); assert.equal(poolForDay(400).length, 72);
  assert.equal(WORDMAP_LANGUAGES.length, 13);
  assert.equal(WORDMAP_LANGUAGES.find(language => language.tag === 'nv').speech, null);
});
test('word map: seed labels remain separate from imported shared-gloss candidates', async () => {
  const { conceptTranslations, glossIndexes, glossCandidates, searchAnchor, normalizeGloss } = await import('../public/dlang/wordmap.mjs');
  const rows = conceptTranslations('dog');
  assert.equal(rows.length, 13);
  assert.equal(rows.find(row => row.tag === 'es').text, 'perro');
  assert.equal(rows.find(row => row.tag === 'de').text, 'Hund');
  assert.equal(rows.find(row => row.tag === 'zh-Hans').reading, 'gǒu');
  assert.equal(conceptTranslations('eat').find(row => row.tag === 'nv').text, null);
  assert.equal(normalizeGloss('to Eat!'), 'eat');
  const library = { version: 1, username: 'observer', fetchedAt: '2026-11-11T00:00:00.000Z', languages: {
    es: { code: 'es', name: 'Spanish', source: 'learned_lexemes', words: [
      { word: 'perro', translations: ['dog'] }, { word: 'agua', translations: ['water'] }] },
    fr: { code: 'fr', name: 'French', source: 'learned_lexemes', words: [{ word: 'chien', translations: ['dog'] }] },
    de: { code: 'de', name: 'German', source: 'learned_lexemes', words: [{ word: 'Hund', translations: ['the dog'] }] }
  } };
  const indexes = glossIndexes(library);
  const candidates = glossCandidates('dog', indexes);
  assert.deepEqual(candidates.es, ['perro']);
  assert.deepEqual(candidates.fr, ['chien']);
  assert.deepEqual(candidates.de, ['Hund']);
  assert.equal(candidates['zh-Hans'], undefined);
  const results = searchAnchor(library, 'dog');
  assert.equal(results.length, 1);
  assert.equal(results[0].word, 'perro');
  assert.deepEqual(results[0].candidates.fr, ['chien']);
  assert.equal('matches' in results[0], false);
  assert.deepEqual(searchAnchor(library, 'water')[0].candidates, {});
  assert.deepEqual(searchAnchor(null, 'dog'), []);
});
