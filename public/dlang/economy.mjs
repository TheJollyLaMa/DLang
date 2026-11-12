import { canAuthorizeFundedPayment, hashJSON, reviewStatus, validateContribution } from './steward.mjs';

export const DEFAULT_PLAY_RATE_UNITS = '1';

export function newEarningsLedger() {
  return { schemaVersion: 1, unit: 'provisional-unit', receipts: [], balances: {}, settlements: [] };
}

function assertLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== 1 || ledger.unit !== 'provisional-unit'
    || !Array.isArray(ledger.receipts) || !Array.isArray(ledger.settlements)
    || !ledger.balances || Array.isArray(ledger.balances)) throw Error('Local earnings ledger is invalid.');
  const ids = new Set(), totals = new Map();
  for (const receipt of ledger.receipts) {
    if (!receipt || typeof receipt.id !== 'string' || ids.has(receipt.id)
      || !/^\d+$/.test(receipt.units || '') || BigInt(receipt.units) < 1n
      || !/^[a-f0-9]{64}$/.test(receipt.versionHash || '') || !/^[a-f0-9]{64}$/.test(receipt.audioHash || '')
      || !/^[a-f0-9]{64}$/.test(receipt.evidenceHash || '')
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(receipt.period || '')
      || typeof receipt.authorId !== 'string' || receipt.authorId !== receipt.payeeId
      || receipt.authority !== 'local-only' || receipt.state !== 'accrued') throw Error('Local earnings receipt is invalid or duplicated.');
    ids.add(receipt.id);
    totals.set(receipt.payeeId, (totals.get(receipt.payeeId) || 0n) + BigInt(receipt.units));
  }
  for (const [payeeId, balance] of Object.entries(ledger.balances)) {
    if (!balance || !/^\d+$/.test(balance.accruedUnits || '')
      || !/^\d+$/.test(balance.pendingUnits || '') || !/^\d+$/.test(balance.confirmedUnits || '')
      || balance.confirmedUnits !== '0' || balance.payeeId !== payeeId
      || balance.accruedUnits !== (totals.get(payeeId) || 0n).toString()
      || balance.pendingUnits !== balance.accruedUnits) throw Error('Earnings balance is invalid or claims an unverified payment.');
  }
  for (const payeeId of totals.keys()) if (!ledger.balances[payeeId]) throw Error('Earnings receipt has no matching accrued balance.');
  return ledger;
}

export function validateEarningsLedger(ledger) {
  assertLedger(ledger);
  return ledger;
}

export function qualifyPlayback(contribution, session) {
  if (!contribution || reviewStatus(contribution).status !== 'local-approved'
    || session?.versionHash !== contribution.versionHash || session?.audioHash !== contribution.audio.sha256
    || typeof session?.playId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(session.playId)
    || session.userInitiated !== true || session.muted !== false || session.autoplay !== false
    || session.interrupted !== false || !Array.isArray(session.turns)
    || session.turns.length !== contribution.turns.length) throw Error('Playback did not meet the local qualification rule.');
  for (let index = 0; index < session.turns.length; index++) {
    const played = session.turns[index];
    if (!played || played.turnIndex !== index || played.completed !== true
      || typeof played.response !== 'string' || !played.response.trim() || played.response.length > 2000) {
      throw Error(`Complete turn ${index + 1} and type a response before continuing.`);
    }
  }
  return { qualified: true, authority: 'local-only', playId: session.playId };
}

export async function castUsefulnessVote(contribution, session, { stewardId, direction }) {
  await validateContribution(contribution);
  qualifyPlayback(contribution, session);
  if (typeof stewardId !== 'string' || !stewardId.trim() || stewardId.length > 120
    || stewardId.trim().toLowerCase() === contribution.authorId.toLowerCase()) {
    throw Error('Use a non-author local steward identity for usefulness feedback.');
  }
  if (!['up', 'down'].includes(direction)) throw Error('Choose usefulness up or down.');
  const next = structuredClone(contribution);
  next.usefulnessVotes = (next.usefulnessVotes || []).filter(vote =>
    vote.stewardId.toLowerCase() !== stewardId.trim().toLowerCase());
  next.usefulnessVotes.push({
    stewardId: stewardId.trim(), direction, contributionId: contribution.id,
    versionHash: contribution.versionHash, audioHash: contribution.audio.sha256,
    playId: session.playId, evidenceHash: await hashJSON(session), authority: 'local-only'
  });
  await validateContribution(next);
  return next;
}

export async function accrueQualifiedPlay(ledger, contribution, session, { rateUnits = DEFAULT_PLAY_RATE_UNITS, period = new Date().toISOString().slice(0, 7) } = {}) {
  assertLedger(ledger);
  await validateContribution(contribution);
  if (!/^\d+$/.test(String(rateUnits)) || BigInt(rateUnits) < 1n) throw Error('Per-play rate must be a positive exact unit count.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw Error('Earnings period must be YYYY-MM.');
  qualifyPlayback(contribution, session);
  const duplicate = ledger.receipts.find(receipt => receipt.id === session.playId);
  if (duplicate) return { ledger, duplicate: true, receipt: duplicate };
  const next = structuredClone(ledger);
  const evidenceHash = await hashJSON({
    playId: session.playId, versionHash: session.versionHash, audioHash: session.audioHash,
    userInitiated: session.userInitiated, muted: session.muted, autoplay: session.autoplay,
    interrupted: session.interrupted, turns: session.turns
  });
  const receipt = {
    id: session.playId,
    contributionId: contribution.id,
    versionHash: contribution.versionHash,
    audioHash: contribution.audio.sha256,
    evidenceHash,
    authorId: contribution.authorId,
    payeeId: contribution.authorId,
    credit: contribution.credit,
    period,
    units: String(rateUnits),
    authority: 'local-only',
    state: 'accrued',
    at: new Date().toISOString()
  };
  next.receipts.push(receipt);
  const balance = next.balances[receipt.payeeId] || {
    payeeId: receipt.payeeId, accruedUnits: '0', pendingUnits: '0', confirmedUnits: '0'
  };
  balance.accruedUnits = (BigInt(balance.accruedUnits) + BigInt(receipt.units)).toString();
  balance.pendingUnits = (BigInt(balance.pendingUnits) + BigInt(receipt.units)).toString();
  next.balances[receipt.payeeId] = balance;
  assertLedger(next);
  return { ledger: next, duplicate: false, receipt };
}

export function fundingStatus() {
  return {
    state: 'unavailable',
    asset: 'Ommm',
    polygonReference: '0x1a74f818F1b42dBFcE449c7Fa93B107C6e4A2433',
    baseAsset: null,
    reason: 'Narrator payments have no allocated budget or configured settlement authority. The learning-gem reserve is separate.',
    fundedAuthorized: canAuthorizeFundedPayment()
  };
}

export function settleEarnings() {
  throw Error('Settlement is unavailable: local accruals are not payment authority.');
}

export function localMilestones(ledger) {
  assertLedger(ledger);
  const plays = ledger.receipts.length;
  return [
    { id: 'narrator-first-turn', label: 'First scene narrated', reached: plays >= 1 },
    { id: 'narrator-five-scenes', label: 'Five qualified local plays', reached: plays >= 5 }
  ].map(item => ({ ...item, claimState: item.reached ? 'local milestone · DNFT claim unconfigured' : 'in progress', fundedAuthorized: false }));
}
