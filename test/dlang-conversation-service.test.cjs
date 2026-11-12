const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const { createConversationService, handleConversationRequest, createConversationTransport } = require('../services/conversation.cjs');
const origin = 'https://dlang.example';
const owner = Wallet.createRandom(), guest = Wallet.createRandom();

function fixture() {
  let time = Date.now();
  const calls = [];
  const service = createConversationService({ allowedOrigins: [origin], allowedWallets: [owner.address, guest.address],
    maxRoomsPerDay: 1, now: () => time, transport: { ready: true,
      async connect(input) { calls.push(input); return { token: 'media', expiresAt: input.expiresAt, participantCap: 2 }; },
      async close(id) { calls.push(['close', id]); }
    } });
  async function sign(wallet, input) {
    const challenge = await service.challenge({ ...input, wallet: wallet.address }, origin);
    return service.authorize({ challengeId: challenge.challengeId,
      signature: await wallet.signMessage(challenge.message) }, origin);
  }
  return { service, calls, sign, advance: ms => { time += ms; } };
}
test('real wallet signatures, invitation, origin, replay, two participants and quota fail closed', async () => {
  const f = fixture();
  await assert.rejects(f.service.challenge({ wallet: owner.address }, 'https://evil.example'), /Origin/);
  await assert.rejects(f.service.challenge({ wallet: Wallet.createRandom().address }, origin), /admitted/);
  const challenge = await f.service.challenge({ action: 'create', wallet: owner.address, guest: guest.address, minutes: 1 }, origin);
  await assert.rejects(f.service.authorize({ challengeId: challenge.challengeId,
    signature: await guest.signMessage(challenge.message) }, origin), /Signature/);
  await assert.rejects(f.service.authorize({ challengeId: challenge.challengeId, signature: 'replay' }, origin), /expired/);
  const a = await f.sign(owner, { action: 'create', guest: guest.address, minutes: 1 });
  const b = await f.sign(guest, { action: 'join', id: a.id });
  await assert.rejects(f.sign(guest, { action: 'join', id: a.id }), /quota/);
  await assert.rejects(f.service.command(a.token, { action: 'connect' }, 'https://evil.example'), /Origin/);
  await f.service.command(a.token, { action: 'connect', publish: false }, origin);
  await f.service.command(b.token, { action: 'connect', publish: true }, origin);
  assert.equal(f.calls[0].publish, false); assert.equal(f.calls[1].publish, true);
  await assert.rejects(f.service.command(a.token, { action: 'connect' }, origin), /Already connected/);
  await f.service.command(b.token, { action: 'leave' }, origin);
  await assert.rejects(f.service.command(a.token, { action: 'state' }, origin), /expired/);
  f.advance(100000); await f.service.tick();
  await assert.rejects(f.sign(owner, { action: 'create', guest: guest.address, minutes: 1 }), /quota/);
  await f.service.close();
});
test('expiry and control loss revoke both peers; unconfigured transport is unavailable', async () => {
  const f = fixture(), a = await f.sign(owner, { action: 'create', guest: guest.address, minutes: 1 });
  f.advance(31000); await f.service.tick();
  assert.ok(f.calls.some(c => Array.isArray(c) && c[0] === 'close'));
  await assert.rejects(f.service.command(a.token, { action: 'state' }, origin), /expired/);
  const service = createConversationService();
  assert.equal(service.configured, false);
  await assert.rejects(service.challenge({}, origin), /unavailable/);
});
test('HTTP handler requires exact allowed origin, bounded body and explicit configured service', async () => {
  const { Readable } = require('node:stream');
  async function invoke({ url = '/api/dlang/conversation/challenge', method = 'POST', requestOrigin = origin, body = '{}' } = {}) {
    const request = Readable.from([body]);
    Object.assign(request, { url, method, headers: { origin: requestOrigin } });
    const result = {};
    const response = { writeHead(status, headers) { result.status = status; result.headers = headers; },
      end(body) { result.body = body; } };
    result.handled = await handleConversationRequest(request, response, {
      allowedOrigins: [origin], service: { configured: true, challenge: async input => input }
    });
    return result;
  }
  assert.equal((await invoke()).status, 200);
  assert.equal((await invoke({ requestOrigin: 'https://evil.example' })).status, 403);
  assert.equal((await invoke({ body: 'x'.repeat(8193) })).status, 400);
  assert.equal((await invoke({ method: 'OPTIONS' })).status, 204);
  assert.equal((await invoke({ url: '/api/unrelated' })).handled, false);
});
test('trusted frontend service rejects redirects, malformed challenges and wallet switch', async () => {
  const { conversationConfig, createConversationService: client } = await import('../public/dlang/conversation-service.mjs');
  const config = { endpoint: 'https://dlang.example/api/dlang/conversation', livekitOrigin: 'wss://media.example' };
  for (const endpoint of ['http://evil.example/api/dlang/conversation', 'https://dlang.example/other',
    'https://user:pass@trusted.example/api/dlang/conversation']) {
    assert.throws(() => conversationConfig({ ...config, endpoint }, origin), /configuration/);
  }
  const calls = [];
  const wallet = { request: async input => { calls.push(input.method); return [owner.address]; } };
  const c = client({ config, wallet, origin, fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    return Response.json({ message: 'Sign an unrelated transaction', challengeId: 'x' });
  } });
  await assert.rejects(c.authorize({ action: 'create', guest: guest.address, consent: true }), /challenge/);
  assert.deepEqual(calls, ['eth_requestAccounts']); c.stop();
});
test('provider transport creates private capped room with short audio-only grant', async () => {
  const calls = [];
  const sdk = {
    AccessToken: class {
      constructor(_key, _secret, options) { calls.push(options); }
      addGrant(grant) { calls.push(grant); }
      async toJwt() { return 'server-signed'; }
    },
    RoomServiceClient: class {
      async listRooms() { return []; }
      async createRoom(options) { calls.push(options); }
      async deleteRoom(id) { calls.push(['delete', id]); }
    }
  };
  const transport = createConversationTransport({ sdk, url: 'wss://media.example', apiKey: 'fixture', apiSecret: 'fixture' });
  const grant = await transport.connect({ id: 'conversation:private', identity: owner.address,
    otherIdentity: guest.address, publish: true, expiresAt: Date.now() + 60000 });
  assert.equal(grant.token, 'server-signed');
  assert.equal(calls[0].maxParticipants, 2);
  assert.equal(calls[1].ttl, '30s');
  assert.deepEqual(calls[2].canPublishSources, [2]);
  assert.equal(calls[2].canPublishData, false);
  await transport.close('conversation:private');
});

test('wallet change cancels pending signature and never authorizes or captures', async () => {
  const { createConversationService: client, challengeMessage } = await import('../public/dlang/conversation-service.mjs');
  const config = { endpoint: 'https://dlang.example/api/dlang/conversation', livekitOrigin: 'wss://media.example' };
  let release, signing;
  const entered = new Promise(resolve => { signing = resolve; }), requests = [];
  const wallet = { request: async ({ method }) => {
    if (method === 'personal_sign') { signing(); return new Promise(resolve => { release = resolve; }); }
    return [owner.address];
  } };
  const c = client({ config, wallet, origin, fetchImpl: async (url, options) => {
    requests.push(url);
    const input = JSON.parse(options.body), expiresAt = Date.now() + 60000,
      challengeId = 'c'.repeat(64), id = `conversation:${'d'.repeat(64)}`;
    return Response.json({ id, challengeId, expiresAt, message: challengeMessage({
      action: input.action, wallet: input.wallet, guest: input.guest, id, origin, expiresAt, challengeId
    }) });
  } });
  const pending = c.authorize({ action: 'create', guest: guest.address, consent: true });
  await entered; c.stop(); release('signature');
  assert.equal(await pending, null);
  assert.equal(requests.length, 1);
});
