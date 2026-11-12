const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');
const { openTool } = require('./learning-tools.cjs');

async function setup(t, width = 1280) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const external = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__mediaCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.__mediaCalls++; throw Error('Microphone not granted in this test'); };
  });
  await page.goto(base + '/dlang.html');
  await openTool(page, 'voices');
  return { page, external, errors };
}

for (const width of [1280, 375]) test(`${width}px steward modules mount without capture, payment or external services`, async t => {
  const { page, external, errors } = await setup(t, width);
  for (const root of ['narration-root', 'conversation-root']) {
    await page.locator(`#${root} button`).first().waitFor();
    assert.ok((await page.locator(`#${root}`).textContent()).trim().length > 20);
  }
  assert.equal(await page.locator('#narration-root header').evaluate(header => getComputedStyle(header).display), 'block');
  assert.equal(await page.locator('#narration-root header input').count(), 0);
  await openTool(page, 'library');
  await page.getByRole('spinbutton', { name: 'Day', exact: true }).fill('8');
  await page.getByRole('spinbutton', { name: 'Day', exact: true }).press('Tab');
  await openTool(page, 'voices');
  await page.waitForFunction(() => document.querySelector('#narration-root header').textContent.includes('year-v2-0022'));
  assert.match(await page.locator('#conversation-root').textContent(), /level 2/);
  assert.equal(await page.evaluate(() => window.__mediaCalls), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});

test('weekly attempt blocks narration and conversation until it finishes', async t => {
  const { page, errors } = await setup(t);
  const start = Date.now() - 60000;
  const config = {
    id: 'steward-integration', timezone: 'America/New_York', level: 1,
    conceptPolicy: 'recurring-12', enrollmentCutoff: new Date(start).toISOString(),
    dayStarts: Array.from({ length: 8 }, (_, index) => new Date(start + index * 86400000).toISOString())
  };
  await page.route('**/dlang/round.json', route => route.fulfill({ json: config }));
  await page.evaluate(async config => {
    const { Round } = await import('./dlang/core.mjs');
    const { SCENES } = await import('./dlang/scenes.mjs');
    const { PACKS } = await import('./dlang/packs.mjs');
    const before = Date.parse(config.dayStarts[0]) - 1000;
    const round = new Round({ config, scenes: SCENES, packs: PACKS, storage: localStorage, clock: () => before });
    round.enroll('en', { eligible: true, authorization: false });
  }, config);
  await page.reload();
  await openTool(page, 'week');
  await page.locator('#study-scene [data-target]').first().waitFor();
  await page.click('#week-tab');
  await page.click('#go');
  await page.waitForFunction(() => document.getElementById('narration-root').hidden && document.getElementById('conversation-root').hidden);
  await page.click('#finish');
  await page.waitForFunction(() => !document.getElementById('narration-root').hidden && !document.getElementById('conversation-root').hidden);
  assert.equal(await page.evaluate(() => window.__mediaCalls), 0);
  assert.deepEqual(errors, []);
});
