import { SCENES, CONCEPTS, sceneSVG } from './scenes.mjs';
export const DAYS = 365;
export const SESSIONS_PER_DAY = 3;
export const REVIEW_DAYS = [1, 3, 7, 14, 30, 60];
export const PRACTICE_KEY = 'dlang-practice-v1';
export const EXTRA_CONCEPTS = ['bed', 'sofa', 'door', 'window', 'bottle', 'bowl', 'plate', 'spoon', 'fork', 'knife', 'apple', 'banana', 'carrot', 'bread', 'hat', 'shoe', 'bag', 'umbrella', 'dog', 'fish', 'boat', 'car', 'house', 'bridge'];
export const LIBRARY_CONCEPTS = [...CONCEPTS, ...EXTRA_CONCEPTS];
export function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
export function shuffle(items, rng) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
// Three nonoverlapping rows keep all targets reachable; each composition shuffles the slots.
const slots = Array.from({ length: 12 }, (_, i) => [35 + (i % 4) * 245, 100 + Math.floor(i / 4) * 163, 165, 135]);
export function yearLibrary() {
  const appearances = Object.fromEntries(LIBRARY_CONCEPTS.map(id => [id, 0]));
  const entries = [];
  for (let index = 0; index < DAYS * SESSIONS_PER_DAY; index++) {
    const rng = random(81073 + index * 7919);
    const cycle = Math.floor(index / 3), group = index % 3;
    const concepts = shuffle(LIBRARY_CONCEPTS, random(337 + cycle * 31)).slice(group * 12, group * 12 + 12);
    const layout = shuffle(slots, rng);
    const base = SCENES[(index * 3 + cycle) % SCENES.length];
    const targets = concepts.map((concept, i) => {
      const design = appearances[concept]++ % 32;
      const [x, y, w, h] = layout[i];
      return { id: `y${index}-${concept}`, concept, design, exemplar: `${concept}-design-${design}`,
        box: [x + Math.floor(rng() * 22), y + Math.floor(rng() * 15), w, h] };
    });
    entries.push({ ...base, id: `year-${String(index + 1).padStart(4, '0')}`,
      title: `${base.title} · discovery ${index + 1}`, seed: index + 1, targets,
      sky: `hsl(${Math.floor(rng() * 360)} 38% 85%)`, ground: `hsl(${25 + Math.floor(rng() * 50)} 27% 68%)`,
      accent: `hsl(${Math.floor(rng() * 360)} 35% 36%)`, library: true });
  }
  return entries;
}
export const YEAR_LIBRARY = yearLibrary();
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function emptyPractice() { return { version: 1, attempts: [], reviews: {} }; }
export function validatePractice(value) {
  if (value?.version !== 1 || !Array.isArray(value.attempts) || value.attempts.length > 1095 || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews)) throw Error('Practice records invalid; export or clear this browser before continuing.');
  const ids = new Set(), days = new Map();
  for (const attempt of value.attempts) {
    if (!YEAR_LIBRARY.some(scene => scene.id === attempt.scene) || ids.has(attempt.scene) || !/^\d{4}-\d{2}-\d{2}$/.test(attempt.day)
      || !Number.isSafeInteger(attempt.correct) || attempt.correct < 0 || attempt.correct > 12 || !Number.isSafeInteger(attempt.touched) || attempt.touched < attempt.correct || attempt.touched > 12
      || !Number.isFinite(attempt.at) || attempt.at < 0 || !['en', 'es', 'fr', 'hi', 'zh-Hans'].includes(attempt.language)) throw Error('Invalid practice attempt.');
    ids.add(attempt.scene); days.set(attempt.day, (days.get(attempt.day) || 0) + 1);
    if (days.get(attempt.day) > 3) throw Error('Invalid daily practice count.');
  }
  for (const [concept, review] of Object.entries(value.reviews)) {
    if (!LIBRARY_CONCEPTS.includes(concept) || !Number.isInteger(review.stage) || review.stage < 0 || review.stage >= REVIEW_DAYS.length
      || !Number.isFinite(review.due) || !Number.isFinite(review.seen) || !Number.isInteger(review.count) || review.count < 1) throw Error('Invalid concept review.');
  }
  return value;
}
export function readPractice(storage) {
  const raw = storage.getItem(PRACTICE_KEY);
  return raw ? validatePractice(JSON.parse(raw)) : emptyPractice();
}
export function nextScene(state, now = Date.now()) {
  validatePractice(state);
  if (state.attempts.filter(item => item.day === localDay(new Date(now))).length >= 3) return null;
  const used = new Set(state.attempts.map(item => item.scene));
  const firstUnused = YEAR_LIBRARY.findIndex(scene => !used.has(scene.id));
  if (firstUnused < 0) return null;
  const batch = Math.floor(firstUnused / SESSIONS_PER_DAY);
  const recent = state.attempts.slice(-21).map(item => YEAR_LIBRARY.find(scene => scene.id === item.scene));
  const images = new Set(recent.flatMap(scene => scene.targets.map(target => target.exemplar)));
  const candidates = YEAR_LIBRARY.slice(batch * SESSIONS_PER_DAY, (batch + 1) * SESSIONS_PER_DAY)
    .filter(scene => !used.has(scene.id) && !scene.targets.some(target => images.has(target.exemplar)));
  let best = null, bestScore = -Infinity;
  for (const scene of candidates) {
    const score = scene.targets.reduce((sum, target) => {
      const review = state.reviews[target.concept];
      return sum + (!review ? 2 : review.due <= now ? 3 + Math.min(7, (now - review.due) / 86400000) : -2);
    }, 0);
    if (score > bestScore) { best = scene; bestScore = score; }
  }
  return best;
}
export function finishPractice(state, scene, outcomes, language, now = Date.now()) {
  validatePractice(state);
  if (!YEAR_LIBRARY.includes(scene) || state.attempts.some(item => item.scene === scene.id)
    || state.attempts.filter(item => item.day === localDay(new Date(now))).length >= 3) throw Error('Session unavailable or already completed.');
  if (!['en', 'es', 'fr', 'hi', 'zh-Hans'].includes(language) || !outcomes || Object.keys(outcomes).some(id => !scene.targets.some(target => target.concept === id) || typeof outcomes[id] !== 'boolean')) throw Error('Invalid practice outcomes.');
  const copy = structuredClone(state);
  for (const [concept, remembered] of Object.entries(outcomes)) {
    const old = copy.reviews[concept];
    const stage = remembered ? old && old.due <= now ? Math.min(old.stage + 1, REVIEW_DAYS.length - 1) : old?.stage || 0 : 0;
    copy.reviews[concept] = { stage, due: remembered && old?.due > now ? old.due : now + (remembered ? REVIEW_DAYS[stage] * 86400000 : 600000), seen: now, count: (old?.count || 0) + 1 };
  }
  copy.attempts.push({ scene: scene.id, day: localDay(new Date(now)), correct: Object.values(outcomes).filter(Boolean).length,
    touched: Object.keys(outcomes).length, language, at: now });
  return validatePractice(copy);
}
export function practiceStats(state, now = Date.now()) {
  validatePractice(state);
  return { sessions: state.attempts.length, today: state.attempts.filter(a => a.day === localDay(new Date(now))).length,
    touched: state.attempts.reduce((sum, a) => sum + a.touched, 0), remembered: state.attempts.reduce((sum, a) => sum + a.correct, 0),
    concepts: Object.keys(state.reviews).length, due: Object.values(state.reviews).filter(r => r.due <= now).length,
    days: new Set(state.attempts.map(a => a.day)).size };
}
export function librarySVG(scene) { return sceneSVG(scene, { study: true }); }
