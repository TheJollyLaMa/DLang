const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../index');

test('host routes private conversation before static method refusal without enabling a service', async t => {
  const origin = 'https://thejollylama.github.io';
  const server = createServer({ conversationOrigins: [origin], conversationLivekitOrigin: 'wss://private.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = await fetch(base + '/api/dlang/conversation/challenge', {
    method: 'POST', headers: { Origin: origin, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(request.status, 503);
  assert.ok(request.headers.get('content-security-policy').includes('wss://private.example'));
  const rejected = await fetch(base + '/api/dlang/conversation/challenge', {
    method: 'POST', headers: { Origin: 'https://untrusted.example', 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(rejected.status, 403);
  const unrelated = await fetch(base + '/api/pay', { method: 'POST', body: '{}' });
  assert.equal(unrelated.status, 405);
});

test('host refuses credentials, paths and non-WSS conversation origins', () => {
  for (const origin of ['https://private.example', 'wss://key:secret@private.example', 'wss://private.example/path', 'wss://private.example?token=secret']) {
    assert.throws(() => createServer({ conversationLivekitOrigin: origin }), /exact WSS origin/);
  }
});
