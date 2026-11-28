import test from 'node:test';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, parseEther } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

const ommmArtifact = compileContract('Ommm');
const voiceArtifact = compileContract('DLangOmmmVoicePool');
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
    wallet: { deterministic: true, totalAccounts: 4 }
  });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  const deploy = async (abi, bytecode, args = []) => {
    const contract = await new ContractFactory(abi, bytecode, signers[0]).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };
  const asset = await deploy(assetArtifact.abi, `0x${assetArtifact.evm.bytecode.object}`);
  const ommm = await deploy(ommmArtifact.abi, ommmArtifact.bytecode, [
    asset.target, addresses[0], parseEther('1000')
  ]);
  const weeklyBudget = parseEther('10');
  const voice = await deploy(voiceArtifact.abi, voiceArtifact.bytecode, [
    ommm.target, addresses[0], weeklyBudget
  ]);
  await mined(asset.mint(addresses[0], 10_000_000n));
  await mined(asset.approve(ommm.target, 10_000_000n));
  await mined(ommm.openPool(voice.target, 'DLang voice', weeklyBudget, 1_000n));
  const now = async () => Number((await provider.getBlock('latest')).timestamp);
  const advance = async seconds => {
    await chain.request({ method: 'evm_increaseTime', params: [seconds] });
    await chain.request({ method: 'evm_mine', params: [] });
  };
  return { chain, provider, signers, addresses, asset, ommm, voice, weeklyBudget, now, advance };
}

test('voice weeks are owner-scheduled, budget-reserved, and settle exact rewards once after the end', async t => {
  const f = await setup(t);
  const weekId = id('NY-2026-11-23');
  const now = await f.now();
  await assert.rejects(() => f.voice.connect(f.signers[1]).scheduleWeek(weekId, now, now + 60));
  await mined(f.voice.scheduleWeek(weekId, now, now + 60));
  assert.equal(await f.voice.reservedBudget(), f.weeklyBudget);
  await assert.rejects(() => f.voice.scheduleWeek(weekId, now, now + 60));

  const recipients = f.addresses.slice(1, 3).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const half = f.weeklyBudget / 2n;
  const evidence = id('reviewed-voice-ledger');
  await assert.rejects(() => f.voice.settleWeek(weekId, recipients, [half, half], evidence));
  await assert.rejects(() => f.voice.settleWeek(weekId, [...recipients].reverse(), [half, half], evidence));
  await assert.rejects(() => f.voice.connect(f.signers[1]).settleWeek(weekId, recipients, [half, half], evidence));

  await f.advance(61);
  await mined(f.voice.settleWeek(weekId, recipients, [half, half], evidence));
  assert.equal(await f.ommm.balanceOf(recipients[0]), half);
  assert.equal(await f.ommm.balanceOf(recipients[1]), half);
  assert.equal(await f.voice.reservedBudget(), 0n);
  assert.equal(await f.voice.scheduledWeeks(weekId).then(week => week.settled), true);
  assert.equal(await f.ommm.previewRedeem(parseEther('1')), 100n);
  await assert.rejects(() => f.voice.settleWeek(weekId, recipients, [half, half], id('again')));
});

test('empty weeks carry the budget forward for a later scheduled week', async t => {
  const f = await setup(t);
  const first = id('NY-2026-11-23');
  const start = await f.now();
  await mined(f.voice.scheduleWeek(first, start, start + 30));
  await f.advance(31);
  await mined(f.voice.settleWeek(first, [], [], id('no-eligible-plays')));
  assert.equal(await f.voice.reservedBudget(), 0n);
  assert.equal(await f.ommm.remainingBudget(f.voice.target), f.weeklyBudget);
  const second = id('NY-2026-11-30');
  const nextStart = await f.now();
  await mined(f.voice.scheduleWeek(second, nextStart, nextStart + 30));
  assert.equal(await f.voice.reservedBudget(), f.weeklyBudget);
});
