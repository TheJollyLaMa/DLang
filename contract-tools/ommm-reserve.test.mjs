import test from 'node:test';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, parseEther, ZeroAddress } from 'ethers';
import { compileOmmm } from './ommm-artifact.mjs';

const artifact = compileOmmm();
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'Asset.sol': { content: `
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
contract Asset {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public mode;
    address public callback;
    bool public callbackSucceeded;
    function configure(uint8 m, address c) external { mode=m; callback=c; }
    function mint(address to, uint256 n) external { balanceOf[to]+=n; }
    function approve(address to, uint256 n) external returns(bool) { allowance[msg.sender][to]=n; return true; }
    function move(address from, address to, uint256 n) private returns(bool) {
        if(mode==1) return false;
        balanceOf[from]-=n;
        balanceOf[to]+=mode==2?n-1:n;
        if(callback!=address(0)) (callbackSucceeded,)=callback.call(abi.encodeWithSignature("fund(uint256)",1));
        if(mode==3) assembly { return(0,0) }
        return true;
    }
    function transfer(address to, uint256 n) external returns(bool) { return move(msg.sender,to,n); }
    function transferFrom(address from, address to, uint256 n) external returns(bool) {
        allowance[from][msg.sender]-=n; return move(from,to,n);
    }
}` } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
})));
assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);
const assetArtifact = output.contracts['Asset.sol'].Asset;
const mined = async tx => (await tx).wait();
async function setup(t, bootstrap = true) {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 8453 },
    wallet: { deterministic: true, totalAccounts: 4 } });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(s => s.getAddress()));
  const deploy = async (abi, bytecode, args = []) => {
    const c = await new ContractFactory(abi, bytecode, signers[0]).deploy(...args);
    await c.waitForDeployment(); return c;
  };
  const asset = await deploy(assetArtifact.abi, `0x${assetArtifact.evm.bytecode.object}`);
  const pool = await deploy(artifact.abi, artifact.bytecode, [asset.target, addresses[0]]);
  for (const [i, signer] of signers.entries()) {
    await mined(asset.mint(addresses[i], 20_000_000_000n));
    await mined(asset.connect(signer).approve(pool.target, 20_000_000_000n));
  }
  if (bootstrap) await mined(pool.bootstrap());
  const award = async (i = 1, level = 1) => mined(pool.awardLevel(addresses[i], level, id(`level-${i}-${level}`)));
  return { provider, asset, pool, signers, addresses, deploy, award };
}

test('4400 inventory tokens and .44 USDC count all unawarded supply; bootstrap is exact and one-time', async t => {
  const f = await setup(t, false);
  assert.equal(await f.pool.totalSupply(), parseEther('4400'));
  assert.equal(await f.pool.balanceOf(f.pool.target), parseEther('4400'));
  assert.equal(await f.pool.balanceOf(f.addresses[0]), 0n);
  await assert.rejects(() => f.award());
  await assert.rejects(() => f.pool.connect(f.signers[1]).bootstrap());
  await mined(f.pool.bootstrap());
  assert.equal(await f.pool.reserveAssets(), 440_000n);
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 100n);
  await assert.rejects(() => f.pool.bootstrap());
});

test('constructor rejects noncontracts, non-six-decimal assets and zero authority', async t => {
  const f = await setup(t);
  for (const args of [[ZeroAddress, f.addresses[0]], [f.addresses[1], f.addresses[0]], [f.pool.target, f.addresses[0]], [f.asset.target, ZeroAddress]]) {
    await assert.rejects(() => f.deploy(artifact.abi, artifact.bytecode, args));
  }
});

test('only approved sequential learning awards distribute inventory, never mint or reuse evidence', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.pool.connect(f.signers[1]).awardLevel(f.addresses[1], 1, id('x')));
  await assert.rejects(() => f.pool.awardLevel(f.addresses[1], 2, id('x')));
  await assert.rejects(() => f.pool.awardLevel(ZeroAddress, 1, id('x')));
  await assert.rejects(() => f.pool.awardLevel(f.addresses[1], 1, '0x' + '00'.repeat(32)));
  for (let level = 1; level <= 6; level++) await f.award(1, level);
  await assert.rejects(() => f.award(1, 6));
  await assert.rejects(() => f.award(1, 7));
  await assert.rejects(() => f.pool.awardLevel(f.addresses[2], 1, id('level-1-1')));
  assert.equal(await f.pool.balanceOf(f.addresses[1]), parseEther('6'));
  assert.equal(await f.pool.totalSupply(), parseEther('4400'));
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 100n);
});

test('day awards require completed post-launch UTC days and cannot repeat', async t => {
  const f = await setup(t);
  const firstDay = await f.pool.firstDay();
  await assert.rejects(() => f.pool.awardDay(f.addresses[1], firstDay - 1n, id('before')));
  await assert.rejects(() => f.pool.awardDay(f.addresses[1], firstDay, id('today')));
  await f.provider.send('evm_increaseTime', [86401]); await f.provider.send('evm_mine', []);
  await mined(f.pool.awardDay(f.addresses[1], firstDay, id('day')));
  await assert.rejects(() => f.pool.awardDay(f.addresses[1], firstDay, id('again')));
  assert.equal(await f.pool.balanceOf(f.addresses[1]), parseEther('0.1'));
});

test('redemption burns only caller tokens and transfers exact USDC; dust and slippage revert', async t => {
  const f = await setup(t);
  await f.award();
  await assert.rejects(() => f.pool.redeem(parseEther('1'), 100n));
  await assert.rejects(() => f.pool.connect(f.signers[1]).redeem(1n, 1n));
  await assert.rejects(() => f.pool.connect(f.signers[1]).redeem(parseEther('1'), 101n));
  await assert.rejects(() => f.pool.connect(f.signers[1]).redeem(parseEther('1'), 0n));
  const before = await f.asset.balanceOf(f.addresses[1]);
  await mined(f.pool.connect(f.signers[1]).redeem(parseEther('1'), 100n));
  assert.equal(await f.asset.balanceOf(f.addresses[1]), before + 100n);
  assert.equal(await f.pool.reserveAssets(), 439_900n);
  assert.equal(await f.pool.totalSupply(), parseEther('4399'));
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 100n);
});

test('sponsor funds and direct USDC donations raise every share without changing supply', async t => {
  const f = await setup(t);
  await mined(f.pool.connect(f.signers[2]).fund(440_000n));
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 200n);
  await mined(f.asset.transfer(f.pool.target, 440_000n));
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 300n);
  assert.equal(await f.pool.totalSupply(), parseEther('4400'));
});

test('minting waits for dollar backing and requires rounded-up matched funding into locked inventory', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.pool.fundAndMint(parseEther('1'), 1_000_000n));
  await mined(f.pool.fund(4_400_000_000n - 440_000n));
  assert.equal(await f.pool.previewMint(parseEther('1')), 1_000_000n);
  await assert.rejects(() => f.pool.connect(f.signers[1]).fundAndMint(parseEther('1'), 1_000_000n));
  await assert.rejects(() => f.pool.fundAndMint(parseEther('1'), 999_999n));
  await mined(f.pool.fundAndMint(parseEther('1'), 1_000_000n));
  assert.equal(await f.pool.totalSupply(), parseEther('4401'));
  assert.equal(await f.pool.balanceOf(f.pool.target), parseEther('4401'));
  assert.equal(await f.pool.previewRedeem(parseEther('1')), 1_000_000n);
  await mined(f.pool.fund(1n));
  assert.equal(await f.pool.previewMint(parseEther('1')), 1_000_001n);
  await mined(f.pool.fundAndMint(parseEther('1'), 1_000_001n));
  assert.ok(await f.pool.reserveAssets() * parseEther('4401') >= 4_401_000_001n * parseEther('4402'));
});

test('ordinary ERC20 transfers/allowances work but no one can approve, withdraw or redeem inventory', async t => {
  const f = await setup(t);
  await f.award();
  await mined(f.pool.connect(f.signers[1]).approve(f.addresses[2], parseEther('0.5')));
  await mined(f.pool.connect(f.signers[2]).transferFrom(f.addresses[1], f.addresses[2], parseEther('0.5')));
  await assert.rejects(() => f.pool.transferFrom(f.pool.target, f.addresses[0], 1n));
  await assert.rejects(() => f.pool.connect(f.signers[1]).transfer(f.pool.target, 1n));
  await assert.rejects(() => f.pool.connect(f.signers[2]).transferFrom(f.addresses[1], f.addresses[2], 1n));
  assert.equal(await f.pool.balanceOf(f.addresses[2]), parseEther('0.5'));
});

test('pausing stops awards/minting but never traps holders or disables sponsorship/redemption', async t => {
  const f = await setup(t);
  await f.award();
  await assert.rejects(() => f.pool.connect(f.signers[1]).pauseAwards());
  await mined(f.pool.pauseAwards());
  await assert.rejects(() => f.award(1, 2));
  await mined(f.pool.fund(1n));
  await mined(f.pool.connect(f.signers[1]).redeem(parseEther('1'), 100n));
  await mined(f.pool.resumeAwards());
  await f.award(1, 2);
});

test('false/fee transfers roll back all state; no-return USDC-compatible tokens work', async t => {
  const f = await setup(t, false);
  for (const mode of [1, 2]) {
    await mined(f.asset.configure(mode, ZeroAddress));
    await assert.rejects(() => f.pool.bootstrap());
    assert.equal(await f.pool.funded(), false);
    assert.equal(await f.pool.reserveAssets(), 0n);
  }
  await mined(f.asset.configure(3, ZeroAddress));
  await mined(f.pool.bootstrap()); await f.award();
  await mined(f.asset.configure(2, ZeroAddress));
  await assert.rejects(() => f.pool.connect(f.signers[1]).redeem(parseEther('1'), 100n));
  assert.equal(await f.pool.balanceOf(f.addresses[1]), parseEther('1'));
  await mined(f.asset.configure(3, ZeroAddress));
  await mined(f.pool.connect(f.signers[1]).redeem(parseEther('1'), 100n));
});

test('asset callbacks cannot reenter a reserve operation', async t => {
  const f = await setup(t);
  await mined(f.asset.configure(0, f.pool.target));
  await mined(f.pool.fund(1n));
  assert.equal(await f.asset.callbackSucceeded(), false);
  assert.equal(await f.pool.reserveAssets(), 440_001n);
});
