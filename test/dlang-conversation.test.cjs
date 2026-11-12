const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

test('typed prompts use only scene concepts and never score or invent a response', async () => {
  const { conversationPrompt } = await import('../public/dlang/conversation.mjs');
  const context = { sceneId: 's', level: 2, language: 'es', concepts: ['cat', 'cup'] };
  assert.match(conversationPrompt(context), /gato/);
  assert.match(conversationPrompt(context, 1), /taza/);
  assert.match(conversationPrompt(context, 2), /gato/);
  assert.equal(conversationPrompt(null), null);
  assert.equal(conversationPrompt({ concepts: [] }), null);
});

test('offline typed practice is bounded, remountable and cleared on block and scene change', async t => {
  const dir = path.join(__dirname, '../public');
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.end('<script defer src="/dlang/vendor/livekit-client-2.24.0.umd.js"></script><div id="conversation-root"></div>');
      return;
    }
    if (req.url === '/dlang/vendor/livekit-client-2.24.0.umd.js') {
      res.setHeader('content-type', 'text/javascript');
      fs.createReadStream(path.join(dir, req.url)).pipe(res); return;
    }
    if (!/^\/dlang\/[a-z-]+\.mjs$/.test(req.url)) { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'text/javascript');
    fs.createReadStream(path.join(dir, req.url)).pipe(res);
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await page.evaluate(() => typeof window.LivekitClient?.Room), 'function');
  await page.evaluate(async () => {
    const { mountConversation } = await import('/dlang/conversation.mjs');
    window.scene = { sceneId: 's1', sceneVersion: 'v1', title: 'Kitchen', level: 1, language: 'es', concepts: ['cat', 'cup'] };
    window.mount = () => mountConversation({ getSceneContext: () => window.scene });
    window.practice = window.mount();
  });
  await page.locator('textarea').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Next turn' }).click();
  assert.match(await page.locator('#conversation-root > ol').innerText(), /<img/);
  assert.equal(await page.locator('#conversation-root > ol img').count(), 0);
  assert.match(await page.locator('[aria-live]').innerText(), /taza/);
  await page.evaluate(() => { window.scene = { ...window.scene, sceneId: 's2' }; window.practice.refreshContext(); });
  assert.equal(await page.locator('#conversation-root > ol li').count(), 0);
  await page.locator('textarea').fill('hello');
  await page.getByRole('button', { name: 'Next turn' }).click();
  await page.evaluate(() => window.practice.setBlocked(true));
  assert.equal(await page.locator('#conversation-root > ol li').count(), 0);
  assert.equal(await page.locator('textarea').isDisabled(), true);
  await page.evaluate(() => { window.scene = null; window.practice.setBlocked(false); });
  assert.equal(await page.locator('textarea').isDisabled(), true);
  await page.evaluate(() => { window.scene = { sceneId: 's3', language: 'en', concepts: ['book'] }; window.practice = window.mount(); });
  assert.equal(await page.locator('textarea').count(), 1);
  assert.match(await page.locator('[aria-live]').innerText(), /book/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.match(await page.locator('#conversation-root').innerText(), /no service is configured/);
  assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${server.address().port}/`)));
  await page.evaluate(async () => {
    const { mountConversation } = await import('/dlang/conversation.mjs');
    const { challengeMessage } = await import('/dlang/conversation-service.mjs');
    window.liveCalls = [];
    const walletAddress = `0x${'1'.repeat(40)}`, id = `conversation:${'a'.repeat(64)}`, nonce = 'b'.repeat(64);
    const wallet = { request: async ({ method }) => {
      window.liveCalls.push(method); return method === 'personal_sign' ? 'signature' : [walletAddress];
    } };
    class Room {
      constructor() {
        this.remoteParticipants = new Map();
        this.localParticipant = { publishTrack: async () => window.liveCalls.push('publish') };
      }
      on() {}
      async connect() { window.liveCalls.push('connect'); }
      async startAudio() {}
      async disconnect() { window.liveCalls.push('disconnect'); }
    }
    window.practice = mountConversation({
      getSceneContext: () => window.scene,
      config: { endpoint: `${location.origin}/api/dlang/conversation`, livekitOrigin: 'wss://audio.example' },
      wallet, sdk: { Room, RoomEvent: {}, Track: { Source: { Microphone: 'mic' } },
        createLocalAudioTrack: async () => {
          window.liveCalls.push('capture');
          return { stop: () => window.liveCalls.push('stop'), mute: async () => window.liveCalls.push('mute') };
        } },
      fetchImpl: async (url, options) => {
        window.liveCalls.push(url);
        const input = JSON.parse(options.body), expiresAt = Date.now() + 60000;
        if (url.endsWith('/challenge')) return Response.json({ challengeId: nonce, id, expiresAt,
          message: challengeMessage({ action: input.action, wallet: input.wallet, guest: input.guest,
            id, expiresAt, origin: location.origin, challengeId: nonce }) });
        if (url.endsWith('/session')) return Response.json({ token: 'session' });
        if (input.action === 'connect') return Response.json({ token: 'grant', url: 'wss://audio.example/',
          otherIdentity: 'guest', participantCap: 2, expiresAt });
        return Response.json({ left: true });
      }
    });
  });
  assert.deepEqual(await page.evaluate(() => window.liveCalls), []);
  await page.getByRole('button', { name: 'Create private room' }).click();
  assert.deepEqual(await page.evaluate(() => window.liveCalls), []);
  await page.getByLabel('Invited wallet').fill(`0x${'2'.repeat(40)}`);
  await page.getByLabel(/I consent/).check();
  await page.getByRole('button', { name: 'Create private room' }).click();
  await page.waitForFunction(() => window.liveCalls.includes('connect'));
  assert.equal(await page.evaluate(() => window.liveCalls.includes('capture')), false);
  await page.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByLabel(/Enable microphone/).check();
  await page.getByRole('button', { name: 'Create private room' }).click();
  await page.waitForFunction(() => window.liveCalls.includes('publish'));
  await page.getByRole('button', { name: 'Mute / interrupt' }).click();
  assert.equal(await page.evaluate(() => window.liveCalls.includes('mute')), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dlang:wallet', { detail: { address: 'changed' } })));
  assert.equal(await page.evaluate(() => window.liveCalls.includes('stop')), true);
  assert.equal(await page.getByLabel(/I consent/).isChecked(), false);
  await page.evaluate(() => window.practice.setBlocked(true));
  assert.equal(await page.getByRole('button', { name: 'Create private room' }).isDisabled(), true);
  await page.evaluate(() => window.practice.dispose());
  assert.equal(await page.locator('#conversation-root').innerText(), '');
});

function fixture({ deny = false, connectFailure = false, deferCapture = false } = {}) {
  const events = new EventTarget(), calls = [], rooms = [];
  let release;
  const capture = { stop() { calls.push('stop'); }, async mute() { calls.push('mute'); } };
  const event = { TrackPublished: 'published', TrackSubscribed: 'subscribed',
    TrackUnsubscribed: 'unsubscribed', Disconnected: 'disconnected' };
  class Room {
    constructor() { this.handlers = {}; this.remoteParticipants = new Map(); this.localParticipant = { publishTrack: async () => calls.push('publish') }; rooms.push(this); }
    on(name, handler) { this.handlers[name] = handler; }
    async connect(url, token, options) { calls.push(['connect', url, token, options]); if (connectFailure) throw Error('network'); }
    async disconnect() { calls.push('disconnect'); }
    async startAudio() { calls.push('play'); }
  }
  const sdk = { Room, RoomEvent: event, Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'mic' } },
    async createLocalAudioTrack() {
      calls.push('capture');
      if (deny) throw Error('denied');
      if (deferCapture) await new Promise(resolve => { release = resolve; });
      return capture;
    } };
  const audio = { pause() { calls.push('pause'); }, play() { calls.push('remote-play'); }, srcObject: null };
  let clock = 1000, expire;
  const grant = { url: 'wss://audio.example/', token: 'media-token', otherIdentity: 'guest',
    participantCap: 2, expiresAt: clock + 60_000 };
  const options = { sdk, audio, livekitOrigin: 'wss://audio.example', events,
    now: () => clock, setTimer: callback => { expire = callback; return 1; }, clearTimer() {} };
  return { options, calls, rooms, grant, events, release: () => release(), expire: () => expire(), clock: n => { clock = n; } };
}

test('LiveKit adapter checks consent, trusted origin, cap and short expiry before sending token', async () => {
  const { createConversationLiveKit } = await import('../public/dlang/conversation-livekit.mjs');
  const f = fixture(), room = createConversationLiveKit(f.options);
  await assert.rejects(room.start({ grant: f.grant }), /Consent/);
  for (const change of [{ url: 'wss://evil.example/' }, { participantCap: 3 }, { expiresAt: 1 },
    { expiresAt: 1000 + 16 * 60_000 }]) {
    await assert.rejects(room.start({ consent: true, grant: { ...f.grant, ...change } }), /grant/);
  }
  assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === 'connect'), false);
  await room.start({ consent: true, grant: f.grant, microphone: true });
  assert.ok(f.calls.includes('capture'));
  await room.interrupt();
  assert.ok(f.calls.includes('mute'));
  f.events.dispatchEvent(new Event('dlang:wallet'));
  assert.ok(f.calls.includes('stop'));
  assert.ok(f.calls.includes('disconnect'));
  room.dispose();
});

test('permission denial, network failure, expiry and cancellation clean up', async () => {
  const { createConversationLiveKit } = await import('../public/dlang/conversation-livekit.mjs');
  for (const options of [{ deny: true }, { connectFailure: true }]) {
    const f = fixture(options), room = createConversationLiveKit(f.options);
    await assert.rejects(room.start({ consent: true, grant: f.grant, microphone: true }), /could not connect/);
    assert.ok(f.calls.includes('disconnect')); room.dispose();
  }
  const f = fixture(), room = createConversationLiveKit(f.options);
  await room.start({ consent: true, grant: f.grant, microphone: true });
  f.expire();
  assert.ok(f.calls.includes('stop')); assert.ok(f.calls.includes('disconnect')); room.dispose();
  const pending = fixture({ deferCapture: true }), other = createConversationLiveKit(pending.options);
  const start = other.start({ consent: true, grant: pending.grant, microphone: true });
  await new Promise(resolve => setImmediate(resolve));
  other.stop(); pending.release(); await start;
  assert.ok(pending.calls.includes('stop'));
  assert.equal(pending.calls.includes('publish'), false); other.dispose();
});

test('only the invited identity is subscribed and disconnect clears media', async () => {
  const { createConversationLiveKit } = await import('../public/dlang/conversation-livekit.mjs');
  const f = fixture(), room = createConversationLiveKit(f.options);
  await room.start({ consent: true, grant: f.grant, microphone: true });
  const handlers = f.rooms[0].handlers;
  const publication = { kind: 'audio', setSubscribed: value => f.calls.push(['subscribed', value]) };
  handlers.published(publication, { identity: 'stranger' });
  handlers.published(publication, { identity: 'guest' });
  assert.deepEqual(f.calls.filter(c => Array.isArray(c) && c[0] === 'subscribed'), [['subscribed', true]]);
  const remote = { kind: 'audio', attach: () => f.calls.push('attach'), detach: () => f.calls.push('detach') };
  handlers.subscribed(remote, publication, { identity: 'stranger' });
  assert.equal(f.calls.includes('attach'), false);
  handlers.subscribed(remote, publication, { identity: 'guest' });
  assert.ok(f.calls.includes('attach'));
  handlers.disconnected();
  assert.ok(f.calls.includes('detach')); assert.ok(f.calls.includes('stop'));
  room.dispose();
});
