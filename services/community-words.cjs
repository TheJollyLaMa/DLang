'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { verifyMessage, getAddress } = require('ethers');
const { writeDurableJSON } = require('./durable-json.cjs');

async function createWordService({ storePath, origin, roster, reviewers = [], ensProvider, now = Date.now }) {
  const { hashJSON, sceneSnapshot, reviewerEligible } = await import('../public/dlang/steward.mjs');
  const { pilotEligibility } = await import('../public/dlang/pilot.mjs');
  const { validateWordPayload, wordVersion } = await import('../public/dlang/community-words.mjs');
  const { resolveContributorCredit } = await import('../public/dlang/identity.mjs');
  const url = new URL(origin);
  if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)
    || url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Word service needs an exact HTTPS origin (localhost for testing).');
  if (!storePath || !path.isAbsolute(storePath)) throw Error('Word service needs an explicit durable absolute store path.');
  const eligible = address => pilotEligibility(roster, address).eligible;
  pilotEligibility(roster, roster.members[0].walletAddress);
  let state = { version: 1, records: [], flags: [] }, queue = Promise.resolve();
  try { state = JSON.parse(await fs.readFile(storePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state.version !== 1 || !Array.isArray(state.records) || !Array.isArray(state.flags)) throw Error('Invalid durable word store.');
  for (const record of state.records) {
    if (record.id !== await wordVersion(record.payload, record.authorId) || !eligible(record.authorId)) throw Error('Durable recording hash or pilot author is invalid.');
  }
  const nonces = new Map();
  async function persist(next) {
    await writeDurableJSON(storePath, next);
    state = next;
  }
  // Verify storage before advertising writable readiness; never fall back to browser-only success.
  await persist(state);
  const list = () => ({ version: 1, persistence: 'operator-store', payments: false,
    records: state.records.map(record => ({ ...record, pilotEligible: eligible(record.authorId) })), flags: state.flags });
  function challenge({ address, action, bodyHash, origin: claimedOrigin }) {
    if (claimedOrigin !== origin || !eligible(address) || !['authorize-upload', 'publish', 'flag', 'feedback', 'review'].includes(action)
      || !/^[a-f0-9]{64}$/.test(bodyHash || '')) throw Error('Only signed whitelisted pilot contributions are accepted.');
    for (const [key, value] of nonces) if (value.expires <= now()) nonces.delete(key);
    if (nonces.size >= 500) throw Error('Word authorization queue is full; retry later.');
    const nonce = randomBytes(24).toString('hex'), expires = now() + 120000;
    const message = ['DLang community WORD authorization — no payment or cloning consent',
      `Wallet: ${address.toLowerCase()}`, `Origin: ${origin}`, `Action: ${action}`,
      `Payload SHA-256: ${bodyHash}`, `Nonce: ${nonce}`, `Expires: ${new Date(expires).toISOString()}`].join('\n');
    nonces.set(nonce, { address: address.toLowerCase(), action, bodyHash, expires, message });
    return { nonce, message };
  }
  async function apply({ nonce, signature, payload }) {
    const auth = nonces.get(nonce);
    if (!auth || auth.expires <= now()) throw Error('Word authorization expired or was already used.');
    if (await hashJSON(payload) !== auth.bodyHash || verifyMessage(auth.message, signature).toLowerCase() !== auth.address) {
      throw Error('Signature does not match the exact word contribution.');
    }
    nonces.delete(nonce);
    if (!eligible(auth.address)) throw Error('Pilot contributor is no longer eligible.');
    if (auth.action === 'authorize-upload') {
      if (payload.purpose !== 'public-word-upload' || !/^[a-f0-9]{64}$/.test(payload.sha256 || '')) throw Error('Explicit word-upload authorization required.');
      if (payload.credit !== undefined) {
        if (/^0x/i.test(payload.credit?.trim())) getAddress(payload.credit.trim());
        await resolveContributorCredit(payload.credit, auth.address, ensProvider);
      }
      return { ...list(), eligible: true };
    }
    const next = structuredClone(state), at = new Date(now()).toISOString();
    if (auth.action === 'publish') {
      await validateWordPayload(payload);
      // Historical nickname credits remain playable, but cannot enroll for rewards.
      if (/^0x/i.test(payload.voice.speaker.trim()) || /\.eth$/i.test(payload.voice.speaker.trim())) {
        if (/^0x/i.test(payload.voice.speaker.trim())) getAddress(payload.voice.speaker.trim());
        await resolveContributorCredit(payload.voice.speaker, auth.address, ensProvider);
      }
      const id = await wordVersion(payload, auth.address);
      if (next.records.some(row => row.id === id || row.payload.voice.cid === payload.voice.cid)) throw Error('This recording is already published.');
      if (next.records.length >= 5000) throw Error('Pilot recording limit reached.');
      next.records.push({ id, authorId: auth.address, payload, publishedAt: at,
        review: { status: 'unreviewed' }, feedback: [], authorization: { message: auth.message, signature } });
    } else if (auth.action === 'flag') {
      const snapshot = await sceneSnapshot(payload.scene, payload.language);
      const { PACKS } = await import('../public/dlang/packs.mjs');
      if (!PACKS[payload.language]?.[payload.concept] || snapshot.sceneHash !== payload.scene?.sceneHash
        || !snapshot.concepts.includes(payload.concept)
        || !['device-synthesis', 'legacy-recording', 'community-word', 'unavailable'].includes(payload.source)
        || typeof payload.recordId !== 'string' || payload.recordId.length > 120) throw Error('Pronunciation flag context is invalid.');
      if (payload.source === 'community-word' && !next.records.some(row => row.id === payload.recordId
        && row.payload.voice.language === payload.language && row.payload.voice.concept === payload.concept)) throw Error('Flagged recording does not match the word.');
      const id = await hashJSON({ payload, authorId: auth.address });
      if (next.flags.some(row => row.id === id)) throw Error('You already flagged this pronunciation in this scene.');
      if (next.flags.length >= 10000) throw Error('Pilot flag limit reached.');
      next.flags.push({ id, authorId: auth.address, ...payload, status: 'open', at,
        authorization: { message: auth.message, signature } });
    } else {
      const record = next.records.find(row => row.id === payload.recordId);
      if (!record || payload.versionHash !== record.id || record.authorId === auth.address) throw Error('Feedback must bind another speaker’s exact recording.');
      if (auth.action === 'feedback') {
        if (![1, -1].includes(payload.value) || payload.meaning !== 'clear-helpful-learning') throw Error('Thumbs mean clear and helpful for learning, not accent preference.');
        record.feedback = record.feedback.filter(vote => vote.address !== auth.address);
        record.feedback.push({ address: auth.address, value: payload.value, at, authorization: { message: auth.message, signature } });
      } else {
        const profile = reviewers.find(row => row.id.toLowerCase() === auth.address);
        if (!reviewerEligible(profile, record.payload.voice.language, record.authorId)
          || !['approved', 'rejected'].includes(payload.status)) throw Error('Independent operator-qualified language reviewer required.');
        record.review = { status: payload.status, reviewer: auth.address, at, versionHash: record.id,
          authorization: { message: auth.message, signature } };
      }
    }
    await persist(next);
    return list();
  }
  return { list, challenge, submit(body) {
    const result = queue.then(() => apply(body));
    queue = result.catch(() => {});
    return result;
  } };
}

async function handleWordRequest(req, res, service, origin) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/api/words')) return false;
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (!service) { send(503, { error: 'Community WORD persistence is not configured on this host. Drafts remain local; no shared publication, votes or rewards are claimed.' }); return true; }
  try {
    if (pathname === '/api/words' && req.method === 'GET') { send(200, service.list()); return true; }
    if (req.method !== 'POST' || !['/api/words/challenge', '/api/words/submit'].includes(pathname)) { send(405, { error: 'Unsupported WORD endpoint.' }); return true; }
    if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') throw Error('Same-origin JSON authorization required.');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) throw Error('Word request exceeds limit.'); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    send(200, pathname.endsWith('/challenge') ? service.challenge(body) : await service.submit(body));
  } catch (error) { send(400, { error: error.message }); }
  return true;
}
module.exports = { createWordService, handleWordRequest };
