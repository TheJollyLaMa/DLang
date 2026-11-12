const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../index');
const { chromium } = require('playwright');

test('host routes private conversation before static method refusal without enabling a service', async t => {
  const origin = 'https://thejollylama.github.io';
  const server = createServer({ conversationOrigins: [origin], conversationLivekitOrigin: 'wss://private.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await fetch(base + '/api/dlang/conversation/config');
  assert.equal(config.status, 503);
  assert.deepEqual(await config.json(), { configured: false, error: 'Private conversation unavailable.' });
  const request = await fetch(base + '/api/dlang/conversation/challenge', {
    method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(request.status, 503);
  assert.ok(request.headers.get('content-security-policy').includes('wss://private.example'));
  const rejected = await fetch(base + '/api/dlang/conversation/challenge', {
    method: 'POST', headers: { Origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(rejected.status, 403);
  const unrelated = await fetch(base + '/api/pay', { method: 'POST', body: '{}' });
  assert.equal(unrelated.status, 405);
  assert.equal((await fetch(base + '/health').then(response => response.json())).privateConversationConfigured, false);
});

test('host refuses credentials, paths and non-WSS conversation origins', () => {
  for (const origin of ['https://private.example', 'wss://key:secret@private.example', 'wss://private.example/path', 'wss://private.example?token=secret']) {
    assert.throws(() => createServer({ conversationLivekitOrigin: origin }), /exact WSS origin/);
  }
});

test('served app loads the pinned client and keeps voice unavailable without operator config', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage();
  const configStatuses = [];
  page.on('response', response => {
    if (response.url().endsWith('/api/dlang/conversation/config')) configStatuses.push(response.status());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('#conversation-root')?.childElementCount > 0);
  assert.equal(await page.evaluate(() => typeof window.LivekitClient?.Room), 'function');
  assert.match(await page.locator('#conversation-root').innerText(), /unavailable: no service is configured/);
  assert.doesNotMatch(await page.locator('#dlang-status').innerText(), /No reviewed artwork is published/);
  assert.ok(configStatuses.includes(503));
});
