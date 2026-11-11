import { PACKS, LANGUAGE_NAMES } from './packs.mjs';
import { cid, digest } from './storage.mjs';
export const MAX_VOICE_BYTES = 1024 * 1024;
export const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'];
export function validateVoice(entry) {
  if (!entry || entry.version !== 1 || !PACKS[entry.language]?.[entry.concept] || typeof entry.speaker !== 'string'
    || !entry.speaker.trim() || entry.speaker.length > 60 || entry.license !== 'CC-BY-4.0'
    || !VOICE_TYPES.includes(entry.type) || !Number.isFinite(entry.duration) || entry.duration <= 0 || entry.duration > 15
    || !Number.isInteger(entry.size) || entry.size < 1 || entry.size > MAX_VOICE_BYTES
    || !/^[a-f0-9]{64}$/.test(entry.sha256) || entry.nativeSpeakerDeclared !== true) throw Error('Invalid voice contribution.');
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
export function mountAudio({ ipfs, openDialog }) {
  const $ = id => document.getElementById(id);
  let voices = [], language = 'en', concept = 'chair', recorder, stream, chunks = [], recordingAt, timer, selected, recordingContext, player, mediaURL, generation = 0, draftGeneration = 0;
  const previous = new Map();
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
    try { const saved = await draft('get', expected); if (key() !== expected || current !== draftGeneration) return; selected = saved;
      $('voice-preview').disabled = !saved; $('voice-publish').disabled = !saved;
      if (saved) status('Your local draft is ready. It has not been shared.'); }
    catch (error) { status(error.message); }
  }
  function stopPlayer() {
    generation++; player?.pause(); globalThis.speechSynthesis?.cancel();
    if (mediaURL) URL.revokeObjectURL(mediaURL); mediaURL = null;
  }
  async function playBlob(blob) {
    stopPlayer(); mediaURL = URL.createObjectURL(blob); player = new Audio(mediaURL);
    player.onerror = () => status('This audio cannot be decoded. Try a different voice or record an example.');
    await player.play();
  }
  async function play(tag, id) {
    if (language !== tag || concept !== id) { selected = null; draftGeneration++; $('voice-publish').disabled = true; $('voice-preview').disabled = true; }
    language = tag; concept = id; labels(); stopPlayer();
    const current = generation, entry = PACKS[tag]?.[id];
    if (!entry) { status('Audio is unavailable for this word.'); return; }
    const voice = nextVoice(voices, tag, id, previous.get(key()));
    if (voice) {
      previous.set(key(), voice.cid);
      status(`Loading ${voice.speaker}…`);
      try {
        const blob = await ipfs.read(voice.cid, MAX_VOICE_BYTES);
        if (await digest(blob) !== voice.sha256 || blob.size !== voice.size) throw Error('Voice content does not match the reviewed recording.');
        if (current !== generation) return;
        await playBlob(new Blob([blob], { type: voice.type }));
        status(`${voice.speaker} · reviewed community recording · tap again for another voice.`);
      } catch (error) { status(`Recording unavailable: ${error.message} You can record a new example.`); }
      return;
    }
    if (!globalThis.speechSynthesis) { status('No device audio available. Record an example for this word.'); return; }
    const locale = tag === 'zh-Hans' ? 'zh-CN' : tag;
    const available = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().split('-')[0] === locale.split('-')[0]);
    if (!available.length) { status('No matching device voice installed. You can record a native-speaker example.'); return; }
    const rotationKey = `device:${key()}`, index = ((previous.get(rotationKey) ?? -1) + 1) % available.length;
    previous.set(rotationKey, index);
    const utterance = new SpeechSynthesisUtterance(entry.label); utterance.lang = locale; utterance.voice = available[index]; utterance.rate = .85;
    utterance.onerror = event => status(`Device speech unavailable (${event.error}). Record or choose an example.`);
    speechSynthesis.speak(utterance); status(`${available[index].name} · device synthesis, not a native-speaker recording.`);
  }
  $('voice-open').onclick = () => { openDialog('voice-dialog'); void loadDraft(); };
  for (const id of ['voice-language', 'voice-concept']) $(id).onchange = () => { language = $('voice-language').value; concept = $('voice-concept').value; void loadDraft(); };
  $('voice-record').onclick = async () => {
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { status('Microphone recording is unavailable in this browser; use HTTPS and a supported device.'); return; }
    $('voice-record').disabled = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!$('voice-dialog').open) { stream.getTracks().forEach(track => track.stop()); return; }
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(value => MediaRecorder.isTypeSupported(value));
      if (!type) throw Error('No supported recording format.');
      recorder = new MediaRecorder(stream, { mimeType: type }); chunks = []; recordingAt = Date.now();
      let failed = false;
      recordingContext = { key: key(), language, concept };
      $('voice-language').disabled = true; $('voice-concept').disabled = true; $('voice-publish').disabled = true;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); if (chunks.reduce((n, b) => n + b.size, 0) > MAX_VOICE_BYTES && recorder.state === 'recording') recorder.stop(); };
      recorder.onerror = () => { failed = true; clearTimeout(timer); status('Recording failed; nothing published.'); stream.getTracks().forEach(track => track.stop()); };
      recorder.onstop = async () => {
        clearTimeout(timer); stream.getTracks().forEach(track => track.stop());
        $('voice-record').textContent = 'Record my pronunciation'; $('voice-language').disabled = false; $('voice-concept').disabled = false;
        if (failed) { await loadDraft(); status('Recording failed; no new draft saved or published.'); return; }
        const blob = new Blob(chunks, { type: type.split(';')[0] }), duration = (Date.now() - recordingAt) / 1000;
        try {
          if (!blob.size || blob.size > MAX_VOICE_BYTES || duration < .2 || duration > 15) throw Error('Record between 0.2 and 15 seconds, up to 1 MiB. Delayed/background recordings that exceed the limit are not saved.');
          await draft('put', recordingContext.key, { blob, duration, language: recordingContext.language, concept: recordingContext.concept });
          await loadDraft(); status('Draft saved on this device. Preview it; Publish makes your voice public.');
        } catch (error) { status(error.message); }
      };
      recorder.start(250); timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 14900);
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
      status('Publishing your voice publicly to IPFS…');
      const receipt = await ipfs.upload(saved.blob, `dlang-${saved.language}-${saved.concept}.${saved.blob.type.split('/')[1]}`);
      const metadata = validateVoice({ version: 1, language: saved.language, concept: saved.concept, speaker,
        type: saved.blob.type, duration: saved.duration, size: saved.blob.size, cid: receipt.cid, sha256: receipt.sha256,
        license: 'CC-BY-4.0', nativeSpeakerDeclared: true });
      const manifest = await ipfs.upload(new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'dlang-voice.json');
      const link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.href = `https://github.com/TheJollyLaMa/DLang/issues/new?title=${encodeURIComponent(`Voice review: ${saved.language} / ${saved.concept}`)}&body=${encodeURIComponent(`Please review this public voice contribution before inclusion in community rotation.\nMetadata: ipfs://${manifest.cid}\nAudio: ${receipt.uri}\nSHA-256: ${receipt.sha256}\nSpeaker credit: ${speaker}\nLicense: CC BY 4.0. Native speaker status is self-declared; fluent review is still required.`)}`;
      link.textContent = 'Send to the steward for review ↗'; $('voice-submission').replaceChildren(link);
      status(`Public voice pinned: ${receipt.uri}. Not approved or in community rotation yet. Open the review link to submit.`);
    } catch (error) { status(`Publish incomplete: ${error.message} Any completed IPFS upload remains public; no review submission was sent automatically.`); }
    finally { $('voice-publish').disabled = !selected; }
  };
  $('voice-dialog').addEventListener('close', () => { if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); stopPlayer(); });
  window.addEventListener('pagehide', () => { clearTimeout(timer); if (recorder?.state === 'recording') recorder.stop(); stream?.getTracks().forEach(track => track.stop()); stopPlayer(); });
  fetch('./dlang/community-voices.json', { signal: AbortSignal.timeout(15000) }).then(response => { if (!response.ok) throw Error(`Voice library HTTP ${response.status}`); return response.json(); })
    .then(value => { voices = validateVoices(value); status(voices.length ? `${voices.length} reviewed community voices available.` : 'Community recordings are open for contributions. Device voices play when installed.'); })
    .catch(error => status(`Community library unavailable: ${error.message} Device voices may still be available.`));
  labels();
  return { play };
}
