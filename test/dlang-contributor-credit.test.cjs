const test = require('node:test');
const assert = require('node:assert/strict');

test('public wallet or ENS credit binds the signing contributor, never an unrelated payout address', async () => {
  const { resolveContributorCredit } = await import('../public/dlang/identity.mjs');
  const wallet = '0x' + 'a'.repeat(40), other = '0x' + 'b'.repeat(40);
  assert.deepEqual(await resolveContributorCredit(wallet.toUpperCase().replace('0X', '0x'), wallet),
    { kind: 'wallet', credit: wallet, wallet });
  let lookedUp;
  const provider = { getNetwork: async () => ({ chainId: 1n }),
    resolveName: async name => { lookedUp = name; return wallet; } };
  assert.deepEqual(await resolveContributorCredit(' TheJollyLaMa.eth ', wallet, provider),
    { kind: 'ens', credit: 'thejollylama.eth', wallet });
  assert.equal(lookedUp, 'thejollylama.eth');
  await assert.rejects(resolveContributorCredit(other, wallet), /signing contributor/);
  await assert.rejects(resolveContributorCredit('someone.eth', wallet,
    { ...provider, resolveName: async () => other }), /signing contributor/);
  await assert.rejects(resolveContributorCredit('missing.eth', wallet,
    { ...provider, resolveName: async () => null }), /no valid wallet/);
  await assert.rejects(resolveContributorCredit('name.eth', wallet,
    { ...provider, getNetwork: async () => ({ chainId: 8453n }) }), /mainnet/);
  await assert.rejects(resolveContributorCredit('name.eth', wallet), /mainnet/);
  for (const credit of ['Nickname', 'https://name.eth', 'foo..eth', '-foo.eth', 'foo-.eth', '0x123']) {
    await assert.rejects(resolveContributorCredit(credit, wallet, provider), /wallet address or ASCII/);
  }
  await assert.rejects(resolveContributorCredit(wallet, 'not a wallet'), /valid contributor/);
  await assert.rejects(resolveContributorCredit('name.eth', wallet,
    { ...provider, resolveName: async () => { throw Error('ENS provider unavailable'); } }), /provider unavailable/);
});
