const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');
const { openTool } = require('./learning-tools.cjs');

for (const width of [1280, 375]) test(`${width}px autoplay video landing, accessible icon panels and reduced-motion still`, async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const requests = [], external = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(base + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(base + '/');
  await page.locator('#practice-start').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.learning-panel:not([hidden])').count(), 0);
  assert.equal(await page.locator('#practice').isVisible(), false);
  assert.equal(await page.locator('#landing-video').getAttribute('src'), null);
  assert.equal(requests.some(url => url.includes('.mp4')), false);
  await page.waitForFunction(() => document.querySelector('#landing-poster img').complete);
  const poster = await page.locator('#landing-poster img').evaluate(image => ({ source: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight }));
  assert.match(poster.source, width === 375 ? /landing-mobile.jpg$/ : /landing-desktop.jpg$/);
  assert.deepEqual([poster.width, poster.height], width === 375 ? [512, 1230] : [1280, 720]);
  assert.equal(await page.locator('#landing-motion').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => {
    const video = document.querySelector('#landing-video');
    return video.readyState >= 2 && !video.paused && video.currentTime > 0;
  });
  const film = await page.locator('#landing-video').evaluate(video => ({ src: video.currentSrc, width: video.videoWidth, height: video.videoHeight, muted: video.muted, loop: video.loop, autoplay: video.autoplay, duration: video.duration }));
  assert.match(film.src, width === 375 ? /landing-mobile.mp4$/ : /landing-desktop.mp4$/);
  assert.deepEqual([film.width, film.height], width === 375 ? [512, 1230] : [1280, 720]);
  assert.equal(film.muted, true); assert.equal(film.loop, true); assert.equal(film.autoplay, true);
  assert.ok(film.duration >= 15 && film.duration < 16);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#landing-video').paused);
  assert.equal(await page.locator('#landing-video').evaluate(video => video.paused), true);
  assert.equal(await page.locator('#landing-video').evaluate(video => video.classList.contains('has-frame')), false);
  for (const name of ['practice', 'library', 'voices', 'week']) {
    await openTool(page, name);
    assert.equal(await page.locator('.learning-panel:not([hidden])').count(), 1);
    assert.equal(await page.locator(`#panel-${name}`).evaluate(panel => panel.contains(document.activeElement)), true);
    const bounds = await page.locator(`#panel-${name}`).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(`#panel-${name}`).isVisible(), false);
    assert.equal(await page.locator(`.tool-rail [data-open-panel="${name}"]`).evaluate(button => button === document.activeElement), true);
  }
  await openTool(page, 'library');
  await page.click('#wordmap-open');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#panel-library').isVisible(), true, 'Escape closes the nested dialog before its panel');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
});
