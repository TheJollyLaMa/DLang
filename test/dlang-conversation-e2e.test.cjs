const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const { createServer } = require('../index');
const { createConversationService } = require('../services/conversation.cjs');
const { createConversationOperator } = require('../services/conversation-operator.cjs');

test('pinned LiveKit server SDK signs an audio-only, short-lived room grant locally', async () => {
  const sdk = require('livekit-server-sdk');
  const token = new sdk.AccessToken('local-key', 'local-secret', { identity: 'local-learner', ttl: '30s' });
  token.addGrant({ roomJoin: true, room: 'conversation:local', canPublish: true,
    canPublishSources: [2], canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
  const jwt = await token.toJwt();
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  assert.equal(claims.video.room, 'conversation:local');
  assert.equal(claims.video.canPublishSources[0], 'microphone');
  assert.equal(claims.video.canPublishData, false);
  assert.equal(typeof sdk.RoomServiceClient, 'function');
});

const fakeSdk = {
  AccessToken: class {
    constructor(_key, _secret) {}
    addGrant() {}
    async toJwt() { return 'local-media-token'; }
  },
  RoomServiceClient: class {
    async listRooms() { return []; }
    async createRoom() {}
    async deleteRoom() {}
  }
};

test('operator config fails closed and uses bounded exact-origin settings', async () => {
  assert.equal(createConversationOperator({}).configured, false);
  const env = {
    DLANG_CONVERSATION_ORIGINS: 'https://dlang.example',
    DLANG_CONVERSATION_WALLETS: `${Wallet.createRandom().address},${Wallet.createRandom().address}`,
    DLANG_LIVEKIT_URL: 'wss://media.example',
    DLANG_LIVEKIT_API_KEY: 'local-key',
    DLANG_LIVEKIT_API_SECRET: 'local-secret'
  };
  const ready = createConversationOperator(env, () => fakeSdk);
  assert.equal(ready.configured, true);
  assert.equal(ready.livekitOrigin, 'wss://media.example');
  assert.equal(ready.service.configured, true);
  await ready.service.close();

  const invalid = createConversationOperator({ ...env, DLANG_CONVERSATION_ORIGINS: 'https://dlang.example/path' }, () => fakeSdk);
  assert.equal(invalid.configured, false);
  assert.equal(invalid.service, null);
});

test('same-origin config, wallet invitations and control traverse the real local HTTP host', async t => {
  const mediaOrigin = 'wss://media.example';
  const options = { conversationOrigins: [], conversationLivekitOrigin: mediaOrigin };
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const owner = Wallet.createRandom(), guest = Wallet.createRandom(), grants = [], closed = [];
  options.conversationOrigins.push(origin);
  options.conversationService = createConversationService({
    allowedOrigins: [origin], allowedWallets: [owner.address, guest.address],
    maxRooms: 1, maxSessions: 2, maxRoomsPerDay: 1,
    transport: {
      ready: true,
      async connect(input) {
        grants.push(input);
        return { url: mediaOrigin, token: `local-${input.identity}`, otherIdentity: input.otherIdentity,
          expiresAt: input.expiresAt, participantCap: 2 };
      },
      async close(id) { closed.push(id); }
    }
  });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await options.conversationService.close();
  });

  const configResponse = await fetch(`${origin}/api/dlang/conversation/config`);
  assert.equal(configResponse.status, 200);
  const runtimeConfig = await configResponse.json();
  assert.deepEqual(runtimeConfig, {
    configured: true, endpoint: '/api/dlang/conversation', livekitOrigin: mediaOrigin
  });
  assert.equal((await fetch(`${origin}/health`).then(response => response.json())).privateConversationConfigured, true);
  assert.equal((await fetch(`${origin}/api/dlang/conversation/config`, { headers: { Origin: 'https://evil.example' } })).status, 403);

  const { conversationConfig, createConversationService: createClient } =
    await import('../public/dlang/conversation-service.mjs');
  function walletProvider(wallet) {
    return { request: async ({ method, params }) => {
      if (method === 'personal_sign') return wallet.signMessage(Buffer.from(params[0].slice(2), 'hex'));
      return [wallet.address];
    } };
  }
  const fetchWithOrigin = (url, init) => fetch(url, {
    ...init, headers: { ...init.headers, Origin: origin }
  });
  const config = conversationConfig(runtimeConfig, origin);
  const a = createClient({ config, wallet: walletProvider(owner), origin, fetchImpl: fetchWithOrigin });
  const b = createClient({ config, wallet: walletProvider(guest), origin, fetchImpl: fetchWithOrigin });
  const invitation = await a.authorize({
    action: 'create', guest: guest.address, minutes: 1, consent: true, microphone: false
  });
  assert.match(invitation.id, /^conversation:[0-9a-f]{64}$/);
  const join = await b.authorize({ action: 'join', id: invitation.id, consent: true, microphone: true });
  assert.equal(join.id, invitation.id);
  assert.equal(join.url, mediaOrigin);
  assert.equal(grants.length, 2);
  assert.equal(grants[0].publish, false);
  assert.equal(grants[1].publish, true);
  assert.equal((await fetch(`${origin}/api/dlang/conversation/challenge`, {
    method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: '{}'
  })).status, 400);
  a.stop(); b.stop();
  await new Promise(resolve => setTimeout(resolve, 30));
  await options.conversationService.tick();
  assert.ok(closed.includes(invitation.id));
});
