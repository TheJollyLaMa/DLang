// Personal, local-only Duolingo word-library export for the DLang notebook.
// Signs in once (session reused from data/duo/state.json when still valid),
// then walks each enrolled course sequentially: switch course, read skill
// progress, page through learned lexemes 500 at a time. Randomized multi-second
// delays limit request volume; per-course caches in
// data/duo/ mean re-runs only fetch what previously failed.
// Output: data/duo-words.json (gitignored, never published) — importable from
// the personal notebook's "My word library" section.
//
// Usage: node scripts/fetch-duo-words.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data', 'duo');
const STATE = path.join(DATA_DIR, 'state.json');
const OUT_FILE = path.join(ROOT, 'data', 'duo-words.json');
const PAGE_SIZE = 500, MAX_PAGES = 40, MAX_TRANSLATIONS = 5;

function env() {
  const vars = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) vars[match[1]] = match[2].trim();
  }
  if (!vars.DUO_USERNAME || !vars.DUO_PASSWORD) throw Error('Set DUO_USERNAME and DUO_PASSWORD in .env');
  return vars;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pace = () => sleep(6000 + Math.random() * 6000);
const breathe = () => sleep(2500 + Math.random() * 2500);
const cachePath = code => path.join(DATA_DIR, `words-${code.toLowerCase()}.json`);
const readCache = code => { try { return JSON.parse(fs.readFileSync(cachePath(code), 'utf8')); } catch { return null; } };

async function main() {
  const { DUO_USERNAME: user, DUO_PASSWORD: pass } = env();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 },
    ...(fs.existsSync(STATE) ? { storageState: STATE } : {}) });
  const page = await context.newPage();
  const cookie = async () => (await context.cookies('https://www.duolingo.com')).find(c => c.name === 'jwt_token')?.value;

  await page.goto('https://www.duolingo.com/learn', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  if (!await cookie()) {
    console.log('Signing in (solve any captcha in the window if one appears)…');
    await page.goto('https://www.duolingo.com/log-in', { waitUntil: 'domcontentloaded' });
    await page.type('[data-test="email-input"]', user, { delay: 70 });
    await page.type('[data-test="password-input"]', pass, { delay: 70 });
    await page.click('[data-test="register-button"]');
    await page.waitForURL(/duolingo\.com\/learn/, { timeout: 180000 });
  } else console.log('Reusing saved session; no login needed.');
  await context.storageState({ path: STATE });

  const jwt = await cookie();
  const uid = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;
  const headers = { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
  // One in-page fetch channel so every call carries the live session cookies.
  async function call(url, options = {}) {
    await breathe();
    const result = await page.evaluate(async ({ url, options }) => {
      const response = await fetch(url, { credentials: 'include', ...options });
      return { status: response.status, text: await response.text() };
    }, { url, options: { headers, ...options } });
    if (result.status < 200 || result.status >= 300) throw Error(`${options.method || 'GET'} ${url} -> ${result.status}`);
    return result.text ? JSON.parse(result.text) : {};
  }

  const me = await call(`https://www.duolingo.com/2017-06-30/users/${uid}?fields=courses,learningLanguage,fromLanguage`);
  const original = { learningLanguage: me.learningLanguage, fromLanguage: me.fromLanguage || 'en' };
  const courses = (me.courses || []).sort((a, b) => (b.xp || 0) - (a.xp || 0));
  fs.writeFileSync(path.join(DATA_DIR, 'courses.json'), JSON.stringify(courses, null, 2));
  console.log(`${courses.length} enrolled courses; active: ${original.learningLanguage}.`);

  async function switchCourse({ learningLanguage, fromLanguage }) {
    await call(`https://www.duolingo.com/2017-06-30/users/${uid}?fields=currentCourse(learningLanguage)`,
      { method: 'PATCH', body: JSON.stringify({ fromLanguage, learningLanguage }) });
  }

  async function fetchCourseWords(course) {
    const current = await call(`https://www.duolingo.com/2017-06-30/users/${uid}?fields=currentCourse`);
    const active = current.currentCourse;
    if (active?.learningLanguage !== course.learningLanguage) throw Error(`course did not switch (still ${active?.learningLanguage})`);
    const progressedSkills = (active.skills || []).flat()
      .filter(skill => skill.finishedLevels > 0 || skill.finishedLessons > 0)
      .map(skill => ({ finishedLevels: skill.finishedLevels, finishedSessions: skill.finishedSessions ?? skill.finishedLessons ?? 0, skillId: { id: skill.id } }));
    const words = [];
    let startIndex = 0, total = null;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const url = `https://www.duolingo.com/2017-06-30/users/${uid}/courses/${course.learningLanguage}/${course.fromLanguage}/learned-lexemes?limit=${PAGE_SIZE}&sortBy=ALPHABETICAL&startIndex=${startIndex}`;
      const data = await call(url, { method: 'POST', body: JSON.stringify({ lastTotalLexemeCount: 0, progressedSkills }) });
      for (const lexeme of data.learnedLexemes || [])
        words.push({ word: lexeme.text, ...(lexeme.translations?.length ? { translations: lexeme.translations.slice(0, MAX_TRANSLATIONS) } : {}) });
      total = data.pagination?.totalLexemes ?? total;
      const next = data.pagination?.nextStartIndex;
      if (next == null || next <= startIndex || !(data.learnedLexemes || []).length) break;
      startIndex = next;
      process.stdout.write(`  …${words.length}/${total}\r`);
    }
    return { words, total, skills: progressedSkills.length };
  }

  let fetched = 0, skipped = 0;
  const failed = [];
  for (const course of courses) {
    const code = course.learningLanguage;
    if (readCache(code)) { skipped++; continue; }
    console.log(`→ ${course.title} (${code}), ${course.xp} XP`);
    try {
      await switchCourse(course);
      await pace();
      const { words, total, skills } = await fetchCourseWords(course);
      const entry = { code: code.length > 2 ? code.slice(0, 3).toLowerCase() + code.slice(3) : code.toLowerCase(),
        name: course.title, points: course.xp || 0, learning: code === original.learningLanguage,
        source: 'learned_lexemes', fetchedAt: new Date().toISOString(), words };
      fs.writeFileSync(cachePath(code), JSON.stringify(entry, null, 2));
      console.log(`  saved ${words.length} words (server total ${total}, from ${skills} progressed skills).`);
      fetched++;
    } catch (error) {
      console.log(`  FAILED: ${error.message} — continuing; re-run later to retry just this course.`);
      failed.push(code);
    }
    await pace();
  }

  try { await switchCourse(original); console.log(`Restored active course: ${original.learningLanguage}.`); }
  catch (error) { console.log(`Could not restore ${original.learningLanguage} (${error.message}) — switch back in the app.`); }
  await context.storageState({ path: STATE });
  await browser.close();

  const merged = { version: 1, username: user, fetchedAt: new Date().toISOString(), languages: {} };
  for (const course of courses) {
    const entry = readCache(course.learningLanguage);
    if (entry) merged.languages[entry.code] = entry;
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));
  const total = Object.values(merged.languages).reduce((sum, language) => sum + language.words.length, 0);
  console.log(`\nDone. ${fetched} fetched, ${skipped} cached, ${failed.length} failed${failed.length ? ` (${failed.join(', ')})` : ''}.`);
  console.log(`${Object.keys(merged.languages).length} languages, ${total} words -> ${path.relative(ROOT, OUT_FILE)}`);
  console.log('Import it from DLang: notebook dialog -> My word library -> Import word library JSON.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
