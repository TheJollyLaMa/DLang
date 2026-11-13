const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Wallet } = require('ethers');
const { createWordService } = require('../services/community-words.cjs');
const { createServer } = require('../index');
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3fu6cqzrzckwl2gfv36qoqzwa';
const CID2 = 'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

async function fixture(t) {
  const wallets = Array.from({ length: 4 }, () => Wallet.createRandom());
  const roster = { format: 'dlang-reviewed-pilot-roster', version: 1, authorization: false, maximumEntrants: 8,
    members: wallets.map((wallet, i) => ({ label: `test-${i}`, walletAddress: wallet.address })) };
  const storePath = path.join(__dirname, `.word-test-${wallets[0].address}.json`);
  t.after(async () => { await fs.rm(storePath, { force: true }); await fs.rm(`${storePath}.pending`, { force: true }); });
  const { sceneSnapshot, hashJSON } = await import('../public/dlang/steward.mjs');
  const scene = await sceneSnapshot({ sceneId: 'word-test-scene', sceneVersion: '1', level: 1,
    title: 'A chair', concepts: ['chair'], scene: { chair: true } }, 'en');
  const payload = { voice: { version: 1, language: 'en', concept: 'chair', speaker: 'Test learner',
    license: 'CC-BY-4.0', type: 'audio/webm', duration: 1, size: 5, cid: CID, sha256: 'a'.repeat(64),
    nativeSpeakerDeclared: false },
    profile: { language: 'en', dialect: 'self-declared test dialect', nativeSpeakerDeclared: false },
    scene, consent: 'own-voice-public-word-CC-BY-4.0', createdAt: '2026-11-13T12:00:00Z' };
  let clock = Date.now();
  const options = { storePath, origin: 'http://localhost', roster, now: () => clock,
    reviewers: [{ id: wallets[2].address, languages: ['en'], nativeSpeaker: true }] };
  const service = await createWordService(options);
  const authorization = async (wallet, action, value) => {
    const challenge = service.challenge({ address: wallet.address, action, bodyHash: await hashJSON(value), origin: options.origin });
    return { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message), payload: value };
  };
  const submit = async (index, action, value) => service.submit(await authorization(wallets[index], action, value));
  return { service, options, payload, wallets, submit, authorization, expire: () => { clock += 120001; } };
}

test('whitelisted learner publishes immediately unreviewed; signed exact samples and scene survive restart', async t => {
  const f = await fixture(t);
  const result = await f.submit(0, 'publish', f.payload), record = result.records[0];
  assert.equal(record.review.status, 'unreviewed');
  assert.equal(record.pilotEligible, true);
  assert.equal(record.payload.profile.nativeSpeakerDeclared, false);
  assert.equal(record.payload.voice.sha256, 'a'.repeat(64));
  assert.equal(result.payments, false);
  const restarted = await createWordService(f.options);
  assert.deepEqual(restarted.list().records, result.records);
  const { nextCommunityWord } = await import('../public/dlang/community-words.mjs');
  assert.equal(nextCommunityWord(result.records, 'en', 'chair').id, record.id);
  await assert.rejects(f.submit(0, 'publish', f.payload), /already published/);
  await assert.rejects(f.submit(0, 'publish', { ...f.payload, scene: { ...f.payload.scene, sceneId: 'other' } }), /scene/);
  await assert.rejects(f.submit(0, 'publish', { ...f.payload, consent: 'clone-and-impersonate' }), /consent/);
  assert.equal(Object.hasOwn(record, 'rewards'), false);
});

test('authorization binds wallet, purpose, payload and origin, expires, and cannot be replayed', async t => {
  const f = await fixture(t), auth = await f.authorization(f.wallets[0], 'publish', f.payload);
  await assert.rejects(f.service.submit({ ...auth, payload: { ...f.payload, createdAt: '2026-11-14T12:00:00Z' } }), /exact word/);
  await assert.rejects(f.service.submit({ ...auth, signature: await f.wallets[1].signMessage('wrong purpose') }), /exact word/);
  await f.service.submit(auth);
  await assert.rejects(f.service.submit(auth), /already used/);
  assert.throws(() => f.service.challenge({ address: Wallet.createRandom().address, action: 'publish', bodyHash: 'a'.repeat(64), origin: f.options.origin }), /whitelisted/);
  assert.throws(() => f.service.challenge({ address: f.wallets[0].address, action: 'publish', bodyHash: 'a'.repeat(64), origin: 'https://other.example' }), /whitelisted/);
  const expired = await f.authorization(f.wallets[0], 'feedback', {});
  f.expire(); await assert.rejects(f.service.submit(expired), /expired/);
});

test('clarity thumbs replace rather than accrue; no self-feedback, self-review, or flag closure', async t => {
  const f = await fixture(t);
  const record = (await f.submit(0, 'publish', f.payload)).records[0];
  const feedback = { recordId: record.id, versionHash: record.id, value: 1, meaning: 'clear-helpful-learning' };
  await assert.rejects(f.submit(0, 'feedback', feedback), /another speaker/);
  await assert.rejects(f.submit(1, 'feedback', { ...feedback, versionHash: 'b'.repeat(64) }), /exact recording/);
  await assert.rejects(f.submit(1, 'feedback', { ...feedback, meaning: 'dislike-accent' }), /not accent/);
  await f.submit(1, 'feedback', feedback);
  await f.submit(1, 'feedback', feedback);
  const changed = (await f.submit(1, 'feedback', { ...feedback, value: -1 })).records[0];
  assert.equal(changed.feedback.length, 1);
  assert.equal(changed.feedback[0].value, -1);
  assert.equal(changed.review.status, 'unreviewed');
  const flag = { scene: f.payload.scene, language: 'en', concept: 'chair', source: 'community-word', recordId: record.id };
  await f.submit(1, 'flag', flag);
  await assert.rejects(f.submit(1, 'flag', flag), /already flagged/);
  const review = { recordId: record.id, versionHash: record.id, status: 'approved' };
  await assert.rejects(f.submit(0, 'review', review), /another speaker/);
  await assert.rejects(f.submit(1, 'review', review), /operator-qualified/);
  const reviewed = await f.submit(2, 'review', review);
  assert.equal(reviewed.records[0].review.status, 'approved');
  assert.equal(reviewed.flags[0].status, 'open');
  const restarted = await createWordService(f.options);
  assert.equal(restarted.list().records[0].feedback.length, 1);
  assert.equal(restarted.list().flags[0].status, 'open');
});

test('weighted playback prefers reviewed clear voices but diversifies speakers, dialects and learner candidates', async t => {
  const f = await fixture(t);
  await f.submit(0, 'publish', f.payload);
  const second = { ...f.payload, voice: { ...f.payload.voice, cid: CID2, speaker: 'Native fixture', nativeSpeakerDeclared: true },
    profile: { ...f.payload.profile, dialect: 'another dialect', nativeSpeakerDeclared: true } };
  const records = (await f.submit(1, 'publish', second)).records;
  const { nextCommunityWord, wordWeight } = await import('../public/dlang/community-words.mjs');
  records[1].review.status = 'approved';
  assert.ok(wordWeight(records[1]) > wordWeight(records[0]));
  let counts = [0, 0];
  for (let i = 0; i < 1000; i++) counts[records.indexOf(nextCommunityWord(records, 'en', 'chair', null, () => i / 1000))]++;
  assert.ok(counts[1] > counts[0] * 4);
  assert.ok(counts[0] > 0, 'unreviewed whitelisted learners can be heard');
  assert.equal(nextCommunityWord(records, 'en', 'chair', records[1], () => 0).id, records[0].id);
  assert.equal(nextCommunityWord(records, 'en', 'chair', { ...records[1], consecutivePlays: 2 }, () => .99).id, records[0].id);
  let previous = null, seed = 42;
  counts = [0, 0];
  for (let i = 0; i < 10000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const chosen = nextCommunityWord(records, 'en', 'chair', previous, () => seed / 4294967296);
    counts[records.indexOf(chosen)]++;
    previous = { ...chosen, consecutivePlays: previous?.authorId === chosen.authorId ? previous.consecutivePlays + 1 : 1 };
    assert.ok(previous.consecutivePlays <= 2, 'A second available speaker must not be crowded out');
  }
  assert.ok(counts[1] > counts[0] * 1.2, 'Quality must affect repeated rotation, not just the first selection');
  assert.ok(counts[0] > 2500, 'Lower-weight eligible learners still receive meaningful rotation');
  assert.equal(nextCommunityWord(records, 'fr', 'chair'), null);
  records[1].review.status = 'rejected';
  assert.equal(nextCommunityWord(records, 'en', 'chair').id, records[0].id);
});

test('hosted persistence absent is an explicit 503, not local success; same-origin API is gated', async t => {
  const f = await fixture(t);
  const server = createServer({ wordService: f.service, wordOrigin: f.options.origin });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(`${base}/api/words`)).json()).persistence, 'operator-store');
  const foreign = await fetch(`${base}/api/words/challenge`, { method: 'POST',
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 400);
  const unavailable = createServer();
  unavailable.listen(0, '127.0.0.1'); await new Promise(resolve => unavailable.once('listening', resolve));
  t.after(() => new Promise(resolve => unavailable.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${unavailable.address().port}/api/words`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Drafts remain local/);
  await assert.rejects(createWordService({ ...f.options, storePath: path.join(__dirname, 'missing-word-dir', 'registry.json') }), /ENOENT/);
});
