const test = require('node:test');
const assert = require('node:assert/strict');
function library(overrides = {}, language = {}) {
  return { version: 1, username: 'observer', fetchedAt: '2026-11-10T00:00:00.000Z',
    languages: { es: { code: 'es', name: 'Spanish', points: 100, learning: true, source: 'vocabulary_overview',
      words: [{ word: 'hola', pos: 'Interjection', strength: 0.75 }, { word: 'gato', translations: ['cat'] }], ...language } }, ...overrides };
}
test('word library validation accepts a real export and rejects malformed data', async () => {
  const { validateWordLibrary, libraryStats } = await import('../public/dlang/words.mjs');
  assert.equal(validateWordLibrary(library()).languages.es.words.length, 2);
  const stats = libraryStats(library());
  assert.deepEqual([stats.languages, stats.words, stats.active], [1, 2, 1]);
  assert.deepEqual(stats.perLanguage[0], { code: 'es', name: 'Spanish', words: 2, learning: true });
  assert.throws(() => validateWordLibrary(library({ version: 2 })), /version 1/);
  assert.throws(() => validateWordLibrary(library({}, { source: 'telepathy' })), /Invalid language entry/);
  assert.throws(() => validateWordLibrary(library({}, { words: [{ word: '' }] })), /Invalid word/);
  assert.throws(() => validateWordLibrary(library({}, { words: [{ word: 'x'.repeat(121) }] })), /Invalid word/);
  assert.throws(() => validateWordLibrary(library({}, { words: [{ word: 'ok', strength: 2 }] })), /Invalid strength/);
  assert.throws(() => validateWordLibrary(library({}, { learning: 'yes' })), /learning status/);
  assert.throws(() => validateWordLibrary(library({ fetchedAt: 'not a date' })), /version 1 export/);
  assert.throws(() => validateWordLibrary(library({ languages: { 'BAD CODE': { code: 'BAD CODE', name: 'X', source: 'skills', words: [] } } })), /Invalid language entry/);
  assert.throws(() => validateWordLibrary(library({ languages: {} })), /1 to 64/);
});
test('word library persists locally, round-trips and enforces the size cap', async () => {
  const { readWordLibrary, saveWordLibrary, WORDS_KEY, MAX_LIBRARY_BYTES } = await import('../public/dlang/words.mjs');
  const map = new Map(), storage = { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  assert.equal(readWordLibrary(storage), null);
  saveWordLibrary(storage, library());
  assert.ok(map.get(WORDS_KEY).length < MAX_LIBRARY_BYTES);
  assert.equal(readWordLibrary(storage).languages.es.name, 'Spanish');
  const huge = library({}, { words: Array.from({ length: 20000 }, (_, i) => ({ word: `w${i}`, normalized: 'n'.repeat(200), skill: 's'.repeat(200) })) });
  const wide = { ...huge, languages: Object.fromEntries(['es', 'fr', 'de', 'hi', 'ru', 'he'].map(code => [code, { ...huge.languages.es, code }])) };
  assert.throws(() => saveWordLibrary(storage, wide), /4 MiB/);
  const unicodeHeavy = library({}, { words: Array.from({ length: 20000 }, (_, i) =>
    ({ word: `w${i}`, skill: '界'.repeat(200) })) });
  assert.throws(() => saveWordLibrary(storage, unicodeHeavy), /4 MiB/);
  assert.equal(readWordLibrary(storage).username, 'observer', 'a rejected import does not replace the existing profile');
  storage.removeItem(WORDS_KEY);
  assert.equal(readWordLibrary(storage), null);
});
