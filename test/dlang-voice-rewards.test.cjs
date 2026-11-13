const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Wallet } = require('ethers');
const { createVoiceRewardService, allocate, hash, START, END, UNITS } = require('../services/voice-rewards.cjs');
const { createServer } = require('../index');
const { createWordService } = require('../services/community-words.cjs');

async function fixture(t, { origin = 'http://localhost', duration = 1 } = {}) {
  const wallets = Array.from({ length: 4 }, () => Wallet.createRandom());
  const roster = { format: 'dlang-reviewed-pilot-roster', version: 1, authorization: false, maximumEntrants: 8,
    members: wallets.map((row, i) => ({ label: `test-${i}`, walletAddress: row.address })) };
  const storePath = path.join(__dirname, `.reward-test-${wallets[0].address}.json`);
  const wordPath = `${storePath}.words`;
  t.after(async () => { for (const file of [storePath, `${storePath}.pending`, wordPath, `${wordPath}.pending`]) await fs.rm(file, { force: true }); });
  let clock = START - 1, fundingAvailable = true;
  const { sceneSnapshot } = await import('../public/dlang/steward.mjs');
  const scene = await sceneSnapshot({ sceneId: 'reward-scene', sceneVersion: '1', level: 1,
    title: 'Reward chair', concepts: ['chair'], scene: { chair: true } }, 'en');
  const wordService = await createWordService({ storePath: wordPath, origin, roster, now: () => clock });
  for (let i = 0; i < 2; i++) {
    const payload = { voice: { version: 1, language: 'en', concept: 'chair', speaker: wallets[i].address,
      license: 'CC-BY-4.0', type: 'audio/webm', duration, size: 5,
      cid: i ? 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku' : 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3fu6cqzrzckwl2gfv36qoqzwa',
      sha256: 'a'.repeat(64), nativeSpeakerDeclared: false },
      profile: { language: 'en', dialect: 'test', nativeSpeakerDeclared: false },
      scene, consent: 'own-voice-public-word-CC-BY-4.0', createdAt: '2026-11-13T12:00:00Z' };
    const challenge = wordService.challenge({ address: wallets[i].address, action: 'publish', bodyHash: hash(payload), origin });
    await wordService.submit({ nonce: challenge.nonce, signature: await wallets[i].signMessage(challenge.message), payload });
  }
  const records = wordService.list().records;
  const options = { storePath, origin, roster, words: { list: () => ({ records }) }, now: () => clock,
    verifyFunding: async () => fundingAvailable,
    funding: { chainId: 8453, pool: wallets[3].address, asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      assets: '1000000', units: UNITS.toString(), start: START / 1000, end: END / 1000,
      transactionHash: `0x${'1'.repeat(64)}`, runtimeHash: `0x${'2'.repeat(64)}` } };
  let service = await createVoiceRewardService(options);
  const auth = async (index, action, payload, svc = service) => {
    const challenge = await svc.challenge({ address: wallets[index].address, action, bodyHash: hash(payload), origin: options.origin });
    return { nonce: challenge.nonce, signature: await wallets[index].signMessage(challenge.message), payload };
  };
  const send = async (index, action, payload) => service.submit(await auth(index, action, payload));
  const enroll = index => send(index, 'enroll', { recordId: records[index].id, credit: wallets[index].address });
  const start = (record = 0, listener = 2) => send(listener, 'start', { recordId: records[record].id, deliberatePractice: true });
  const complete = async (session, listener = 2, extra = {}) => send(listener, 'complete', {
    sessionId: session.id, recordId: session.recordId, completed: true, audible: true,
    visible: true, uninterrupted: true, deliberatePractice: true, ...extra
  });
  return { wallets, options, records, auth, send, enroll, start, complete, get service() { return service; },
    at: value => { clock = value; }, advance: value => { clock += value; },
    fundingAvailable: value => { fundingAvailable = value; },
    restart: async () => { service = await createVoiceRewardService(options); return service; } };
}

test('one exact funded NY week: signed, independent audible completions; deliberate repeats accrue; durable replay protection', async t => {
  const f = await fixture(t);
  await f.enroll(0); await f.enroll(1);
  await assert.rejects(f.start(), /funded-week/);
  f.at(START);
  await assert.rejects(f.start(0, 0), /independent/);
  const first = (await f.start()).session;
  const completion = await f.auth(2, 'complete', { sessionId: first.id, recordId: first.recordId,
    completed: true, audible: true, visible: true, uninterrupted: true, deliberatePractice: true });
  await f.restart();
  f.advance(1000);
  assert.equal((await f.service.submit(completion)).outcome, 'qualified');
  await assert.rejects(f.service.submit(completion), /replayed/);
  const second = (await f.start()).session;
  f.advance(1000); await f.complete(second);
  const third = (await f.start(1)).session;
  f.advance(1000); await f.complete(third);
  assert.equal(f.service.list().completedCredits, 3);
  f.at(END);
  await assert.rejects(f.start(), /funded-week/);
  const settled = f.service.list().settlement;
  assert.equal(settled.totalCredits, 3);
  assert.equal(settled.allocations.reduce((sum, row) => sum + BigInt(row.units), 0n), UNITS);
  assert.equal(settled.allocations.find(row => row.address === f.wallets[0].address.toLowerCase()).credits, '2');
  await f.restart();
  assert.deepEqual(f.service.list().settlement, settled);
});

test('reject instant, hidden, muted, interrupted, concurrent, unwhitelisted, wrong-signature and boundary crossing plays', async t => {
  const f = await fixture(t); await f.enroll(0); f.at(START);
  let session = (await f.start()).session;
  await assert.rejects(f.start(), /previous practice/);
  await assert.rejects(f.complete(session), /instantaneous/);
  for (const extra of [{ audible: false }, { visible: false }, { uninterrupted: false }, { completed: false }, { deliberatePractice: false }]) {
    session = (await f.start()).session; f.advance(1000);
    await assert.rejects(f.complete(session, 2, extra), /earns no credit/);
  }
  const outside = Wallet.createRandom();
  await assert.rejects(f.service.challenge({ address: outside.address, action: 'start', origin: f.options.origin, bodyHash: hash({}) }), /whitelisted/);
  await assert.rejects(f.service.challenge({ address: f.wallets[2].address, action: 'start', origin: 'https://other.test', bodyHash: hash({}) }), /whitelisted/);
  const signed = await f.auth(2, 'start', { recordId: f.records[0].id, deliberatePractice: true });
  signed.signature = await f.wallets[1].signMessage('forged');
  await assert.rejects(f.service.submit(signed), /mismatched/);
  await assert.rejects(f.send(2, 'start', { recordId: f.records[0].id, deliberatePractice: true, extra: 'poisoned' }), /Exact reward action/);
  f.at(END - 500); session = (await f.start()).session; f.at(END + 500);
  await assert.rejects(f.complete(session), /earns no credit/);
  assert.equal(f.service.list().completedCredits, 0);
  assert.equal(f.service.list().settlement.outcome, 'carry-zero-plays');
});
test('only .2–15 second signed word durations can qualify, including both exact boundaries', async t => {
  for (const duration of [.2, 15]) {
    const f = await fixture(t, { duration }); await f.enroll(0); f.at(START);
    const session = (await f.start()).session;
    assert.equal(session.duration, duration);
    f.advance(duration * 1000);
    assert.equal((await f.complete(session)).outcome, 'qualified');
    await f.restart(); assert.equal(f.service.list().completedCredits, 1);
  }
  for (const duration of [.199, 15.001]) await assert.rejects(fixture(t, { duration }), /Word recording/);
});

test('enrollment resolves matching signed credit independently; bad legacy nicknames and unresolved/wrong wallet cannot earn', async t => {
  const f = await fixture(t);
  await assert.rejects(f.send(0, 'enroll', { recordId: f.records[0].id, credit: 'Test nickname' }), /nickname/i);
  await assert.rejects(f.send(0, 'enroll', { recordId: f.records[0].id, credit: f.wallets[1].address }), /signing contributor/i);
  await assert.rejects(f.send(1, 'enroll', { recordId: f.records[0].id, credit: f.wallets[1].address }), /own/);
  f.at(START); await assert.rejects(f.start(), /enroll/);
  await f.enroll(0); f.records[0].review.status = 'rejected';
  await assert.rejects(f.start(), /independent/);
  await assert.rejects(createVoiceRewardService({ ...f.options, verifyFunding: async () => false }), /verification/);
  await assert.rejects(createVoiceRewardService({ ...f.options, funding: { ...f.options.funding, assets: '2000000' } }), /funding/);
});

test('HTTP rewards fail closed without verified funding; exact same origin protects challenge and submit', async t => {
  const f = await fixture(t);
  const server = createServer({ voiceRewardService: f.service, wordOrigin: f.options.origin });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/voice-rewards`;
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(`${url}/challenge`, { method: 'POST', headers: { origin: 'https://wrong.test', 'content-type': 'application/json' }, body: '{}' })).status, 400);
  const disabled = createServer();
  await new Promise(resolve => disabled.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => disabled.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${disabled.address().port}/api/voice-rewards`)).status, 503);
});

test('exact proportional units conserve budget with deterministic dust; zero plays carry and thumbs are not inputs', () => {
  const result = allocate(['a', 'a', 'b', 'c'].map((contributor, i) => ({ id: String(i), contributor })));
  assert.equal(result.allocations.reduce((sum, row) => sum + BigInt(row.units), 0n), UNITS);
  assert.equal(result.allocations[0].units, (UNITS / 2n).toString());
  assert.equal(allocate([]).inventoryUnits, UNITS.toString());
});
test('browser/service share existing canonical payload hashes, independent of property order', async () => {
  const { hashJSON } = await import('../public/dlang/steward.mjs');
  const payload = { z: { b: true, a: 'value' }, a: [1, 2] };
  assert.equal(hash(payload), await hashJSON(payload));
  assert.equal(hash(payload), hash({ a: [1, 2], z: { a: 'value', b: true } }));
});
test('live retirement/unavailable funding and expired persistent challenges fail closed; receipt journal tampering is refused on restart', async t => {
  const f = await fixture(t); await f.enroll(0); f.at(START);
  const authorization = await f.auth(2, 'start', { recordId: f.records[0].id, deliberatePractice: true });
  f.advance(120001); await f.restart();
  await assert.rejects(f.service.submit(authorization), /Expired/);
  f.fundingAvailable(false); await assert.rejects(f.start(), /no longer available/);
  f.fundingAvailable(true); let session = (await f.start()).session;
  f.advance(1000); f.fundingAvailable(false); await assert.rejects(f.complete(session), /no longer available/);
  assert.equal(f.service.list().completedCredits, 0);
  f.fundingAvailable(true); session = (await f.start()).session;
  f.advance(1000); await f.complete(session);
  const journal = JSON.parse(await fs.readFile(f.options.storePath));
  journal.receipts[0].contributor = f.wallets[1].address.toLowerCase();
  await fs.writeFile(f.options.storePath, JSON.stringify(journal));
  await assert.rejects(f.restart(), /Invalid durable qualified receipt/);
});

test('browser completion monitor earns only at audible native end; hidden, seek, pause, mute and cancellation discard', async () => {
  const { attestWordPlayback } = await import('../public/dlang/voice-rewards.mjs');
  const run = async interrupt => {
    const element = Object.assign(new EventTarget(), { muted: false, volume: 1, playbackRate: 1, duration: 1, currentTime: 0 });
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    let time = 0, earned = 0;
    const cancel = attestWordPlayback({ element, document: doc, session: { duration: 1 },
      rewards: { complete: async () => { earned++; return { outcome: 'qualified' }; } }, now: () => time });
    element.dispatchEvent(new Event('playing'));
    if (interrupt === 'hidden') { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); doc.visibilityState = 'visible'; }
    else if (interrupt === 'mute') { element.muted = true; element.dispatchEvent(new Event('volumechange')); element.muted = false; }
    else if (interrupt === 'cancel') cancel();
    else if (interrupt) element.dispatchEvent(new Event(interrupt));
    time = 1000; element.currentTime = 1; element.dispatchEvent(new Event('ended'));
    await new Promise(resolve => setImmediate(resolve));
    return earned;
  };
  assert.equal(await run(), 1);
  for (const event of ['hidden', 'mute', 'cancel', 'pause', 'seeking', 'waiting', 'stalled', 'error', 'ratechange']) assert.equal(await run(event), 0, event);
});

test('native browser WAV end sends a signed funded-service completion; test waveform is not a human recording/public upload', async t => {
  const { chromium } = require('playwright');
  const options = {};
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const f = await fixture(t, { origin: base }); await f.enroll(0); f.at(START);
  options.voiceRewardService = f.service;
  options.wordOrigin = base;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); });
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.exposeFunction('fixtureAddress', () => f.wallets[0].address);
  await page.exposeFunction('fixtureSign', message => f.wallets[0].signMessage(message));
  await page.exposeFunction('fixtureListenerAddress', () => f.wallets[2].address);
  await page.exposeFunction('fixtureListenerSign', message => f.wallets[2].signMessage(message));
  await page.exposeFunction('fixtureAdvance', () => f.advance(1000));
  await page.goto(base + '/dlang.html');
  await page.evaluate(async ({ recordId, credit }) => {
    const { createVoiceRewardClient, attestWordPlayback } = await import('./dlang/voice-rewards.mjs');
    const rewards = createVoiceRewardClient({ signer: async () => ({ getAddress: window.fixtureAddress, signMessage: window.fixtureSign }) });
    await rewards.enroll(recordId, credit);
    const listener = createVoiceRewardClient({ signer: async () => ({ getAddress: window.fixtureListenerAddress, signMessage: window.fixtureListenerSign }) });
    const bytes = new ArrayBuffer(44 + 16000), view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 16036, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, 16000, true);
    for (let i = 0; i < 8000; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 220 / 8000) * 2000, true);
    const button = document.createElement('button'); button.id = 'fixture-wave-play'; button.textContent = 'Play test waveform';
    button.style.cssText = 'position:fixed;top:5px;left:5px;z-index:10000';
    document.body.append(button);
    button.onclick = async () => {
      try {
        const { session } = await listener.start(recordId);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        const element = new Audio(url);
        await new Promise((resolve, reject) => {
          element.oncanplaythrough = resolve; element.onerror = reject;
          element.load();
        });
        attestWordPlayback({ element, session,
          // Test clocks/visibility isolate native end/HTTP/signatures from other test windows.
          document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
          now: () => element.ended ? session.duration * 1000 : 0,
          rewards: { complete: async value => {
          await window.fixtureAdvance(); return listener.complete(value);
        } }, report: message => { window.__rewardResult = message; URL.revokeObjectURL(url); } });
        await element.play();
      } catch (error) { window.__rewardResult = error.message; }
    };
  }, { recordId: f.records[0].id, credit: f.wallets[0].address });
  await page.click('#fixture-wave-play');
  await page.waitForFunction(() => typeof window.__rewardResult === 'string');
  assert.match(await page.evaluate(() => window.__rewardResult), /Signed completion saved/);
  assert.equal(f.service.list().completedCredits, 1);
  await f.restart();
  assert.equal(f.service.list().completedCredits, 1);
});

test('real Chrome word recording uses decoded duration and qualifies at native WebM end', async t => {
  const { chromium } = require('playwright');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/dlang.html`);
  const result = await page.evaluate(async () => {
    const { decodedWordDuration } = await import('./dlang/audio.mjs');
    const { attestWordPlayback } = await import('./dlang/voice-rewards.mjs');
    const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
    oscillator.connect(destination); oscillator.start();
    const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' }), chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(250);
    await new Promise(resolve => setTimeout(resolve, 1000));
    recorder.stop(); await stopped; oscillator.stop(); await context.close();
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const duration = await decodedWordDuration(blob), url = URL.createObjectURL(blob), element = new Audio(url);
    const reports = []; let credits = 0;
    try {
      const completed = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Recorded WebM completion did not qualify')), 5000);
        attestWordPlayback({ element, session: { duration },
          document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
          rewards: { complete: async () => { credits++; return { outcome: 'qualified' }; } },
          report: message => { reports.push(message); clearTimeout(timeout); resolve(); } });
      });
      await element.play(); await completed;
      return { duration, endDuration: element.duration, credits, reports };
    } finally { URL.revokeObjectURL(url); }
  });
  assert.ok(result.duration >= .2 && result.duration <= 15);
  assert.ok(Math.abs(result.duration - result.endDuration) < .1);
  assert.equal(result.credits, 1, JSON.stringify(result));
  assert.match(result.reports[0], /Signed completion saved/);
});
