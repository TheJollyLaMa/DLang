// Protocol adaptation of DecentBusking rehearsal.js/rehearsal-http.js at
// ac8a9cc (Apache-2.0). DLang tokens are independent of all other app services.
export function conversationConfig(raw, pageOrigin = globalThis.location?.origin) {
  if (!raw) return null;
  const page = new URL(pageOrigin), endpoint = new URL(raw.endpoint, page), media = new URL(raw.livekitOrigin);
  const local = url => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (endpoint.protocol !== 'https:' && !(local(endpoint) && local(new URL(pageOrigin))) ||
      endpoint.origin !== page.origin ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== '/api/dlang/conversation' ||
      media.protocol !== 'wss:' || media.username || media.password || media.pathname !== '/' ||
      media.search || media.hash) throw Error('Invalid trusted conversation configuration.');
  return Object.freeze({ endpoint: endpoint.href, livekitOrigin: media.origin });
}

export function createConversationService({ config, wallet, fetchImpl = globalThis.fetch,
  origin = globalThis.location?.origin, now = () => Date.now() }) {
  if (!config || !wallet?.request) throw Error('Private conversation needs a configured service and browser wallet.');
  const expected = conversationConfig(config, origin);
  let token = '', generation = 0, pending = new Set();
  async function request(path, input, bearer = '', keepalive = false) {
    const controller = new AbortController();
    if (!keepalive) pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl(`${expected.endpoint}/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(input), credentials: 'omit', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', keepalive, signal: controller.signal
      });
      if (!response.ok) throw Error('Private conversation unavailable; check invitation, quota or service.');
      return await response.json();
    } finally { clearTimeout(timer); pending.delete(controller); }
  }
  function stop() {
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear();
    const previous = token; token = '';
    if (previous) void request('control', { action: 'leave' }, previous, true).catch(() => {});
  }
  async function authorize({ action, guest = '', id = '', minutes = 5, microphone = false, consent } = {}) {
    if (consent !== true) throw Error('Consent is required.');
    stop();
    const current = generation, valid = () => current === generation;
    const accounts = await wallet.request({ method: 'eth_requestAccounts' });
    if (!valid()) return null;
    const address = String(accounts?.[0] || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) throw Error('A wallet account is required.');
    if (!['create', 'join'].includes(action) || !Number.isInteger(minutes) || minutes < 1 || minutes > 15 ||
        action === 'create' && (!/^0x[0-9a-f]{40}$/i.test(guest) || guest.toLowerCase() === address) ||
        action === 'join' && !/^conversation:[0-9a-f]{64}$/.test(id)) throw Error('Use a distinct invited wallet or a valid private room ID.');
    const challenge = await request('challenge', { action, wallet: address, guest: guest.toLowerCase(), id, minutes });
    if (!valid()) return null;
    if (typeof challenge.challengeId !== 'string' || typeof challenge.message !== 'string' ||
        challenge.message.length > 4096 || challenge.message !== challengeMessage({
          action, wallet: address, guest: guest.toLowerCase(), id: challenge.id, origin,
          expiresAt: challenge.expiresAt, challengeId: challenge.challengeId
        }) || !/^conversation:[0-9a-f]{64}$/.test(challenge.id) ||
        !/^[0-9a-f]{64}$/.test(challenge.challengeId) ||
        !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= now() ||
        challenge.expiresAt > now() + 120000 || action === 'join' && challenge.id !== id) {
      throw Error('Invalid private conversation challenge.');
    }
    const hex = `0x${Array.from(new TextEncoder().encode(challenge.message), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const signature = await wallet.request({ method: 'personal_sign', params: [hex, address] });
    if (!valid()) return null;
    const latest = await wallet.request({ method: 'eth_accounts' });
    if (!valid() || latest?.[0]?.toLowerCase() !== address) throw Error('Wallet changed; sign again.');
    const session = await request('session', { challengeId: challenge.challengeId, signature });
    if (typeof session.token !== 'string' || !session.token || session.token.length > 8192) throw Error('Invalid conversation authorization.');
    if (!valid()) {
      void request('control', { action: 'leave' }, session.token, true).catch(() => {});
      return null;
    }
    token = session.token;
    try {
      const grant = await request('control', { action: 'connect', publish: microphone === true }, token);
      if (!valid()) return null;
      return { ...grant, id: challenge.id };
    } catch (error) { stop(); throw error; }
  }
  async function heartbeat() {
    if (!token) throw Error('Private conversation ended.');
    await request('control', { action: 'state' }, token);
  }
  return { authorize, heartbeat, stop };
}

export function challengeMessage({ action, wallet, guest, id, origin, expiresAt, challengeId }) {
  return ['DLang PRIVATE CONVERSATION authorization', `Action: ${action}`, `Room: ${id}`,
    `Wallet: ${wallet}`, `Guest: ${guest}`, `Origin: ${origin}`, `Nonce: ${challengeId}`,
    `Challenge expires: ${expiresAt}`,
    'Private invited audio only. No recording, transcript, scoring, payment or transaction.'].join('\n');
}
