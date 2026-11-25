import test from 'node:test';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, parseEther, ZeroAddress } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

const ommmArtifact = compileContract('Ommm');
const learningArtifact = compileContract('DLangOmmmLearningPool');
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'Asset.sol': { content: `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
contract Asset {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
}` } },
  settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
})));
assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);
const assetArtifact = output.contracts['Asset.sol'].Asset;
const mined = async tx => (await tx).wait();

async function setup(t) {
  const chain = ganache.provider({
    logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 8453 },
    wallet: { deterministic: true, totalAccounts: 3 }
  });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  const deploy = async (abi, bytecode, args = []) => {
    const contract = await new ContractFactory(abi, bytecode, signers[0]).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };
  const asset = await deploy(assetArtifact.abi, `0x${assetArtifact.evm.bytecode.object}`);
  const ommm = await deploy(ommmArtifact.abi, ommmArtifact.bytecode, [asset.target, addresses[0], parseEther('1000')]);
  const learning = await deploy(learningArtifact.abi, learningArtifact.bytecode, [ommm.target, addresses[0]]);
  await mined(asset.mint(addresses[0], 1_000_000_000n));
  await mined(asset.approve(ommm.target, 1_000_000_000n));
  await mined(ommm.openPool(learning.target, 'DLang learning', parseEther('10'), 1_000n));
  return { chain, provider, signers, addresses, asset, ommm, learning };
}

test('learning pool enforces owner, completed UTC days, one reward per day, and sequential levels 1-6', async t => {
  const f = await setup(t);
  const firstDay = await f.learning.firstDay();

  await assert.rejects(() => f.learning.connect(f.signers[1]).awardLevel(f.addresses[2], 1, id('unauthorized')));
  await assert.rejects(() => f.learning.awardDay(f.addresses[2], firstDay, id('same-day')));

  await f.chain.request({ method: 'evm_increaseTime', params: [24 * 60 * 60] });
  await f.chain.request({ method: 'evm_mine', params: [] });
  await assert.rejects(() => f.learning.awardDay(f.addresses[2], firstDay + 1n, id('current-day')));
  await assert.rejects(() => f.learning.awardDay(f.addresses[2], firstDay + 2n, id('future-day')));
  if (firstDay > 0n) await assert.rejects(() => f.learning.awardDay(f.addresses[2], firstDay - 1n, id('before-launch')));

  await mined(f.learning.awardDay(f.addresses[2], firstDay, id('day-one')));
  assert.equal(await f.ommm.balanceOf(f.addresses[2]), parseEther('0.1'));
  await assert.rejects(() => f.learning.awardDay(f.addresses[2], firstDay, id('day-one-again')));

  await assert.rejects(() => f.learning.awardLevel(f.addresses[2], 0, id('zero-level')));
  await assert.rejects(() => f.learning.awardLevel(f.addresses[2], 2, id('skip-level')));
  await mined(f.learning.awardLevel(f.addresses[2], 1, id('level-one')));
  await assert.rejects(() => f.learning.awardLevel(f.addresses[2], 1, id('repeat-level')));
  for (let level = 2; level <= 6; level++) {
    await mined(f.learning.awardLevel(f.addresses[2], level, id(`level-${level}`)));
  }
  await assert.rejects(() => f.learning.awardLevel(f.addresses[2], 7, id('level-seven')));
  assert.equal(await f.learning.awardedLevel(f.addresses[2]), 6n);
  assert.equal(await f.ommm.balanceOf(f.addresses[2]), parseEther('6.1'));
});

test('learning pool relies on Ommm for globally unique evidence and budget enforcement', async t => {
  const f = await setup(t);
  const firstDay = await f.learning.firstDay();
  await f.chain.request({ method: 'evm_increaseTime', params: [24 * 60 * 60] });
  await f.chain.request({ method: 'evm_mine', params: [] });

  const evidence = id('same-evidence');
  await mined(f.learning.awardDay(f.addresses[2], firstDay, evidence));
  await assert.rejects(() => f.learning.awardLevel(f.addresses[2], 1, evidence));

  await mined(f.ommm.closePool(f.learning.target));
  await assert.rejects(() => f.learning.awardLevel(f.addresses[2], 1, id('closed-pool')));
});

test('learning pool rejects a non-contract Ommm address', async t => {
  const f = await setup(t);
  await assert.rejects(() => new ContractFactory(
    learningArtifact.abi, learningArtifact.bytecode, f.signers[0]
  ).deploy(ZeroAddress, f.addresses[0]));
});
