import test from 'node:test';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, parseEther, ZeroAddress } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

const artifact = compileContract('Ommm');
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'Asset.sol': { content: `
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
contract Asset {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 n) external { balanceOf[to]+=n; }
    function approve(address to, uint256 n) external returns(bool) { allowance[msg.sender][to]=n; return true; }
    function transfer(address to, uint256 n) external returns(bool) { balanceOf[msg.sender]-=n; balanceOf[to]+=n; return true; }
    function transferFrom(address from, address to, uint256 n) external returns(bool) {
        allowance[from][msg.sender]-=n; balanceOf[from]-=n; balanceOf[to]+=n; return true;
    }
}` } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
})));
assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);
const assetArtifact = output.contracts['Asset.sol'].Asset;
const mined = async tx => (await tx).wait();
const CAP = parseEther('1000000');
const START = 100_000n; // $0.10 per Ommm

async function setup(t) {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 8453 },
    wallet: { deterministic: true, totalAccounts: 5 } });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all([0, 1, 2, 3, 4].map(i => provider.getSigner(i)));
  const [owner, dlang, busking, holder, other] = await Promise.all(signers.map(s => s.getAddress()));
  const deploy = async (abi, bytecode, args = []) => {
    const c = await new ContractFactory(abi, bytecode, signers[0]).deploy(...args);
    await c.waitForDeployment(); return c;
  };
  const asset = await deploy(assetArtifact.abi, `0x${assetArtifact.evm.bytecode.object}`);
  const ommm = await deploy(artifact.abi, artifact.bytecode, [asset.target, owner, CAP, START]);
  for (const [i, signer] of signers.entries()) {
    await mined(asset.mint(await signer.getAddress(), 1_000_000_000_000n));
    await mined(asset.connect(signer).approve(ommm.target, 1_000_000_000_000n));
  }
  const price = async () => (await ommm.reserveAssets()) * 10n ** 18n / (await ommm.committedSupply());
  return { asset, ommm, signers, owner, dlang, busking, holder, other, deploy, price };
}

test('first pool is priced at the start price; rewards mint within budget without moving the price', async t => {
  const f = await setup(t);
  assert.equal(await f.ommm.requiredAssets(parseEther("4400")), 440_000_000n);
  await mined(f.ommm.openPool(f.dlang, 'DLang learning', parseEther("4400"), 440_000_000n));
  assert.equal(await f.ommm.totalSupply(), 0n);
  assert.equal(await f.ommm.committedSupply(), parseEther('4400'));
  const before = await f.price();
  await mined(f.ommm.connect(f.signers[1]).reward(f.holder, parseEther('1'), id('level-1')));
  assert.equal(await f.ommm.balanceOf(f.holder), parseEther('1'));
  assert.equal(await f.price(), before);
  assert.equal(await f.ommm.previewRedeem(parseEther('1')), 100_000n);
  await assert.rejects(() => f.ommm.connect(f.signers[1]).reward(f.holder, parseEther('1'), id('level-1')));
  await assert.rejects(() => f.ommm.connect(f.signers[1]).reward(f.holder, parseEther('4400'), id('too-much')));
  await assert.rejects(() => f.ommm.connect(f.signers[2]).reward(f.holder, 1n, id('not-a-pool')));
});

test('a new pool must add enough USDC that the price drops by at most 10%', async t => {
  const f = await setup(t);
  await mined(f.ommm.openPool(f.dlang, 'DLang learning', parseEther('1000'), 100_000_000n));
  const before = await f.price();
  const budget = parseEther('9000');
  const need = await f.ommm.requiredAssets(budget);
  // 0.9 * $100 * 10000/1000 - $100 = $800
  assert.equal(need, 800_000_000n);
  await assert.rejects(() => f.ommm.openPool(f.busking, 'DecentBusking', budget, need - 1n));
  await mined(f.ommm.openPool(f.busking, 'DecentBusking', budget, need));
  const after = await f.price();
  assert.ok(after * 10n >= before * 9n, `${after} vs ${before}`);
  assert.ok(after < before);
  assert.equal((await f.ommm.pools(f.busking)).label, 'DecentBusking');
});

test('small budgets relative to supply can open with little or no USDC; a stricter limit needs more', async t => {
  const f = await setup(t);
  await mined(f.ommm.openPool(f.dlang, 'DLang', parseEther('10000'), 1_000_000_000n));
  assert.equal(await f.ommm.requiredAssets(parseEther('1000')), 0n);
  await mined(f.ommm.setMaxDropBps(100));
  assert.ok(await f.ommm.requiredAssets(parseEther('1000')) > 0n);
  await assert.rejects(() => f.ommm.setMaxDropBps(1001));
  await assert.rejects(() => f.ommm.connect(f.signers[1]).setMaxDropBps(0));
});

test('redemption pays the committed-supply price and keeps unminted budgets backed', async t => {
  const f = await setup(t);
  await mined(f.ommm.openPool(f.dlang, 'DLang', parseEther('100'), 10_000_000n));
  await mined(f.ommm.connect(f.signers[1]).reward(f.holder, parseEther('10'), id('r1')));
  const held = await f.asset.balanceOf(f.holder);
  await mined(f.ommm.connect(f.signers[3]).redeem(parseEther('10'), 1_000_000n));
  assert.equal(await f.asset.balanceOf(f.holder), held + 1_000_000n);
  assert.equal(await f.ommm.reserveAssets(), 9_000_000n);
  assert.equal(await f.ommm.committedSupply(), parseEther('90'));
  await assert.rejects(() => f.ommm.connect(f.signers[3]).redeem(1n, 0n));
});

test('closing a pool releases budget and raises the price; sponsors can fund', async t => {
  const f = await setup(t);
  await mined(f.ommm.openPool(f.dlang, 'DLang', parseEther('100'), 10_000_000n));
  await mined(f.ommm.connect(f.signers[1]).reward(f.holder, parseEther('10'), id('r1')));
  await mined(f.ommm.closePool(f.dlang));
  assert.equal(await f.ommm.committedSupply(), parseEther('10'));
  assert.equal(await f.ommm.previewRedeem(parseEther('10')), 10_000_000n);
  await assert.rejects(() => f.ommm.connect(f.signers[1]).reward(f.holder, 1n, id('r2')));
  await mined(f.ommm.connect(f.signers[4]).fund(5_000_000n));
  assert.equal(await f.ommm.reserveAssets(), 15_000_000n);
  await mined(f.ommm.openPool(f.dlang, '', parseEther('5'), 10_000_000n));
  assert.equal(await f.ommm.remainingBudget(f.dlang), parseEther('5'));
});

test('cap, pause, owner-only controls and transfers into the contract are enforced', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.ommm.openPool(f.dlang, 'x', CAP + 1n, 2n ** 255n));
  await assert.rejects(() => f.ommm.connect(f.signers[1]).openPool(f.dlang, 'x', 1n, 2n ** 255n));
  await mined(f.ommm.openPool(f.dlang, 'DLang', parseEther('100'), 10_000_000n));
  await assert.rejects(() => f.ommm.setSupplyCap(parseEther('99')));
  await mined(f.ommm.pauseRewards());
  await assert.rejects(() => f.ommm.connect(f.signers[1]).reward(f.holder, 1n, id('p')));
  await mined(f.ommm.resumeRewards());
  await mined(f.ommm.connect(f.signers[1]).reward(f.holder, parseEther('1'), id('p')));
  await assert.rejects(() => f.ommm.connect(f.signers[3]).transfer(f.ommm.target, 1n));
  await mined(f.ommm.connect(f.signers[3]).transfer(f.other, 1n));
});

test('constructor rejects bad configuration', async t => {
  const f = await setup(t);
  for (const args of [[ZeroAddress, f.owner, CAP, START], [f.asset.target, f.owner, 0n, START], [f.asset.target, f.owner, CAP, 0n], [f.ommm.target, f.owner, CAP, START]]) {
    await assert.rejects(() => f.deploy(artifact.abi, artifact.bytecode, args));
  }
});

test('prototype recovery returns all backing and retires the token; can be disabled', async t => {
  const f = await setup(t);
  await mined(f.ommm.openPool(f.dlang, 'DLang', parseEther('100'), 10_000_000n));
  await assert.rejects(() => f.ommm.connect(f.signers[1]).recoverPrototype(f.asset.target, f.dlang));
  const held = await f.asset.balanceOf(f.other);
  await mined(f.ommm.recoverPrototype(f.asset.target, f.other));
  assert.equal(await f.asset.balanceOf(f.other), held + 10_000_000n);
  assert.equal(await f.ommm.prototypeRetired(), true);
  await assert.rejects(() => f.ommm.connect(f.signers[1]).reward(f.holder, 1n, id('late')));

  const g = await setup(t);
  await mined(g.ommm.openPool(g.dlang, 'DLang', parseEther('100'), 10_000_000n));
  await mined(g.ommm.disablePrototypeRecovery());
  await assert.rejects(() => g.ommm.recoverPrototype(g.asset.target, g.other));
});
