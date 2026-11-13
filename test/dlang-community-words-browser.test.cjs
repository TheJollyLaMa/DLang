const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Wallet } = require('ethers');
const { chromium } = require('playwright');
const { createServer } = require('../index');
const { createWordService } = require('../services/community-words.cjs');
const { openTool } = require('./learning-tools.cjs');
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3fu6cqzrzckwl2gfv36qoqzwa';

test('scene hearing exposes compact WORD flow; fixture recording publishes unreviewed, feedback and stop are guarded', async t => {
  const author = Wallet.createRandom(), listener = Wallet.createRandom();
  const storePath = path.join(__dirname, `.word-browser-${author.address}.json`);
  const options = {};
  const server = createServer(options);
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  options.wordOrigin = base;
  options.wordService = createWordService({ storePath, origin: base,
    roster: { format: 'dlang-reviewed-pilot-roster', version: 1, authorization: false, maximumEntrants: 8,
      members: [{ label: 'fixture author', walletAddress: author.address }, { label: 'fixture listener', walletAddress: listener.address }] } });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    await fs.rm(storePath, { force: true }); await fs.rm(`${storePath}.pending`, { force: true });
  });
  const context = await browser.newContext({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let wallet = author;
  await page.exposeFunction('wordTestAddress', () => wallet.address);
  await page.exposeFunction('wordTestSign', message => wallet.signMessage(message));
  await page.goto(base + '/dlang.html');
  await openTool(page, 'week');
  await page.click('#study-tab');
  await page.getByRole('button', { name: /Flag or record/ }).first().click();
  await page.locator('#voice-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#voice-dialog > details').evaluate(node => node.open), false);
  assert.match(await page.locator('#voice-title').textContent(), /·/);
  await page.keyboard.press('Escape');
  await page.evaluate(async cid => {
    const { mountAudio } = await import('./dlang/audio.mjs');
    const { createWordClient } = await import('./dlang/community-words.mjs');
    const { createVoiceRewardClient } = await import('./dlang/voice-rewards.mjs');
    const { digest } = await import('./dlang/storage.mjs');
    const scene = { sceneId: 'browser-word-scene', sceneVersion: '1', level: 1, title: 'Browser chair', concepts: ['chair'], scene: { chair: true } };
    window.__captures = 0; window.__uploads = 0; window.__paused = 0; window.__blocked = false;
    const bytes = new Blob(['fixture-word-bytes'], { type: 'audio/webm' });
    navigator.mediaDevices.getUserMedia = async () => { window.__captures++; return { getTracks: () => [{ stop() {} }] }; };
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable({ data: bytes }); void this.onstop(); }
    };
    window.AudioContext = class {
      async decodeAudioData() { return { duration: .25 }; }
      async close() {}
    };
    window.Audio = class {
      async play() { window.__played = true; }
      pause() { window.__paused++; }
    };
    const words = createWordClient({ signer: async () => ({ getAddress: window.wordTestAddress, signMessage: window.wordTestSign }) });
    const rewards = createVoiceRewardClient({ signer: async () => ({ getAddress: window.wordTestAddress, signMessage: window.wordTestSign }) });
    window.__wordAudio = mountAudio({ words, rewards, getSceneContext: () => scene, getBlocked: () => window.__blocked,
      openDialog: id => document.getElementById(id).showModal(),
      ipfs: { upload: async blob => { window.__uploads++; return { cid, uri: `ipfs://${cid}`, sha256: await digest(blob) }; }, read: async () => bytes } });
    await window.__wordAudio.openWord('en', 'chair', scene);
  }, CID);
  assert.equal(await page.evaluate(() => window.__captures), 0);
  await page.fill('#voice-speaker', author.address);
  await page.fill('#voice-dialect', 'Fixture dialect');
  await page.click('#voice-record');
  await page.waitForTimeout(250);
  await page.click('#voice-record');
  await page.waitForFunction(() => !document.getElementById('voice-preview').disabled);
  await page.click('#voice-publish');
  assert.match(await page.locator('#voice-status').textContent(), /consent first/);
  assert.equal(await page.evaluate(() => window.__uploads), 0);
  await page.check('#voice-consent');
  await page.click('#voice-publish');
  await page.waitForFunction(() => document.getElementById('voice-status').textContent.includes('UNREVIEWED'));
  const saved = (await (await fetch(base + '/api/words')).json()).records[0];
  assert.equal(saved.payload.voice.speaker, author.address);
  assert.equal(saved.payload.profile.nativeSpeakerDeclared, false);
  assert.equal(saved.payload.scene.sceneId, 'browser-word-scene');
  assert.equal(saved.review.status, 'unreviewed');
  assert.equal(saved.feedback.length, 0);
  assert.equal((await (await fetch(base + '/api/words')).json()).flags.length, 0, 'publication never invents a pronunciation flag');
  await page.evaluate(() => new Promise(resolve => {
    const dialog = document.getElementById('voice-dialog');
    dialog.addEventListener('close', resolve, { once: true }); dialog.close();
  }));
  await page.evaluate(() => window.__wordAudio.playWord('en', 'chair', { sceneId: 'browser-word-scene', sceneVersion: '1', level: 1, title: 'Browser chair', concepts: ['chair'], scene: { chair: true } }));
  assert.match(await page.locator('#audio-status').textContent(), /Fixture dialect.*unreviewed.*learner.*no earnings/);
  await page.evaluate(() => window.__wordAudio.stopNarration());
  assert.ok(await page.evaluate(() => window.__paused) > 0);
  wallet = listener;
  await page.evaluate(() => window.__wordAudio.openWord('en', 'chair'));
  await page.click('#voice-up');
  await page.waitForFunction(() => document.getElementById('voice-status').textContent.includes('feedback saved'));
  assert.equal((await (await fetch(base + '/api/words')).json()).records[0].feedback.length, 1);
  await page.click('#voice-up');
  await page.waitForFunction(() => document.getElementById('voice-status').textContent.includes('feedback saved'));
  assert.equal((await (await fetch(base + '/api/words')).json()).records[0].feedback.length, 1);
  await page.click('#voice-flag');
  await page.waitForFunction(() => document.getElementById('voice-status').textContent.includes('flagged'));
  await page.evaluate(() => { window.__blocked = true; });
  const captures = await page.evaluate(() => window.__captures);
  await page.click('#voice-record');
  assert.equal(await page.evaluate(() => window.__captures), captures);
  assert.match(await page.locator('#voice-status').textContent(), /disabled during scored/);
  await page.evaluate(() => window.__wordAudio.playWord('en', 'chair'));
  assert.equal((await (await fetch(base + '/api/words')).json()).payments, false);
  await page.evaluate(() => {
    window.__blocked = false;
    window.dispatchEvent(new CustomEvent('dlang:private-audio', { detail: { active: true } }));
  });
  await page.click('#voice-record');
  assert.equal(await page.evaluate(() => window.__captures), captures);
  await page.evaluate(() => {
    window.__played = false;
    return window.__wordAudio.playWord('en', 'chair');
  });
  assert.equal(await page.evaluate(() => window.__played), false);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dlang:private-audio', { detail: { active: false } })));
  assert.deepEqual(errors, []);
});
