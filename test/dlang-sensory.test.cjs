const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Wallet, verifyMessage } = require('ethers');
const { createServer } = require('../index');

test('sensory catalog requires provenance, bounded media and explicit review before approval', async () => {
  const { validateSensoryCatalog } = await import('../public/dlang/sensory.mjs');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/dlang/sensory-catalog.json')));
  const assets = validateSensoryCatalog(catalog);
  assert.equal(assets.filter(asset => asset.kind === 'sound').length, 6);
  assert.equal(assets.filter(asset => asset.kind === 'image').length, 12);
  assert.ok(assets.every(asset => asset.status === 'draft'));
  for (const asset of assets) {
    const data = fs.readFileSync(path.join(__dirname, '../public/dlang', asset.path));
    const { createHash } = require('node:crypto');
    assert.equal(data.length, asset.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
    if (asset.preview) {
      assert.ok(asset.preview.bytes < 50000, 'Preview must remain lightweight');
      const preview = fs.readFileSync(path.join(__dirname, '../public/dlang', asset.preview.path));
      assert.equal(createHash('sha256').update(preview).digest('hex'), asset.preview.sha256);
    }
  }
  const changed = structuredClone(catalog);
  changed.assets[0].status = 'approved';
  assert.throws(() => validateSensoryCatalog(changed), /review/);
  changed.assets[0].path = 'https://other.example/sound.mp3';
  assert.throws(() => validateSensoryCatalog(changed));
  assert.throws(() => validateSensoryCatalog({ version: 1, assets: [assets[0], assets[0]] }));
});

test('weather derivatives are audible without clipping and retain the original recordings', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/dlang.html`);
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/dlang/sensory-catalog.json')));
  const weather = catalog.assets.filter(asset => ['wind', 'rain'].includes(asset.concept));
  assert.equal(weather.length, 2);
  for (const asset of weather) {
    assert.equal(asset.processing.version, 2);
    const source = fs.readFileSync(path.join(__dirname, '../public/dlang', asset.processing.originalPath));
    assert.equal(require('node:crypto').createHash('sha256').update(source).digest('hex'), asset.processing.originalSha256);
    const levels = await page.evaluate(async asset => {
      const context = new AudioContext();
      async function measure(path) {
        const response = await fetch(`/dlang/${path}`);
        if (!response.ok) throw Error(`Media HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        let squareSum = 0, peak = 0, samples = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          for (const sample of buffer.getChannelData(channel)) {
            squareSum += sample * sample; peak = Math.max(peak, Math.abs(sample)); samples++;
          }
        }
        return { rmsDb: 10 * Math.log10(squareSum / samples), peakDb: 20 * Math.log10(peak), duration: buffer.duration };
      }
      try { return { original: await measure(asset.processing.originalPath), normalized: await measure(asset.path) }; }
      finally { await context.close(); }
    }, asset);
    assert.ok(Math.abs(levels.normalized.rmsDb + 30) <= 1, `${asset.concept}: ${JSON.stringify(levels)}`);
    assert.ok(levels.normalized.peakDb <= -3, 'Decoded audio must retain at least 3 dB headroom');
    assert.ok(levels.normalized.rmsDb + 20 * Math.log10(0.3) >= -42, 'Weather must be audible at the existing 30% player volume');
    assert.ok(levels.normalized.rmsDb - levels.original.rmsDb >= (asset.concept === 'wind' ? 19 : 13));
    assert.ok(Math.abs(levels.normalized.duration - levels.original.duration) < 0.1);
  }
  for (const asset of catalog.assets.filter(asset => ['cat', 'bird', 'bell', 'surprise'].includes(asset.concept) && asset.kind === 'sound')) {
    assert.equal(asset.processing, undefined, 'Accepted cues must not be normalized');
    assert.ok(asset.path.endsWith('-v1.mp3'));
  }
});

test('contributor opt-in and withdrawal stay local, require signatures and never upload samples', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage(), wallet = Wallet.createRandom(), messages = [], mutations = [];
  await page.exposeFunction('signVoiceConsent', message => { messages.push(message); return wallet.signMessage(message); });
  page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()); });
  await page.route('**/dlang/pilot-roster.json', route => route.fulfill({ json: {
    format: 'dlang-reviewed-pilot-roster', version: 1, authorization: false, maximumEntrants: 8,
    members: [{ walletAddress: wallet.address, label: 'Test' }]
  } }));
  await page.goto(`http://127.0.0.1:${server.address().port}/dlang.html`);
  await page.locator('#study-scene [data-target]').first().waitFor({ state: 'attached' });
  await page.locator('[data-open-panel="voices"]').click();
  await page.evaluate(async address => {
    const { mountVoiceSeeding } = await import('/dlang/voice-seeding.mjs');
    window.__consentWalletCalls = 0;
    mountVoiceSeeding({ root: document.getElementById('voice-seeding-root'), storage: localStorage, report() {},
      getWallet: async () => { window.__consentWalletCalls++; return { address, signer: { signMessage: message => window.signVoiceConsent(message) } }; } });
  }, wallet.address);
  await page.locator('[data-seed-sign]').click();
  assert.equal(await page.evaluate(() => window.__consentWalletCalls), 0);
  const sample = fs.readFileSync(path.join(__dirname, '../public/dlang/sensory/2026-11/2026-11-sounds-cat-v1.mp3'));
  await page.locator('[data-seed-file]').setInputFiles({ name: 'synthetic-test-sample.mp3', mimeType: 'audio/mpeg', buffer: sample });
  await page.locator('[data-seed-consent]').check();
  await page.locator('[data-seed-sign]').click();
  await page.waitForFunction(() => document.querySelector('[data-seed-status]').textContent.includes('Signed request saved only'));
  const key = `dlang-voice-seed-request-v1:${wallet.address.toLowerCase()}`;
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(saved.action, 'opt-in');
  assert.equal(verifyMessage(messages[0], saved.signature), wallet.address);
  assert.equal(JSON.stringify(saved).includes('base64'), false);
  await page.locator('[data-seed-withdraw]').click();
  await page.waitForFunction(() => document.querySelector('[data-seed-status]').textContent.includes('not delivered'));
  const withdrawn = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  assert.equal(withdrawn.action, 'withdraw');
  assert.equal(withdrawn.id, saved.id);
  assert.equal(messages.length, 2);
  assert.deepEqual(mutations, []);
});

test('voice consent binds sample, scope, wallet and action; payments are never authorized', async () => {
  const { voiceSeedMessage, VOICE_SEED_TERMS } = await import('../public/dlang/voice-seeding.mjs');
  const { verifyVoiceConsent } = await import('../scripts/voice-seed.mjs');
  const wallet = Wallet.createRandom();
  const record = { version: 1, terms: VOICE_SEED_TERMS, action: 'opt-in',
    id: '550e8400-e29b-41d4-a716-446655440000', wallet: wallet.address, language: 'en',
    sampleHash: 'a'.repeat(64), origin: 'https://dlang.example', issuedAt: new Date().toISOString() };
  const message = voiceSeedMessage(record);
  assert.match(message, /not permit live AI conversation/);
  assert.match(message, /guarantees no payout/);
  const signature = await wallet.signMessage(message);
  const roster = { format: 'dlang-reviewed-pilot-roster', version: 1, authorization: false, maximumEntrants: 8,
    members: [{ walletAddress: wallet.address, label: 'Test contributor' }] };
  assert.equal(verifyVoiceConsent({ ...record, signature }, roster), wallet.address);
  assert.equal(verifyMessage(message, signature), wallet.address);
  assert.throws(() => verifyVoiceConsent({ ...record, sampleHash: 'b'.repeat(64), signature }, roster), /signature/);
  assert.throws(() => verifyVoiceConsent({ ...record, signature }, { ...roster, members: [{ walletAddress: Wallet.createRandom().address, label: 'Other' }] }), /whitelist/);
  const withdraw = { ...record, action: 'withdraw' };
  assert.equal(verifyVoiceConsent({ ...withdraw, signature: await wallet.signMessage(voiceSeedMessage(withdraw)) }, roster), wallet.address);
});

for (const width of [1280, 375]) test(`${width}px sensory previews are opt-in, muted for speech, blocked for live audio and reduced-motion safe`, async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/dlang.html`);
  await page.locator('#study-scene [data-sensory-concept="tree"]').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#sensory-root audio').count(), 0);
  await page.locator('[data-open-panel="voices"]').click();
  await page.locator('[data-sensory-choice] option').first().waitFor({ state: 'attached' });
  assert.equal(await page.locator('[data-sensory-choice] option').count(), 6);
  assert.equal(await page.locator('[data-sensory-gallery] img').count(), 12);
  assert.equal(await page.locator('input[data-sensory-motion]').isChecked(), false);
  await page.locator('input[data-sensory-motion]').check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.sensoryMotion), 'true');
  await page.locator('[data-open-panel="week"]').click();
  const moving = page.locator('#study-scene [data-sensory-concept="tree"] > svg');
  assert.equal(await moving.evaluate(node => getComputedStyle(node).animationName), 'sensory-sway');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await moving.evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.locator('[data-open-panel="voices"]').click();
  await page.locator('[data-sensory-play]').click();
  await page.waitForFunction(() => document.querySelector('[data-sensory-status]').textContent.includes('preview; human'));
  assert.match(await page.locator('[data-sensory-status]').innerText(), /generated/);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dlang:private-audio', { detail: { active: true } })));
  assert.equal(await page.locator('[data-sensory-play]').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.sensoryMotion), 'false');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dlang:private-audio', { detail: { active: false } })));
  assert.equal(await page.locator('[data-sensory-play]').isEnabled(), true);
  await page.locator('[data-sensory-play]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('dlang:audio-start')));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.match(await page.locator('#voice-seeding-root').innerText(), /no automatic upload, clone, reward payout or operator submission/);
  assert.equal(await page.locator('[data-seed-consent]').isChecked(), false);
  assert.deepEqual(errors, []);
});
