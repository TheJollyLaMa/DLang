import test from 'node:test';
import assert from 'node:assert/strict';
import { id, parseEther, ZeroAddress, ZeroHash } from 'ethers';
import { setup, mined, staircaseArtifact, trialArtifact } from './staircase-fixture.mjs';

const supply = parseEther('4400');
const dollarReserve = 4_400_000_000n;
const doubleReserve = dollarReserve * 2n;
const fundTo = async (f, target) => mined(f.pool.fund(target - await f.pool.reserveAssets()));
const claimable = (f, i) => f.pool.claimableDividend(f.addresses[i]);

test('successors are distinct, validate configuration, and refuse unfunded awards/enrollment', async t => {
  const f = await setup(t, { bootstrap: false });
  assert.equal(await f.pool.totalSupply(), supply);
  assert.equal(await f.pool.balanceOf(f.pool.target), supply);
  assert.equal(await f.pool.reserveAssets(), 0n);
  assert.equal(await f.pool.currentStep(), 0n);
  await assert.rejects(() => f.award());
  await assert.rejects(() => f.pool.checkpoint());
  await assert.rejects(() => f.pool.fund(1n));
  const r = await f.open();
  await assert.rejects(() => f.join(r, 1));
  for (const args of [[ZeroAddress, f.addresses[0]], [f.pool.target, f.addresses[0]], [f.asset.target, ZeroAddress]]) {
    await assert.rejects(() => f.deploy(staircaseArtifact, args));
  }
  for (const args of [
    [f.asset.target, f.addresses[0], f.members, ZeroAddress],
    [f.asset.target, f.addresses[0], [f.pool.target], f.pool.target],
    [f.asset.target, f.addresses[0], [f.members[0], f.members[0]], f.pool.target],
    [f.pool.target, f.addresses[0], f.members, f.pool.target]
  ]) await assert.rejects(() => f.deploy(trialArtifact, args));
  await mined(f.pool.bootstrap());
  assert.equal(await f.pool.currentStep(), 100n);
  await assert.rejects(() => f.pool.bootstrap());
  await f.join(r, 1); await f.conserve();
});

test('milestones climb at exact .0001/.001/.01/.1/$1 thresholds, not promised revenue', async t => {
  const f = await setup(t);
  for (const [step, assets] of [[1000n, 4_400_000n], [10_000n, 44_000_000n],
    [100_000n, 440_000_000n], [1_000_000n, dollarReserve]]) {
    await fundTo(f, assets - 1n);
    assert.ok(await f.pool.currentStep() < step);
    await mined(f.pool.connect(f.signers[2]).fund(1n));
    assert.equal(await f.pool.currentStep(), step);
    assert.equal(await f.pool.highestStep(), step);
    assert.equal(await f.pool.totalSupply(), supply);
  }
  assert.equal(await f.pool.dividendLiabilities(), 0n);
  await f.conserve();
});

test('$2 allocates $1 per outstanding token and retains $1 backing; inventory is separate', async t => {
  const f = await setup(t);
  await f.award();
  await fundTo(f, doubleReserve - 1n);
  assert.equal(await f.pool.resetCount(), 0n);
  const receipt = await mined(f.pool.fund(1n));
  assert.ok(receipt.logs.map(log => {
    try { return f.pool.interface.parseLog(log)?.name; } catch { return null; }
  }).includes('DividendReset'));
  assert.equal(await f.pool.resetCount(), 1n);
  assert.equal(await f.pool.reserveAssets(), dollarReserve);
  assert.equal(await f.pool.dividendLiabilities(), dollarReserve);
  assert.equal(await claimable(f, 1), 1_000_000n);
  assert.equal(await f.pool.claimableDividend(f.pool.target), 4_399_000_000n);
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 1_000_000n);
  assert.equal(await f.pool.balanceOf(f.addresses[1]), parseEther('1'));
  await assert.rejects(() => f.pool.claimDividendFor(f.pool.target));
  await assert.rejects(() => f.pool.connect(f.signers[1]).withdrawInventoryDividend(f.addresses[1], 1n));
  await f.conserve();
});

test('large deposits distribute all surplus above $1 and repeated checkpoints cannot replay resets', async t => {
  const f = await setup(t);
  await f.award();
  await fundTo(f, 5n * dollarReserve);
  assert.equal(await f.pool.reserveAssets(), dollarReserve);
  assert.equal(await claimable(f, 1), 4_000_000n);
  assert.equal(await f.pool.dividendLiabilities(), 4n * dollarReserve);
  await mined(f.pool.connect(f.signers[2]).checkpoint());
  assert.equal(await f.pool.resetCount(), 1n);
  await mined(f.pool.fund(dollarReserve));
  assert.equal(await f.pool.resetCount(), 2n);
  assert.equal(await claimable(f, 1), 5_000_000n);
  assert.equal(await f.pool.dividendLiabilities(), 5n * dollarReserve);
  await f.conserve();
});

test('holder claims are recipient-bound and do not change backing or allow duplicate payouts', async t => {
  const f = await setup(t);
  await f.award(); await fundTo(f, doubleReserve);
  const before = await f.asset.balanceOf(f.addresses[1]);
  await mined(f.pool.connect(f.signers[2]).claimDividendFor(f.addresses[1]));
  assert.equal(await f.asset.balanceOf(f.addresses[1]), before + 1_000_000n);
  assert.equal(await claimable(f, 1), 0n);
  assert.equal(await f.pool.dividendsPaid(f.addresses[1]), 1_000_000n);
  assert.equal(await f.pool.reserveAssets(), dollarReserve);
  await assert.rejects(() => f.pool.claimDividendFor(f.addresses[1]));
  await assert.rejects(() => f.pool.claimDividendFor(ZeroAddress));
  await f.conserve();
});

test('inventory withdrawals are admin-only, bounded, event-recorded, and cannot take holder debt/backing', async t => {
  const f = await setup(t);
  await f.award(); await fundTo(f, doubleReserve);
  await assert.rejects(() => f.pool.withdrawInventoryDividend(f.addresses[0], 4_399_000_001n));
  await assert.rejects(() => f.pool.withdrawInventoryDividend(ZeroAddress, 1n));
  await assert.rejects(() => f.pool.withdrawInventoryDividend(f.pool.target, 1n));
  await assert.rejects(() => f.pool.withdrawInventoryDividend(f.addresses[0], 0n));
  const before = await f.asset.balanceOf(f.addresses[3]);
  const receipt = await mined(f.pool.withdrawInventoryDividend(f.addresses[3], 4_399_000_000n));
  const event = receipt.logs.filter(log => log.address === f.pool.target).map(log => f.pool.interface.parseLog(log))
    .find(log => log?.name === 'InventoryDividendWithdrawn');
  assert.equal(event.args.administrator, f.addresses[0]);
  assert.equal(event.args.recipient, f.addresses[3]);
  assert.equal(await f.asset.balanceOf(f.addresses[3]), before + 4_399_000_000n);
  assert.equal(await f.pool.dividendLiabilities(), 1_000_000n);
  assert.equal(await f.pool.reserveAssets(), dollarReserve);
  await assert.rejects(() => f.pool.withdrawInventoryDividend(f.addresses[0], 1n));
  await mined(f.pool.claimDividendFor(f.addresses[1]));
  assert.equal(await f.pool.dividendLiabilities(), 0n);
  await f.conserve();
});

test('transfers, approvals, burns and later awards preserve earned dividends without retroactive entitlement', async t => {
  const f = await setup(t);
  await f.award(); await fundTo(f, doubleReserve);
  await mined(f.pool.connect(f.signers[1]).approve(f.addresses[2], parseEther('1')));
  await mined(f.pool.connect(f.signers[2]).transferFrom(f.addresses[1], f.addresses[2], parseEther('1')));
  assert.equal(await claimable(f, 1), 1_000_000n);
  assert.equal(await claimable(f, 2), 0n);
  await f.award(3);
  assert.equal(await claimable(f, 3), 0n);
  await mined(f.pool.fund(dollarReserve));
  assert.equal(await claimable(f, 1), 1_000_000n);
  assert.equal(await claimable(f, 2), 1_000_000n);
  assert.equal(await claimable(f, 3), 1_000_000n);
  await mined(f.pool.connect(f.signers[2]).redeem(parseEther('1'), 1_000_000n));
  assert.equal(await f.pool.balanceOf(f.addresses[2]), 0n);
  assert.equal(await claimable(f, 2), 1_000_000n);
  assert.equal(await f.pool.reserveAssets(), dollarReserve - 1_000_000n);
  await mined(f.pool.claimDividendFor(f.addresses[2]));
  await mined(f.pool.claimDividendFor(f.addresses[1]));
  await assert.rejects(() => f.pool.connect(f.signers[3]).transfer(f.pool.target, 1n));
  await f.conserve();
});

test('direct donations checkpoint against pre-transfer balances; redemption quote anticipates a pending reset', async t => {
  const f = await setup(t);
  await f.award();
  await mined(f.asset.transfer(f.pool.target, doubleReserve - 440_000n));
  assert.equal(await f.pool.resetDue(), true);
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 1_000_000n);
  await assert.rejects(() => f.pool.fundAndMint(parseEther('1'), 2_000_000n));
  await mined(f.pool.connect(f.signers[1]).transfer(f.addresses[2], parseEther('1')));
  assert.equal(await f.pool.resetCount(), 1n);
  assert.equal(await claimable(f, 1), 1_000_000n);
  assert.equal(await claimable(f, 2), 0n);
  await mined(f.pool.connect(f.signers[2]).redeem(parseEther('1'), 1_000_000n));
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 1_000_000n);
  await f.conserve();
});

test('matched issuance cannot trigger a false reset or give new inventory past dividends', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.pool.fundAndMint(parseEther('1'), 1_000_000n));
  await f.award(); await fundTo(f, doubleReserve);
  const inventoryDebt = await f.pool.claimableDividend(f.pool.target);
  await mined(f.pool.fund(2_200_000_000n));
  assert.equal(await f.pool.previewMint(supply), 6_600_000_000n);
  await assert.rejects(() => f.pool.fundAndMint(supply, 6_599_999_999n));
  await assert.rejects(() => f.pool.connect(f.signers[1]).fundAndMint(supply, 6_600_000_000n));
  await mined(f.pool.fundAndMint(supply, 6_600_000_000n));
  assert.equal(await f.pool.totalSupply(), supply * 2n);
  assert.equal(await f.pool.resetCount(), 1n);
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 1_500_000n);
  assert.equal(await f.pool.claimableDividend(f.pool.target), inventoryDebt);
  await f.award(2);
  assert.equal(await claimable(f, 2), 0n);
  await mined(f.pool.fund(4_400_000_000n));
  assert.equal(await f.pool.resetCount(), 2n);
  assert.equal(await claimable(f, 1), 2_000_000n);
  assert.equal(await claimable(f, 2), 1_000_000n);
  await f.conserve();
});

test('fractional transfers aggregate dividend dust; claims and inventory withdrawal remain fully solvent', async t => {
  const f = await setup(t);
  await f.award();
  await mined(f.pool.connect(f.signers[1]).transfer(f.addresses[2], parseEther('0.333333333333333333')));
  await mined(f.pool.connect(f.signers[1]).transfer(f.addresses[3], parseEther('0.333333333333333333')));
  for (let cycle = 0; cycle < 3; cycle++) {
    await fundTo(f, doubleReserve);
    if (await claimable(f, 1)) await mined(f.pool.claimDividendFor(f.addresses[1]));
    await f.conserve();
  }
  assert.equal(await f.pool.accumulatedDividend(f.addresses[2]), 999_999n);
  assert.equal(await f.pool.accumulatedDividend(f.addresses[3]), 999_999n);
  for (const i of [1, 2, 3]) if (await claimable(f, i)) await mined(f.pool.claimDividendFor(f.addresses[i]));
  const inventory = await f.pool.claimableDividend(f.pool.target);
  await mined(f.pool.withdrawInventoryDividend(f.addresses[0], inventory));
  assert.ok(await f.pool.dividendLiabilities() <= 2n);
  assert.equal(await f.pool.reserveAssets(), dollarReserve);
  await f.conserve();
});

test('pausing awards never traps dividends, holder transfers, redemptions or funding', async t => {
  const f = await setup(t);
  await f.award(); await fundTo(f, doubleReserve);
  await assert.rejects(() => f.pool.connect(f.signers[1]).pauseAwards());
  await mined(f.pool.pauseAwards());
  await assert.rejects(() => f.award(2));
  await assert.rejects(() => f.pool.fundAndMint(parseEther('1'), 1_000_000n));
  await mined(f.pool.connect(f.signers[1]).transfer(f.addresses[2], parseEther('1')));
  await mined(f.pool.claimDividendFor(f.addresses[1]));
  await mined(f.pool.connect(f.signers[2]).redeem(parseEther('1'), 1_000_000n));
  await mined(f.pool.fund(1n));
  await mined(f.pool.withdrawInventoryDividend(f.addresses[0], 1n));
  await mined(f.pool.resumeAwards()); await f.award(2);
  await f.conserve();
});

test('failed/fee asset transfers revert all dividend state and callbacks cannot reenter payouts', async t => {
  const f = await setup(t);
  await f.award(); await fundTo(f, doubleReserve);
  for (const mode of [1, 2]) {
    await f.configureAsset(mode);
    await assert.rejects(() => f.pool.claimDividendFor(f.addresses[1]));
    await assert.rejects(() => f.pool.withdrawInventoryDividend(f.addresses[0], 1n));
    assert.equal(await claimable(f, 1), 1_000_000n);
    assert.equal(await f.pool.dividendsPaid(f.addresses[1]), 0n);
    await f.conserve();
  }
  await f.configureAsset(3);
  await mined(f.asset.setCallback(f.pool.target, f.pool.interface.encodeFunctionData('claimDividendFor', [f.addresses[1]])));
  await mined(f.pool.claimDividendFor(f.addresses[1]));
  assert.equal(await f.asset.callbackSucceeded(), false);
  await f.conserve();
});

test('learning authority and duplicate protections stay unchanged', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.pool.connect(f.signers[1]).awardLevel(f.addresses[1], 1, id('bad')));
  await assert.rejects(() => f.pool.awardLevel(f.addresses[1], 2, id('bad')));
  await assert.rejects(() => f.pool.awardLevel(f.addresses[1], 1, ZeroHash));
  await f.award();
  await assert.rejects(() => f.award());
  await assert.rejects(() => f.pool.awardLevel(f.addresses[2], 1, id('level-1-1')));
  const firstDay = await f.pool.firstDay();
  await assert.rejects(() => f.pool.awardDay(f.addresses[1], firstDay, id('today')));
  await assert.rejects(() => f.pool.awardDay(f.addresses[1], firstDay - 1n, id('old')));
  await f.at((Number(firstDay) + 1) * 86400);
  await mined(f.pool.awardDay(f.addresses[1], firstDay, id('day')));
  await assert.rejects(() => f.pool.awardDay(f.addresses[1], firstDay, id('again')));
  assert.equal(await f.pool.balanceOf(f.addresses[1]), parseEther('1.1'));
});

test('modelled multi-cycle claims conserve earned dividends across fractional transfers, burns and matched mints', async t => {
  const f = await setup(t);
  const units = parseEther('1');
  const balances = new Map(), earned = new Map(), paid = new Map();
  for (const address of [...f.addresses, f.pool.target]) {
    balances.set(address, 0n); earned.set(address, 0n); paid.set(address, 0n);
  }
  balances.set(f.pool.target, supply);
  let expectedSupply = supply;
  for (let i = 1; i <= 4; i++) {
    await f.award(i);
    balances.set(f.addresses[i], units);
    balances.set(f.pool.target, balances.get(f.pool.target) - units);
  }
  for (let cycle = 0; cycle < 4; cycle++) {
    await fundTo(f, expectedSupply * 2_000_000n / units);
    for (const address of earned.keys()) {
      earned.set(address, earned.get(address) + balances.get(address) * 1_000_000n / units);
    }
    const from = f.addresses[cycle + 1], to = f.addresses[(cycle + 1) % 4 + 1];
    const transfer = parseEther('0.25');
    await mined(f.pool.connect(f.signers[cycle + 1]).transfer(to, transfer));
    balances.set(from, balances.get(from) - transfer);
    balances.set(to, balances.get(to) + transfer);
    const burn = parseEther('0.125');
    await mined(f.pool.connect(f.signers[cycle + 1]).redeem(burn, 125_000n));
    balances.set(from, balances.get(from) - burn); expectedSupply -= burn;
    await mined(f.pool.fundAndMint(units, 1_000_000n));
    balances.set(f.pool.target, balances.get(f.pool.target) + units); expectedSupply += units;
    await mined(f.pool.claimDividendFor(from));
    paid.set(from, earned.get(from));
    if (cycle % 2 === 0) {
      const inventory = earned.get(f.pool.target) - paid.get(f.pool.target);
      await mined(f.pool.withdrawInventoryDividend(f.addresses[0], inventory));
      paid.set(f.pool.target, earned.get(f.pool.target));
    }
    let remainingDebt = 0n;
    for (const address of earned.keys()) {
      const debt = earned.get(address) - paid.get(address); remainingDebt += debt;
      assert.equal(await f.pool.claimableDividend(address), debt);
      assert.equal(await f.pool.balanceOf(address), balances.get(address));
    }
    assert.equal(await f.pool.dividendLiabilities(), remainingDebt);
    assert.equal(await f.pool.totalSupply(), expectedSupply);
    assert.equal(await f.pool.reserveAssets(), expectedSupply * 1_000_000n / units);
    await f.conserve();
  }
});

test('finalized forfeitures split exactly once: survivors keep principal plus half; permissionless pool delivery', async t => {
  const f = await setup(t, { count: 3 });
  const r = await f.open();
  for (let i = 1; i <= 3; i++) await f.join(r, i);
  await f.propose(r, [76, 84, 75]);
  await mined(f.trial.finalize(r.round));
  assert.equal(await f.trial.credit(f.members[0]), 1_250_000n);
  assert.equal(await f.trial.credit(f.members[1]), 1_250_000n);
  assert.equal(await f.trial.credit(f.members[2]), 0n);
  assert.equal(await f.trial.staircaseCredit(), 500_000n);
  assert.equal(await f.pool.reserveAssets(), 440_000n);
  await f.conserve();
  await assert.rejects(() => f.trial.finalize(r.round));
  await mined(f.trial.connect(f.signers[4]).fundStaircase());
  assert.equal(await f.pool.reserveAssets(), 940_000n);
  assert.equal(await f.trial.staircaseCredit(), 0n);
  await assert.rejects(() => f.trial.fundStaircase());
  for (const account of f.members.slice(0, 2)) await mined(f.trial.claimFor(account));
  assert.equal(await f.trial.liabilities(), 0n);
  await f.conserve();
});

test('zero survivors still funds staircase; remaining half carries forward without a second split', async t => {
  const f = await setup(t, { count: 3 });
  const first = await f.open(); await f.join(first, 1);
  await f.propose(first, [75, 0, 0]); await mined(f.trial.finalize(first.round));
  assert.equal(await f.trial.carryTotal(), 500_000n);
  assert.equal(await f.trial.carry(f.members[0]), 500_000n);
  assert.equal(await f.trial.staircaseCredit(), 500_000n);
  await mined(f.trial.fundStaircase());
  const next = await f.open(); await f.join(next, 2);
  await f.propose(next, [0, 76, 0]); await mined(f.trial.finalize(next.round));
  assert.equal(await f.trial.credit(f.members[1]), 1_500_000n);
  assert.equal(await f.trial.staircaseCredit(), 0n);
  assert.equal(await f.trial.carryTotal(), 0n);
  await f.conserve();
});

test('survivor dust retains origins, and shutdown refunds only survivor carry and unresolved principal', async t => {
  const f = await setup(t, { count: 4 });
  const first = await f.open(); await f.join(first, 4);
  await f.propose(first, [0, 0, 0, 0]); await mined(f.trial.finalize(first.round));
  const next = await f.open();
  for (let i = 1; i <= 3; i++) await f.join(next, i);
  await f.propose(next, [76, 80, 84, 0]); await mined(f.trial.finalize(next.round));
  assert.equal(await f.trial.carryTotal(), 2n);
  assert.equal(await f.trial.carry(f.members[3]), 2n);
  assert.equal(await f.trial.credit(f.members[0]), 1_166_666n);
  const pending = await f.open(); await f.join(pending, 4);
  await mined(f.trial.stop());
  assert.equal(await f.trial.credit(f.members[3]), 1_000_002n);
  assert.equal(await f.trial.staircaseCredit(), 500_000n);
  await f.conserve();
  for (const account of f.members) await mined(f.trial.claimFor(account));
  await mined(f.trial.fundStaircase());
  assert.equal(await f.trial.liabilities(), 0n);
  await f.conserve();
});

test('cancelled, timed-out and stopped unsettled rounds refund full principal; no forfeiture skim', async t => {
  const f = await setup(t, { count: 3 });
  const first = await f.open(); await f.join(first, 1);
  await mined(f.trial.cancel(first.round));
  assert.equal(await f.trial.credit(f.members[0]), 1_000_000n);
  await f.at(first.end - 3600);
  const second = await f.open(); await f.join(second, 2);
  await f.at(second.end + 14 * 86400);
  await mined(f.trial.connect(f.signers[4]).expireAndStop());
  assert.equal(await f.trial.credit(f.members[1]), 1_000_000n);
  assert.equal(await f.trial.staircaseCredit(), 0n);
  assert.equal(await f.pool.reserveAssets(), 440_000n);
  for (const account of f.members.slice(0, 2)) await mined(f.trial.claimFor(account));
  await f.conserve();
});

test('weekly review, authority, language and ordered scheduling gates remain enforced before forfeitures', async t => {
  const f = await setup(t, { count: 2 });
  const first = await f.open();
  await assert.rejects(() => f.trial.connect(f.signers[3]).join(first.round, id('es')));
  await assert.rejects(() => f.trial.connect(f.signers[1]).join(first.round, ZeroHash));
  await f.join(first, 1); await assert.rejects(() => f.join(first, 1));
  await assert.rejects(() => f.trial.propose(first.round, [75, 0], id('early')));
  await assert.rejects(() => f.trial.connect(f.signers[1]).cancel(first.round));
  await f.at(first.end - 3600);
  const next = await f.open(); await f.join(next, 2);
  await f.at(first.end);
  await assert.rejects(() => f.trial.connect(f.signers[1]).propose(first.round, [75, 0], id('unauthorized')));
  await assert.rejects(() => f.trial.propose(first.round, [85, 0], id('invalid score')));
  await assert.rejects(() => f.trial.propose(first.round, [75, 1], id('nonentrant')));
  await mined(f.trial.propose(first.round, [75, 0], id('review')));
  await assert.rejects(() => f.trial.propose(first.round, [76, 0], id('overwrite')));
  await assert.rejects(() => f.trial.finalize(first.round));
  const proposed = await f.trial.rounds(first.round);
  await f.at(Number(proposed.proposedAt) + 48 * 3600);
  await mined(f.trial.finalize(first.round));
  await assert.rejects(() => f.trial.cancel(first.round));
  await f.conserve();
  await f.propose(next, [0, 76]); await mined(f.trial.finalize(next.round));
  assert.equal(await f.trial.credit(f.members[1]), 1_500_000n);
  assert.equal(await f.trial.staircaseCredit(), 500_000n);
  await f.conserve();
});

test('reserve delivery failure never blocks survivor settlement or refund claims and retains retryable debt', async t => {
  const f = await setup(t, { count: 2, mockPool: true });
  const r = await f.open(); await f.join(r, 1); await f.join(r, 2);
  await mined(f.pool.configure(true));
  await f.propose(r, [76, 75]); await mined(f.trial.finalize(r.round));
  await assert.rejects(() => f.trial.fundStaircase());
  assert.equal(await f.trial.staircaseCredit(), 500_000n);
  assert.equal(await f.asset.balanceOf(f.pool.target), 0n);
  await mined(f.trial.claimFor(f.members[0]));
  assert.equal(await f.trial.liabilities(), 500_000n);
  await f.conserve();
  await mined(f.pool.configure(false));
  await mined(f.trial.fundStaircase());
  assert.equal(await f.asset.balanceOf(f.pool.target), 500_000n);
  await f.conserve();
});

test('USDC pool blacklist cannot block weekly claims; fee/false transfers preserve staircase debt', async t => {
  const f = await setup(t, { count: 2 });
  const r = await f.open(); await f.join(r, 1); await f.join(r, 2);
  await f.propose(r, [76, 75]); await mined(f.trial.finalize(r.round));
  await f.configureAsset(0, f.pool.target);
  await assert.rejects(() => f.trial.fundStaircase());
  await mined(f.trial.claimFor(f.members[0]));
  for (const mode of [1, 2]) {
    await f.configureAsset(mode);
    await assert.rejects(() => f.trial.fundStaircase());
    assert.equal(await f.trial.staircaseCredit(), 500_000n); await f.conserve();
  }
  await f.configureAsset(3);
  await mined(f.asset.setCallback(f.trial.target, f.trial.interface.encodeFunctionData('fundStaircase')));
  await mined(f.trial.fundStaircase());
  assert.equal(await f.asset.callbackSucceeded(), false);
  await f.conserve();
});

test('forfeiture delivery crosses $2 and allocates dividends, never treating pending escrow liabilities as backing', async t => {
  const f = await setup(t, { count: 2 });
  await f.award();
  await fundTo(f, doubleReserve - 500_000n);
  const r = await f.open(); await f.join(r, 1); await f.join(r, 2);
  await f.propose(r, [76, 75]); await mined(f.trial.finalize(r.round));
  assert.equal(await f.pool.resetCount(), 0n);
  assert.equal(await f.trial.staircaseCredit(), 500_000n);
  await mined(f.trial.fundStaircase());
  assert.equal(await f.pool.resetCount(), 1n);
  assert.equal(await claimable(f, 1), 1_000_000n);
  assert.equal(await f.pool.reserveAssets(), dollarReserve);
  assert.equal(await f.trial.credit(f.members[0]), 1_500_000n);
  await f.conserve();
});

test('eight-member multiple-round conservation includes unresolved deposits, split debt, claims and carried dust', async t => {
  const f = await setup(t, { count: 8 });
  const first = await f.open();
  for (let i = 1; i <= 8; i++) await f.join(first, i);
  await f.propose(first, Array(8).fill(0));
  await mined(f.trial.finalize(first.round)); await f.conserve();
  const next = await f.open();
  for (let i = 1; i <= 8; i++) await f.join(next, i);
  await f.propose(next, [76, 80, 84, 0, 0, 0, 0, 0]);
  await mined(f.trial.finalize(next.round)); await f.conserve();
  assert.equal(await f.trial.staircaseCredit(), 6_500_000n);
  const pending = await f.open(); await f.join(pending, 8);
  await f.conserve(); await mined(f.trial.stop()); await f.conserve();
  for (const account of f.members) if (await f.trial.credit(account)) await mined(f.trial.claimFor(account));
  await mined(f.trial.fundStaircase());
  assert.equal(await f.trial.liabilities(), 0n);
  await f.conserve();
});
