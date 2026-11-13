import test from 'node:test';
import assert from 'node:assert/strict';
import { Contract, id, keccak256 } from 'ethers';
import { setup, mined } from './staircase-fixture.mjs';
import { compileContract } from './ommm-artifact.mjs';
import { verifyVoiceFunding, USDC } from '../services/voice-pool-verification.cjs';
import { assertGasBudget, GAS_CAP, SETTLEMENT_RESERVE, verifyVoiceSettlement } from './voice-pilot.mjs';

const artifact = compileContract('OmmmVoicePilot');
async function fixture(t) {
  const f = await setup(t);
  await f.provider.send('evm_setAccountCode', [USDC, await f.provider.getCode(f.asset.target)]);
  const asset = new Contract(USDC, f.asset.interface, f.signers[0]);
  await mined(asset.mint(f.addresses[0], 1000000n));
  const voice = await f.deploy(artifact, [USDC, f.addresses[0]]);
  await mined(asset.approve(voice.target, 1000000n));
  const funding = await mined(voice.bootstrap());
  const start = Number(await voice.WEEK_START()), end = Number(await voice.WEEK_END());
  return { ...f, asset, voice, funding, start, end };
}
test('separate exact $1 native Base USDC bootstrap backs 10000 Ommm; learning holdings untouched; runtime receipt verifies', async t => {
  const f = await fixture(t);
  assert.equal(await f.voice.totalSupply(), 10000n * 10n ** 18n);
  assert.equal(await f.voice.reserveAssets(), 1000000n);
  assert.equal(await f.voice.currentStep(), 100n);
  assert.equal(await f.pool.reserveAssets(), 440000n);
  assert.equal(await f.pool.totalSupply(), 4400n * 10n ** 18n);
  await assert.rejects(f.voice.bootstrap());
  await assert.rejects(f.voice.fund(1));
  await assert.rejects(f.voice.fundAndMint(1, 1));
  await assert.rejects(f.voice.awardDay(f.addresses[1], 1, id('fake')));
  await assert.rejects(f.voice.awardLevel(f.addresses[1], 1, id('fake')));
  assert.equal(await verifyVoiceFunding(f.provider, { pool: f.voice.target, runtimeHash: keccak256(await f.provider.getCode(f.voice.target)),
    start: f.start, end: f.end, units: (await f.voice.VOICE_SUPPLY()).toString(), transactionHash: f.funding.hash }), true);
});
test('weekly exact inventory transfer is atomic, sorted, owner-gated and single-use; redemption preserves backing', async t => {
  const f = await fixture(t), supply = await f.voice.VOICE_SUPPLY();
  const recipients = f.addresses.slice(1, 3).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const amounts = [supply / 3n, supply - supply / 3n];
  await assert.rejects(f.voice.settleVoiceWeek(recipients, amounts, id('early')));
  await f.at(f.end);
  await assert.rejects(f.voice.connect(f.signers[1]).settleVoiceWeek(recipients, amounts, id('wrong-owner')));
  await assert.rejects(f.voice.settleVoiceWeek([...recipients].reverse(), amounts, id('unsorted')));
  await assert.rejects(f.voice.settleVoiceWeek([recipients[0], recipients[0]], amounts, id('duplicate')));
  await assert.rejects(f.voice.settleVoiceWeek(recipients, [1, 1], id('under')));
  await assert.rejects(f.voice.settleVoiceWeek(recipients, amounts, `0x${'0'.repeat(64)}`));
  const evidence = id('exact-receipts');
  const receipt = await mined(f.voice.settleVoiceWeek(recipients, amounts, evidence));
  assert.equal((await verifyVoiceSettlement(f.voice, receipt, { evidence, outcome: 'allocated',
    allocations: recipients.map((address, i) => ({ address: address.toLowerCase(), units: amounts[i].toString() })) })).payoutConfirmed, true);
  assert.equal(await f.voice.balanceOf(f.voice.target), 0n);
  assert.equal(await f.voice.totalSupply(), supply);
  await assert.rejects(f.voice.settleVoiceWeek(recipients, amounts, id('retry')));
  const index = f.addresses.indexOf(recipients[0]);
  const assets = await f.voice.previewRedeem(amounts[0]);
  await mined(f.voice.connect(f.signers[index]).redeem(amounts[0], assets));
  assert.equal(await f.asset.balanceOf(f.voice.target), 1000000n - assets);
  assert.equal(await f.pool.reserveAssets(), 440000n);
});
test('zero plays carry inventory without payout; owner can recover holder backing/dividends then retire; two-step custody preserved', async t => {
  const f = await fixture(t);
  await mined(f.voice.transferOwnership(f.addresses[1]));
  assert.equal(await f.voice.owner(), f.addresses[0]);
  await mined(f.voice.connect(f.signers[1]).acceptOwnership());
  await f.at(f.end);
  const receipt = await mined(f.voice.connect(f.signers[1]).settleVoiceWeek([], [], id('no-plays')));
  const events = receipt.logs.map(row => { try { return f.voice.interface.parseLog(row); } catch { return null; } });
  assert.ok(events.some(row => row?.name === 'VoiceWeekCarried'));
  assert.ok(!events.some(row => row?.name === 'VoiceWeekSettled'));
  assert.deepEqual(await verifyVoiceSettlement(f.voice, receipt, { evidence: id('no-plays'), outcome: 'carry-zero-plays', allocations: [] }),
    { payoutConfirmed: false, carryConfirmed: true, outcome: 'carry-zero-plays' });
  assert.equal(await f.voice.balanceOf(f.voice.target), await f.voice.VOICE_SUPPLY());
  await mined(f.voice.connect(f.signers[1]).recoverPrototype(USDC, f.addresses[2]));
  assert.equal(await f.voice.prototypeRetired(), true);
  assert.equal(await f.voice.reserveAssets(), 0n);
  await assert.rejects(f.voice.connect(f.signers[1]).settleVoiceWeek([], [], id('retired')));
});
test('launch gas guard reserves settlement within additional cap; native token identity and late bootstrap cannot change', async t => {
  assert.doesNotThrow(() => assertGasBudget(0n, GAS_CAP - SETTLEMENT_RESERVE, SETTLEMENT_RESERVE));
  assert.throws(() => assertGasBudget(1n, GAS_CAP - SETTLEMENT_RESERVE, SETTLEMENT_RESERVE), /cap/);
  assert.throws(() => assertGasBudget(0n, 0n), /cap/);
  const f = await setup(t);
  await assert.rejects(f.deploy(artifact, [f.asset.target, f.addresses[0]]));
  await f.provider.send('evm_setAccountCode', [USDC, await f.provider.getCode(f.asset.target)]);
  const prefunded = await f.deploy(artifact, [USDC, f.addresses[0]]);
  const native = new Contract(USDC, f.asset.interface, f.signers[0]);
  await mined(native.mint(prefunded.target, 1n));
  await assert.rejects(prefunded.bootstrap());
  const voice = await f.deploy(artifact, [USDC, f.addresses[0]]);
  await f.at(Number(await voice.WEEK_START()));
  await assert.rejects(voice.bootstrap());
});
test('voice prototype recovery also takes holder backing and dividend liabilities, voiding future payouts but preserving balances', async t => {
  const f = await fixture(t), supply = await f.voice.VOICE_SUPPLY();
  await f.at(f.end);
  await mined(f.voice.settleVoiceWeek([f.addresses[1]], [supply], id('holder')));
  await mined(f.asset.mint(f.voice.target, 20000000000n));
  await mined(f.voice.checkpoint());
  assert.ok(await f.voice.claimableDividend(f.addresses[1]) > 0n);
  const held = await f.asset.balanceOf(f.voice.target);
  await mined(f.voice.recoverPrototype(USDC, f.addresses[2]));
  assert.equal(await f.voice.balanceOf(f.addresses[1]), supply);
  assert.equal(await f.voice.claimableDividend(f.addresses[1]), 0n);
  assert.equal(await f.asset.balanceOf(f.addresses[2]), held);
  await assert.rejects(f.voice.claimDividendFor(f.addresses[1]));
  await assert.rejects(f.voice.connect(f.signers[1]).redeem(supply, 1));
  assert.equal(await f.pool.reserveAssets(), 440000n);
});
