const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createServer } = require('../index');

test('narration UI completes a local 2-of-3 review, segmented response and accruing receipt', async t => {
  const { sceneSnapshot, createContribution, assignReviewPanel, castLocalVote } = await import('../public/dlang/steward.mjs');
  const { newEarningsLedger } = await import('../public/dlang/economy.mjs');
  const scene = await sceneSnapshot({
    sceneId: 'fixture-scene', sceneVersion: 'fixture-scene-v1', level: 1, language: 'en',
    concepts: ['chair'], title: 'The quiet room', scene: { id: 'fixture-scene', objects: ['chair'] }
  }, 'en');
  const profiles = ['reviewer-a', 'reviewer-b', 'reviewer-c'].map(id => ({ id, languages: ['en'], nativeSpeaker: true }));
  let record = await createContribution({
    id: 'ui_narration_0001', language: 'en', level: 1, scene, authorId: `0x${'a'.repeat(40)}`,
    credit: 'River', audio: { cid: `bafy${'c'.repeat(52)}`, sha256: 'c'.repeat(64), size: 128, duration: 4, type: 'audio/webm' },
    turns: [{ start: 0, end: 4, prompt: 'What would you say?', concept: 'chair' }]
  });
  record = await assignReviewPanel(record, profiles.map(profile => profile.id), profiles);
  record = await castLocalVote(record, { reviewerId: 'reviewer-a', language: 'en', decision: 'approve', versionHash: record.versionHash });
  const state = {
    schemaVersion: 1, localAuthorId: 'local:test', profiles, contributions: [record],
    ledger: newEarningsLedger()
  };
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage();
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(`${base}/dlang/narration.mjs`);
  await page.setContent('<main><section id="narration-root"></section><section id="conversation-root"></section></main>');
  await page.evaluate(async ({ base, state, scene }) => {
    localStorage.setItem('dlang-narration-stewards-v1', JSON.stringify(state));
    const [{ mountNarration }, { nextReviewedNarration }] = await Promise.all([
      import(`${base}/dlang/narration.mjs`), import(`${base}/dlang/audio.mjs`)
    ]);
    const audio = {
      records: [],
      async setNarrations(records) { this.records = records; },
      async selectNarration(language, context) { return nextReviewedNarration(this.records, language, context); },
      async playNarrationTurn() {
        let finish;
        window.__narrationPlayCount = (window.__narrationPlayCount || 0) + 1;
        const done = new Promise(resolve => { finish = resolve; });
        window.__finishNarrationTurn = () => finish({ completed: true });
        return { audio: { muted: false }, done };
      },
      stopNarration() { window.__finishNarrationTurn?.(); }
    };
    window.__narration = mountNarration({
      storage: localStorage, ipfs: {}, audio, getSceneContext: () => scene,
      getAddress: () => window.__walletAddress || '', report: message => { window.__lastReport = message; }
    });
  }, { base, state, scene });
  await page.waitForFunction(() => window.__narration?.getStatus().blocked === false);
  const reviewer = page.locator('[data-reviewer="ui_narration_0001"]');
  await reviewer.selectOption('reviewer-b');
  await page.locator('[data-vote="approve"][data-id="ui_narration_0001"]').click();
  await page.waitForSelector('[data-play-turn]');
  assert.equal(await page.locator('[data-usefulness]').count(), 0);
  assert.equal(await page.locator('#conversation-root').textContent(), '');
  await page.locator('[data-play-turn]').click();
  await page.waitForFunction(() => window.__narrationPlayCount === 1);
  await page.evaluate(() => window.__finishNarrationTurn());
  await page.waitForFunction(() => !document.querySelector('[data-response]').disabled);
  await page.fill('[data-response]', 'The chair is beside the window.');
  await page.locator('[data-next-turn]').click();
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('Qualified local play accrued'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dlang-narration-stewards-v1')));
  assert.equal(saved.contributions[0].review.votes.filter(vote => !vote.revoked && vote.decision === 'approve').length, 2);
  assert.equal(saved.ledger.receipts.length, 1);
  assert.equal(saved.ledger.receipts[0].authority, 'local-only');
  assert.equal(saved.ledger.balances[record.authorId].pendingUnits, '1');
  assert.equal(saved.ledger.balances[record.authorId].confirmedUnits, '0');
  await page.locator('[data-usefulness="up"]').click();
  await page.waitForFunction(() => document.querySelector('[data-usefulness-counts]')?.textContent.includes('1 up · 0 down'));
  await page.locator('[data-usefulness="down"]').click();
  await page.waitForFunction(() => document.querySelector('[data-usefulness-counts]')?.textContent.includes('0 up · 1 down'));
  const rated = await page.evaluate(() => JSON.parse(localStorage.getItem('dlang-narration-stewards-v1')));
  assert.equal(rated.contributions[0].usefulnessVotes.length, 1);
  assert.equal(rated.contributions[0].usefulnessVotes[0].stewardId, 'local:test');
  assert.equal(rated.contributions[0].usefulnessVotes[0].versionHash, record.versionHash);
  assert.equal(rated.contributions[0].usefulnessVotes[0].direction, 'down');
  assert.deepEqual(rated.contributions[0].review, saved.contributions[0].review);
  assert.deepEqual(rated.ledger, saved.ledger);
  await page.evaluate(address => {
    window.__walletAddress = address;
    window.dispatchEvent(new CustomEvent('dlang:wallet', { detail: { address } }));
  }, record.authorId);
  assert.equal(await page.locator('[data-usefulness]').count(), 0);
  await page.locator('[data-play-turn]').click();
  await page.waitForFunction(() => window.__narrationPlayCount === 2);
  await page.evaluate(() => window.__finishNarrationTurn());
  await page.waitForFunction(() => !document.querySelector('[data-response]').disabled);
  await page.fill('[data-response]', 'The author can listen but cannot rate this narration.');
  await page.locator('[data-next-turn]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dlang-narration-stewards-v1')).ledger.receipts.length === 2);
  assert.equal(await page.locator('[data-usefulness]').count(), 0);
  await page.locator('[data-play-turn]').click();
  await page.waitForFunction(() => window.__narrationPlayCount === 3);
  await page.evaluate(() => window.__narration.setBlocked(true));
  await page.waitForTimeout(50);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('dlang-narration-stewards-v1')))).ledger.receipts.length, 2);
  assert.equal(await page.locator('[data-native-room]').isHidden(), true);
  await page.evaluate(() => window.__narration.setBlocked(false));
});
