import { YEAR_LIBRARY, PRACTICE_KEY, readPractice, nextScene, finishPractice, practiceStats, librarySVG, localDay } from './library.mjs';
import { PACKS, LANGUAGE_NAMES } from './packs.mjs';
const ACTIVE_KEY = 'dlang-practice-active-v1';
export function mountPractice({ storage, audio, report }) {
  const $ = id => document.getElementById(id);
  let active = null, scene = null, chosen = null, state, timer, previewKey = '';
  const languages = $('practice-language');
  languages.replaceChildren(...Object.keys(PACKS).map(tag => new Option(LANGUAGE_NAMES[tag], tag)));
  function load() { state = readPractice(storage); }
  function summary() {
    const stats = practiceStats(state);
    $('practice-summary').textContent = `${stats.today} of 3 sessions today · ${stats.sessions} completed · ${stats.concepts} concepts explored · ${stats.due} due for review`;
    $('practice-start').disabled = !!active || stats.today >= 3 || !nextScene(state);
    languages.disabled = !!active;
    $('practice-finish').hidden = !active;
    window.dispatchEvent(new Event('dlang:practice'));
  }
  function paint() {
    $('practice-scene').innerHTML = scene ? librarySVG(scene) : '';
    $('practice-objects').replaceChildren();
    if (!scene) return;
    for (const target of scene.targets) {
      const choose = () => {
        chosen = target.concept;
        $('practice-word').textContent = PACKS[active.language][chosen].label;
        $('practice-word').lang = active.language;
        $('practice-word').disabled = false; $('practice-again').disabled = false; $('practice-remembered').disabled = false;
        void audio.play(active.language, chosen);
        $('practice-help').textContent = 'Listen, say the word, then choose whether you remembered. This is self-review, not speech scoring.';
      };
      const node = $('practice-scene').querySelector(`[data-target="${target.id}"]`);
      node.onclick = choose; node.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); choose(); } };
      const button = document.createElement('button'); button.textContent = target.concept; button.onclick = choose; $('practice-objects').append(button);
    }
  }
  function stop() { clearInterval(timer); timer = null; }
  function finish() {
    if (!active) return;
    stop();
    try {
      const stored = JSON.parse(storage.getItem(ACTIVE_KEY) || 'null');
      if (stored?.scene !== active.scene || stored.deadline !== active.deadline) throw Error('This session changed in another tab. Reload to continue.');
      load();
      const result = finishPractice(state, scene, stored.outcomes, active.language, Math.min(Date.now(), active.deadline - 1));
      storage.setItem(PRACTICE_KEY, JSON.stringify(result)); storage.removeItem(ACTIVE_KEY); state = result;
      active = null; scene = null; chosen = null; summary(); paint();
      $('practice-word').disabled = true; $('practice-again').disabled = true; $('practice-remembered').disabled = true;
      $('practice-timer').textContent = 'Session complete';
      $('practice-help').textContent = 'A little more of the world has a name. Your next reviews are scheduled from your self-assessments.';
    } catch (error) { report(error.message); $('practice-start').disabled = true; }
  }
  function tick() {
    if (!active) return;
    const remaining = Math.max(0, Math.ceil((active.deadline - Date.now()) / 1000));
    $('practice-timer').textContent = `${remaining}s · ${Object.keys(active.outcomes).length} / 12 reviewed`;
    if (!remaining) finish();
  }
  function run() { scene = YEAR_LIBRARY.find(s => s.id === active.scene); languages.value = active.language; paint(); tick(); if (active) timer = setInterval(tick, 500); summary(); }
  for (const [id, remembered] of [['practice-again', false], ['practice-remembered', true]]) $(id).onclick = () => {
    if (!active || !chosen) return;
    if (Date.now() >= active.deadline) { finish(); return; }
    try {
      const stored = JSON.parse(storage.getItem(ACTIVE_KEY) || 'null');
      if (stored?.scene !== active.scene || stored.deadline !== active.deadline) throw Error('Session changed in another tab; reload.');
      active = stored; active.outcomes[chosen] = remembered; storage.setItem(ACTIVE_KEY, JSON.stringify(active));
      $('practice-help').textContent = remembered ? 'Remembered · next review moves farther away.' : 'Again · this concept returns sooner.';
      $('practice-again').disabled = true; $('practice-remembered').disabled = true; tick();
      if (active && Object.keys(active.outcomes).length === 12) finish();
    } catch (error) { report(error.message); }
  };
  $('practice-word').onclick = () => { if (active && chosen) void audio.play(active.language, chosen); };
  $('practice-start').onclick = () => {
    try {
      if (storage.getItem(ACTIVE_KEY)) throw Error('A practice session is already running. Reload to resume it.');
      load(); const next = nextScene(state); if (!next) throw Error('Your three sessions are complete, or no fresh images are available yet.');
      const now = new Date(), midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
      active = { scene: next.id, language: languages.value, started: now.getTime(), deadline: Math.min(now.getTime() + 120000, midnight.getTime()), outcomes: {}, day: localDay(now) };
      storage.setItem(ACTIVE_KEY, JSON.stringify(active)); run();
    } catch (error) { report(error.message); }
  };
  $('practice-finish').onclick = finish;
  $('library-day').onchange = () => {
    const day = +$('library-day').value - 1;
    if (!Number.isInteger(day) || day < 0 || day >= 365) { report('Choose a library day from 1 to 365.'); return; }
    const key = `${day}:${$('library-slot').value}`;
    if (key === previewKey) return;
    previewKey = key;
    $('library-word').disabled = true;
    const preview = YEAR_LIBRARY[day * 3 + +$('library-slot').value];
    $('library-preview').innerHTML = librarySVG(preview);
    for (const target of preview.targets) {
      const node = $('library-preview').querySelector(`[data-target="${target.id}"]`);
      const choose = () => { $('library-word').textContent = PACKS[languages.value][target.concept].label; $('library-word').lang = languages.value; $('library-word').disabled = false; $('library-word').onclick = () => { void audio.play(languages.value, target.concept); }; void audio.play(languages.value, target.concept); };
      node.onclick = choose; node.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); choose(); } };
    }
  };
  $('library-slot').onchange = () => $('library-day').onchange();
  $('library-day').oninput = () => $('library-day').onchange();
  $('library-day').onchange();
  $('library-download').onclick = () => {
    const link = document.createElement('a'); link.href = './dlang/year-library.json'; link.download = 'dlang-year-library.json'; link.click();
  };
  try {
    load();
    const raw = storage.getItem(ACTIVE_KEY);
    if (raw) {
      const value = JSON.parse(raw), target = YEAR_LIBRARY.find(s => s.id === value.scene);
      if (!target || !PACKS[value.language] || !Number.isFinite(value.deadline) || !Number.isFinite(value.started)
        || value.started < 0 || value.started > Date.now() || value.day !== localDay(new Date(value.started))
        || value.deadline <= value.started || value.deadline - value.started > 120000 || !value.outcomes || Array.isArray(value.outcomes)
        || Object.entries(value.outcomes).some(([id, result]) => !target.targets.some(t => t.concept === id) || typeof result !== 'boolean')) throw Error('Saved session is invalid; clear the active session before starting again.');
      if (state.attempts.some(a => a.scene === value.scene)) storage.removeItem(ACTIVE_KEY);
      else { active = value; run(); }
    }
    summary();
  } catch (error) { report(error.message); $('practice-start').disabled = true; }
  window.addEventListener('storage', event => { if ([PRACTICE_KEY, ACTIVE_KEY].includes(event.key)) { stop(); active = null; scene = null; chosen = null; paint(); $('practice-word').disabled = true; $('practice-again').disabled = true; $('practice-remembered').disabled = true; try { load(); const raw = storage.getItem(ACTIVE_KEY); if (raw) { report('Practice changed in another tab. Reload to resume.'); $('practice-start').disabled = true; } else { summary(); } } catch (error) { report(error.message); } } });
}
