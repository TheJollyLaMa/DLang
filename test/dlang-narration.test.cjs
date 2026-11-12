const test = require('node:test');
const assert = require('node:assert/strict');

const CID = `bafy${'a'.repeat(52)}`;
const audioHash = 'a'.repeat(64);
const sceneHashFixture = async () => {
  const { sceneSnapshot } = await import('../public/dlang/steward.mjs');
  return sceneSnapshot({
    sceneId: 'scene-4', sceneVersion: 'practice-recipe-v1', level: 2, language: 'en',
    concepts: ['apple', 'bread'], title: 'Orchard table',
    scene: { id: 'scene-4', targets: [{ id: 'apple', concept: 'apple' }, { id: 'bread', concept: 'bread' }] }
  }, 'en');
};

async function fixture() {
  const steward = await import('../public/dlang/steward.mjs');
  const scene = await sceneHashFixture();
  const record = await steward.createContribution({
    id: 'narration_0001', language: 'en', level: 2, scene, authorId: 'speaker-wallet',
    credit: 'River', audio: { cid: CID, sha256: audioHash, size: 100, duration: 4, type: 'audio/webm' },
    turns: [
      { start: 0, end: 2, prompt: 'What is happening?', concept: 'apple' },
      { start: 2, end: 4, prompt: 'What would you say?', concept: 'bread' }
    ]
  });
  const profiles = [
    { id: 'reviewer-a', languages: ['en'], nativeSpeaker: true },
    { id: 'reviewer-b', languages: ['en'], nativeSpeaker: true },
    { id: 'reviewer-c', languages: ['en'], nativeSpeaker: true },
    { id: 'speaker-wallet', languages: ['en'], nativeSpeaker: true },
    { id: 'reviewer-fr', languages: ['fr'], nativeSpeaker: true },
    { id: 'reviewer-d', languages: ['en'], nativeSpeaker: true }
  ];
  return { steward, record, profiles };
}

async function approved(record, profiles, steward) {
  let reviewed = await steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-b', 'reviewer-c'], profiles);
  for (const reviewerId of ['reviewer-a', 'reviewer-b']) {
    reviewed = await steward.castLocalVote(reviewed, {
      reviewerId, language: 'en', decision: 'approve', versionHash: reviewed.versionHash
    });
  }
  return reviewed;
}

function session(contribution, patch = {}) {
  return {
    playId: 'play_receipt_0001',
    versionHash: contribution.versionHash,
    audioHash: contribution.audio.sha256,
    userInitiated: true, muted: false, autoplay: false, interrupted: false,
    turns: contribution.turns.map((_, turnIndex) => ({
      turnIndex, completed: true, response: `A typed response ${turnIndex + 1}`
    })),
    ...patch
  };
}

test('three-person language panel excludes author and duplicate, wrong-language or version-mismatched votes', async () => {
  const { steward, record, profiles } = await fixture();
  await assert.rejects(steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-b'], profiles), /exactly three/);
  await assert.rejects(steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-a', 'reviewer-c'], profiles), /distinct/);
  await assert.rejects(steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-b', 'speaker-wallet'], profiles), /excluding its author/);
  await assert.rejects(steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-b', 'reviewer-fr'], profiles), /eligible native speaker/);

  const panel = await steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-b', 'reviewer-c'], profiles);
  await assert.rejects(steward.castLocalVote(panel, {
    reviewerId: 'reviewer-a', language: 'fr', decision: 'approve', versionHash: panel.versionHash
  }), /assigned and qualified/);
  await assert.rejects(steward.castLocalVote(panel, {
    reviewerId: 'reviewer-a', language: 'en', decision: 'approve', versionHash: 'b'.repeat(64)
  }), /different narration version/);
  const one = await steward.castLocalVote(panel, {
    reviewerId: 'reviewer-a', language: 'en', decision: 'approve', versionHash: panel.versionHash
  });
  await assert.rejects(steward.castLocalVote(one, {
    reviewerId: 'reviewer-a', language: 'en', decision: 'approve', versionHash: panel.versionHash
  }), /One vote/);
  assert.equal(steward.reviewStatus(one).status, 'in-review');
  const two = await steward.castLocalVote(one, {
    reviewerId: 'reviewer-b', language: 'en', decision: 'approve', versionHash: panel.versionHash
  });
  assert.equal(steward.reviewStatus(two).status, 'local-approved');
  assert.equal(steward.reviewStatus(two).fundedAuthorized, false);
  await assert.rejects(steward.castLocalVote(two, {
    reviewerId: 'reviewer-c', language: 'en', decision: 'approve', versionHash: panel.versionHash
  }), /already decided/);

  const altered = structuredClone(record);
  altered.audio.sha256 = 'c'.repeat(64);
  await assert.rejects(steward.validateContribution(altered), /version hash/);
});

test('reviewer replacement and vote revocation preserve explicit local history', async () => {
  const { steward, record, profiles } = await fixture();
  let reviewed = await steward.assignReviewPanel(record, ['reviewer-a', 'reviewer-b', 'reviewer-c'], profiles);
  reviewed = await steward.castLocalVote(reviewed, {
    reviewerId: 'reviewer-a', language: 'en', decision: 'approve', versionHash: reviewed.versionHash
  });
  await assert.rejects(steward.replaceReviewer(reviewed, 'reviewer-a', 'reviewer-d', profiles, 'rotation'), /Revoke/);
  reviewed = await steward.revokeReviewVote(reviewed, 'reviewer-a', 'Panel conflict reported');
  reviewed = await steward.replaceReviewer(reviewed, 'reviewer-a', 'reviewer-d', profiles, 'Panel conflict reported');
  assert.equal(reviewed.review.history.at(-1).action, 'reviewer-replaced');
  reviewed = await steward.castLocalVote(reviewed, {
    reviewerId: 'reviewer-d', language: 'en', decision: 'approve', versionHash: reviewed.versionHash
  });
  assert.equal(steward.reviewStatus(reviewed).approvals, 1);
  assert.equal(reviewed.review.votes[0].revoked, true);
  assert.equal(reviewed.review.votes[0].signature, '');
});

test('audio selection rotates only locally approved recordings bound to the exact scene version', async () => {
  const { steward, record, profiles } = await fixture();
  const { nextReviewedNarration } = await import('../public/dlang/audio.mjs');
  const approvedRecord = await approved(record, profiles, steward);
  assert.equal((await nextReviewedNarration([approvedRecord], 'en', record.scene)).id, record.id);
  assert.equal(await nextReviewedNarration([record], 'en', record.scene), null);
  assert.equal(await nextReviewedNarration([approvedRecord], 'fr', record.scene), null);
  const newerScene = { ...record.scene, sceneVersion: 'practice-recipe-v2' };
  assert.equal(await nextReviewedNarration([approvedRecord], 'en', newerScene), null);
});

test('playback usefulness is editable per steward and version, independent of correctness and earnings', async () => {
  const { steward, record, profiles } = await fixture();
  const { castUsefulnessVote, newEarningsLedger } = await import('../public/dlang/economy.mjs');
  const reviewed = await approved(record, profiles, steward), listened = session(reviewed);
  const ledger = newEarningsLedger(), ledgerBefore = structuredClone(ledger);
  const reviewBefore = structuredClone(reviewed.review);
  await assert.rejects(castUsefulnessVote(record, session(record), { stewardId: 'learner', direction: 'up' }), /qualification/);
  await assert.rejects(castUsefulnessVote(reviewed, listened, { stewardId: 'SPEAKER-WALLET', direction: 'up' }), /non-author/);
  for (const patch of [
    { versionHash: 'b'.repeat(64) }, { audioHash: 'b'.repeat(64) },
    { interrupted: true }, { muted: true }, { autoplay: true },
    { turns: [] }, { turns: listened.turns.map(turn => ({ ...turn, response: '' })) }
  ]) await assert.rejects(castUsefulnessVote(reviewed, { ...listened, ...patch }, { stewardId: 'learner', direction: 'up' }));
  await assert.rejects(castUsefulnessVote(reviewed, listened, { stewardId: 'learner', direction: 'approve' }), /up or down/);
  let rated = await castUsefulnessVote(reviewed, listened, { stewardId: 'learner', direction: 'up' });
  assert.deepEqual(steward.usefulnessCounts(rated), { up: 1, down: 0 });
  rated = await castUsefulnessVote(rated, listened, { stewardId: 'LEARNER', direction: 'down' });
  rated = await castUsefulnessVote(rated, { ...listened, playId: 'another_play_0001' }, { stewardId: 'other-learner', direction: 'up' });
  assert.equal(rated.usefulnessVotes.length, 2);
  assert.deepEqual(steward.usefulnessCounts(rated), { up: 1, down: 1 });
  assert.deepEqual(rated.review, reviewBefore);
  assert.equal(rated.versionHash, reviewed.versionHash);
  assert.equal(steward.canAuthorizeFundedPayment(rated), false);
  assert.deepEqual(ledger, ledgerBefore);
  assert.equal(reviewed.usefulnessVotes, undefined);
  const restored = JSON.parse(JSON.stringify(rated));
  await steward.validateContribution(restored);
  assert.deepEqual(steward.usefulnessCounts(restored), { up: 1, down: 1 });
  for (const patch of [
    { contributionId: 'other_narration' }, { versionHash: 'c'.repeat(64) },
    { audioHash: 'c'.repeat(64) }, { stewardId: reviewed.authorId }, { authority: 'funded' }
  ]) {
    const invalid = structuredClone(rated);
    Object.assign(invalid.usefulnessVotes[0], patch);
    await assert.rejects(steward.validateContribution(invalid), /Usefulness vote/);
  }
  const duplicate = structuredClone(rated);
  duplicate.usefulnessVotes.push({ ...duplicate.usefulnessVotes[0] });
  await assert.rejects(steward.validateContribution(duplicate), /duplicate/);
  const published = await steward.preparePublishedContribution(rated, CID, 'new_version_0001');
  assert.deepEqual(steward.usefulnessCounts(published), { up: 0, down: 0 });
  await assert.rejects(castUsefulnessVote(published, listened, { stewardId: 'learner', direction: 'up' }));
});

test('stopping narration synchronously cancels a pending audio read before it can create a player', async () => {
  const { createNarrationTurnPlayer } = await import('../public/dlang/audio.mjs');
  let release, created = 0;
  const player = createNarrationTurnPlayer({
    load: () => new Promise(resolve => { release = resolve; }),
    AudioConstructor: class { constructor() { created++; } },
    createURL: () => 'blob:fixture', revokeURL: () => {}
  });
  const pending = player.play({ turns: [{ start: 0, end: 1 }] }, 0);
  player.stop();
  release(new Blob(['narration bytes'], { type: 'audio/webm' }));
  await assert.rejects(pending, /cancelled before it started/);
  assert.equal(created, 0);
});

test('turn playback resolves only after its marked boundary and rejects a manual pause', async () => {
  const { createNarrationTurnPlayer } = await import('../public/dlang/audio.mjs');
  class FakeAudio {
    constructor() {
      this.duration = 4; this.currentTime = 0; this.muted = false; this.paused = true; this.listeners = new Map();
      queueMicrotask(() => this.dispatch('loadedmetadata'));
    }
    addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
    removeEventListener(type, handler) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== handler)); }
    dispatch(type) { for (const handler of this.listeners.get(type) || []) handler(); }
    async play() { this.paused = false; return true; }
    pause() { if (this.paused) return; this.paused = true; this.dispatch('pause'); }
  }
  const player = createNarrationTurnPlayer({
    AudioConstructor: FakeAudio, load: async () => new Blob(['narration'], { type: 'audio/webm' }),
    createURL: () => 'blob:fixture', revokeURL: () => {}
  });
  const record = { turns: [{ start: 0, end: 2 }, { start: 2, end: 4 }] };
  const first = await player.play(record, 0);
  first.audio.currentTime = 2;
  first.audio.dispatch('timeupdate');
  assert.deepEqual(await first.done, { completed: true });
  const interrupted = await player.play(record, 1);
  interrupted.audio.currentTime = 2.5;
  interrupted.audio.pause();
  await assert.rejects(interrupted.done, /paused or interrupted/);
  player.stop();
});

test('qualified plays accrue exact tiny units once and survive period rollover without claiming settlement', async () => {
  const { steward, record, profiles } = await fixture();
  const contribution = await approved(record, profiles, steward);
  const economy = await import('../public/dlang/economy.mjs');
  let ledger = economy.newEarningsLedger();
  const firstEvidence = session(contribution);
  const first = await economy.accrueQualifiedPlay(ledger, contribution, firstEvidence, { rateUnits: '1', period: '2026-01' });
  ledger = first.ledger;
  assert.equal(first.receipt.units, '1');
  assert.equal(first.receipt.authority, 'local-only');
  assert.equal(ledger.balances['speaker-wallet'].pendingUnits, '1');
  assert.equal(ledger.balances['speaker-wallet'].confirmedUnits, '0');
  const replay = await economy.accrueQualifiedPlay(ledger, contribution, firstEvidence, { rateUnits: '1', period: '2026-01' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.ledger.receipts.length, 1);
  const second = await economy.accrueQualifiedPlay(ledger, contribution, session(contribution, { playId: 'play_receipt_0002' }), { rateUnits: '2', period: '2026-02' });
  ledger = second.ledger;
  assert.equal(ledger.balances['speaker-wallet'].accruedUnits, '3');
  assert.equal(ledger.balances['speaker-wallet'].pendingUnits, '3');
  assert.equal(ledger.receipts[0].period, '2026-01');
  assert.equal(ledger.receipts[1].period, '2026-02');
  assert.equal(economy.fundingStatus().fundedAuthorized, false);
  assert.throws(() => economy.settleEarnings(), /not payment authority/);
  assert.equal(economy.localMilestones(ledger)[0].fundedAuthorized, false);

  for (const patch of [
    { muted: true }, { autoplay: true }, { interrupted: true },
    { turns: [{ turnIndex: 0, completed: true, response: 'only one' }] },
    { turns: [{ turnIndex: 0, completed: false, response: 'interrupted' }, session(contribution).turns[1]] }
  ]) await assert.rejects(economy.accrueQualifiedPlay(ledger, contribution, session(contribution, patch), { period: '2026-03' }));
  const corrupted = structuredClone(ledger);
  corrupted.balances['speaker-wallet'].confirmedUnits = '1';
  await assert.rejects(economy.accrueQualifiedPlay(corrupted, contribution, session(contribution, { playId: 'play_receipt_0003' })));
});

test('immutable review and earnings records remain valid after browser-style JSON persistence', async () => {
  const { steward, record, profiles } = await fixture();
  const contribution = await approved(record, profiles, steward);
  const restored = JSON.parse(JSON.stringify(contribution));
  assert.equal((await steward.validateContribution(restored)).versionHash, contribution.versionHash);
  const economy = await import('../public/dlang/economy.mjs');
  const accrued = await economy.accrueQualifiedPlay(economy.newEarningsLedger(), restored, session(restored));
  const restoredLedger = JSON.parse(JSON.stringify(accrued.ledger));
  assert.equal(restoredLedger.balances['speaker-wallet'].pendingUnits, '1');
});
