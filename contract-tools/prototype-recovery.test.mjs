import test from 'node:test';
import assert from 'node:assert/strict';
import { id, parseEther, ZeroAddress } from 'ethers';
import { setup, mined } from './staircase-fixture.mjs';

test('reserve full recovery voids holder backing and dividends, retires permanently and preserves history', async t => {
  const f = await setup(t);
  await f.award();
  await mined(f.pool.fund(8_800_000_000n - 440_000n));
  assert.equal(await f.pool.claimableDividend(f.addresses[1]), 1_000_000n);
  const before = await f.asset.balanceOf(f.addresses[0]);
  await assert.rejects(() => f.pool.connect(f.signers[1]).recoverPrototype(f.asset.target, f.addresses[1]));
  await assert.rejects(() => f.pool.recoverPrototype(f.asset.target, ZeroAddress));
  await assert.rejects(() => f.pool.recoverPrototype(f.asset.target, f.pool.target));
  for (const mode of [1, 2]) {
    await f.configureAsset(mode);
    await assert.rejects(() => f.pool.recoverPrototype.staticCall(f.asset.target, f.addresses[0]));
    assert.equal(await f.pool.prototypeRetired(), false);
  }
  await f.configureAsset();
  const receipt = await mined(f.pool.recoverPrototype(f.asset.target, f.addresses[0]));
  assert.ok(receipt.logs.some(log => {
    try { return f.pool.interface.parseLog(log)?.name === 'PrototypeRecovery'; } catch { return false; }
  }));
  assert.equal(await f.asset.balanceOf(f.addresses[0]) - before, 8_800_000_000n);
  assert.equal(await f.pool.prototypeRetired(), true);
  assert.equal(await f.pool.funded(), false);
  assert.equal(await f.pool.reserveAssets(), 0n);
  assert.equal(await f.pool.claimableDividend(f.addresses[1]), 0n);
  assert.equal(await f.pool.accumulatedDividend(f.addresses[1]), 1_000_000n);
  assert.equal(await f.pool.dividendLiabilities(), 4_400_000_000n);
  assert.equal(await f.pool.balanceOf(f.addresses[1]), parseEther('1'));
  for (const action of [
    () => f.pool.bootstrap(), () => f.pool.fund(1), () => f.pool.checkpoint(),
    () => f.pool.claimDividendFor(f.addresses[1]),
    () => f.pool.withdrawInventoryDividend(f.addresses[0], 1),
    () => f.pool.connect(f.signers[1]).redeem(parseEther('1'), 1),
    () => f.pool.connect(f.signers[1]).transfer(f.addresses[2], 1),
    () => f.pool.fundAndMint(1, 1), () => f.pool.disablePrototypeRecovery(), () => f.award(2)
  ]) await assert.rejects(action);
  await mined(f.asset.transfer(f.pool.target, 123));
  await mined(f.pool.recoverPrototype(f.asset.target, f.addresses[0]));
  assert.equal(await f.asset.balanceOf(f.pool.target), 0n);
});

test('weekly recovery can take refundable deposits, halts all workflows and preserves liability evidence', async t => {
  const f = await setup(t);
  const r = await f.open();
  await f.join(r, 1);
  await assert.rejects(() => f.trial.connect(f.signers[1]).recoverPrototype(f.asset.target, f.addresses[1]));
  for (const mode of [1, 2]) {
    await f.configureAsset(mode);
    await assert.rejects(() => f.trial.recoverPrototype.staticCall(f.asset.target, f.addresses[0]));
    assert.equal(await f.trial.prototypeRetired(), false);
  }
  await f.configureAsset();
  const before = await f.asset.balanceOf(f.addresses[0]);
  await mined(f.trial.recoverPrototype(f.asset.target, f.addresses[0]));
  assert.equal(await f.asset.balanceOf(f.addresses[0]) - before, 1_000_000n);
  assert.equal(await f.trial.prototypeRetired(), true);
  assert.equal(await f.trial.stopped(), true);
  assert.equal(await f.trial.liabilities(), 1_000_000n);
  assert.equal(await f.trial.enrolled(r.round, f.addresses[1]), true);
  for (const action of [
    () => f.join(r, 2), () => f.open(), () => f.trial.cancel(r.round),
    () => f.trial.stop(), () => f.trial.finalize(r.round), () => f.trial.fundStaircase(),
    () => f.trial.claimFor(f.addresses[1]), () => f.trial.expire(r.round),
    () => f.trial.propose(r.round, [76, 0, 0, 0], id('retired')),
    () => f.trial.transferSteward(f.addresses[1]), () => f.trial.disablePrototypeRecovery()
  ]) await assert.rejects(action);
  await mined(f.asset.transfer(f.trial.target, 123));
  await mined(f.trial.recoverPrototype(f.asset.target, f.addresses[0]));
  assert.equal(await f.asset.balanceOf(f.trial.target), 0n);
});

test('both prototypes recover native and unrelated ERC20 donations without reentrant recovery', async t => {
  const f = await setup(t);
  for (const contract of [f.pool, f.trial]) {
    await assert.rejects(() => contract.recoverPrototype(ZeroAddress, f.addresses[0]));
    await mined(f.signers[0].sendTransaction({ to: contract.target, value: 12345n }));
    await mined(contract.recoverPrototype(ZeroAddress, f.addresses[1]));
    assert.equal(BigInt(await f.provider.send('eth_getBalance', [contract.target, 'latest'])), 0n);
    await mined(f.asset.transfer(contract.target, 100n));
    await mined(f.asset.setCallback(contract.target,
      contract.interface.encodeFunctionData('recoverPrototype', [f.asset.target, f.addresses[0]])));
    await mined(contract.recoverPrototype(f.asset.target, f.addresses[0]));
    assert.equal(await f.asset.callbackSucceeded(), false);
  }
});

test('custody handoff is two-step; sealing recovery is irreversible without changing normal refunds', async t => {
  const f = await setup(t);
  await mined(f.pool.transferOwnership(f.addresses[2]));
  assert.equal(await f.pool.owner(), f.addresses[0]);
  await assert.rejects(() => f.pool.connect(f.signers[1]).acceptOwnership());
  await mined(f.pool.connect(f.signers[2]).acceptOwnership());
  await assert.rejects(() => f.pool.recoverPrototype(f.asset.target, f.addresses[0]));
  await mined(f.pool.connect(f.signers[2]).disablePrototypeRecovery());
  await assert.rejects(() => f.pool.connect(f.signers[2]).recoverPrototype(f.asset.target, f.addresses[2]));
  await assert.rejects(() => f.trial.transferSteward(ZeroAddress));
  await mined(f.trial.transferSteward(f.addresses[2]));
  assert.equal(await f.trial.steward(), f.addresses[0]);
  await assert.rejects(() => f.trial.connect(f.signers[1]).acceptSteward());
  await mined(f.trial.connect(f.signers[2]).acceptSteward());
  await assert.rejects(() => f.trial.recoverPrototype(f.asset.target, f.addresses[0]));
  await mined(f.trial.connect(f.signers[2]).disablePrototypeRecovery());
  await assert.rejects(() => f.trial.connect(f.signers[2]).recoverPrototype(f.asset.target, f.addresses[2]));
  const start = await f.now() + 100;
  await mined(f.trial.connect(f.signers[2]).openRound(start, start + 6 * 86400, id('group')));
  await mined(f.trial.connect(f.signers[1]).join(1, id('es')));
  await mined(f.trial.connect(f.signers[2]).cancel(1));
  await mined(f.trial.claimFor(f.addresses[1]));
  assert.equal(await f.trial.liabilities(), 0n);
  assert.equal(await f.pool.funded(), true);
});
