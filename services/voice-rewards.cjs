'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { verifyMessage, getAddress } = require('ethers');
const { writeDurableJSON } = require('./durable-json.cjs');
const { canonicalJSON } = require('../public/dlang/steward.mjs');

const START = Date.parse('2026-11-16T05:00:00Z');
const END = Date.parse('2026-11-23T05:00:00Z');
const UNITS = 10000n * 10n ** 18n;
const MAX_RECEIPTS = 10000;
const hash = value => createHash('sha256').update(canonicalJSON(value)).digest('hex');
const wallet = value => getAddress(value).toLowerCase();
async function validateReceiptJournal(state, { roster, origin }) {
  const { wordVersion } = await import('../public/dlang/community-words.mjs');
  const members = new Set(roster.members.map(row => wallet(row.walletAddress)));
  const ids = new Set(), nonces = new Set();
  const verifyAuth = (authorization, address, action, payload, at) => {
    const lines = authorization?.message?.split('\n') || [];
    const nonce = lines[7]?.replace('Nonce: ', ''), expires = Date.parse(lines[8]?.replace('Expires: ', ''));
    if (lines.length !== 9 || lines[0] !== 'DLang voice reward pilot — trusted audible-completion attestation; no transaction'
      || lines[1] !== `Wallet: ${address}` || lines[2] !== `Origin: ${origin}`
      || lines[3] !== `Pool: ${state.funding.pool.toLowerCase()}` || lines[4] !== `Week: ${START / 1000}-${END / 1000}`
      || lines[5] !== `Action: ${action}` || lines[6] !== `Payload SHA-256: ${hash(payload)}`
      || !/^[a-f0-9]{48}$/.test(nonce || '') || nonces.has(nonce) || !Number.isFinite(expires)
      || at >= expires || expires > at + 120000
      || wallet(verifyMessage(authorization.message, authorization.signature)) !== address) throw Error('Receipt authorization mismatch or duplicate.');
    nonces.add(nonce);
  };
  const enrolled = new Map();
  for (const enrollment of state.enrollments) {
    if (!members.has(enrollment.wallet) || enrollment.credit?.wallet !== enrollment.wallet
      || !['wallet', 'ens'].includes(enrollment.credit?.kind) || !Number.isSafeInteger(enrollment.at) || enrollment.at >= END
      || !enrollment.record || enrollment.record.id !== enrollment.recordId
      || wallet(enrollment.record.authorId) !== enrollment.wallet
      || await wordVersion(enrollment.record.payload, enrollment.wallet) !== enrollment.recordId) throw Error('Invalid verified contributor enrollment.');
    verifyAuth(enrollment.authorization, enrollment.wallet, 'enroll',
      { recordId: enrollment.recordId, credit: enrollment.requestedCredit }, enrollment.at);
    const wordAuth = enrollment.record.authorization, lines = wordAuth?.message?.split('\n') || [];
    if (lines.length !== 7 || lines[0] !== 'DLang community WORD authorization — no payment or cloning consent'
      || lines[1] !== `Wallet: ${enrollment.wallet}` || lines[2] !== `Origin: ${origin}` || lines[3] !== 'Action: publish'
      || lines[4] !== `Payload SHA-256: ${hash(enrollment.record.payload)}`
      || wallet(verifyMessage(wordAuth.message, wordAuth.signature)) !== enrollment.wallet) throw Error('Enrolled word publication signature mismatch.');
    enrolled.set(enrollment.recordId, enrollment.wallet);
  }
  for (const receipt of state.receipts) {
    if (ids.has(receipt.id) || !/^[a-f0-9]{48}$/.test(receipt.id || '') || !members.has(receipt.listener)
      || !members.has(receipt.contributor) || receipt.listener === receipt.contributor
      || !Number.isSafeInteger(receipt.startedAt) || !Number.isSafeInteger(receipt.completedAt)
      || !Number.isFinite(receipt.duration) || receipt.duration < .2 || receipt.duration > 15
      || receipt.startedAt < START || receipt.completedAt >= END || receipt.completedAt - receipt.startedAt < receipt.duration * 1000
      || receipt.completedAt - receipt.startedAt > receipt.duration * 1000 + 30000
      || enrolled.get(receipt.recordId) !== receipt.contributor
      || state.enrollments.find(row => row.recordId === receipt.recordId).record.payload.voice.duration !== receipt.duration) throw Error('Invalid durable qualified receipt.');
    ids.add(receipt.id);
    for (const [action, authorization, payload] of [
      ['start', receipt.startAuthorization, { recordId: receipt.recordId, deliberatePractice: true }],
      ['complete', receipt.completionAuthorization, { sessionId: receipt.id, recordId: receipt.recordId,
        completed: true, audible: true, visible: true, uninterrupted: true, deliberatePractice: true }]
    ]) {
      verifyAuth(authorization, receipt.listener, action, payload, action === 'start' ? receipt.startedAt : receipt.completedAt);
    }
  }
  return true;
}

function allocate(receipts) {
  const credits = new Map();
  for (const receipt of receipts) credits.set(receipt.contributor, (credits.get(receipt.contributor) || 0n) + 1n);
  const total = BigInt(receipts.length);
  if (!total) return { outcome: 'carry-zero-plays', totalCredits: 0, inventoryUnits: UNITS.toString(), allocations: [] };
  const rows = [...credits].map(([address, count]) => ({
    address, credits: count.toString(), units: UNITS * count / total, remainder: UNITS * count % total
  }));
  rows.sort((a, b) => a.remainder === b.remainder ? a.address.localeCompare(b.address) : a.remainder > b.remainder ? -1 : 1);
  const dust = UNITS - rows.reduce((sum, row) => sum + row.units, 0n);
  for (let i = 0; i < Number(dust); i++) rows[i].units++;
  rows.sort((a, b) => a.address.localeCompare(b.address));
  return { outcome: 'allocated', totalCredits: receipts.length, inventoryUnits: '0',
    allocations: rows.map(({ remainder, ...row }) => ({ ...row, units: row.units.toString() })) };
}

async function createVoiceRewardService({ storePath, origin, roster, words, ensProvider, funding, verifyFunding, now = Date.now }) {
  const { pilotEligibility } = await import('../public/dlang/pilot.mjs');
  const { resolveContributorCredit } = await import('../public/dlang/identity.mjs');
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('Exact reward HTTPS origin required.');
  if (!path.isAbsolute(storePath || '') || !words) throw Error('Durable reward store and shared word service required.');
  if (!funding || funding.chainId !== 8453 || funding.asset?.toLowerCase() !== '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
    || funding.assets !== '1000000' || funding.units !== UNITS.toString() || funding.start !== START / 1000
    || funding.end !== END / 1000 || !/^0x[a-fA-F0-9]{64}$/.test(funding.transactionHash || '')
    || !/^0x[a-fA-F0-9]{64}$/.test(funding.runtimeHash || '')) throw Error('Verified $1 Base USDC voice-pool funding receipt required.');
  wallet(funding.pool);
  if (typeof verifyFunding !== 'function' || await verifyFunding(funding) !== true) throw Error('Live funding verification required.');
  const eligible = address => pilotEligibility(roster, address).eligible;
  const members = roster.members.map(row => wallet(row.walletAddress));
  if (members.length > 128) throw Error('Voice pilot supports at most 128 contributors.');
  let state = { version: 1, funding, enrollments: [], challenges: {}, sessions: [], receipts: [] }, queue = Promise.resolve();
  try { state = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state.version !== 1 || hash(state.funding) !== hash(funding) || !Array.isArray(state.receipts)
    || !Array.isArray(state.sessions) || !Array.isArray(state.enrollments) || !state.challenges) throw Error('Reward store or funding identity mismatch.');
  await validateReceiptJournal(state, { roster, origin });
  await writeDurableJSON(storePath, state);
  const serialize = operation => {
    const result = queue.then(operation); queue = result.catch(() => {}); return result;
  };
  const save = async next => { await writeDurableJSON(storePath, next); state = next; };
  const inWeek = () => now() >= START && now() < END;
  let finalSettlement = null;
  const list = () => ({ version: 1, prototypeAttestation: true, funding: state.funding,
    week: { timezone: 'America/New_York', start: new Date(START).toISOString(), endExclusive: new Date(END).toISOString(), recurring: false },
    active: inWeek(), completedCredits: state.receipts.length,
    enrollments: state.enrollments.map(({ recordId, wallet, credit }) => ({ recordId, wallet, credit })),
    settlement: now() >= END ? finalSettlement ||= { ...allocate(state.receipts), evidence: hash({ funding: state.funding, receipts: state.receipts }) } : null });
  async function challenge({ address, action, bodyHash, origin: claimed }) {
    address = wallet(address);
    if (claimed !== origin || !eligible(address) || !['enroll', 'start', 'complete', 'discard'].includes(action)
      || !/^[a-f0-9]{64}$/.test(bodyHash || '')) throw Error('Signed whitelisted voice-reward request required.');
    const next = structuredClone(state);
    for (const [key, row] of Object.entries(next.challenges)) if (row.expires <= now()) delete next.challenges[key];
    if (Object.keys(next.challenges).length >= 500) throw Error('Reward challenge capacity reached.');
    const nonce = randomBytes(24).toString('hex'), expires = now() + 120000;
    const message = ['DLang voice reward pilot — trusted audible-completion attestation; no transaction',
      `Wallet: ${address}`, `Origin: ${origin}`, `Pool: ${funding.pool.toLowerCase()}`,
      `Week: ${START / 1000}-${END / 1000}`, `Action: ${action}`, `Payload SHA-256: ${bodyHash}`,
      `Nonce: ${nonce}`, `Expires: ${new Date(expires).toISOString()}`].join('\n');
    next.challenges[nonce] = { address, action, bodyHash, message, expires };
    await save(next); return { nonce, message };
  }
  async function submit({ nonce, signature, payload }) {
    const auth = state.challenges[nonce];
    if (!auth || auth.expires <= now() || hash(payload) !== auth.bodyHash
      || wallet(verifyMessage(auth.message, signature)) !== auth.address || !eligible(auth.address)) throw Error('Expired, replayed or mismatched reward signature.');
    const next = structuredClone(state);
    delete next.challenges[nonce];
    // Consume verified challenges durably, including rejected qualification attempts.
    await save(next);
    const authorization = { message: auth.message, signature };
    const fields = { enroll: ['recordId', 'credit'], start: ['recordId', 'deliberatePractice'],
      discard: ['sessionId'], complete: ['sessionId', 'recordId', 'completed', 'audible', 'visible', 'uninterrupted', 'deliberatePractice'] };
    if (Object.keys(payload).sort().join(',') !== fields[auth.action].sort().join(',')) throw Error('Exact reward action payload required.');
    const record = words.list().records.find(row => row.id === payload.recordId);
    if (auth.action === 'enroll') {
      if (now() >= END || !record || wallet(record.authorId) !== auth.address || !eligible(record.authorId)) throw Error('Enroll your own whitelisted recording before the week ends.');
      const credit = await resolveContributorCredit(payload.credit, auth.address, ensProvider);
      if (/^0x/i.test(payload.credit.trim())) getAddress(payload.credit.trim());
      next.enrollments = next.enrollments.filter(row => row.recordId !== record.id);
      next.enrollments.push({ recordId: record.id, wallet: auth.address, credit, requestedCredit: payload.credit,
        record: structuredClone(record), at: now(), authorization });
      await save(next); return list();
    }
    if (auth.action === 'start') {
      if (!inWeek() || !record || record.review?.status === 'rejected' || !eligible(record.authorId)
        || wallet(record.authorId) === auth.address || payload.deliberatePractice !== true) throw Error('Only deliberate, independent funded-week practice qualifies.');
      const enrollment = next.enrollments.find(row => row.recordId === record.id && row.wallet === wallet(record.authorId));
      if (!enrollment) throw Error('Contributor must enroll verified matching ENS/wallet credit before earning.');
      await resolveContributorCredit(enrollment.credit.credit, enrollment.wallet, ensProvider);
      if (await verifyFunding(funding) !== true || !inWeek()) throw Error('Funded pool no longer available for this week.');
      const duration = record.payload.voice.duration;
      if (!Number.isFinite(duration) || duration < .2 || duration > 15) throw Error('Word duration must be .2–15 seconds.');
      if (next.sessions.some(row => row.listener === auth.address && row.status === 'started' && row.expires > now())) throw Error('Complete or discard the previous practice session.');
      next.sessions = next.sessions.filter(row => row.expires > now());
      if (next.sessions.length >= 500 || next.receipts.length >= MAX_RECEIPTS) throw Error('Pilot receipt capacity reached; no further credits accepted.');
      const id = randomBytes(24).toString('hex');
      const session = { id, recordId: record.id, listener: auth.address, contributor: wallet(record.authorId),
        duration, startedAt: now(), expires: Math.min(END, now() + duration * 1000 + 30000), status: 'started', authorization };
      next.sessions.push(session);
      await save(next); return { session: { id, recordId: record.id, duration, expires: session.expires } };
    }
    const session = next.sessions.find(row => row.id === payload.sessionId && row.listener === auth.address);
    if (!session || session.status !== 'started') throw Error('Playback session is unavailable or already consumed.');
    session.status = 'discarded';
    if (auth.action === 'discard') { await save(next); return { outcome: 'discarded' }; }
    if (!inWeek() || session.expires <= now() || now() - session.startedAt < session.duration * 1000
      || payload.recordId !== session.recordId || payload.audible !== true || payload.visible !== true
      || payload.completed !== true || payload.uninterrupted !== true || payload.deliberatePractice !== true) {
      await save(next); throw Error('Interrupted, hidden, muted, expired or instantaneous playback earns no credit.');
    }
    const current = words.list().records.find(row => row.id === session.recordId);
    if (!current || current.review?.status === 'rejected' || !eligible(session.contributor)) {
      await save(next); throw Error('Recording no longer qualifies.');
    }
    try {
      if (await verifyFunding(funding) !== true || !inWeek()) throw Error('Funded pool no longer available; completion earns no credit.');
    } catch (error) { await save(next); throw error; }
    if (next.receipts.length >= MAX_RECEIPTS) { await save(next); throw Error('Pilot receipt capacity reached; completion earns no further credit.'); }
    session.status = 'completed';
    next.receipts.push({ id: session.id, recordId: session.recordId, contributor: session.contributor,
      listener: session.listener, duration: session.duration, startedAt: session.startedAt, completedAt: now(),
      startAuthorization: session.authorization, completionAuthorization: authorization });
    await save(next); return { outcome: 'qualified', receiptId: session.id, authoritativeCredits: next.receipts.length };
  }
  return { list, challenge: body => serialize(() => challenge(body)), submit: body => serialize(() => submit(body)) };
}

async function handleVoiceRewardRequest(req, res, service, origin) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/api/voice-rewards')) return false;
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!service) { send(503, { error: 'Voice rewards are not funded and verified on this host. No earnings are claimed.' }); return true; }
  try {
    if (pathname === '/api/voice-rewards' && req.method === 'GET') { send(200, service.list()); return true; }
    if (req.method !== 'POST' || !['/api/voice-rewards/challenge', '/api/voice-rewards/submit'].includes(pathname)) throw Error('Unsupported reward operation.');
    if (req.headers.origin !== origin || req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])
      || !req.headers['content-type']?.startsWith('application/json')) throw Error('Same-origin JSON request required.');
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16000) throw Error('Reward request too large.'); }
    const body = JSON.parse(text);
    send(200, await service[pathname.endsWith('/challenge') ? 'challenge' : 'submit'](body));
  } catch (error) { send(400, { error: error.message }); }
  return true;
}
module.exports = { createVoiceRewardService, handleVoiceRewardRequest, allocate, hash, START, END, UNITS, validateReceiptJournal };
