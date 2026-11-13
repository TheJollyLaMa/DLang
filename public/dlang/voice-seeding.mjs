import { digest } from './storage.mjs';
import { pilotEligibility } from './pilot.mjs';

export const VOICE_SEED_TERMS = 'dlang-voice-seed-2026-11-v1';
export const VOICE_SEED_SCOPE = [
  'I am an adult, this is my own speaking voice, and I control the rights to these dedicated samples.',
  'I explicitly permit ElevenLabs Instant Voice Cloning processing and DLang generation of reviewed lesson narration in my voice until I withdraw.',
  'This does not permit live AI conversation, impersonation, sale of my voice, or harvesting private calls. Existing CC BY recordings do not grant this permission.',
  'Generated narration must be labeled synthetic, previewed and approved by me before activation, and reviewed for language accuracy.',
  'Samples stay private, not on public IPFS. ElevenLabs processing and retention apply; zero retention or complete removal from provider backups is not promised.',
  'Withdrawal stops future generation after operator acknowledgement; previously downloaded or distributed audio cannot be guaranteed recalled.',
  'Proposed one-time approval and reviewed-usage gem rewards have no agreed rates or caps. This signature earns no gems, authorizes no transaction and guarantees no payout.'
].join('\n');

export function voiceSeedMessage(record) {
  if (!record || record.version !== 1 || record.terms !== VOICE_SEED_TERMS
    || !['opt-in', 'withdraw'].includes(record.action) || !/^[0-9a-f-]{36}$/.test(record.id)
    || !/^0x[0-9a-f]{40}$/i.test(record.wallet) || !/^[a-f0-9]{64}$/.test(record.sampleHash)
    || !Number.isFinite(Date.parse(record.issuedAt)) || typeof record.language !== 'string'
    || !/^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(record.language)
    || typeof record.origin !== 'string') throw Error('Invalid voice consent request.');
  const origin = new URL(record.origin);
  if (origin.origin !== record.origin || !['https:', 'http:'].includes(origin.protocol)
    || origin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(origin.hostname)) throw Error('Invalid consent origin.');
  return ['DLang CONTRIBUTOR AI VOICE consent request', `Terms: ${record.terms}`, `Action: ${record.action}`,
    `Request: ${record.id}`, `Wallet: ${record.wallet.toLowerCase()}`, `Language: ${record.language}`,
    `Dedicated sample SHA-256: ${record.sampleHash}`, `Origin: ${record.origin}`, `Issued: ${record.issuedAt}`,
    record.action === 'withdraw'
      ? 'I withdraw this voice-cloning permission. Stop future generation and acknowledge my request. This is not permission to create or activate a voice. Previously distributed audio and provider backups may not be fully recalled.'
      : VOICE_SEED_SCOPE].join('\n');
}

export function mountVoiceSeeding({ root, storage, getWallet, report, getBlocked = () => false }) {
  root.innerHTML = `<h2>Contribute my AI voice</h2>
    <p>Separate from calls and public narration uploads. Adult approved contributors only. This pilot prepares a private consent request; there is no automatic upload, clone, reward payout or operator submission.</p>
    <pre data-seed-terms style="white-space:pre-wrap"></pre>
    <label>Language tag <input data-seed-language value="en" maxlength="20"></label>
    <label>Dedicated sample (your own voice only, at most 25 MiB) <input data-seed-file type="file" accept="audio/*"></label>
    <audio data-seed-preview controls aria-label="My local voice sample preview" style="max-width:100%"></audio>
    <label><input data-seed-consent type="checkbox"> I have previewed my dedicated sample, meet the requirements, and explicitly agree to every statement above.</label>
    <button data-seed-sign>Sign and save private opt-in request</button>
    <button data-seed-withdraw>Sign withdrawal request for my saved opt-in</button>
    <button data-seed-download disabled>Download private request</button>
    <p data-seed-status role="status">No sample is uploaded. Signing requests wallet access only when you choose it. Keep requests and samples private; arrange delivery directly with the operator, never in a public GitHub issue.</p>`;
  const $ = selector => root.querySelector(selector);
  $('[data-seed-terms]').textContent = VOICE_SEED_SCOPE;
  const keyFor = address => `dlang-voice-seed-request-v1:${address.toLowerCase()}`;
  let request = null, sampleURL = '', busy = false, sampleGeneration = 0;
  const status = text => { $('[data-seed-status]').textContent = text; };
  $('[data-seed-file]').onchange = () => {
    sampleGeneration++;
    $('[data-seed-consent]').checked = false;
    if (sampleURL) URL.revokeObjectURL(sampleURL);
    sampleURL = '';
    const sample = $('[data-seed-file]').files[0];
    if (!sample || !sample.type.startsWith('audio/') || sample.size < 1 || sample.size > 25 * 1024 * 1024) {
      status('Choose your own audio sample, 1 byte to 25 MiB. Nothing uploaded.');
      $('[data-seed-preview]').removeAttribute('src'); return;
    }
    sampleURL = URL.createObjectURL(sample);
    $('[data-seed-preview]').src = sampleURL;
    status('Local sample ready to preview. Its hash, not the audio, goes into the signed request.');
  };
  async function sign(action) {
    if (getBlocked() || busy) { status('Consent requests are paused during scored practice or another signature.'); return; }
    busy = true;
    const ownSampleGeneration = sampleGeneration;
    try {
      if (action === 'opt-in' && !$('[data-seed-consent]').checked) throw Error('Explicit consent and sample preview are required.');
      const { address, signer } = await getWallet();
      const key = keyFor(address);
      if (action === 'opt-in') {
        const saved = JSON.parse(storage.getItem(key) || 'null');
        if (saved?.action === 'opt-in') throw Error('A local opt-in already exists. Arrange its private review or request withdrawal before replacing it.');
        if (!$('[data-seed-consent]').checked) throw Error('Explicit consent and sample preview are required.');
        const sample = $('[data-seed-file]').files[0];
        if (!sample || !sample.type.startsWith('audio/') || sample.size < 1 || sample.size > 25 * 1024 * 1024) throw Error('Select your dedicated voice sample first.');
        const response = await fetch('./dlang/pilot-roster.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok || !pilotEligibility(await response.json(), address).eligible) throw Error('Contributor whitelist unavailable or wallet not admitted. No consent saved.');
        request = { version: 1, terms: VOICE_SEED_TERMS, action, id: crypto.randomUUID(), wallet: address.toLowerCase(),
          language: $('[data-seed-language]').value.trim(), sampleHash: await digest(sample), origin: location.origin, issuedAt: new Date().toISOString() };
      } else {
        const saved = JSON.parse(storage.getItem(key) || 'null');
        if (!saved || saved.wallet !== address.toLowerCase()) throw Error('Connect the wallet for your saved opt-in before requesting withdrawal.');
        request = { ...saved, action, issuedAt: new Date().toISOString() };
        delete request.signature;
      }
      const message = voiceSeedMessage(request);
      const signature = await signer.signMessage(message);
      const latest = await getWallet();
      if (latest.address.toLowerCase() !== request.wallet || getBlocked() || ownSampleGeneration !== sampleGeneration
        || action === 'opt-in' && !$('[data-seed-consent]').checked) throw Error('Wallet, sample or consent changed; request was not saved.');
      request.signature = signature;
      storage.setItem(key, JSON.stringify(request));
      $('[data-seed-download]').disabled = false;
      status(action === 'opt-in'
        ? 'Signed request saved only on this device. Download it and arrange private operator delivery with the sample. No clone is active; ownership/eligibility, speaker-preview and language review are still required. Reward rates/caps and payouts are not configured.'
        : 'Signed withdrawal saved locally, not delivered. Download and privately send it to the operator; future generation is not disabled until acknowledged.');
    } catch (error) { request = null; $('[data-seed-download]').disabled = true; status(error.message); report(error.message); }
    finally { busy = false; }
  }
  $('[data-seed-sign]').onclick = () => { void sign('opt-in'); };
  $('[data-seed-withdraw]').onclick = () => { void sign('withdraw'); };
  $('[data-seed-download]').onclick = () => {
    if (!request) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `private-dlang-voice-${request.action}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('pagehide', () => { if (sampleURL) URL.revokeObjectURL(sampleURL); });
  const pause = () => { $('[data-seed-preview]').pause(); };
  window.addEventListener('dlang:audio-start', pause);
  window.addEventListener('dlang:panel', pause);
  window.addEventListener('dlang:practice', () => { if (getBlocked()) pause(); });
}
