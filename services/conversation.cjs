const { randomBytes } = require('node:crypto');
const { verifyMessage } = require('ethers');
const opaque = () => randomBytes(32).toString('hex');
const address = value => /^0x[0-9a-f]{40}$/i.test(value || '') ? value.toLowerCase() : '';

// Adapted private invitation/origin/nonce patterns from DecentBusking
// discord-bot/rehearsal.js at ac8a9cc, Apache-2.0. No recording/checkpoint store.
function createConversationService({ allowedOrigins = [], allowedWallets = [], transport,
  maxRooms = 1, maxSessions = 8, maxRoomsPerDay = 20, now = Date.now, verify = verifyMessage } = {}) {
  const rooms = new Map(), sessions = new Map(), challenges = new Map();
  const wallets = new Set(allowedWallets.map(address).filter(Boolean));
  let tail = Promise.resolve(), day = '', used = 0, closed = false;
  const run = fn => { const task = tail.then(fn); tail = task.catch(() => {}); return task; };
  const configured = allowedOrigins.length > 0 && wallets.size >= 2 && transport?.ready === true &&
    [maxRooms, maxSessions, maxRoomsPerDay].every(n => Number.isInteger(n) && n > 0 && n <= 100);
  const timer = configured ? setInterval(() => {
    void run(cleanup).catch(() => { for (const room of rooms.values()) room.ended = true; sessions.clear(); });
  }, 5000) : null;
  timer?.unref?.();
  const fail = message => { throw Error(message); };
  function check(origin) {
    if (!configured || closed) fail('Private conversation is unavailable.');
    if (!allowedOrigins.includes(origin)) fail('Origin not allowed.');
  }
  async function cleanup() {
    await transport?.initialize?.();
    for (const [id, c] of challenges) if (c.expiresAt <= now()) challenges.delete(id);
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now() || now() - session.seen > 30000) {
        sessions.delete(token);
        const room = rooms.get(session.id);
        if (room) room.ended = true;
      }
    }
    for (const [id, room] of rooms) {
      if (room.expiresAt <= now() || room.ended || closed) {
        room.ended = true; room.endedAt ||= now();
        for (const [token, session] of sessions) if (session.id === id) sessions.delete(token);
        try {
          await transport.close(id);
          // Short-lived media grants may reconnect until expiry; retain tombstone.
          if (now() > room.endedAt + 35000) rooms.delete(id);
        } catch { /* Retry provider cleanup on the next operator tick. */ }
      }
    }
  }
  return {
    get configured() { return configured && !closed; },
    challenge(input, origin) {
      return run(async () => {
        check(origin); await cleanup();
        const wallet = address(input.wallet), guest = address(input.guest);
        if (!wallets.has(wallet)) fail('Wallet is not admitted.');
        let room;
        if (input.action === 'create') {
          if (!wallets.has(guest) || guest === wallet || !Number.isInteger(input.minutes) ||
              input.minutes < 1 || input.minutes > 15) fail('Invalid invitation or duration.');
          if (rooms.size >= maxRooms) fail('Room quota exhausted.');
          room = { id: `conversation:${opaque()}`, owner: wallet, guest, expiresAt: now() + input.minutes * 60000 };
        } else if (input.action === 'join') {
          room = rooms.get(input.id);
          if (!room || room.ended || room.expiresAt <= now() || ![room.owner, room.guest].includes(wallet)) fail('Invitation unavailable.');
        } else fail('Unknown action.');
        if (challenges.size >= 64) fail('Challenge quota exhausted.');
        const challengeId = opaque(), expiresAt = Math.min(now() + 120000, room.expiresAt);
        const { challengeMessage } = await import('../public/dlang/conversation-service.mjs');
        const message = challengeMessage({ action: input.action, wallet, guest: guest || '', id: room.id, origin, expiresAt, challengeId });
        challenges.set(challengeId, { action: input.action, room, wallet, origin, message, expiresAt });
        return { challengeId, message, id: room.id, expiresAt };
      });
    },
    authorize(input, origin) {
      return run(async () => {
        check(origin); await cleanup();
        const c = challenges.get(input.challengeId);
        if (!c || c.origin !== origin || c.expiresAt <= now()) fail('Challenge expired.');
        challenges.delete(input.challengeId);
        if (address(await verify(c.message, input.signature)) !== c.wallet) fail('Signature does not match.');
        let room = rooms.get(c.room.id);
        if (c.action === 'create') {
          const today = new Date(now()).toISOString().slice(0, 10);
          if (today !== day) { day = today; used = 0; }
          if (rooms.size >= maxRooms || used >= maxRoomsPerDay) fail('Room quota exhausted.');
          room = c.room;
        }
        if (!room || room.ended || room.expiresAt <= now()) fail('Room expired.');
        if (sessions.size >= maxSessions || [...sessions.values()].some(s => s.id === room.id && s.wallet === c.wallet)) fail('Participant quota exhausted.');
        if (c.action === 'create') { rooms.set(room.id, room); used++; }
        const token = opaque(), expiresAt = Math.min(room.expiresAt, now() + 15 * 60000);
        sessions.set(token, { id: room.id, wallet: c.wallet, origin, expiresAt, seen: now() });
        return { token, expiresAt, id: room.id };
      });
    },
    command(token, input, origin) {
      return run(async () => {
        check(origin); await cleanup();
        const s = sessions.get(token), room = s && rooms.get(s.id);
        if (!s || s.origin !== origin || !room || room.ended || s.expiresAt <= now()) fail('Session expired.');
        s.seen = now();
        if (input.action === 'leave') {
          room.ended = true; await cleanup(); return { left: true };
        }
        if (input.action === 'state') return { expiresAt: s.expiresAt, participantCap: 2 };
        if (input.action !== 'connect') fail('Unknown control.');
        if (s.connected) fail('Already connected; authorize a new session.');
        s.connected = true;
        try {
          return await transport.connect({ id: room.id, identity: s.wallet,
            otherIdentity: s.wallet === room.owner ? room.guest : room.owner,
            publish: input.publish === true, expiresAt: s.expiresAt });
        } catch (error) { room.ended = true; await cleanup(); throw error; }
      });
    },
    tick: () => run(cleanup),
    close: () => run(async () => { clearInterval(timer); closed = true; challenges.clear(); await cleanup(); })
  };
}

async function handleConversationRequest(request, response, { service, allowedOrigins = [], livekitOrigin = '' } = {}) {
  const url = new URL(request.url, 'http://localhost'), prefix = '/api/dlang/conversation/';
  if (url.pathname === '/api/dlang/conversation/config') {
    const origin = String(request.headers.origin || '');
    const allowed = !origin || allowedOrigins.includes(origin);
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'origin',
      ...(origin && allowed ? { 'access-control-allow-origin': origin } : {}) };
    const send = (status, data) => { response.writeHead(status, headers); response.end(JSON.stringify(data)); };
    if (!allowed) { send(403, { configured: false, error: 'Origin not allowed.' }); return true; }
    if (request.method !== 'GET') { send(405, { configured: false, error: 'GET required.' }); return true; }
    if (!service?.configured || !livekitOrigin) {
      send(503, { configured: false, error: 'Private conversation unavailable.' }); return true;
    }
    send(200, { configured: true, endpoint: '/api/dlang/conversation', livekitOrigin });
    return true;
  }
  if (!url.pathname.startsWith(prefix)) return false;
  const origin = String(request.headers.origin || ''), allowed = allowedOrigins.includes(origin);
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'origin',
    ...(allowed ? { 'access-control-allow-origin': origin } : {}) };
  const send = (status, data) => { response.writeHead(status, headers); response.end(JSON.stringify(data)); };
  if (!allowed) { send(403, { error: 'Origin not allowed.' }); return true; }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...headers, 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization' }); response.end(); return true;
  }
  if (!service?.configured) { send(503, { error: 'Private conversation unavailable.' }); return true; }
  if (request.method !== 'POST') { send(405, { error: 'POST required.' }); return true; }
  try {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
      if (Buffer.byteLength(text) > 8192) throw Error('Request too large.');
    }
    const input = JSON.parse(text || '{}'), action = url.pathname.slice(prefix.length);
    if (action === 'challenge') send(200, await service.challenge(input, origin));
    else if (action === 'session') send(200, await service.authorize(input, origin));
    else if (action === 'control') send(200, await service.command(
      String(request.headers.authorization || '').replace(/^Bearer /, ''), input, origin));
    else send(404, { error: 'Unknown route.' });
  } catch { send(400, { error: 'Private conversation unavailable; check invitation, quota or service.' }); }
  return true;
}

// Load the operator-installed livekit-server-sdk externally; no secret defaults.
function createConversationTransport({ sdk, url, apiKey, apiSecret } = {}) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password ||
      endpoint.pathname !== '/' || endpoint.search || endpoint.hash || !apiKey || !apiSecret ||
      !sdk?.AccessToken || !sdk?.RoomServiceClient) throw Error('Private LiveKit transport is not configured.');
  const rooms = new sdk.RoomServiceClient(endpoint.href.replace(/^wss:/, 'https:'), apiKey, apiSecret);
  const created = new Set();
  let initializing;
  // Single operator instance per LiveKit project. Restart invalidates old rooms.
  function initialize() {
    initializing ||= (async () => {
      for (const room of await rooms.listRooms()) {
        if (/^conversation:[0-9a-f]{64}$/.test(room.name)) await rooms.deleteRoom(room.name);
      }
    })().catch(error => { initializing = null; throw error; });
    return initializing;
  }
  return {
    ready: true,
    initialize,
    async connect({ id, identity, otherIdentity, publish, expiresAt }) {
      await initialize();
      if (!created.has(id)) {
        await rooms.createRoom({ name: id, maxParticipants: 2, emptyTimeout: 30, departureTimeout: 5 });
        created.add(id);
      }
      const token = new sdk.AccessToken(apiKey, apiSecret, { identity, ttl: '30s' });
      token.addGrant({ roomJoin: true, room: id, canPublish: publish, canPublishSources: [2],
        canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
      return { url: endpoint.origin, token: await token.toJwt(), otherIdentity, expiresAt, participantCap: 2 };
    },
    async close(id) {
      try { await rooms.deleteRoom(id); }
      catch (error) {
        if (error.status !== 404 && error.statusCode !== 404 && error.code !== 'not_found') throw error;
      }
      created.delete(id);
    }
  };
}

module.exports = { createConversationService, handleConversationRequest, createConversationTransport };
