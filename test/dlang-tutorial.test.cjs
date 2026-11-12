const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');

for (const width of [1280, 375]) test(`${width}px white rabbit walks through real tools without starting practice or payments`, async t => {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const base = `http://127.0.0.1:${server.address().port}`, errors = [], external = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__sensitive = [];
    window.ethereum = { request: async ({ method }) => {
      window.__sensitive.push(method); throw Error('Tutorial must not request wallet access');
    }, on() {}, removeListener() {} };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__sensitive.push('microphone'); throw Error('Tutorial must not record');
    };
  });
  await page.goto(base + '/dlang.html');
  await page.locator('#study-scene [data-target]').first().waitFor({ state: 'attached' });
  const cases = [
    { title: /first little discovery/, panel: 'practice' },
    { title: /Many languages/, panel: 'week', focus: 'study-scene' },
    { title: /Small words/, panel: 'library' },
    { title: /Listen, echo/, panel: 'voices' },
    { title: /first week/, panel: 'week', focus: 'week' },
    { title: /Half for friends/, panel: 'week', focus: 'week' },
    { title: /Gems climb/, personal: true },
    { title: /What is live/, personal: true },
    { title: /story is more/, personal: true }
  ];
  for (const [index, item] of cases.entries()) {
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    });
    await page.keyboard.press('Escape');
    await page.locator('#rabbit-open').click();
    for (let hop = 0; hop < index; hop++) await page.locator('#rabbit-next').click();
    assert.equal(await page.locator('#rabbit-progress').textContent(), `Hop ${index + 1} of 9`);
    assert.match(await page.locator('#rabbit-title').textContent(), item.title);
    if (index === 0) assert.match(await page.locator('#rabbit-body').textContent(), /Nothing.*starts your timer/);
    if (index === 3) assert.match(await page.locator('#rabbit-body').textContent(), /two-device audio.*different operator-approved wallets.*GitHub Pages is typed-only.*signs a message, not a payment/);
    if (index === 4) assert.match(await page.locator('#rabbit-body').textContent(), /No paid round is open/);
    if (index === 5) assert.match(await page.locator('#rabbit-body').textContent(), /0.50.*0.50.*not active/);
    if (index === 6) assert.match(await page.locator('#rabbit-body').textContent(), /recover all funds.*holder backing, dividends and weekly refunds.*permanently retiring/);
    if (index === 7) assert.match(await page.locator('#rabbit-body').textContent(), /Missing successor evidence shows not configured.*No automatic migration/);
    await page.locator('#rabbit-try').click();
    assert.equal(await page.locator('#rabbit-dialog').evaluate(dialog => dialog.open), false);
    if (item.personal) {
      await page.locator('#history-dialog').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#history-dialog').evaluate(dialog => dialog.open), true);
    }
    else {
      await page.locator(`#panel-${item.panel}`).waitFor({ state: 'visible' });
      assert.equal(await page.locator(`#panel-${item.panel}`).isVisible(), true);
      if (item.focus) assert.equal(await page.evaluate(() => document.activeElement.id), item.focus);
      if (index === 3) {
        const guide = page.locator('#conversation-root details');
        await guide.locator('summary').click();
        await guide.locator('ol').waitFor({ state: 'visible' });
        assert.equal(await guide.locator('a').getAttribute('href'), 'https://dlang-stewards.onrender.com/');
        assert.equal(await guide.locator('ol > li').count(), 7);
        const text = await guide.innerText();
        assert.match(text, /Create private room.*Private room ID.*Join private room/s);
        assert.match(text, /provider retention has not been verified/);
        assert.match(text, /Either person leaving ends the room for both/);
        assert.match(text, /denial\/listen-only, mute, leave and expiry/);
      }
    }
    assert.deepEqual(await page.evaluate(() => window.__sensitive), []);
    assert.equal(await page.evaluate(() => localStorage.getItem('dlang-practice-active-v1')), null);
    assert.equal(await page.locator('#attempt').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  }
  await page.locator('#profile-rabbit').click();
  assert.equal(await page.locator('#history-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('#rabbit-progress').textContent(), 'Hop 1 of 9');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#rabbit-dialog').evaluate(dialog => dialog.open), false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
