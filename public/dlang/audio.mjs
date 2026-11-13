import { PACKS, LANGUAGE_NAMES } from './packs.mjs';
import { cid, digest } from './storage.mjs';
import { reviewStatus, sceneSnapshot, validateContribution } from './steward.mjs';
import { nextCommunityWord, validateWordPayload } from './community-words.mjs';
export const MAX_VOICE_BYTES = 1024 * 1024;
export const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'];
export async function nextReviewedNarration(records, language, sceneContext, previousId = '') {
  const snapshot = await sceneSnapshot(sceneContext, language), matches = [];
  for (const record of records) {
    await validateContribution(record);
    if (record.language === language && record.scene.sceneId === snapshot.sceneId
      && record.scene.sceneVersion === snapshot.sceneVersion && record.scene.sceneHash === snapshot.sceneHash
      && reviewStatus(record).status === 'local-approved') matches.push(record);
  }
  if (!matches.length) return null;
  const index = matches.findIndex(record => record.id === previousId);
  return matches[(index + 1) % matches.length];
}
export function validateVoice(entry) {
  if (!entry || entry.version !== 1 || !PACKS[entry.language]?.[entry.concept] || typeof entry.speaker !== 'string'
    || !entry.speaker.trim() || entry.speaker.length > 60 || entry.license !== 'CC-BY-4.0'
    || !VOICE_TYPES.includes(entry.type) || !Number.isFinite(entry.duration) || entry.duration <= 0 || entry.duration > 15
    || !Number.isInteger(entry.size) || entry.size < 1 || entry.size > MAX_VOICE_BYTES
    || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.nativeSpeakerDeclared !== 'boolean') throw Error('Invalid voice contribution.');
  cid(entry.cid);
  return entry;
}
export function validateVoices(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.voices) || manifest.voices.length > 5000) throw Error('Voice library invalid.');
  const seen = new Set();
  for (const voice of manifest.voices) {
    validateVoice(voice);
    if (voice.approved !== true || !voice.reviewedBy || !Number.isFinite(Date.parse(voice.reviewedAt)) || seen.has(voice.cid)) throw Error('Voice has no unique steward approval.');
    seen.add(voice.cid);
  }
  return manifest.voices;
}
export function nextVoice(voices, language, concept, previous = '') {
  const matches = voices.filter(voice => voice.language === language && voice.concept === concept);
  if (!matches.length) return null;
  return matches[(matches.findIndex(voice => voice.cid === previous) + 1) % matches.length];
}

export function createNarrationTurnPlayer({ load, AudioConstructor = globalThis.Audio, createURL = blob => URL.createObjectURL(blob), revokeURL = url => URL.revokeObjectURL(url) }) {
  let generation = 0, player = null, mediaURL = null, cancelActive = null;
  function stop() {
    generation++;
    player?.pause();
    cancelActive?.(Error('Narration playback stopped.'));
    cancelActive = null;
    if (mediaURL) revokeURL(mediaURL);
    mediaURL = null;
    player = null;
  }
  async function play(record, index, prepare = () => load(record)) {
    stop();
    const request = generation;
    const blob = await prepare();
    if (request !== generation) throw Error('Narration playback was cancelled before it started.');
    const turn = record.turns[index];
    if (!turn || typeof AudioConstructor !== 'function') throw Error('Narration turn is unavailable in this browser.');
    const ownGeneration = generation;
    mediaURL = createURL(blob);
    player = new AudioConstructor(mediaURL);
    const element = player;
    let startResolve, startReject, doneResolve, doneReject, finished = false;
    const started = new Promise((resolve, reject) => { startResolve = resolve; startReject = reject; });
    const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
    void done.catch(() => {});
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onReady);
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('error', onError);
      if (cancelActive === cancel) cancelActive = null;
    };
    const fail = error => {
      if (finished) return;
      finished = true; cleanup(); startReject(error); doneReject(error);
    };
    const complete = () => {
      if (finished) return;
      finished = true; cleanup(); doneResolve({ completed: true });
    };
    const cancel = error => fail(error);
    const onReady = async () => {
      try {
        if (ownGeneration !== generation || !Number.isFinite(element.duration) || turn.end > element.duration + .3) {
          throw Error('Narration turn marks exceed the decoded audio duration.');
        }
        element.currentTime = turn.start;
        await element.play();
        if (ownGeneration !== generation || finished) throw Error('Narration playback was cancelled.');
        if (element.muted) throw Error('Muted narration cannot qualify as a local play.');
        startResolve(element);
      } catch (error) { fail(error); }
    };
    const onTime = () => {
      if (element.currentTime + .025 >= turn.end) {
        element.pause();
        complete();
      }
    };
    const onEnded = () => complete();
    const onPause = () => { if (!finished && element.currentTime + .025 < turn.end) fail(Error('Narration was paused or interrupted.')); };
    const onError = () => fail(Error('Narration audio could not be decoded.'));
    cancelActive = cancel;
    element.addEventListener('loadedmetadata', onReady, { once: true });
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('ended', onEnded, { once: true });
    element.addEventListener('pause', onPause);
    element.addEventListener('error', onError, { once: true });
    await started;
    if (ownGeneration !== generation) throw Error('Narration playback was cancelled.');
    return { audio: element, done };
  }
  return { play, stop, get audio() { return player; } };
}

function drafts() {
  const request = indexedDB.open('dlang-voice-drafts', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts');
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(Error('Local voice storage unavailable.'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function draft(action, key, value) {
  const db = await drafts();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', action === 'get' ? 'readonly' : 'readwrite');
    const request = tx.objectStore('drafts')[action](...(action === 'put' ? [value, key] : [key]));
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(Error('Voice draft could not be saved/read.')); tx.onabort = tx.onerror;
  }); } finally { db.close(); }
}
export function mountAudio({ ipfs, openDialog, words = null, getSceneContext = () => null, getBlocked: externallyBlocked = () => false }) {
  const $ = id => document.getElementById(id);
  let privateAudio = false;
  const getBlocked = () => externallyBlocked() || privateAudio;
  let voices = [], narrations = [], language = 'en', concept = 'chair', recorder, stream, chunks = [], recordingAt, timer, selected, recordingContext, player, mediaURL, generation = 0, draftGeneration = 0, turnPlayer;
  const previous = new Map();
  const narrationPrevious = new Map();
  let community = [], communityReady = false, heard = null, wordContext = null;
  const communityPrevious = new Map();
  async function refreshCommunity() {
    if (!words) throw Error('Shared WORD service is not configured. Your recording remains a local draft.');
    const result = await words.list();
    if (result.version !== 1 || result.persistence !== 'operator-store' || !Array.isArray(result.records)) throw Error('Shared WORD persistence is unavailable.');
    for (const record of result.records) await validateWordPayload(record.payload);
    community = result.records; communityReady = true;
    return result;
  }
  async function openWord(tag = language, id = concept, context = null) {
    if (getBlocked()) { status('Word contributions are unavailable during scored practice or private audio.'); return; }
    language = tag; concept = id;
    $('voice-consent').checked = false;
    const raw = context || heard?.scene || getSceneContext();
    wordContext = raw ? { ...raw, sceneVersion: String(raw.sceneVersion), title: raw.title || raw.scene?.title } : null;
    openDialog('voice-dialog');
    await loadDraft();
    try { await refreshCommunity(); status('Whitelisted pilot: public word recordings play immediately, visibly unreviewed.'); }
    catch (error) { communityReady = false; status(error.message); }
    updateFeedback();
  }
  function updateFeedback() {
    const record = heard?.source === 'community-word' && heard?.language === language && heard?.concept === concept ? heard.record : null;
    for (const id of ['voice-up', 'voice-down', 'voice-review-approve', 'voice-review-reject']) {
      if ($(id)) $(id).disabled = !record || !communityReady || getBlocked();
    }
    if ($('voice-heard')) $('voice-heard').textContent = record
      ? `${record.payload.voice.speaker} · ${record.payload.profile.dialect} · ${record.review.status} · native status self-declared: ${record.payload.profile.nativeSpeakerDeclared ? 'yes' : 'no'}`
      : 'No community word recording selected. Device voices cannot receive community thumbs.';
    if ($('voice-flag')) $('voice-flag').disabled = !wordContext || !communityReady || getBlocked();
  }
  async function submitWordAction(action, payload) {
    if (getBlocked()) throw Error('Word contributions are unavailable during scored practice or private audio.');
    if (!words || !communityReady) throw Error('Shared WORD persistence is unavailable. Nothing was submitted.');
    const result = await words.mutate(action, payload);
    community = result.records;
    if (heard?.record) heard.record = community.find(record => record.id === heard.record.id) || heard.record;
    updateFeedback();
    return result;
  }
  const key = () => `${language}:${concept}`;
  const status = text => { $('audio-status').textContent = text; $('voice-status').textContent = text; };
  const labels = () => {
    $('voice-language').value = language; $('voice-concept').value = concept;
    $('voice-title').textContent = `${PACKS[language][concept].label} · ${LANGUAGE_NAMES[language]}`;
  };
  $('voice-language').replaceChildren(...Object.keys(PACKS).map(tag => new Option(LANGUAGE_NAMES[tag], tag)));
  $('voice-concept').replaceChildren(...Object.keys(PACKS.en).map(id => new Option(id, id)));
  async function loadDraft() {
    labels(); selected = null; $('voice-publish').disabled = true; $('voice-preview').disabled = true;
    const expected = key(), current = ++draftGeneration;
    try { const saved = await draft('get', expected), profile = await draft('get', `profile:${language}`);
      if (key() !== expected || current !== draftGeneration) return; selected = saved;
      if (profile) {
        $('voice-speaker').value = profile.speaker;
        $('voice-dialect').value = profile.dialect;
        $('voice-native').checked = profile.nativeSpeakerDeclared;
      }
      $('voice-preview').disabled = !saved; $('voice-publish').disabled = !saved;
      if (saved) status('Your local draft is ready. It has not been shared.'); }
    catch (error) { status(error.message); }
  }
  function stopPlayer() {
    generation++; player?.pause(); globalThis.speechSynthesis?.cancel();
    turnPlayer?.stop();
    if (mediaURL) URL.revokeObjectURL(mediaURL); mediaURL = null;
  }
  async function playBlob(blob) {
    if (getBlocked() || recorder?.state === 'recording') throw Error('Playback disabled during scored practice, private audio or recording.');
    window.dispatchEvent(new Event('dlang:audio-start'));
    stopPlayer();
    const ownGeneration = generation;
    mediaURL = URL.createObjectURL(blob); player = new Audio(mediaURL);
    const currentPlayer = player;
    currentPlayer.onerror = () => status('This audio cannot be decoded. Try a different voice or record an example.');
    await currentPlayer.play();
    if (ownGeneration !== generation) {
      currentPlayer.pause();
      throw Error('Audio playback was cancelled.');
    }
  }
  async function narrationBlob(record) {
    const blob = record.localBlob instanceof Blob ? record.localBlob : await ipfs.read(cid(record.audio.cid), 2 * 1024 * 1024);
    if (blob.size !== record.audio.size || await digest(blob) !== record.audio.sha256) {
      throw Error('Narration audio does not match its immutable scene record.');
    }
    return new Blob([blob], { type: record.audio.type });
  }
  turnPlayer = createNarrationTurnPlayer({
    load: narrationBlob,
    AudioConstructor: globalThis.Audio
  });
  async function setNarrations(records) {
    if (!Array.isArray(records) || records.length > 5000) throw Error('Narration rotation is invalid.');
    const checked = [];
    for (const record of records) {
      await validateContribution(record);
      if (reviewStatus(record).status !== 'local-approved') continue;
      if (!record.audio.cid && !(record.localBlob instanceof Blob)) continue;
      checked.push(record);
    }
    narrations = checked;
    return narrations.length;
  }
  async function selectNarration(tag, sceneContext) {
    const snapshot = await sceneSnapshot(sceneContext, tag), key = `${tag}:${snapshot.sceneHash}`;
    const previousId = narrationPrevious.get(key);
    const selectedNarration = await nextReviewedNarration(narrations, tag, sceneContext, previousId);
    if (!selectedNarration) return null;
    narrationPrevious.set(key, selectedNarration.id);
    return selectedNarration;
  }
  async function playNarrationTurn(record, index) {
    if (getBlocked() || recorder?.state === 'recording') throw Error('Narration unavailable during scored practice, private audio or recording.');
    window.dispatchEvent(new Event('dlang:audio-start'));
    stopPlayer();
    return turnPlayer.play(record, index, async () => {
      await validateContribution(record);
      if (reviewStatus(record).status !== 'local-approved' || !Number.isInteger(index) || !record.turns[index]) {
        throw Error('Narration turn is not in the local reviewed rotation.');
      }
      return narrationBlob(record);
    });
  }
  async function play(tag, id, sceneContext = null, wordScene = null) {
    if (getBlocked() || recorder?.state === 'recording') { stopPlayer(); return; }
    window.dispatchEvent(new Event('dlang:audio-start'));
    if (language !== tag || concept !== id) { selected = null; draftGeneration++; $('voice-publish').disabled = true; $('voice-preview').disabled = true; }
    language = tag; concept = id; labels(); stopPlayer();
    const current = generation, entry = PACKS[tag]?.[id];
    heard = { language: tag, concept: id, scene: wordScene || sceneContext || getSceneContext(), source: 'unavailable', recordId: '' };
    let narrationError = '', communityError = '';
    if (sceneContext) {
      try {
        const narration = await selectNarration(tag, sceneContext);
        if (narration) {
          const blob = await narrationBlob(narration);
          if (current !== generation) return;
          await playBlob(blob);
          status(`${narration.credit} · reviewed scene narration · local review only, not payment authority.`);
          return { source: 'local-reviewed-narration', narration };
        }
      } catch (error) {
        if (current !== generation) return;
        narrationError = error.message;
        status(`Scene narration unavailable: ${narrationError} Trying word audio instead.`);
      }
    }
    if (!entry) { status(`Audio is unavailable for this word.${narrationError ? ` Scene narration: ${narrationError}` : ''}`); return; }
    try {
      await refreshCommunity();
      if (current !== generation) return;
      const reviewedLegacy = voices.map(voice => ({ id: voice.cid, authorId: `legacy:${voice.speaker}`,
        payload: { voice, profile: { dialect: 'dialect not declared', nativeSpeakerDeclared: voice.nativeSpeakerDeclared } },
        review: { status: 'approved' }, feedback: [], pilotEligible: true, legacy: true }));
      const selectedWord = nextCommunityWord([...community, ...reviewedLegacy], tag, id, communityPrevious.get(key()));
      if (selectedWord) {
        const voice = selectedWord.payload.voice;
        const blob = await ipfs.read(voice.cid, MAX_VOICE_BYTES);
        if (blob.size !== voice.size || await digest(blob) !== voice.sha256) throw Error('Community word bytes do not match the signed recording.');
        if (current !== generation) return;
        await playBlob(new Blob([blob], { type: voice.type }));
        const last = communityPrevious.get(key());
        communityPrevious.set(key(), { ...selectedWord,
          consecutivePlays: last?.authorId === selectedWord.authorId ? (last.consecutivePlays || 1) + 1 : 1 });
        heard = { ...heard, source: selectedWord.legacy ? 'legacy-recording' : 'community-word', recordId: selectedWord.id, record: selectedWord };
        updateFeedback();
        status(`${voice.speaker} · ${selectedWord.payload.profile.dialect} · ${selectedWord.review.status} pilot recording · ${voice.nativeSpeakerDeclared ? 'native speaker self-declared' : 'learner / non-native self-declared'} · no earnings accrued.`);
        return { source: 'community-word', record: selectedWord };
      }
    } catch (error) {
      if (current !== generation) return;
      communityError = error.message;
      status(`Community WORD unavailable: ${error.message} Trying existing word audio.`);
    }
    const voice = nextVoice(voices, tag, id, previous.get(key()));
    if (voice) {
      previous.set(key(), voice.cid);
      status(`Loading ${voice.speaker}…`);
      try {
        const blob = await ipfs.read(voice.cid, MAX_VOICE_BYTES);
        if (await digest(blob) !== voice.sha256 || blob.size !== voice.size) throw Error('Voice content does not match the reviewed recording.');
        if (current !== generation) return;
        await playBlob(new Blob([blob], { type: voice.type }));
        heard = { ...heard, source: 'legacy-recording', recordId: voice.cid };
        status(`${voice.speaker} · reviewed community recording · tap again for another voice.${narrationError ? ` Scene narration unavailable: ${narrationError}` : ''}${communityError ? ` Shared word audio unavailable: ${communityError}` : ''}`);
      } catch (error) { status(`Recording unavailable: ${error.message} You can record a new example.`); }
      return;
    }
    if (!globalThis.speechSynthesis) { status(`No device audio available. Record an example for this word.${narrationError ? ` Scene narration unavailable: ${narrationError}` : ''}`); return; }
    const locale = tag === 'zh-Hans' ? 'zh-CN' : tag;
    const available = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().split('-')[0] === locale.split('-')[0]);
    if (!available.length) { status('No matching device voice installed. You can record a native-speaker example.'); return; }
    const rotationKey = `device:${key()}`, index = ((previous.get(rotationKey) ?? -1) + 1) % available.length;
    previous.set(rotationKey, index);
    const utterance = new SpeechSynthesisUtterance(entry.label); utterance.lang = locale; utterance.voice = available[index]; utterance.rate = .85;
    utterance.onerror = event => status(`Device speech unavailable (${event.error}). Record or choose an example.`);
    heard = { ...heard, source: 'device-synthesis', recordId: '' };
    speechSynthesis.speak(utterance); status(`${available[index].name} · device synthesis, not a native-speaker recording.${narrationError ? ` Scene narration unavailable: ${narrationError}` : ''}${communityError ? ` Shared word audio unavailable: ${communityError}` : ''}`);
  }
  $('voice-open').onclick = () => { void openWord(); };
  for (const id of ['voice-language', 'voice-concept']) $(id).onchange = () => {
    language = $('voice-language').value; concept = $('voice-concept').value;
    void loadDraft(); updateFeedback();
  };
  $('voice-record').onclick = async () => {
    if (getBlocked()) { status('Recording disabled during scored practice or private audio.'); return; }
    window.dispatchEvent(new Event('dlang:audio-start'));
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    stopPlayer();
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { status('Microphone recording is unavailable in this browser; use HTTPS and a supported device.'); return; }
    $('voice-record').disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!$('voice-dialog').open) { stream.getTracks().forEach(track => track.stop()); return; }
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
      if (!type) throw Error('No supported recording format.');
      recorder = new MediaRecorder(stream, { mimeType: type }); chunks = []; recordingAt = Date.now();
      let failed = false;
      recordingContext = { key: key(), language, concept, scene: await sceneSnapshot(wordContext || getSceneContext(), language) };
      if (getBlocked() || !$('voice-dialog').open) throw Error('Recording cancelled before it started.');
      $('voice-language').disabled = true; $('voice-concept').disabled = true; $('voice-publish').disabled = true;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); if (chunks.reduce((n, b) => n + b.size, 0) > MAX_VOICE_BYTES && recorder.state === 'recording') recorder.stop(); };
      recorder.onerror = () => { failed = true; clearTimeout(timer); status('Recording failed; nothing published.'); stream.getTracks().forEach(track => track.stop()); };
      recorder.onstop = async () => {
        clearTimeout(timer); stream.getTracks().forEach(track => track.stop());
        $('voice-record').textContent = 'Record my pronunciation'; $('voice-language').disabled = false; $('voice-concept').disabled = false;
        if (failed) { await loadDraft(); status('Recording failed; no new draft saved or published.'); return; }
        const blob = new Blob(chunks, { type: type.split(';')[0] }), duration = Math.min(15, (Date.now() - recordingAt) / 1000);
        try {
          if (!blob.size || blob.size > MAX_VOICE_BYTES || duration < .2) throw Error('Record between 0.2 and 15 seconds, up to 1 MiB.');
          await draft('put', recordingContext.key, { blob, duration, language: recordingContext.language, concept: recordingContext.concept, scene: recordingContext.scene });
          await loadDraft(); status('Draft saved on this device. Preview it; Publish makes your voice public.');
        } catch (error) { status(error.message); }
      };
      recorder.start(250); timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 15000);
      $('voice-record').textContent = 'Stop recording'; status('Recording locally · maximum 15 seconds.');
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); status(`Microphone unavailable: ${error.message}`); }
    finally { $('voice-record').disabled = false; }
  };
  $('voice-preview').onclick = async () => { try { if (!selected) throw Error('Record a local example first.'); await playBlob(selected.blob); } catch (error) { status(error.message); } };
  $('voice-delete').onclick = async () => { try { await draft('delete', key()); await loadDraft(); status('Local draft removed. Published IPFS copies cannot be recalled here.'); } catch (error) { status(error.message); } };
  $('voice-publish').onclick = async () => {
    if (!selected || recorder?.state === 'recording') return;
    const saved = selected, speaker = $('voice-speaker').value.trim();
    if (!speaker || speaker.length > 60) { status('Enter a public speaker credit, such as a nickname.'); return; }
    $('voice-publish').disabled = true;
    try {
      if (getBlocked() || !communityReady) throw Error('Shared WORD persistence must be available before public upload. No upload started.');
      if (!$('voice-consent').checked) throw Error('Confirm your own voice and public word-recording consent first.');
      const profile = { language: saved.language, dialect: $('voice-dialect').value.trim(), nativeSpeakerDeclared: $('voice-native').checked };
      if (!profile.dialect || profile.dialect.length > 80 || !saved.scene) throw Error('Record in a scene and enter your self-declared accent / dialect.');
      // Authorize eligibility before irreversible IPFS upload; this does not authorize cloning or money.
      await submitWordAction('authorize-upload', { purpose: 'public-word-upload', sha256: await digest(saved.blob),
        scene: saved.scene, language: saved.language, concept: saved.concept, profile,
        consent: 'own-voice-public-word-CC-BY-4.0' });
      if (getBlocked() || !$('voice-consent').checked || selected !== saved || !$('voice-dialog').open) {
        throw Error('Contribution or consent changed before upload. Nothing uploaded.');
      }
      status('Publishing your voice publicly to IPFS…');
      const receipt = await ipfs.upload(saved.blob, `dlang-${saved.language}-${saved.concept}.${saved.blob.type.split('/')[1]}`, { purpose: 'word' });
      const recovered = await ipfs.read(receipt.cid, MAX_VOICE_BYTES);
      if (recovered.size !== saved.blob.size || await digest(recovered) !== receipt.sha256) {
        throw Error('Pinned audio could not be byte-verified. No word was added to rotation.');
      }
      if (getBlocked() || !$('voice-consent').checked || selected !== saved || !$('voice-dialog').open) {
        throw Error('Contribution or consent changed after upload. No word was added to rotation.');
      }
      const metadata = validateVoice({ version: 1, language: saved.language, concept: saved.concept, speaker,
        type: saved.blob.type, duration: saved.duration, size: saved.blob.size, cid: receipt.cid, sha256: receipt.sha256,
        license: 'CC-BY-4.0', nativeSpeakerDeclared: profile.nativeSpeakerDeclared });
      const payload = { voice: metadata, profile, scene: saved.scene, consent: 'own-voice-public-word-CC-BY-4.0', createdAt: new Date().toISOString() };
      await validateWordPayload(payload);
      await submitWordAction('publish', payload);
      let profileWarning = '';
      try { await draft('put', `profile:${saved.language}`, { speaker, dialect: profile.dialect, nativeSpeakerDeclared: profile.nativeSpeakerDeclared }); }
      catch (error) { profileWarning = ` Local profile was not saved: ${error.message}`; }
      const link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.href = `https://github.com/TheJollyLaMa/DLang/issues/new?title=${encodeURIComponent(`Word review: ${saved.language} / ${saved.concept}`)}&body=${encodeURIComponent(`Unreviewed pilot word in rotation.\nAudio: ${receipt.uri}\nSHA-256: ${receipt.sha256}\nSpeaker credit: ${speaker}\nDialect: ${profile.dialect}\nLicense: CC BY 4.0. Native status is self-declared; independent language review pending.`)}`;
      link.textContent = 'Send to the steward for review ↗'; $('voice-submission').replaceChildren(link);
      status(`Public word saved to shared pilot rotation: ${receipt.uri} · UNREVIEWED · ${speaker} · ${profile.dialect}. No payment or AI consent granted.${profileWarning}`);
    } catch (error) { status(`Publish incomplete: ${error.message} Any completed IPFS upload remains public; no review submission was sent automatically.`); }
    finally { $('voice-publish').disabled = !selected; }
  };
  $('voice-flag').onclick = async () => {
    try {
      const scene = await sceneSnapshot(wordContext, language);
      await submitWordAction('flag', { language, concept, scene,
        source: heard?.language === language && heard?.concept === concept ? heard.source : 'unavailable',
        recordId: heard?.language === language && heard?.concept === concept ? heard.recordId : '' });
      status('Pronunciation flagged in this scene. A correction or thumbs does not close the flag.');
    } catch (error) { status(error.message); }
  };
  for (const [id, value] of [['voice-up', 1], ['voice-down', -1]]) $(id).onclick = async () => {
    try {
      await submitWordAction('feedback', { recordId: heard.record.id, versionHash: heard.record.id, value, meaning: 'clear-helpful-learning' });
      status('Clarity feedback saved once per wallet and recording; changing your thumb replaces it. No language approval or earnings.');
    } catch (error) { status(error.message); }
  };
  for (const [id, review] of [['voice-review-approve', 'approved'], ['voice-review-reject', 'rejected']]) $(id).onclick = async () => {
    try {
      await submitWordAction('review', { recordId: heard.record.id, versionHash: heard.record.id, status: review });
      status(`Independent language review saved: ${review}. Pronunciation flags remain open for separate resolution.`);
    } catch (error) { status(error.message); }
  };
  $('voice-dialog').addEventListener('close', () => { if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); stopPlayer(); });
  function interrupt() {
    if (recorder?.state === 'recording') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    stopPlayer();
  }
  window.addEventListener('dlang:private-audio', event => {
    privateAudio = event.detail?.active === true;
    if (privateAudio) interrupt();
    updateFeedback();
  });
  window.addEventListener('dlang:panel', interrupt);
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
  window.addEventListener('pagehide', () => { clearTimeout(timer); if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); stopPlayer(); });
  fetch('./dlang/community-voices.json', { signal: AbortSignal.timeout(15000) }).then(response => { if (!response.ok) throw Error(`Voice library HTTP ${response.status}`); return response.json(); })
    .then(value => { voices = validateVoices(value); status(voices.length ? `${voices.length} reviewed community voices available.` : 'Community recordings are open for contributions. Device voices play when installed.'); })
    .catch(error => status(`Community library unavailable: ${error.message} Device voices may still be available.`));
  labels();
  return {
    play,
    openWord,
    playWord: (tag, id, context) => play(tag, id, null, context),
    setNarrations,
    selectNarration,
    playNarrationTurn,
    stopNarration: stopPlayer
  };
}
