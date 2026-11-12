import { SCENES, CONCEPTS, sceneSVG } from './scenes.mjs';
import { LEVELS, HOME_EXTRA_CONCEPTS, levelForDay, poolForDay } from './curriculum.mjs';
export const DAYS = 365;
export const SESSIONS_PER_DAY = 3;
export const REVIEW_DAYS = [1, 3, 7, 14, 30, 60];
export const PRACTICE_KEY = 'dlang-practice-v1';
export const PRACTICE_VERSION = 2;
export const SCENE_VERSION = 2;
export const MAX_PRACTICE_ATTEMPTS = DAYS * SESSIONS_PER_DAY * 2;
export const EXTRA_CONCEPTS = HOME_EXTRA_CONCEPTS;
export const LIBRARY_CONCEPTS = LEVELS.flatMap(level => level.concepts);
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
    // The concept pool widens with the curriculum levels: the first week keeps
    // the same dozen home objects, then counting, feelings, colors and verbs
    // join the scenes like a family slowly narrating more of the world.
    const pool = poolForDay(cycle);
    const concepts = shuffle(pool, random(337 + cycle * 31 + group * 7)).slice(0, 12);
    const layout = shuffle(slots, rng);
    const base = SCENES[(index * 3 + cycle) % SCENES.length];
    const targets = concepts.map((concept, i) => {
      const design = appearances[concept]++ % 32;
      const [x, y, w, h] = layout[i];
      return { id: `y${index}-${concept}`, concept, design, exemplar: `${concept}-design-${design}`,
        box: [x + Math.floor(rng() * 22), y + Math.floor(rng() * 15), w, h] };
    });
    entries.push({ ...base, id: `year-v${SCENE_VERSION}-${String(index + 1).padStart(4, '0')}`,
      title: `${base.title} · discovery ${index + 1}`, seed: index + 1, targets,
      sky: `hsl(${Math.floor(rng() * 360)} 38% 85%)`, ground: `hsl(${25 + Math.floor(rng() * 50)} 27% 68%)`,
      accent: `hsl(${Math.floor(rng() * 360)} 35% 36%)`, library: true, level: levelForDay(cycle).id,
      sceneVersion: SCENE_VERSION });
  }
  return entries;
}
export const YEAR_LIBRARY = yearLibrary();
const sceneIndex = new Map(YEAR_LIBRARY.map((scene, index) => [scene.id, index]));
const sceneById = new Map(YEAR_LIBRARY.map(scene => [scene.id, scene]));
function hashScene(scene) {
  const identity = JSON.stringify({
    id: scene.id, sceneVersion: scene.sceneVersion, level: scene.level, title: scene.title, variant: scene.variant,
    sky: scene.sky, ground: scene.ground, accent: scene.accent,
    targets: scene.targets.map(({ id, concept, design, exemplar, box }) => [id, concept, design, exemplar, box])
  });
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < identity.length; i++) {
    hash ^= BigInt(identity.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
const sceneHashes = new Map(YEAR_LIBRARY.map(scene => [scene.id, hashScene(scene)]));
export function sceneHash(scene) {
  return sceneById.get(scene?.id) === scene ? sceneHashes.get(scene.id) : hashScene(scene);
}
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function emptyPractice() { return { version: PRACTICE_VERSION, attempts: [], reviews: {} }; }

function validateReview(review) {
  return review && Number.isInteger(review.stage) && review.stage >= 0 && review.stage < REVIEW_DAYS.length
    && Number.isFinite(review.due) && review.due >= 0 && Number.isFinite(review.seen) && review.seen >= 0
    && Number.isInteger(review.count) && review.count >= 1;
}

function validateAttemptFields(attempt) {
  return attempt && typeof attempt.scene === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(attempt.day)
    && Number.isSafeInteger(attempt.correct) && attempt.correct >= 0 && attempt.correct <= 12
    && Number.isSafeInteger(attempt.touched) && attempt.touched >= attempt.correct && attempt.touched <= 12
    && Number.isFinite(attempt.at) && attempt.at >= 0 && localDay(new Date(attempt.at)) === attempt.day
    && ['en', 'es', 'fr', 'hi', 'zh-Hans'].includes(attempt.language);
}

function migratePractice(value) {
  if (!Array.isArray(value.attempts) || value.attempts.length > DAYS * SESSIONS_PER_DAY
    || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews)) {
    throw Error('Practice records invalid; export or clear this browser before continuing.');
  }
  const ids = new Set(), days = new Map();
  for (const attempt of value.attempts) {
    const match = /^year-(\d{4})$/.exec(attempt?.scene);
    if (!match || Number(match[1]) < 1 || Number(match[1]) > DAYS * SESSIONS_PER_DAY || !validateAttemptFields(attempt)
      || ids.has(attempt.scene)) throw Error('Invalid legacy practice attempt.');
    ids.add(attempt.scene);
    days.set(attempt.day, (days.get(attempt.day) || 0) + 1);
    if (days.get(attempt.day) > SESSIONS_PER_DAY) throw Error('Invalid daily practice count.');
  }
  for (const [concept, review] of Object.entries(value.reviews))
    if (!LIBRARY_CONCEPTS.includes(concept) || !validateReview(review)) throw Error('Invalid concept review.');
  return {
    version: PRACTICE_VERSION,
    attempts: value.attempts.map(attempt => ({ ...attempt, scene: `legacy:${attempt.scene}`, sceneVersion: 1, sceneHash: null })),
    reviews: structuredClone(value.reviews)
  };
}

export function validatePractice(value) {
  if (value?.version === 1) return validatePractice(migratePractice(value));
  if (value?.version !== PRACTICE_VERSION || !Array.isArray(value.attempts) || value.attempts.length > MAX_PRACTICE_ATTEMPTS
    || !value.reviews || typeof value.reviews !== 'object' || Array.isArray(value.reviews)) {
    throw Error('Practice records invalid; export or clear this browser before continuing.');
  }
  const ids = new Set(), days = new Map(), usedScenes = new Set();
  let firstUnusedIndex = 0;
  for (const attempt of value.attempts) {
    const identity = `${attempt?.sceneVersion}:${attempt?.scene}`;
    if (!validateAttemptFields(attempt) || ids.has(identity)) throw Error('Invalid practice attempt.');
    if (attempt.sceneVersion === 1) {
      const match = /^legacy:year-(\d{4})$/.exec(attempt.scene);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > DAYS * SESSIONS_PER_DAY || attempt.sceneHash !== null) throw Error('Invalid legacy practice attempt.');
    } else if (attempt.sceneVersion === SCENE_VERSION) {
      const index = sceneIndex.get(attempt.scene), scene = sceneById.get(attempt.scene);
      if (index == null || !scene || attempt.sceneHash !== sceneHash(scene)) throw Error('Practice scene no longer matches this library.');
      while (firstUnusedIndex < YEAR_LIBRARY.length && usedScenes.has(YEAR_LIBRARY[firstUnusedIndex].id)) firstUnusedIndex++;
      if (Math.floor(index / SESSIONS_PER_DAY) !== Math.floor(firstUnusedIndex / SESSIONS_PER_DAY)) throw Error('Practice levels must be completed in order.');
      usedScenes.add(attempt.scene);
    } else throw Error('Invalid practice scene version.');
    ids.add(identity);
    days.set(attempt.day, (days.get(attempt.day) || 0) + 1);
    if (days.get(attempt.day) > SESSIONS_PER_DAY) throw Error('Invalid daily practice count.');
  }
  for (const [concept, review] of Object.entries(value.reviews))
    if (!LIBRARY_CONCEPTS.includes(concept) || !validateReview(review)) throw Error('Invalid concept review.');
  return value;
}
export function readPractice(storage) {
  const raw = storage.getItem(PRACTICE_KEY);
  if (!raw) return emptyPractice();
  const stored = JSON.parse(raw), value = validatePractice(stored);
  if (stored.version !== PRACTICE_VERSION) storage.setItem(PRACTICE_KEY, JSON.stringify(value));
  return value;
}
export function nextScene(state, now = Date.now()) {
  validatePractice(state);
  if (state.attempts.filter(item => item.day === localDay(new Date(now))).length >= 3) return null;
  const used = new Set(state.attempts.filter(item => item.sceneVersion === SCENE_VERSION).map(item => item.scene));
  const firstUnused = YEAR_LIBRARY.findIndex(scene => !used.has(scene.id));
  if (firstUnused < 0) return null;
  const batch = Math.floor(firstUnused / SESSIONS_PER_DAY);
  const recent = state.attempts.filter(item => item.sceneVersion === SCENE_VERSION).slice(-21)
    .map(item => sceneById.get(item.scene));
  const images = new Set(recent.flatMap(scene => scene.targets.map(target => target.exemplar)));
  const candidates = YEAR_LIBRARY.slice(batch * SESSIONS_PER_DAY, (batch + 1) * SESSIONS_PER_DAY)
    .filter(scene => !used.has(scene.id) && !scene.targets.some(target => images.has(target.exemplar)));
  if (!candidates.length) {
    const fallback = YEAR_LIBRARY.slice(batch * SESSIONS_PER_DAY, (batch + 1) * SESSIONS_PER_DAY)
      .filter(scene => !used.has(scene.id));
    if (!fallback.length) return null;
    return fallback.reduce((best, scene) => !best || scene.targets.filter(target => images.has(target.exemplar)).length
      < best.targets.filter(target => images.has(target.exemplar)).length ? scene : best, null);
  }
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
  const index = sceneIndex.get(scene?.id), nextIndex = YEAR_LIBRARY.findIndex(candidate =>
    !state.attempts.some(attempt => attempt.sceneVersion === SCENE_VERSION && attempt.scene === candidate.id));
  if (index == null || YEAR_LIBRARY[index] !== scene || scene.sceneVersion !== SCENE_VERSION
    || index < 0 || Math.floor(index / SESSIONS_PER_DAY) !== Math.floor(nextIndex / SESSIONS_PER_DAY)
    || state.attempts.some(item => item.sceneVersion === SCENE_VERSION && item.scene === scene.id)
    || state.attempts.filter(item => item.day === localDay(new Date(now))).length >= SESSIONS_PER_DAY) throw Error('Session unavailable or already completed.');
  if (!['en', 'es', 'fr', 'hi', 'zh-Hans'].includes(language) || !outcomes || typeof outcomes !== 'object'
    || Array.isArray(outcomes) || Object.keys(outcomes).length > scene.targets.length
    || Object.keys(outcomes).some(id => !scene.targets.some(target => target.concept === id) || typeof outcomes[id] !== 'boolean')) throw Error('Invalid practice outcomes.');
  const copy = structuredClone(state);
  for (const [concept, remembered] of Object.entries(outcomes)) {
    const old = copy.reviews[concept];
    const stage = remembered ? old && old.due <= now ? Math.min(old.stage + 1, REVIEW_DAYS.length - 1) : old?.stage || 0 : 0;
    copy.reviews[concept] = { stage, due: remembered && old?.due > now ? old.due : now + (remembered ? REVIEW_DAYS[stage] * 86400000 : 600000), seen: now, count: (old?.count || 0) + 1 };
  }
  copy.attempts.push({ scene: scene.id, sceneVersion: SCENE_VERSION, sceneHash: sceneHash(scene),
    day: localDay(new Date(now)), correct: Object.values(outcomes).filter(Boolean).length,
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
export function practiceProgress(state) {
  validatePractice(state);
  const used = new Set(state.attempts.filter(attempt => attempt.sceneVersion === SCENE_VERSION).map(attempt => attempt.scene));
  const next = YEAR_LIBRARY.find(scene => !used.has(scene.id)) || null;
  const level = next ? LEVELS.find(item => item.id === next.level) : null;
  const levelScenes = next ? YEAR_LIBRARY.filter(scene => scene.level === next.level) : [];
  const completedInLevel = levelScenes.reduce((sum, scene) => sum + Number(used.has(scene.id)), 0);
  return { level: level?.id ?? LEVELS.length, title: level?.title ?? 'Year complete',
    completedInLevel, totalInLevel: levelScenes.length, nextScene: next };
}
export function librarySVG(scene) { return sceneSVG(scene, { study: true }); }
