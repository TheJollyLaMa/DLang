import { digest } from './storage.mjs';
import {
  assignReviewPanel, canAuthorizeFundedPayment, castLocalVote, createContribution,
  localPracticeRotation, markContributionPublished, preparePublishedContribution,
  replaceReviewer, revokeReviewVote, reviewStatus, sceneSnapshot, validateContribution,
  validateReviewerProfile, usefulnessCounts
} from './steward.mjs';
import {
  accrueQualifiedPlay, castUsefulnessVote, fundingStatus, localMilestones, newEarningsLedger, qualifyPlayback, validateEarningsLedger
} from './economy.mjs';
import { LANGUAGE_NAMES, PACKS } from './packs.mjs';
import { WORDMAP_LANGUAGES } from './curriculum.mjs';

const STATE_KEY = 'dlang-narration-stewards-v1';
const DB_NAME = 'dlang-narration-recordings-v1';
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_SECONDS = 120;
const EARNING_RATE = '1';

function freshState() {
  return { schemaVersion: 1, localAuthorId: `local:${crypto.randomUUID()}`, profiles: [], contributions: [], ledger: newEarningsLedger() };
}

function readState(storage) {
  const raw = storage.getItem(STATE_KEY);
  if (!raw) return freshState();
  const value = JSON.parse(raw);
  if (value?.schemaVersion !== 1 || typeof value.localAuthorId !== 'string'
    || !Array.isArray(value.profiles) || !Array.isArray(value.contributions)
    || !value.ledger) throw Error('Saved narration records are invalid; nothing was changed.');
  value.profiles.forEach(validateReviewerProfile);
  return value;
}

async function validateState(value) {
  if (value.schemaVersion !== 1) throw Error('Narration bundle version is not supported.');
  validateEarningsLedger(value.ledger);
  for (const profile of value.profiles) validateReviewerProfile(profile);
  for (const record of value.contributions) await validateContribution(record);
}

function openDraftDB() {
  if (!globalThis.indexedDB) throw Error('Local narration storage requires IndexedDB.');
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore('recordings');
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(Error('Local narration storage could not be opened.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function draftDB(action, key, value) {
  const db = await openDraftDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', action === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('recordings');
      const request = action === 'put' ? store.put(value, key) : action === 'delete' ? store.delete(key) : store.get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(Error('Local narration recording could not be saved or read.'));
      tx.onabort = tx.onerror;
    });
  } finally { db.close(); }
}

const escapeHTML = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const contextFor = getter => {
  const context = getter?.();
  return context && typeof context === 'object' ? context : null;
};
const randomId = () => crypto.randomUUID();

export function mountNarration({
  storage, ipfs, audio, report = () => {}, getSceneContext = () => null,
  getWallet = null, getAddress = () => ''
}) {
  const root = document.getElementById('narration-root');
  let room = null;
  if (!root) throw Error('Add #narration-root before mounting narration.');
  let state, context = null, blocked = true, stateError = '', parentBlocked = false, hydrated = false, recorder = null, stream = null, recordStartedAt = 0;
  let recordingContext = null, discardCapture = false, selected = null, player = null, recordTimer = null;
  let turnIndex = 0, playback = null, playedSegment = null, walletGeneration = 0, contextGeneration = 0;
  let completedListening = null;
  let sceneLanguage = 'en', statusMessage = '';
  try {
    state = readState(storage);
    state.profiles = state.profiles.map(validateReviewerProfile);
  } catch (error) {
    state = freshState();
    stateError = error.message;
    report(error.message);
  }
  const languages = [...new Map([...Object.keys(PACKS), ...WORDMAP_LANGUAGES.map(item => item.tag)]
    .map(tag => [tag, { tag, name: LANGUAGE_NAMES[tag] || WORDMAP_LANGUAGES.find(item => item.tag === tag)?.name || tag }])).values()];
  const languageOptions = selectedTag => languages.map(item =>
    `<option value="${escapeHTML(item.tag)}"${item.tag === selectedTag ? ' selected' : ''}>${escapeHTML(item.name)}</option>`).join('');
  const profileOptions = (language, selectedId = '', eligible = state.profiles) => eligible
    .filter(profile => profile.nativeSpeaker && profile.languages.includes(language))
    .map(profile => `<option value="${escapeHTML(profile.id)}"${profile.id === selectedId ? ' selected' : ''}>${escapeHTML(profile.id)}</option>`).join('');
  const statusText = message => {
    statusMessage = message;
    const node = root.querySelector('[data-status]');
    if (node) node.textContent = message;
    report(message);
  };
  const persist = async next => {
    if (!hydrated || stateError) throw Error(stateError || 'Narration storage is still being validated.');
    if (blocked) throw Error('Narration actions are paused during scored practice.');
    await validateState(next);
    storage.setItem(STATE_KEY, JSON.stringify(next));
    state = next;
  };
  const sceneLabel = () => context ? `${context.title} · level ${context.level} · ${context.sceneId} (${context.sceneVersion})` : 'No scene selected';
  const currentAuthor = () => {
    const address = getAddress?.();
    return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address) ? address : state.localAuthorId;
  };
  const contributionById = id => state.contributions.find(record => record.id === id);

  function recordCard(record) {
    const result = reviewStatus(record), votes = record.review.votes.filter(vote => !vote.revoked);
    const panel = record.review.panel.length === 3 ? record.review.panel.map(profile => escapeHTML(profile.id)).join(' · ') : 'Not assigned';
    const voteRows = votes.map(vote => `${escapeHTML(vote.reviewerId)}: ${vote.decision}${vote.signature ? ' · signature present, not verified' : ' · local unsigned'}`).join('<br>');
    const canReview = result.status === 'in-review' && record.review.panel.length === 3;
    const reviewerSelect = profileOptions(record.language, '', record.review.panel);
    return `<article class="narration-item">
      <h3>${record.publication.state === 'local' ? 'Local draft · ' : ''}${escapeHTML(record.scene.title)} · ${escapeHTML(LANGUAGE_NAMES[record.language] || record.language)}</h3>
      <p>${escapeHTML(record.credit)} · ${record.turns.length} turn${record.turns.length === 1 ? '' : 's'} · SHA-256 ${escapeHTML(record.audio.sha256.slice(0, 16))}…</p>
      <p>Scene version ${escapeHTML(record.scene.sceneVersion)} · ${escapeHTML(record.versionHash.slice(0, 16))}…</p>
      <p>Review: ${result.approvals}/2 approvals · ${escapeHTML(result.status)} · funded authorization: unavailable</p>
      <p>Panel: ${panel}${votes.length ? `<br>${voteRows}` : ''}</p>
      ${record.review.history.length ? `<p>Audit notes: ${record.review.history.map(entry => escapeHTML(entry.action)).join(' · ')}</p>` : ''}
      ${record.review.panel.length !== 3 ? `<fieldset><legend>Assign exactly three local reviewers</legend>
        ${state.profiles.filter(profile => profile.languages.includes(record.language) && profile.id.toLowerCase() !== record.authorId.toLowerCase())
          .map(profile => `<label><input type="checkbox" data-panel="${escapeHTML(record.id)}" value="${escapeHTML(profile.id)}">${escapeHTML(profile.id)}</label>`).join('') || '<p>No eligible local reviewer profiles yet.</p>'}
        <button data-assign="${escapeHTML(record.id)}">Assign 3-person panel</button></fieldset>` : ''}
      ${record.audio.cid ? `<p>Public audio: ipfs://${escapeHTML(record.audio.cid)}${record.publication.metadataCid ? ` · metadata: ipfs://${escapeHTML(record.publication.metadataCid)}` : ' · metadata upload pending'}</p>` : ''}
      ${canReview ? `<label>Assigned reviewer <select data-reviewer="${escapeHTML(record.id)}">${reviewerSelect}</select></label>
        <label>Correctness note <input data-review-note="${escapeHTML(record.id)}" maxlength="500" placeholder="Optional for approval; required for rejection"></label>
        <button data-vote="approve" data-id="${escapeHTML(record.id)}">Approve locally</button>
        <button data-vote="reject" data-id="${escapeHTML(record.id)}">Reject locally</button>
        <button data-sign="approve" data-id="${escapeHTML(record.id)}">Sign approval</button>` : ''}
      ${votes.length ? `<label>Change reason <input data-change-reason="${escapeHTML(record.id)}" maxlength="300"></label>
        <label>Revoke vote <select data-revoke="${escapeHTML(record.id)}"><option value="">Choose reviewer</option>${votes.map(vote => `<option value="${escapeHTML(vote.reviewerId)}">${escapeHTML(vote.reviewerId)}</option>`).join('')}</select></label>
        <button data-revoke-vote="${escapeHTML(record.id)}">Revoke with reason</button>` : ''}
      ${record.review.panel.length === 3 ? `<details><summary>Replace an assigned reviewer</summary>
        <label>Current reviewer <select data-old-reviewer="${escapeHTML(record.id)}">${record.review.panel.map(profile => `<option value="${escapeHTML(profile.id)}">${escapeHTML(profile.id)}</option>`).join('')}</select></label>
        <label>Eligible replacement <select data-new-reviewer="${escapeHTML(record.id)}">${state.profiles.filter(profile => profile.languages.includes(record.language)
          && profile.id.toLowerCase() !== record.authorId.toLowerCase()
          && !record.review.panel.some(assigned => assigned.id.toLowerCase() === profile.id.toLowerCase()))
          .map(profile => `<option value="${escapeHTML(profile.id)}">${escapeHTML(profile.id)}</option>`).join('')}</select></label>
        <label>Replacement reason <input data-replace-reason="${escapeHTML(record.id)}" maxlength="300"></label>
        <button data-replace-reviewer="${escapeHTML(record.id)}">Replace with reason</button></details>` : ''}
      ${result.status === 'local-approved' ? `<button data-listen="${escapeHTML(record.id)}">Use in this device’s learning rotation</button>` : ''}
      ${record.publication.state === 'local' ? `<button data-publish="${escapeHTML(record.id)}">${record.audio.cid ? 'Publish metadata to IPFS' : 'Publish this version to public IPFS'}</button>` : ''}
      <button data-export-record="${escapeHTML(record.id)}">Export review record</button>
    </article>`;
  }

  function render() {
    const activeContext = context;
    const feedbackRecord = selected && contributionById(selected.id);
    const counts = feedbackRecord ? usefulnessCounts(feedbackRecord) : { up: 0, down: 0 };
    const canRate = feedbackRecord && reviewStatus(feedbackRecord).status === 'local-approved'
      && completedListening?.session.versionHash === feedbackRecord.versionHash
      && completedListening.stewardId.toLowerCase() === currentAuthor().toLowerCase()
      && currentAuthor().toLowerCase() !== feedbackRecord.authorId.toLowerCase();
    const currentRating = feedbackRecord?.usefulnessVotes?.find(vote =>
      vote.stewardId.toLowerCase() === currentAuthor().toLowerCase())?.direction;
    root.innerHTML = `<div data-narration-studio><header><p class="eyebrow">NOTICE · NAME · NARRATE</p><h2>Scene narrations</h2>
      <p>Learn a scene, then explain it in your own words. Local reviews can add audio to this device’s practice rotation; they do not authorize Ommm payments or DNFT claims.</p>
      <p><strong>Current scene:</strong> ${escapeHTML(sceneLabel())}</p>
      </header>
      <p>Prototype only · Polygon Ommm ${fundingStatus().polygonReference} is an unverified lead; no Base asset or sponsor pool is configured.</p>
      <p>Review every turn for scene accuracy and understandability; correctness, not popularity, controls local rotation.</p>
      <label>Narration language <select data-language>${languageOptions(sceneLanguage)}</select></label>
      <label>Public speaker credit <input data-credit maxlength="100" placeholder="Name or nickname"></label>
      <button data-record ${blocked || !activeContext || recorder ? 'disabled' : ''}>Record narration</button>
      <button data-mark ${!recorder || blocked ? 'disabled' : ''}>Mark learner pause</button>
      <button data-stop ${!recorder ? 'disabled' : ''}>Stop and save local draft</button>
      <p data-recording>${recorder ? 'Recording on this device · maximum 2 minutes. Mark each response pause.' : 'Recording starts only when you choose Record.'}</p>
      <p data-status role="status">${stateError ? `Saved data unavailable: ${escapeHTML(stateError)}` : blocked ? 'Narration paused during scored practice or saved-data validation.' : escapeHTML(statusMessage || 'Local stages work offline; publishing is always explicit.')}</p>
      <hr><h3>Local review panel</h3>
      <p>Reviewer qualifications here are self-declared and unverified. Local decisions are unsigned unless a reviewer signs; signatures are not verified for funded use.</p>
      <label>Reviewer ID <input data-profile-id maxlength="100" placeholder="Wallet address or local reviewer ID"></label>
      <label>Qualified language <select data-profile-language>${languageOptions(sceneLanguage)}</select></label>
      <label><input data-profile-native type="checkbox"> I speak this language natively (local declaration)</label>
      <button data-add-profile>Add local reviewer profile</button>
      <ul>${state.profiles.map(profile => `<li>${escapeHTML(profile.id)} · ${profile.languages.map(tag => escapeHTML(LANGUAGE_NAMES[tag] || tag)).join(', ')} · local, unverified</li>`).join('')}</ul>
      <details><summary>Import or export local review records</summary>
        <label>Import JSON review record <input data-import type="file" accept="application/json,.json"></label>
        <button data-export-all>Export local records</button></details>
      <hr><h3>Local drafts</h3>${state.contributions.filter(record => record.publication.state === 'local').map(recordCard).join('') || '<p>No local recordings yet.</p>'}
      <hr><h3>Published or reviewed recordings</h3>${state.contributions.filter(record => record.publication.state === 'published').map(recordCard).join('') || '<p>Nothing is in rotation yet. No reviewer or recording is pre-approved.</p>'}</div>
      <section data-native-room aria-label="Qualified narration listening"></section>`;
    room = root.querySelector('[data-native-room]');
    room.innerHTML = `<h2>Listen · pause · answer</h2>
      <p>Reviewed narration stays tied to the exact scene version. Learner pauses and typed responses are required for local per-play accrual; interruptions do not count.</p>
      <p>Balances are provisional local units only. No Ommm transfer, on-chain payment, or NFT claim is available.</p>
      <p data-room-status>${blocked ? 'Conversation is paused.' : activeContext ? 'Finding a locally reviewed narration for this exact scene…' : 'Choose a scene outside scored practice.'}</p>
      ${selected && !blocked ? `<article class="narration-item"><h3>${escapeHTML(selected.credit)} · ${escapeHTML(selected.scene.title)}</h3>
        <p>Local review 2/3 · this device only · ${selected.turns.length} turns</p>
        <p data-turn-prompt>${escapeHTML(selected.turns[turnIndex]?.prompt || 'Scene complete')}</p>
        <button data-play-turn ${player ? 'disabled' : ''}>${playedSegment ? 'Replay this turn' : 'Play native turn'}</button>
        <button data-stop-play ${!playback && !playedSegment ? 'disabled' : ''}>Stop / interrupt</button>
        <label>Your typed response <textarea data-response maxlength="2000" ${!playedSegment || playedSegment.turnIndex !== turnIndex ? 'disabled' : ''}></textarea></label>
        <button data-next-turn ${!playedSegment || playedSegment.turnIndex !== turnIndex || !playedSegment.completed ? 'disabled' : ''}>${turnIndex === selected.turns.length - 1 ? 'Complete listening' : 'Next turn'}</button>
        <p>Turn ${turnIndex + 1} of ${selected.turns.length} · listens are not proof of human attention.</p>
        <p data-usefulness-counts>Usefulness: ${counts.up} up · ${counts.down} down${currentRating ? ` · your vote: ${currentRating}` : ''}. Local feedback only; not correctness or payment authority.</p>
        ${canRate ? `<button data-usefulness="up" aria-pressed="${currentRating === 'up'}">Useful · up</button>
          <button data-usefulness="down" aria-pressed="${currentRating === 'down'}">Not useful · down</button>
          <p>One editable vote per local steward for this exact narration version.</p>` : '<p>Complete listening and responses to rate usefulness. Authors cannot rate their own narration.</p>'}
        </article>` : ''}
      <h3>Your provisional earnings</h3>
      <p>${Object.values(state.ledger.balances).map(balance => `${escapeHTML(balance.payeeId)} · ${escapeHTML(balance.pendingUnits)} provisional units pending`).join('<br>') || 'No qualified local plays yet.'}</p>
      <p>Confirmed payments: 0 · ${escapeHTML(fundingStatus().reason)}</p>
      <ul>${localMilestones(state.ledger).map(item => `<li>${item.reached ? '✓' : '·'} ${escapeHTML(item.label)} · ${escapeHTML(item.claimState)}</li>`).join('')}</ul>`;
    room.hidden = blocked || !activeContext;
  }

  async function syncAudio() {
    const rotation = localPracticeRotation(state.contributions, sceneLanguage, context || { sceneId: '', sceneVersion: '' });
    const loaded = [];
    for (const record of rotation) {
      const localBlob = await draftDB('get', `audio:${record.id}`);
      loaded.push(localBlob ? { ...record, localBlob } : record);
    }
    await audio?.setNarrations?.(loaded);
    await chooseNarration();
  }

  async function chooseNarration() {
    const generation = ++contextGeneration;
    selected = null; turnIndex = 0; playback = null; playedSegment = null; completedListening = null;
    if (!context || blocked || !audio?.selectNarration) { render(); return; }
    const choice = await audio.selectNarration(sceneLanguage, context);
    if (generation !== contextGeneration || blocked) return;
    selected = choice;
    render();
  }

  function refreshContext() {
    const latest = contextFor(getSceneContext);
    context = latest;
    if (latest?.language && languages.some(item => item.tag === latest.language)) sceneLanguage = latest.language;
    if (!latest || blocked || !hydrated) {
      selected = null;
      contextGeneration++;
      render();
      return;
    }
    void syncAudio().catch(error => statusText(`Narration selection unavailable: ${error.message}`));
    render();
  }

  function abortPlayback() {
    completedListening = null;
    playback = null;
    playedSegment = null;
    player = null;
    audio?.stopNarration?.();
    contextGeneration++;
  }

  function setBlocked(value) {
    parentBlocked = Boolean(value);
    blocked = parentBlocked || Boolean(stateError) || !hydrated;
    if (blocked) {
      discardCapture = true;
      abortPlayback();
      if (recorder?.state === 'recording') recorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      selected = null;
    } else refreshContext();
    render();
  }

  async function startCapture() {
    if (blocked) throw Error('Narration is paused during scored practice.');
    const current = contextFor(getSceneContext);
    if (!current) throw Error('Choose a scene outside scored practice.');
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw Error('Microphone recording is unavailable in this browser.');
    const language = root.querySelector('[data-language]').value;
    const scene = await sceneSnapshot(current, language);
    const credit = root.querySelector('[data-credit]').value.trim();
    if (!credit || credit.length > 100) throw Error('Enter a short public speaker credit before recording.');
    const id = randomId(), authorId = currentAuthor(), startingWalletGeneration = walletGeneration;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const currentContext = contextFor(getSceneContext);
    const currentScene = currentContext ? await sceneSnapshot(currentContext, language) : null;
    if (blocked || !root.isConnected || startingWalletGeneration !== walletGeneration
      || authorId.toLowerCase() !== currentAuthor().toLowerCase() || currentScene?.sceneHash !== scene.sceneHash) {
      stream.getTracks().forEach(track => track.stop()); stream = null;
      throw Error('Scene or wallet changed before recording started; no narration was captured.');
    }
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
    if (!type) { stream.getTracks().forEach(track => track.stop()); stream = null; throw Error('No supported narration recording format.'); }
    const chunks = [];
    recordingContext = { id, language, level: scene.level, scene, authorId, credit, chunks, type: type.split(';')[0], pauseMarks: [] };
    discardCapture = false;
    try {
      recorder = new MediaRecorder(stream, { mimeType: type });
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
        if (chunks.reduce((total, chunk) => total + chunk.size, 0) > MAX_AUDIO_BYTES && recorder?.state === 'recording') recorder.stop();
      };
      recorder.onerror = () => { discardCapture = true; statusText('Recording failed; no draft was saved.'); };
      recorder.onstop = () => { void finishCapture(); };
      recordStartedAt = performance.now();
      recorder.start(250);
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      stream = null; recorder = null; recordingContext = null;
      throw Error(`Narration recording could not start: ${error.message}`);
    }
    render();
    statusText('Recording locally · maximum 2 minutes. Mark each learner-response pause.');
    const activeRecorder = recorder;
    clearTimeout(recordTimer);
    recordTimer = setTimeout(() => { if (activeRecorder.state === 'recording') activeRecorder.stop(); }, MAX_SECONDS * 1000);
  }

  async function finishCapture() {
    const capture = recordingContext;
    const wasDiscarded = discardCapture;
    clearTimeout(recordTimer);
    recordTimer = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null; recorder = null; recordingContext = null; discardCapture = false;
    if (!capture || wasDiscarded) { render(); return; }
    const duration = Math.min(MAX_SECONDS, (performance.now() - recordStartedAt) / 1000);
    const blob = new Blob(capture.chunks, { type: capture.type });
    if (!blob.size || blob.size > MAX_AUDIO_BYTES || duration < 1) {
      render(); statusText('Record between 1 second and 2 minutes, up to 4 MiB.'); return;
    }
    const boundaries = [0, ...capture.pauseMarks, duration];
    const turns = boundaries.slice(0, -1).map((start, index) => ({
      start, end: boundaries[index + 1], prompt: 'What do you notice?', concept: capture.scene.concepts[index % capture.scene.concepts.length]
    }));
    try {
      const sha256 = await digest(blob);
      const record = await createContribution({
        id: capture.id, language: capture.language, level: capture.level, scene: capture.scene,
        authorId: capture.authorId, credit: capture.credit,
        audio: { cid: '', sha256, size: blob.size, duration, type: capture.type }, turns
      });
      await draftDB('put', `audio:${record.id}`, blob);
      const next = structuredClone(state);
      next.contributions.push(record);
      await persist(next);
      await syncAudio();
      statusText('Local draft saved. Review assignment and publishing are separate choices.');
    } catch (error) { statusText(`Draft was not saved: ${error.message}`); }
    render();
  }

  async function publish(id) {
    let record = contributionById(id);
    if (!record || record.publication.state !== 'local') throw Error('Only a local narration version can be published.');
    if (!record.audio.cid) {
      const blob = await draftDB('get', `audio:${record.id}`);
      if (!(blob instanceof Blob) || blob.size !== record.audio.size || await digest(blob) !== record.audio.sha256) {
        throw Error('Local audio is missing or changed; no upload was started.');
      }
      const audioReceipt = await ipfs.upload(blob, `dlang-narration-${record.language}-${record.id}.${record.audio.type.split('/')[1]}`);
      if (audioReceipt.sha256 !== record.audio.sha256) throw Error('Uploaded audio hash differs from the local recording.');
      const prepared = await preparePublishedContribution(record, audioReceipt.cid, randomId());
      const next = structuredClone(state);
      next.contributions.push(prepared);
      await persist(next);
      record = prepared;
    }
    let prepared = record;
    const metadata = {
      schemaVersion: prepared.schemaVersion, id: prepared.id, language: prepared.language,
      level: prepared.level, scene: prepared.scene, authorId: prepared.authorId, credit: prepared.credit,
      audio: prepared.audio, turns: prepared.turns, createdAt: prepared.createdAt, versionHash: prepared.versionHash
    };
    const metadataReceipt = await ipfs.upload(new Blob([JSON.stringify(metadata)], { type: 'application/json' }), `dlang-narration-${record.id}.json`);
    prepared = await markContributionPublished(prepared, metadataReceipt.cid);
    const next = structuredClone(state), index = next.contributions.findIndex(item => item.id === record.id);
    next.contributions[index] = prepared;
    await persist(next);
    await syncAudio();
    statusText(`Published audio and immutable scene metadata. Public IPFS content is not a review or payment authorization.`);
  }

  async function vote(id, decision, signed = false) {
    const record = contributionById(id);
    if (!record) throw Error('Narration record no longer exists.');
    const select = root.querySelector(`[data-reviewer="${CSS.escape(id)}"]`);
    const reviewerId = select?.value || '';
    const language = record.language;
    const reason = root.querySelector(`[data-review-note="${CSS.escape(id)}"]`)?.value || '';
    let signature = '';
    if (signed) {
      if (!getWallet) throw Error('Wallet signing is not configured.');
      const startedGeneration = walletGeneration, wallet = await getWallet();
      const address = String(wallet?.address || '');
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || reviewerId.toLowerCase() !== address.toLowerCase()) {
        throw Error('Connect the assigned reviewer wallet to sign this version.');
      }
      const message = [
        'DLang native narration review · local prototype',
        `Narration: ${record.id}`,
        `Version: ${record.versionHash}`,
        `Language: ${record.language}`,
        `Reviewer: ${address.toLowerCase()}`,
        `Decision: ${decision}`,
        `Scene: ${record.scene.sceneHash}`
      ].join('\n');
      signature = await wallet.signer.signMessage(message);
      if (startedGeneration !== walletGeneration || String(getAddress?.() || '').toLowerCase() !== address.toLowerCase()) {
        throw Error('Wallet changed while signing; the vote was not recorded.');
      }
    }
    const updated = await castLocalVote(record, { reviewerId, language, decision, reason, versionHash: record.versionHash, signature });
    const next = structuredClone(state);
    next.contributions[next.contributions.findIndex(item => item.id === id)] = updated;
    await persist(next);
    await syncAudio();
    statusText(signed ? 'Signature stored locally, not verified by a registry or contract.' : 'Local review saved; it affects this device’s learning rotation only.');
  }

  async function playTurn() {
    if (!selected || blocked || player) return;
    completedListening = null;
    const contribution = selected, index = turnIndex;
    if (!playback) playback = { playId: randomId(), contributionId: contribution.id, versionHash: contribution.versionHash, audioHash: contribution.audio.sha256, events: [], userInitiated: true, muted: false, autoplay: false, interrupted: false };
    if (playback.interrupted || playback.contributionId !== contribution.id) throw Error('Start a new listening session for this narration.');
    const playId = playback.playId;
    try {
      const active = await audio.playNarrationTurn(contribution, index);
      player = active.audio;
      await active.done;
      if (blocked || !playback || playback.playId !== playId) return;
      playedSegment = { turnIndex: index, completed: true };
      playback.events[index] = { turnIndex: index, completed: true, response: '' };
      player = null;
      render();
    } catch (error) {
      if (playback?.playId === playId) {
        playback = null; playedSegment = null; player = null;
        audio?.stopNarration?.();
        statusText(`Narration interrupted; this play will not accrue: ${error.message}`);
        render();
      }
    }
  }

  async function completeTurn() {
    if (!selected || !playedSegment || playedSegment.turnIndex !== turnIndex) throw Error('Play the complete native turn before responding.');
    const response = room.querySelector('[data-response]').value.trim();
    if (!response) throw Error('Type a short response before continuing.');
    if (!playback || playback.contributionId !== selected.id) throw Error('Start this narration from its first turn.');
    playback.events[turnIndex] = { turnIndex, completed: true, response };
    playedSegment = null;
    if (turnIndex + 1 < selected.turns.length) {
      turnIndex++;
      render();
      return;
    }
    const session = {
      ...playback, turns: selected.turns.map((_, index) => playback.events[index]),
      interrupted: false, userInitiated: true, muted: player?.muted === true, autoplay: false
    };
    qualifyPlayback(selected, session);
    const result = await accrueQualifiedPlay(state.ledger, selected, session, { rateUnits: EARNING_RATE });
    if (result.duplicate) throw Error('This playback receipt was already accrued.');
    const next = structuredClone(state);
    next.ledger = result.ledger;
    await persist(next);
    completedListening = { session, stewardId: currentAuthor() };
    playback = null;
    render();
    statusText('Qualified local play accrued 1 provisional unit. It is not an Ommm payment.');
  }

  function download(name, value) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  root.addEventListener('change', event => {
    if (event.target.matches('[data-language]')) {
      sceneLanguage = event.target.value;
      selected = null;
      abortPlayback();
      void syncAudio().catch(error => statusText(error.message));
      render();
    }
    if (event.target.matches('[data-import]')) void importBundle(event.target.files?.[0]);
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const run = async action => {
      try { await action(); }
      catch (error) { statusText(error.message); }
      render();
    };
    if (button.matches('[data-record]')) void run(startCapture);
    if (button.matches('[data-mark]')) {
      if (recorder?.state !== 'recording') return;
      const mark = (performance.now() - recordStartedAt) / 1000;
      if (recordingContext.pauseMarks.length >= 19 || mark - (recordingContext.pauseMarks.at(-1) || 0) < .3) { statusText('Pause marks must be at least 0.3 seconds apart, up to 20 turns.'); return; }
      recordingContext.pauseMarks.push(mark);
      statusText(`Learner pause marked at ${mark.toFixed(1)} seconds.`);
      render();
    }
    if (button.matches('[data-stop]') && recorder?.state === 'recording') recorder.stop();
    if (button.matches('[data-add-profile]')) void run(async () => {
      const id = root.querySelector('[data-profile-id]').value.trim();
      const language = root.querySelector('[data-profile-language]').value;
      if (!root.querySelector('[data-profile-native]').checked) throw Error('Confirm the local native-speaker declaration first.');
      const profile = validateReviewerProfile({ id, languages: [language], nativeSpeaker: true });
      if (state.profiles.some(item => item.id.toLowerCase() === profile.id.toLowerCase())) throw Error('Reviewer profile already exists.');
      const next = structuredClone(state); next.profiles.push(profile); await persist(next);
      statusText('Local reviewer profile saved. Qualification is unverified.');
    });
    if (button.matches('[data-assign]')) void run(async () => {
      const id = button.dataset.assign;
      const draft = contributionById(id);
      const panel = [...root.querySelectorAll(`[data-panel="${CSS.escape(id)}"]:checked`)].map(input => input.value);
      const nextRecord = await assignReviewPanel(draft, panel, state.profiles);
      const next = structuredClone(state); next.contributions[next.contributions.findIndex(item => item.id === id)] = nextRecord;
      await persist(next); statusText('Three local language-qualified reviewers assigned. No eligibility registry was checked.');
    });
    if (button.matches('[data-vote]')) void run(() => vote(button.dataset.id, button.dataset.vote));
    if (button.matches('[data-sign]')) void run(() => vote(button.dataset.id, button.dataset.sign, true));
    if (button.matches('[data-publish]')) void run(() => publish(button.dataset.publish));
    if (button.matches('[data-listen]')) {
      const record = contributionById(button.dataset.listen);
      if (!record || !context || record.scene.sceneId !== context.sceneId || record.scene.sceneVersion !== context.sceneVersion) {
        statusText('This narration belongs to a different scene version; it will not enter the current rotation.'); return;
      }
      selected = record; turnIndex = 0; playback = null; playedSegment = null;
      void syncAudio().catch(error => statusText(error.message));
      render();
    }
    if (button.matches('[data-revoke-vote]')) void run(async () => {
      const id = button.dataset.revokeVote, reviewerId = root.querySelector(`[data-revoke="${CSS.escape(id)}"]`).value;
      const reason = root.querySelector(`[data-change-reason="${CSS.escape(id)}"]`).value;
      const record = contributionById(id), updated = await revokeReviewVote(record, reviewerId, reason);
      const next = structuredClone(state); next.contributions[next.contributions.findIndex(item => item.id === id)] = updated;
      await persist(next); statusText('Vote revocation saved with its reason; replace reviewers explicitly if needed.');
    });
    if (button.matches('[data-replace-reviewer]')) void run(async () => {
      const id = button.dataset.replaceReviewer;
      const oldId = root.querySelector(`[data-old-reviewer="${CSS.escape(id)}"]`).value;
      const replacementId = root.querySelector(`[data-new-reviewer="${CSS.escape(id)}"]`).value;
      const reason = root.querySelector(`[data-replace-reason="${CSS.escape(id)}"]`).value;
      const updated = await replaceReviewer(contributionById(id), oldId, replacementId, state.profiles, reason);
      const next = structuredClone(state);
      next.contributions[next.contributions.findIndex(item => item.id === id)] = updated;
      await persist(next); await syncAudio();
      statusText('Reviewer replacement saved with its reason. The replacement must cast a new version-bound vote.');
    });
    if (button.matches('[data-export-record]')) {
      const record = contributionById(button.dataset.exportRecord);
      if (record) download(`dlang-review-${record.id}.json`, { schemaVersion: 1, contribution: record });
    }
    if (button.matches('[data-export-all]')) download('dlang-local-narration-reviews.json', {
      schemaVersion: 1, authority: 'local-only', profiles: state.profiles, contributions: state.contributions
    });
    if (button.matches('[data-play-turn]')) void playTurn();
    if (button.matches('[data-stop-play]')) {
      if (playback) playback.interrupted = true;
      abortPlayback(); render(); statusText('Playback stopped; this session is not qualified.');
    }
    if (button.matches('[data-next-turn]')) void run(completeTurn);
    if (button.matches('[data-usefulness]')) void run(async () => {
      if (!selected || !completedListening || blocked) throw Error('Complete this narration before rating usefulness.');
      const listening = completedListening, stewardId = currentAuthor(), generation = walletGeneration;
      if (listening.stewardId.toLowerCase() !== stewardId.toLowerCase()) throw Error('Steward changed; listen again before voting.');
      const record = contributionById(selected.id);
      const updated = await castUsefulnessVote(record, listening.session, { stewardId, direction: button.dataset.usefulness });
      if (blocked || generation !== walletGeneration || completedListening !== listening) throw Error('Listening context changed; usefulness vote was not saved.');
      const next = structuredClone(state);
      next.contributions[next.contributions.findIndex(item => item.id === record.id)] = updated;
      await persist(next);
      statusText('Local usefulness vote saved. Correctness review and earnings are unchanged.');
    });
  });

  async function importBundle(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { statusText('Review import must be 2 MiB or smaller.'); return; }
    try {
      const bundle = JSON.parse(await file.text());
      const entries = bundle?.contributions || (bundle?.contribution ? [bundle.contribution] : null);
      if (bundle?.schemaVersion !== 1 || !Array.isArray(entries)) throw Error('Review file must contain schemaVersion 1 and a contribution or contributions list.');
      const imported = [];
      for (const record of entries) {
        await validateContribution(record);
        imported.push(record);
      }
      const next = structuredClone(state);
      for (const record of imported) {
        const index = next.contributions.findIndex(existing => existing.id === record.id);
        if (index >= 0 && next.contributions[index].versionHash !== record.versionHash) throw Error('Import conflicts with a different immutable version.');
        if (index >= 0) next.contributions[index] = record;
        else next.contributions.push(record);
      }
      await persist(next);
      await syncAudio();
      statusText('Imported records remain local-only; signatures and reviewer qualifications were not verified.');
    } catch (error) { statusText(`Import refused: ${error.message}`); }
  }

  function onWallet(event) {
    walletGeneration++;
    completedListening = null;
    const address = event.detail?.address || '';
    if (recorder?.state === 'recording' && recordingContext?.authorId.toLowerCase() !== String(address).toLowerCase()) {
      discardCapture = true;
      recorder.stop();
    }
    if (playback && address.toLowerCase() !== String(getAddress?.() || '').toLowerCase()) abortPlayback();
    render();
  }
  window.addEventListener('dlang:wallet', onWallet);
  window.addEventListener('dlang:scene', refreshContext);
  window.addEventListener('pagehide', () => {
    clearTimeout(recordTimer);
    discardCapture = true;
    if (recorder?.state === 'recording') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    abortPlayback();
  });
  void validateState(state).then(() => {
    hydrated = true;
    blocked = parentBlocked || Boolean(stateError);
    refreshContext();
    render();
  }).catch(error => {
    stateError = error.message;
    blocked = true;
    report(`Saved narration data is invalid: ${error.message}`);
    render();
  });
  refreshContext();

  return {
    setBlocked,
    refreshContext,
    selectNarration: () => selected,
    async replaceAssignedReviewer(contributionId, oldId, replacementId, reason) {
      const record = contributionById(contributionId);
      const updated = await replaceReviewer(record, oldId, replacementId, state.profiles, reason);
      const next = structuredClone(state); next.contributions[next.contributions.findIndex(item => item.id === contributionId)] = updated;
      await persist(next); await syncAudio(); render();
    },
    getStatus: () => ({
      blocked, captureActive: recorder?.state === 'recording', selectedVersion: selected?.versionHash || '',
      funding: fundingStatus(), fundedAuthorized: canAuthorizeFundedPayment()
    })
  };
}
