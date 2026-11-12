const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');
const { openTool } = require('./learning-tools.cjs');

test('mobile practice preserves keyboard, midnight, cross-tab, and honest word-map controls', async t => {
  const server = createServer({ fetchRoster: async () => ({ contributors: [] }) });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, timezoneId: 'America/New_York' });
  const external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-01-02T04:59:00Z') });
  await page.addInitScript(() => {
    window.__sceneContexts = [];
    window.addEventListener('dlang:scene', event => window.__sceneContexts.push(event.detail));
  });
  await page.goto(`${base}/dlang.html`);
  await openTool(page, 'library');
  await page.fill('#library-day', '8');
  await page.locator('#library-day').dispatchEvent('change');
  await page.waitForFunction(() => window.__sceneContexts.some(context => context?.sceneId === 'year-v2-0022'));
  const previewContext = await page.evaluate(() => window.__sceneContexts.at(-1));
  assert.equal(previewContext.sceneId, 'year-v2-0022');
  assert.equal(previewContext.scene.id, previewContext.sceneId);
  assert.equal(previewContext.level, 2);
  assert.equal(previewContext.scene.targets.length, 12);
  await page.evaluate(() => {
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() {}, getVoices: () => [{ lang: 'es-ES', name: 'Spanish fixture' }, { lang: 'fr-FR', name: 'French fixture' }],
      speak(utterance) { window.__lastUtterance = utterance.text; }
    } });
  });
  await openTool(page, 'practice');
  await page.selectOption('#practice-language', 'es');
  await page.click('#practice-start');
  const active = await page.evaluate(() => JSON.parse(localStorage.getItem('dlang-practice-active-v1')));
  assert.equal(active.sceneVersion, 2);
  assert.match(active.scene, /^year-v2-/);
  assert.equal(active.deadline, Date.parse('2026-01-02T05:00:00Z'), 'midnight shortens the explicit-Go session');
  assert.ok(active.deadline > active.started && active.deadline - active.started <= 120000);
  const contextValue = await page.evaluate(() => window.__sceneContexts.at(-1));
  assert.deepEqual([contextValue.sceneId, contextValue.sceneVersion, contextValue.language], [active.scene, 2, 'es']);
  assert.equal(contextValue.concepts.length, 12);
  assert.equal(contextValue.scene.id, active.scene);
  assert.equal(contextValue.scene.targets.length, 12);
  assert.equal(contextValue.sceneHash, active.sceneHash);
  assert.equal(contextValue.level, 1);
  await openTool(page, 'library');
  await page.fill('#library-day', '9');
  await page.locator('#library-day').dispatchEvent('change');
  const isolatedContext = await page.evaluate(() => window.__sceneContexts.at(-1));
  assert.equal(isolatedContext.sceneId, active.scene, 'preview navigation must not replace the active practice scene');
  assert.equal(isolatedContext.sceneHash, active.sceneHash);
  await openTool(page, 'practice');
  const target = page.locator('#practice-scene [data-target]').first();
  await target.focus();
  assert.equal(await target.getAttribute('tabindex'), '0');
  await page.keyboard.press('Enter');
  await page.locator('#practice-objects').evaluate(element => { element.closest('details').open = true; });
  const listButton = page.locator('#practice-objects button').first();
  assert.equal(await listButton.getAttribute('type'), 'button');
  assert.equal(await listButton.getAttribute('lang'), 'es');
  assert.ok((await listButton.boundingBox()).width >= 90);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);

  await page.clock.runFor(61000);
  await page.waitForFunction(() => !localStorage.getItem('dlang-practice-active-v1'));
  let state = await page.evaluate(() => JSON.parse(localStorage.getItem('dlang-practice-v1')));
  assert.equal(state.attempts[0].day, '2026-01-01', 'midnight completion remains attributed to its start day');
  assert.equal(state.attempts[0].sceneVersion, 2);

  await page.click('#practice-start');
  const second = await context.newPage();
  await second.goto(`${base}/dlang.html`);
  await openTool(second, 'practice');
  await second.locator('#practice-scene [data-target]').first().waitFor();
  await second.click('#practice-finish');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dlang-practice-v1')).attempts.length === 2);
  await page.waitForFunction(() => document.getElementById('practice-scene').querySelectorAll('[data-target]').length === 0);
  assert.match(await page.locator('#practice-summary').textContent(), /2 completed/);
  assert.equal(await page.evaluate(() => !!localStorage.getItem('dlang-practice-active-v1')), false);

  await page.evaluate(() => localStorage.setItem('dlang-words-v1', JSON.stringify({
    version: 1, username: 'local observer', fetchedAt: '2026-01-01T00:00:00.000Z',
    languages: {
      es: { code: 'es', name: 'Spanish', source: 'learned_lexemes', words: [{ word: 'perro', translations: ['dog'] }] },
      fr: { code: 'fr', name: 'French', source: 'learned_lexemes', words: [{ word: 'chien', translations: ['dog'] }] }
    }
  })));
  await openTool(page, 'library');
  await page.click('#wordmap-open');
  await page.locator('#wordmap-levels details:nth-child(2) summary').click();
  await page.getByText(/Possible course candidates \(shared English gloss; not verified translations\)/).first().waitFor();
  assert.match(await page.locator('#wordmap-levels').textContent(), /perro.*chien|chien.*perro/);
  await page.fill('#wordmap-search', 'dog');
  assert.match(await page.locator('#wordmap-results').textContent(), /Possible candidates · chien/);
  await page.locator('#wordmap-results .wordmap-say').first().click();
  assert.match(await page.locator('#wordmap-status').textContent(), /device synthesis, not a native-speaker recording/);
  await page.locator('#wordmap-status .wordmap-stop').click();
  assert.match(await page.locator('#wordmap-status').textContent(), /Speech stopped/);
  const wordMapBounds = await page.locator('#wordmap-dialog').boundingBox();
  assert.ok(wordMapBounds.x >= 0 && wordMapBounds.x + wordMapBounds.width <= 375);
  assert.deepEqual(external, []);
});
