import { PACKS } from './packs.mjs';
import { cid } from './storage.mjs';
import { hashJSON, sceneSnapshot } from './steward.mjs';

export async function validateWordPayload(payload) {
  const { voice, profile, scene, consent } = payload || {};
  if (!voice || voice.version !== 1 || !PACKS[voice.language]?.[voice.concept]
    || typeof voice.speaker !== 'string' || !voice.speaker.trim() || voice.speaker.length > 60
    || voice.license !== 'CC-BY-4.0' || typeof voice.nativeSpeakerDeclared !== 'boolean'
    || !['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'].includes(voice.type)
    || !Number.isFinite(voice.duration) || voice.duration < .2 || voice.duration > 15
    || !Number.isInteger(voice.size) || voice.size < 1 || voice.size > 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(voice.sha256 || '')
    || !profile || profile.language !== voice.language || typeof profile.dialect !== 'string'
    || !profile.dialect.trim() || profile.dialect.length > 80
    || profile.nativeSpeakerDeclared !== voice.nativeSpeakerDeclared
    || consent !== 'own-voice-public-word-CC-BY-4.0'
    || !Number.isFinite(Date.parse(payload.createdAt))) throw Error('Word recording, profile or public-word consent is incomplete.');
  cid(voice.cid);
  const snapshot = await sceneSnapshot(scene, voice.language);
  if (scene.sceneHash !== snapshot.sceneHash || !snapshot.concepts.includes(voice.concept)) {
    throw Error('Word recording does not match its scene and language.');
  }
  return payload;
}

export async function wordVersion(payload, authorId) {
  await validateWordPayload(payload);
  return hashJSON({ payload, authorId: authorId.toLowerCase() });
}

export function wordWeight(record) {
  const votes = record.feedback || [];
  const up = votes.filter(vote => vote.value === 1).length;
  const down = votes.filter(vote => vote.value === -1).length;
  const helpfulness = .5 + (up + 1) / (up + down + 2);
  return (record.review?.status === 'approved' ? 4 : 1)
    * (record.payload.profile.nativeSpeakerDeclared ? 1.5 : 1) * helpfulness;
}

export function nextCommunityWord(records, language, concept, previous = null, random = Math.random) {
  let candidates = records.filter(record => record.payload.voice.language === language
    && record.payload.voice.concept === concept && record.review?.status !== 'rejected'
    && record.pilotEligible === true);
  if (!candidates.length) return null;
  const different = candidates.filter(record => record.authorId !== previous?.authorId);
  if (different.length && previous?.consecutivePlays >= 2) candidates = different;
  const weight = record => wordWeight(record) * (different.length && record.authorId === previous?.authorId ? .25 : 1);
  const total = candidates.reduce((sum, record) => sum + weight(record), 0);
  let choice = Math.max(0, Math.min(.999999999, random())) * total;
  return candidates.find(record => (choice -= weight(record)) < 0) || candidates.at(-1);
}

export function createWordClient({ signer, request = fetch, origin = globalThis.location?.origin }) {
  async function call(path, body) {
    const response = await request(`/api/words${path}`, {
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || `Word community HTTP ${response.status}`);
    return result;
  }
  return {
    list: () => call(''),
    async mutate(action, payload) {
      const wallet = await signer(), address = await wallet.getAddress();
      const bodyHash = await hashJSON(payload);
      const challenge = await call('/challenge', { address, action, bodyHash, origin });
      const signature = await wallet.signMessage(challenge.message);
      return call('/submit', { nonce: challenge.nonce, payload, signature });
    }
  };
}
