// Personal imported word library: words already learned elsewhere, loaded from
// a local export file. Browser-local only; never uploaded, published or graded.
export const WORDS_KEY = 'dlang-words-v1';
export const MAX_LIBRARY_BYTES = 4 * 1024 * 1024;
const SOURCES = ['vocabulary_overview', 'learned_lexemes', 'skills', 'manual'];
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const byteLength = value => new Blob([value]).size;
export function validateWordLibrary(value) {
  if (value?.version !== 1 || !text(value.username, 80) || !text(value.fetchedAt, 40)
    || !Number.isFinite(Date.parse(value.fetchedAt))
    || !value.languages || typeof value.languages !== 'object' || Array.isArray(value.languages))
    throw Error('Word library file not recognized; expected a version 1 export.');
  const entries = Object.entries(value.languages);
  if (!entries.length || entries.length > 64) throw Error('Word library must hold 1 to 64 languages.');
  for (const [code, language] of entries) {
    if (!/^[a-z]{2}(-[A-Za-z]{2,8})?$/.test(code) || language.code !== code || !text(language.name, 40)
      || !SOURCES.includes(language.source) || !Array.isArray(language.words) || language.words.length > 20000)
      throw Error(`Invalid language entry: ${code}.`);
    if (language.learning != null && typeof language.learning !== 'boolean') throw Error(`Invalid learning status for ${code}.`);
    if (language.points != null && (!Number.isSafeInteger(language.points) || language.points < 0)) throw Error(`Invalid points for ${code}.`);
    for (const item of language.words) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || !text(item.word, 120)) throw Error(`Invalid word in ${code}.`);
      for (const field of ['normalized', 'pos', 'gender', 'infinitive', 'skill', 'lastPracticed'])
        if (item[field] != null && !text(item[field], 200)) throw Error(`Invalid ${field} in ${code}.`);
      if (item.strength != null && !(Number.isFinite(item.strength) && item.strength >= 0 && item.strength <= 1)) throw Error(`Invalid strength in ${code}.`);
      if (item.translations != null && (!Array.isArray(item.translations) || item.translations.length > 5 || !item.translations.every(entry => text(entry, 200)))) throw Error(`Invalid translations in ${code}.`);
    }
  }
  return value;
}
export function libraryStats(library) {
  const languages = Object.values(library.languages);
  return { languages: languages.length, words: languages.reduce((sum, language) => sum + language.words.length, 0),
    active: languages.filter(language => language.learning).length,
    perLanguage: languages.map(language => ({ code: language.code, name: language.name, words: language.words.length, learning: !!language.learning }))
      .sort((a, b) => b.words - a.words) };
}
export function readWordLibrary(storage) {
  const raw = storage.getItem(WORDS_KEY);
  if (!raw) return null;
  if (byteLength(raw) > MAX_LIBRARY_BYTES) throw Error('Word library exceeds the 4 MiB local limit.');
  return validateWordLibrary(JSON.parse(raw));
}
export function saveWordLibrary(storage, library) {
  const serialized = JSON.stringify(validateWordLibrary(library));
  if (byteLength(serialized) > MAX_LIBRARY_BYTES) throw Error('Word library exceeds the 4 MiB local limit.');
  storage.setItem(WORDS_KEY, serialized);
  return library;
}
export function mountWords({ storage }) {
  const $ = id => document.getElementById(id);
  function render() {
    let library = null, problem = '';
    try { library = readWordLibrary(storage); } catch (error) { problem = error.message; }
    $('words-clear').hidden = !library;
    if (!library) {
      $('words-stats').replaceChildren(); $('words-languages').textContent = '';
      $('words-status').textContent = problem || 'No word library imported yet.';
      return;
    }
    const stats = libraryStats(library);
    $('words-stats').replaceChildren(...[['Languages', stats.languages], ['Words learned', stats.words], ['Active courses', stats.active]]
      .map(([label, value]) => { const item = document.createElement('div'), count = document.createElement('strong'), title = document.createElement('span'); count.textContent = value.toLocaleString(); title.textContent = label; item.append(count, title); return item; }));
    $('words-languages').textContent = stats.perLanguage.map(language => `${language.name}${language.learning ? ' ●' : ''} ${language.words.toLocaleString()}`).join(' · ');
    $('words-status').textContent = `Imported export of ${library.username}, fetched ${library.fetchedAt.slice(0, 10)}. Saved only in this browser.`;
  }
  $('words-import').onchange = async () => {
    const file = $('words-import').files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_LIBRARY_BYTES) throw Error('Word library exceeds the 4 MiB local limit.');
      saveWordLibrary(storage, JSON.parse(await file.text()));
      render();
    } catch (error) { $('words-status').textContent = `Import failed: ${error.message}`; }
    finally { $('words-import').value = ''; }
  };
  $('words-clear').onclick = () => { storage.removeItem(WORDS_KEY); render(); };
  render();
  return { render };
}
