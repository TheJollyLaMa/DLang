import { cid } from './storage.mjs';

const HASH = /^[a-f0-9]{64}$/;
const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const VOICE_TYPE_SET = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg']);

export function canonicalJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Narration data contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  throw Error('Narration data is not plain JSON.');
}

export async function hashJSON(value) {
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sceneSnapshot(context, language) {
  if (!context || typeof context.sceneId !== 'string' || !context.sceneId.trim() || context.sceneId.length > 120
    || typeof context.sceneVersion !== 'string' || !context.sceneVersion.trim() || context.sceneVersion.length > 120
    || !Number.isInteger(context.level) || context.level < 1 || context.level > 100
    || !LANG.test(language || '') || typeof context.title !== 'string' || !context.title.trim() || context.title.length > 240
    || !Array.isArray(context.concepts) || !context.concepts.length || context.concepts.length > 100
    || context.concepts.some(concept => typeof concept !== 'string' || !concept.trim() || concept.length > 120)) {
    throw Error('Choose a complete scene and language before recording.');
  }
  const scene = context.scene === undefined ? null : context.scene;
  const snapshot = {
    sceneId: context.sceneId,
    sceneVersion: context.sceneVersion,
    level: context.level,
    language,
    concepts: [...new Set(context.concepts)],
    title: context.title,
    scene
  };
  return hashJSON(snapshot).then(sceneHash => ({ ...snapshot, sceneHash }));
}

export function validateReviewerProfile(profile) {
  if (!profile || typeof profile.id !== 'string' || !profile.id.trim() || profile.id.length > 100
    || !Array.isArray(profile.languages) || !profile.languages.length
    || profile.languages.some(language => !LANG.test(language))
    || profile.nativeSpeaker !== true) throw Error('Reviewer must have a language-qualified native-speaker profile.');
  return { id: profile.id.trim(), languages: [...new Set(profile.languages)], nativeSpeaker: true };
}

export function reviewerEligible(profile, language, authorId) {
  try {
    const value = validateReviewerProfile(profile);
    return value.id.toLowerCase() !== String(authorId).toLowerCase() && value.languages.includes(language);
  } catch { return false; }
}

function immutableContribution(record) {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    language: record.language,
    level: record.level,
    scene: record.scene,
    authorId: record.authorId,
    credit: record.credit,
    audio: record.audio,
    turns: record.turns,
    createdAt: record.createdAt
  };
}

export async function createContribution({ id, language, level, scene, authorId, credit, audio, turns, createdAt = new Date().toISOString() }) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)
    || typeof authorId !== 'string' || !authorId.trim() || authorId.length > 120
    || typeof credit !== 'string' || !credit.trim() || credit.length > 100
    || !Number.isInteger(level) || level < 1 || level > 100
    || !audio || !HASH.test(audio.sha256 || '') || !Number.isInteger(audio.size) || audio.size < 1 || audio.size > 2 * 1024 * 1024
    || !Number.isFinite(audio.duration) || audio.duration < 1 || audio.duration > 120
    || !['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'].includes(audio.type)
    || !Array.isArray(turns) || turns.length < 1 || turns.length > 20) throw Error('Narration recording is incomplete or exceeds its limits.');
  if (audio.cid) cid(audio.cid);
  const snapshot = scene.sceneHash ? scene : await sceneSnapshot(scene, language);
  if (snapshot.language !== language || !HASH.test(snapshot.sceneHash || '') || snapshot.level !== level) throw Error('Scene snapshot does not match the narration language or level.');
  let end = 0;
  const cleanTurns = turns.map((turn, index) => {
    if (!turn || !Number.isFinite(turn.start) || !Number.isFinite(turn.end) || turn.start < end
      || turn.end <= turn.start || turn.end > audio.duration + .25
      || typeof turn.prompt !== 'string' || turn.prompt.length > 240) throw Error(`Narration turn ${index + 1} has invalid time marks.`);
    end = turn.end;
    return { start: turn.start, end: turn.end, prompt: turn.prompt.trim(), concept: turn.concept || '' };
  });
  if (cleanTurns.at(-1).end < audio.duration - .25) throw Error('The final turn must reach the end of the recording.');
  const base = {
    schemaVersion: 1, id, language, level, scene: snapshot,
    authorId: authorId.trim(), credit: credit.trim(),
    audio: { cid: audio.cid ? cid(audio.cid) : '', sha256: audio.sha256, size: audio.size, duration: audio.duration, type: audio.type },
    turns: cleanTurns,
    createdAt
  };
  const record = {
    ...base,
    versionHash: await hashJSON(immutableContribution(base)),
    publication: { state: 'local', metadataCid: '', publicAudioCid: '' },
    review: { panel: [], votes: [], history: [] }
  };
  await validateContribution(record);
  return record;
}

export async function preparePublishedContribution(record, audioCid, newId = record.id) {
  await validateContribution(record);
  if (typeof newId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(newId)) throw Error('Published narration version ID is invalid.');
  const base = { ...immutableContribution(record), id: newId, audio: { ...record.audio, cid: cid(audioCid) } };
  const prepared = {
    ...base,
    versionHash: await hashJSON(immutableContribution(base)),
    publication: { state: 'local', metadataCid: '', publicAudioCid: '' },
    review: {
      panel: [], votes: [],
      history: [...record.review.history, { action: 'new-public-version', previousVersionHash: record.versionHash, at: new Date().toISOString() }]
    }
  };
  await validateContribution(prepared);
  return prepared;
}

export async function markContributionPublished(record, metadataCid) {
  await validateContribution(record);
  if (!record.audio.cid) throw Error('Publish the immutable audio file before its narration metadata.');
  const next = structuredClone(record);
  next.publication = { state: 'published', metadataCid: cid(metadataCid), publicAudioCid: record.audio.cid };
  await validateContribution(next);
  return next;
}

export async function validateContribution(record) {
  if (!record || record.schemaVersion !== 1 || typeof record.versionHash !== 'string' || !HASH.test(record.versionHash)
    || typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(record.id)
    || typeof record.language !== 'string' || !LANG.test(record.language)
    || !Number.isInteger(record.level) || record.level < 1 || record.level > 100
    || !record.scene || record.scene.language !== record.language || record.scene.level !== record.level
    || typeof record.scene.sceneId !== 'string' || !record.scene.sceneId.trim()
    || typeof record.scene.sceneVersion !== 'string' || !record.scene.sceneVersion.trim()
    || typeof record.scene.title !== 'string' || !record.scene.title.trim()
    || !Array.isArray(record.scene.concepts) || !record.scene.concepts.length
    || !HASH.test(record.scene.sceneHash || '')
    || typeof record.authorId !== 'string' || !record.authorId.trim()
    || typeof record.credit !== 'string' || !record.credit.trim()
    || !record.audio || !HASH.test(record.audio.sha256 || '') || !Number.isInteger(record.audio.size)
    || record.audio.size < 1 || record.audio.size > 2 * 1024 * 1024
    || !Number.isFinite(record.audio.duration) || record.audio.duration < 1 || record.audio.duration > 120
    || !VOICE_TYPE_SET.has(record.audio.type)
    || !Array.isArray(record.turns) || record.turns.length < 1 || record.turns.length > 20
    || !record.review || !Array.isArray(record.review.panel)
    || !Array.isArray(record.review.votes) || !Array.isArray(record.review.history)
    || !record.publication || !['local', 'published'].includes(record.publication.state)) throw Error('Narration record is invalid.');
  const expected = await hashJSON(immutableContribution(record));
  if (expected !== record.versionHash) throw Error('Narration version hash does not match its immutable content.');
  const expectedSceneHash = await hashJSON({
    sceneId: record.scene.sceneId, sceneVersion: record.scene.sceneVersion, level: record.scene.level,
    language: record.scene.language, concepts: record.scene.concepts, title: record.scene.title, scene: record.scene.scene ?? null
  });
  if (expectedSceneHash !== record.scene.sceneHash) throw Error('Narration scene hash does not match its immutable snapshot.');
  if (record.audio.cid) cid(record.audio.cid);
  let end = 0;
  for (const [index, turn] of record.turns.entries()) {
    if (!turn || !Number.isFinite(turn.start) || !Number.isFinite(turn.end) || turn.start < end
      || turn.end <= turn.start || turn.end > record.audio.duration + .25
      || typeof turn.prompt !== 'string' || turn.prompt.length > 240
      || typeof turn.concept !== 'string' || turn.concept.length > 120) throw Error(`Narration turn ${index + 1} is invalid.`);
    end = turn.end;
  }
  if (record.turns.at(-1).end < record.audio.duration - .25) throw Error('The final turn does not reach the end of the audio.');
  if (record.publication.state === 'published') {
    cid(record.publication.metadataCid);
    cid(record.publication.publicAudioCid);
    if (record.publication.publicAudioCid !== record.audio.cid) throw Error('Published audio CID does not match the narration.');
  } else if (record.publication.metadataCid || record.publication.publicAudioCid) {
    throw Error('Local narration cannot claim a public IPFS URI.');
  }
  const assigned = new Set();
  for (const profile of record.review.panel) {
    const reviewer = validateReviewerProfile(profile);
    if (assigned.has(reviewer.id.toLowerCase()) || !reviewer.languages.includes(record.language)
      || reviewer.id.toLowerCase() === record.authorId.toLowerCase()) throw Error('Review panel has a duplicate, ineligible or author reviewer.');
    assigned.add(reviewer.id.toLowerCase());
  }
  if (record.review.panel.length && record.review.panel.length !== 3) throw Error('A narration review panel must contain exactly three reviewers.');
  const seen = new Set();
  const historicalPanels = new Set(record.review.history.flatMap(event => Array.isArray(event.panel) ? event.panel : []));
  for (const event of record.review.history) {
    if (event.action === 'reviewer-replaced') {
      if (typeof event.oldId !== 'string' || typeof event.replacementId !== 'string' || typeof event.reason !== 'string' || !event.reason.trim()) {
        throw Error('Reviewer replacement history is invalid.');
      }
      historicalPanels.add(event.oldId);
      historicalPanels.add(event.replacementId);
    }
  }
  for (const vote of record.review.votes) {
    if (!vote || typeof vote.reviewerId !== 'string' || !historicalPanels.has(vote.reviewerId)
      && !assigned.has(vote.reviewerId.toLowerCase())
      || vote.versionHash !== record.versionHash || !['approve', 'reject'].includes(vote.decision)
      || vote.language !== record.language || vote.reviewerId.toLowerCase() === record.authorId.toLowerCase()
      || typeof vote.revoked !== 'boolean' || typeof vote.authority !== 'string'
      || (vote.signature && !/^0x[0-9a-fA-F]{130}$/.test(vote.signature))
      || seen.has(vote.reviewerId.toLowerCase())) throw Error('Review vote is duplicate or bound to the wrong narration version.');
    seen.add(vote.reviewerId.toLowerCase());
  }
  if (record.usefulnessVotes !== undefined) {
    if (!Array.isArray(record.usefulnessVotes)) throw Error('Local usefulness votes are invalid.');
    const stewards = new Set();
    for (const vote of record.usefulnessVotes) {
      if (!vote || typeof vote.stewardId !== 'string' || !vote.stewardId.trim() || vote.stewardId.length > 120
        || vote.stewardId !== vote.stewardId.trim() || stewards.has(vote.stewardId.toLowerCase())
        || vote.stewardId.toLowerCase() === record.authorId.toLowerCase()
        || vote.contributionId !== record.id || vote.versionHash !== record.versionHash
        || vote.audioHash !== record.audio.sha256 || !HASH.test(vote.evidenceHash || '')
        || typeof vote.playId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(vote.playId)
        || !['up', 'down'].includes(vote.direction) || vote.authority !== 'local-only') {
        throw Error('Usefulness vote is duplicate, self-authored or bound to the wrong narration version.');
      }
      stewards.add(vote.stewardId.toLowerCase());
    }
  }
  return record;
}

export function usefulnessCounts(record) {
  const votes = record.usefulnessVotes || [];
  return {
    up: votes.filter(vote => vote.direction === 'up').length,
    down: votes.filter(vote => vote.direction === 'down').length
  };
}

export async function assignReviewPanel(record, panel, profiles) {
  await validateContribution(record);
  if (record.review.votes.length) throw Error('A panel cannot change after votes; revoke a vote explicitly first.');
  if (!Array.isArray(panel) || panel.length !== 3) throw Error('Assign exactly three eligible reviewers.');
  const directory = new Map(profiles.map(profile => {
    const clean = validateReviewerProfile(profile);
    return [clean.id.toLowerCase(), clean];
  }));
  const assigned = panel.map(id => {
    const profile = directory.get(String(id).toLowerCase());
    if (!profile || !reviewerEligible(profile, record.language, record.authorId)) throw Error('Each reviewer must be an eligible native speaker of the narration language, excluding its author.');
    return profile;
  });
  if (new Set(assigned.map(profile => profile.id.toLowerCase())).size !== 3) throw Error('Reviewer assignments must be three distinct people.');
  const next = structuredClone(record);
  next.review.panel = assigned;
  next.review.history.push({ action: 'panel-assigned', at: new Date().toISOString(), panel: assigned.map(profile => profile.id) });
  await validateContribution(next);
  return next;
}

export function reviewStatus(record) {
  const active = record.review.votes.filter(vote => !vote.revoked);
  const approvals = active.filter(vote => vote.decision === 'approve').length;
  const rejections = active.filter(vote => vote.decision === 'reject').length;
  return {
    approvals, rejections,
    status: record.review.panel.length !== 3 ? 'unassigned'
      : approvals >= 2 ? 'local-approved'
        : rejections >= 2 ? 'local-rejected' : 'in-review',
    fundedAuthorized: false
  };
}

export async function castLocalVote(record, { reviewerId, language, decision, reason = '', versionHash, signature = '' }) {
  await validateContribution(record);
  if (record.review.panel.length !== 3) throw Error('Assign the three-person language panel first.');
  if (versionHash !== record.versionHash) throw Error('Vote is for a different narration version.');
  if (!['approve', 'reject'].includes(decision) || !record.review.panel.some(profile =>
    profile.id.toLowerCase() === String(reviewerId).toLowerCase() && profile.languages.includes(language)
      && language === record.language && profile.nativeSpeaker === true)) throw Error('Reviewer is not assigned and qualified for this language.');
  if (record.review.votes.some(vote => vote.reviewerId.toLowerCase() === reviewerId.toLowerCase())) throw Error('One vote per assigned reviewer and version; revoke explicitly before replacement.');
  if (reviewStatus(record).status !== 'in-review') throw Error('This review is already decided.');
  if (typeof reason !== 'string' || reason.length > 500 || (decision === 'reject' && !reason.trim())) throw Error('A rejection needs a brief correctness note.');
  if (signature && !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw Error('Review signature format is invalid.');
  const next = structuredClone(record);
  next.review.votes.push({
    reviewerId: reviewerId.trim(), language, decision, reason: reason.trim(),
    versionHash, signature, signedAt: signature ? new Date().toISOString() : '',
    revoked: false, at: new Date().toISOString(), authority: 'local-only'
  });
  await validateContribution(next);
  return next;
}

export async function revokeReviewVote(record, reviewerId, reason) {
  await validateContribution(record);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) throw Error('Vote revocation requires a reason.');
  const next = structuredClone(record), vote = next.review.votes.find(item => item.reviewerId.toLowerCase() === String(reviewerId).toLowerCase());
  if (!vote || vote.revoked) throw Error('There is no active vote to revoke.');
  vote.revoked = true;
  next.review.history.push({ action: 'vote-revoked', reviewerId: vote.reviewerId, reason: reason.trim(), at: new Date().toISOString() });
  await validateContribution(next);
  return next;
}

export async function replaceReviewer(record, oldId, replacementId, profiles, reason) {
  await validateContribution(record);
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 300) throw Error('Reviewer replacement requires a reason.');
  const next = structuredClone(record);
  const index = next.review.panel.findIndex(profile => profile.id.toLowerCase() === String(oldId).toLowerCase());
  if (index < 0) throw Error('Reviewer is not assigned to this narration.');
  const replacement = profiles.map(validateReviewerProfile).find(profile => profile.id.toLowerCase() === String(replacementId).toLowerCase());
  if (!replacement || !reviewerEligible(replacement, record.language, record.authorId)
    || next.review.panel.some(profile => profile.id.toLowerCase() === replacement.id.toLowerCase())) throw Error('Replacement must be a new eligible reviewer for this language.');
  const vote = next.review.votes.find(item => item.reviewerId.toLowerCase() === String(oldId).toLowerCase());
  if (vote && !vote.revoked) throw Error('Revoke the assigned reviewer’s vote with a reason before replacement.');
  const previous = next.review.panel[index];
  next.review.panel[index] = replacement;
  next.review.history.push({ action: 'reviewer-replaced', oldId: previous.id, replacementId: replacement.id, reason: reason.trim(), at: new Date().toISOString() });
  await validateContribution(next);
  return next;
}

export function localPracticeRotation(records, language, scene) {
  return records.filter(record => record.language === language && record.scene.sceneId === scene.sceneId
    && record.scene.sceneVersion === scene.sceneVersion && reviewStatus(record).status === 'local-approved');
}

export function canAuthorizeFundedPayment() {
  return false;
}
