import { hashJSON } from './steward.mjs';
import { resolveContributorCredit } from './identity.mjs';

export function createVoiceRewardClient({ signer, request = fetch, origin = globalThis.location?.origin, ensProvider }) {
  const mainnet = async operation => {
    const { loadEthers } = await import('../vendor/decent-head/2.0.0/js/wallet.js');
    const { JsonRpcProvider, FetchRequest } = await loadEthers();
    const endpoint = new FetchRequest('https://ethereum-rpc.publicnode.com'); endpoint.timeout = 8000;
    const provider = new JsonRpcProvider(endpoint);
    try { return await operation(provider); } finally { provider.destroy(); }
  };
  ensProvider ||= { getNetwork: () => mainnet(provider => provider.getNetwork()),
    resolveName: name => mainnet(provider => provider.resolveName(name)) };
  const call = async (suffix, body) => {
    const response = await request(`/api/voice-rewards${suffix}`, {
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Voice rewards unavailable.');
    return result;
  };
  const mutate = async (action, payload) => {
    const account = await signer(), address = await account.getAddress();
    const auth = await call('/challenge', { address, origin, action, bodyHash: await hashJSON(payload) });
    return call('/submit', { nonce: auth.nonce, signature: await account.signMessage(auth.message), payload });
  };
  return {
    list: () => call(''),
    verifyCredit: async credit => resolveContributorCredit(credit, await (await signer()).getAddress(), ensProvider),
    enroll: (recordId, credit) => mutate('enroll', { recordId, credit }),
    start: recordId => mutate('start', { recordId, deliberatePractice: true }),
    complete: session => mutate('complete', { sessionId: session.id, recordId: session.recordId,
      completed: true, audible: true, visible: true, uninterrupted: true, deliberatePractice: true }),
    discard: session => mutate('discard', { sessionId: session.id })
  };
}

// Native browser events are prototype attestation, not cryptographic audibility proof.
export function attestWordPlayback({ element, session, rewards, document: doc = document, report = () => {}, now = () => performance.now() }) {
  let stopped = false, playingAt = null;
  const removals = [];
  const on = (target, event, handler) => { target.addEventListener(event, handler); removals.push(() => target.removeEventListener(event, handler)); };
  const clean = () => { removals.splice(0).forEach(remove => remove()); };
  const cancel = () => {
    if (stopped) return;
    stopped = true; clean();
    report('Playback interrupted: no voice reward credit. Session expires automatically.');
  };
  const audible = () => !element.muted && element.volume > 0 && element.playbackRate === 1 && doc.visibilityState === 'visible';
  on(element, 'playing', () => {
    if (!audible() || playingAt !== null || !Number.isFinite(element.currentTime)) return cancel();
    // Native media can advance while the JS event queue is busy.
    playingAt = now() - element.currentTime * 1000;
  });
  on(element, 'pause', () => { if (!element.ended) cancel(); });
  for (const event of ['error', 'abort', 'seeking', 'ratechange']) on(element, event, cancel);
  for (const event of ['waiting', 'stalled']) on(element, event, () => { if (playingAt !== null) cancel(); });
  on(element, 'volumechange', () => { if (!audible()) cancel(); });
  on(doc, 'visibilitychange', () => { if (!audible()) cancel(); });
  on(element, 'ended', async () => {
    if (stopped) return;
    if (!audible() || playingAt === null || now() - playingAt < session.duration * 1000 - 20
      || !Number.isFinite(element.duration) || element.duration < .2 || element.duration > 15
      || Math.abs(element.duration - session.duration) > .1 || element.currentTime < element.duration - .02) return cancel();
    stopped = true; clean();
    try {
      const result = await rewards.complete(session);
      if (result.outcome !== 'qualified') throw Error('Completion did not qualify; no credit claimed.');
      report('Signed completion saved: 1 qualifying practice credit, not a guaranteed market payment.');
    } catch (error) { report(`No voice credit confirmed: ${error.message}`); }
  });
  if (!audible()) cancel();
  return cancel;
}
