// The family word map: every curriculum concept across all studied languages,
// anchored on Spanish. Seed translations are machine-generated and clearly
// marked unreviewed; the "learned" evidence comes only from the word library
// the user imported locally. Browser-local; nothing here uploads anything.
import { PACKS } from './packs.mjs';
import { LEVELS, EXTENDED, WORDMAP_LANGUAGES } from './curriculum.mjs';
import { readWordLibrary } from './words.mjs';
import { CONCEPTS, object, extraObject } from './scenes.mjs';

export const normalizeGloss = value => String(value).toLowerCase().replace(/^(to|the|a|an) /, '').replace(/[.!?]/g, '').trim();
const PACK_TAGS = ['en', 'es', 'fr', 'hi', 'zh-Hans'];

export function conceptTranslations(concept) {
  return WORDMAP_LANGUAGES.map(language => {
    const pack = PACK_TAGS.includes(language.tag) ? PACKS[language.tag][concept] : null;
    const extended = EXTENDED[concept]?.[language.tag];
    return { ...language, text: pack?.label ?? extended ?? null, reading: pack?.reading };
  });
}

export function glossIndexes(library) {
  const indexes = {};
  if (!library) return indexes;
  for (const entry of Object.values(library.languages)) {
    const map = new Map();
    for (const item of entry.words) for (const gloss of item.translations || []) {
      const key = normalizeGloss(gloss);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      if (!map.get(key).includes(item.word)) map.get(key).push(item.word);
    }
    indexes[entry.code] = { map };
  }
  return indexes;
}

export function glossCandidates(concept, indexes) {
  const gloss = normalizeGloss(PACKS.en[concept].label);
  const candidates = {};
  for (const language of WORDMAP_LANGUAGES) {
    if (!language.duo || !indexes[language.duo]) continue;
    const found = indexes[language.duo].map.get(gloss) || [];
    if (found.length) candidates[language.tag] = [...found].slice(0, 3);
  }
  return candidates;
}

export function searchAnchor(library, query, limit = 40) {
  if (!library?.languages?.es || !query || query.length < 2) return [];
  const indexes = glossIndexes(library);
  const needle = query.toLowerCase();
  const rows = [];
  for (const item of library.languages.es.words) {
    const glosses = item.translations || [];
    if (!item.word.toLowerCase().includes(needle) && !glosses.some(gloss => gloss.toLowerCase().includes(needle))) continue;
    const candidates = {};
    for (const language of WORDMAP_LANGUAGES) {
      if (!language.duo || language.duo === 'es' || !indexes[language.duo]) continue;
      const found = new Set();
      for (const gloss of glosses) for (const word of indexes[language.duo].map.get(normalizeGloss(gloss)) || []) found.add(word);
      if (found.size) candidates[language.tag] = [...found].slice(0, 3);
    }
    rows.push({ word: item.word, glosses: glosses.slice(0, 4), candidates });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function mountWordMap({ storage, openDialog }) {
  const $ = id => document.getElementById(id);
  $('wordmap-dialog').style.boxSizing = 'border-box';
  let library = null, indexes = {};
  let speechToken = 0;
  const speechStatus = $('wordmap-status');
  const stopButton = document.createElement('button');
  stopButton.type = 'button'; stopButton.className = 'wordmap-stop'; stopButton.textContent = 'Stop speech';
  stopButton.setAttribute('aria-label', 'Stop device speech synthesis'); stopButton.hidden = true;
  stopButton.onclick = () => {
    speechToken++;
    globalThis.speechSynthesis?.cancel();
    setSpeechStatus('Speech stopped.');
  };
  function setSpeechStatus(message, speaking = false) {
    speechStatus.replaceChildren(document.createTextNode(message), stopButton);
    stopButton.hidden = !speaking;
  }
  function speak(text, speech) {
    if (!globalThis.speechSynthesis || !speech) return;
    const token = ++speechToken;
    speechSynthesis.cancel();
    const voices = speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().split('-')[0] === speech.split('-')[0]);
    if (!voices.length) { setSpeechStatus(`No ${speech} device voice installed. Device synthesis only; never a native-speaker claim.`); return; }
    if (!globalThis.SpeechSynthesisUtterance) { setSpeechStatus('Device speech is unavailable in this browser.'); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speech; utterance.voice = voices[0]; utterance.rate = .85;
    utterance.onend = () => { if (token === speechToken) setSpeechStatus('Speech complete.'); };
    utterance.onerror = () => { if (token === speechToken) setSpeechStatus('Device speech could not play.'); };
    speechSynthesis.speak(utterance);
    setSpeechStatus(`${voices[0].name} · device synthesis, not a native-speaker recording.`, true);
  }
  function speakButton(text, speech) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'wordmap-say'; button.textContent = '▶';
    button.setAttribute('aria-label', `Hear ${text} with device speech synthesis`);
    if (!speech) { button.disabled = true; button.title = 'No synthetic voice offered for this language.'; }
    else button.onclick = () => speak(text, speech);
    return button;
  }
  function thumbnail(concept) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-8 -8 116 116'); svg.setAttribute('class', 'wordmap-thumb'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = CONCEPTS.includes(concept) ? object(concept, 3, 'hsl(205 37% 56%)') : extraObject(concept, 5, 'hsl(14 45% 52%)');
    return svg;
  }
  function conceptCard(concept) {
    const card = document.createElement('article'); card.className = 'wordmap-card';
    const head = document.createElement('div'); head.className = 'wordmap-head';
    head.append(thumbnail(concept));
    const title = document.createElement('strong'); title.textContent = PACKS.en[concept].label;
    head.append(title); card.append(head);
    const list = document.createElement('dl');
    const candidates = glossCandidates(concept, indexes);
    for (const entry of conceptTranslations(concept)) {
      const term = document.createElement('dt'); term.textContent = entry.name;
      const detail = document.createElement('dd'); detail.lang = entry.tag;
      if (entry.text) {
        const word = document.createElement('span'); word.textContent = entry.reading ? `${entry.text} · ${entry.reading}` : entry.text;
        detail.append(word, speakButton(entry.text, entry.speech));
      } else { detail.textContent = '— no seed yet'; detail.className = 'wordmap-gap'; }
      if (candidates[entry.tag]) {
        const possible = document.createElement('em'); possible.className = 'wordmap-candidates';
        possible.textContent = `Possible course candidates (shared English gloss; not verified translations): ${candidates[entry.tag].join(', ')}`;
        detail.append(possible);
      }
      list.append(term, detail);
    }
    card.append(list);
    return card;
  }
  function renderLevels() {
    $('wordmap-levels').replaceChildren(...LEVELS.map(level => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Level ${level.id} · ${level.title} · ${level.concepts.length} ${level.kind}`;
      details.append(summary);
      let rendered = false;
      details.addEventListener('toggle', () => {
        if (!details.open || rendered) return;
        rendered = true;
        const grid = document.createElement('div'); grid.className = 'wordmap-grid';
        grid.append(...level.concepts.map(conceptCard));
        details.append(grid);
      });
      return details;
    }));
  }
  function renderSummary() {
    const total = LEVELS.reduce((sum, level) => sum + level.concepts.length, 0);
    const imported = library ? `${Object.keys(library.languages).length} imported course${Object.keys(library.languages).length === 1 ? '' : 's'} can suggest candidates by shared gloss, not confirm translations.` : 'Import a word library in the notebook to see possible matches by shared gloss; these are not confirmed translations.';
    $('wordmap-summary').textContent = `${LEVELS.length} levels · ${total} concepts · ${WORDMAP_LANGUAGES.length} languages. Unmarked translations are machine seed, fluent-speaker review pending. ${imported}`;
  }
  function renderSearch() {
    const query = $('wordmap-search').value.trim();
    const results = $('wordmap-results');
    if (query.length < 2) { results.replaceChildren(); $('wordmap-search-note').textContent = library?.languages?.es ? `Search your ${library.languages.es.words.length.toLocaleString()} Spanish course words. Candidate terms in other courses share a gloss and are not confirmed translations.` : 'Import a Spanish word library to search course words.'; return; }
    const rows = searchAnchor(library, query);
    $('wordmap-search-note').textContent = rows.length ? `${rows.length} Spanish course words match. Other-course candidates share at least one gloss; that does not prove a translation.` : 'No Spanish course word matches.';
    results.replaceChildren(...rows.map(row => {
      const item = document.createElement('article'); item.className = 'wordmap-card';
      const head = document.createElement('div'); head.className = 'wordmap-head';
      const word = document.createElement('strong'); word.lang = 'es'; word.textContent = row.word;
      head.append(word, speakButton(row.word, 'es-ES'));
      const gloss = document.createElement('span'); gloss.className = 'quiet'; gloss.textContent = row.glosses.join(' · ');
      head.append(gloss); item.append(head);
      const list = document.createElement('dl');
      for (const language of WORDMAP_LANGUAGES) {
        if (!row.candidates[language.tag]) continue;
        const term = document.createElement('dt'); term.textContent = language.name;
        const detail = document.createElement('dd'); detail.lang = language.tag;
        detail.append(document.createTextNode(`Possible candidates · ${row.candidates[language.tag].join(', ')} `), speakButton(row.candidates[language.tag][0], language.speech));
        list.append(term, detail);
      }
      if (!list.childElementCount) { const note = document.createElement('p'); note.className = 'quiet'; note.textContent = 'No candidate words share a course gloss.'; item.append(note); }
      else item.append(list);
      return item;
    }));
  }
  function refresh() {
    try { library = readWordLibrary(storage); } catch { library = null; }
    indexes = glossIndexes(library);
    renderSummary(); renderLevels(); renderSearch();
  }
  $('wordmap-open').onclick = () => { refresh(); openDialog('wordmap-dialog'); };
  $('wordmap-search').oninput = renderSearch;
  renderSummary();
  return { refresh };
}
