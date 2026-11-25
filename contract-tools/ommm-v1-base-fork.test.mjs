import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import * as ethers from 'ethers';
import { compileContract } from './ommm-artifact.mjs';
import { backingQuote, connectOmmm } from '../public/dlang/ommm.mjs';

test('Base fork: fund learning and voice budgets, enforce the price limit, and redeem Ommm', {
  timeout: 240_000
}, async t => {
  const rpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const usdcAddress = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const remote = new ethers.JsonRpcProvider(rpc, 8453, { staticNetwork: true });
  let chain;
  let provider;
  t.after(async () => { remote.destroy(); provider?.destroy(); await chain?.disconnect(); delete globalThis.ethers; });

  const block = await remote.getBlockNumber();
  const usdcAbi = [
    'function masterMinter() view returns(address)',
    'function paused() view returns(bool)',
    'function configureMinter(address,uint256) returns(bool)',
    'function mint(address,uint256) returns(bool)',
    'function approve(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)',
    'function allowance(address,address) view returns(uint256)',
    'function decimals() view returns(uint8)'
  ];
  const realUsdc = new ethers.Contract(usdcAddress, usdcAbi, remote);
  const master = await realUsdc.masterMinter({ blockTag: block });
  assert.equal(await realUsdc.decimals({ blockTag: block }), 6n);
  assert.equal(await realUsdc.paused({ blockTag: block }), false);

  chain = ganache.provider({
    logging: { quiet: true },
    fork: { url: rpc, blockNumber: block, disableCache: true },
    chain: { chainId: 8453, hardfork: 'shanghai' },
    wallet: { deterministic: true, unlockedAccounts: [master] }
  });
  provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;

  const steward = await provider.getSigner(0);
  const learner = await provider.getSigner(1);
  const voiceContributor = await provider.getSigner(2);
  const stewardAddress = await steward.getAddress();
  const learnerAddress = await learner.getAddress();
  const contributorAddress = await voiceContributor.getAddress();
  const mined = async tx => (await tx).wait();

  await provider.send('evm_setAccountBalance', [master, '0xde0b6b3a7640000']);
  const admin = new ethers.Contract(usdcAddress, usdcAbi, await provider.getSigner(master));
  const fundingUnits = 1_296_000n;
  await mined(admin.configureMinter(stewardAddress, fundingUnits));
  const asset = new ethers.Contract(usdcAddress, usdcAbi, steward);
  await mined(asset.mint(stewardAddress, fundingUnits));
  const ommmArtifact = compileContract('Ommm');
  const learningArtifact = compileContract('DLangOmmmLearningPool');
  const voiceArtifact = compileContract('DLangOmmmVoicePool');
  const cap = ethers.parseEther('1000000');
  const ommm = await new ethers.ContractFactory(ommmArtifact.abi, ommmArtifact.bytecode, steward)
    .deploy(usdcAddress, stewardAddress, cap);
  await ommm.waitForDeployment();
  const learning = await new ethers.ContractFactory(learningArtifact.abi, learningArtifact.bytecode, steward)
    .deploy(ommm.target, stewardAddress);
  await learning.waitForDeployment();
  const weeklyBudget = ethers.parseEther('10000');
  const voice = await new ethers.ContractFactory(voiceArtifact.abi, voiceArtifact.bytecode, steward)
    .deploy(ommm.target, stewardAddress, weeklyBudget);
  await voice.waitForDeployment();

  const learningBudget = ethers.parseEther('4400');
  const learningAssets = await ommm.requiredAssets(learningBudget);
  assert.equal(learningAssets, 440_000n);
  await mined(asset.approve(ommm.target, fundingUnits));
  await mined(ommm.openPool(learning.target, 'DLang learning', learningBudget, learningAssets));
  const voiceAssets = await ommm.requiredAssets(weeklyBudget);
  assert.equal(voiceAssets, 856_000n);
  await mined(ommm.openPool(voice.target, 'DLang voice', weeklyBudget, voiceAssets));
  assert.equal(await ommm.reserveAssets(), 1_296_000n);
  assert.equal(await ommm.committedSupply(), ethers.parseEther('14400'));

  const firstDay = await learning.firstDay();
  await provider.send('evm_increaseTime', [24 * 60 * 60]);
  await provider.send('evm_mine', []);
  await mined(learning.awardDay(learnerAddress, firstDay, ethers.id('fork-day')));
  await mined(learning.awardLevel(learnerAddress, 1, ethers.id('fork-level')));
  await provider.send('evm_mine', []);
  await provider.send('evm_mine', []);
  await provider.send('evm_mine', []);
  assert.equal(await ommm.balanceOf(learnerAddress), ethers.parseEther('1.1'));
  assert.equal(await ommm.previewRedeem(ethers.parseEther('1')), 90n);

  globalThis.ethers = ethers;
  const config = {
    format: 'dlang-ommm-v1',
    chainId: 8453,
    funded: true,
    contract: ommm.target,
    asset: usdcAddress,
    runtimeCodeHash: ethers.keccak256(await provider.getCode(ommm.target))
  };
  const state = await connectOmmm(config, {
    connected: true, chainId: '0x2105', address: learnerAddress, provider
  });
  assert.equal(state.supply, ethers.parseEther('14400'));
  assert.equal(backingQuote(state.balance, state.reserve, state.supply), 99n);

  const now = Number((await provider.getBlock('latest')).timestamp);
  const weekId = ethers.id('fork-voice-week');
  await mined(voice.scheduleWeek(weekId, now, now + 30));
  await provider.send('evm_increaseTime', [31]);
  await provider.send('evm_mine', []);
  await mined(voice.settleWeek(weekId, [contributorAddress], [weeklyBudget], ethers.id('fork-voice-ledger')));
  assert.equal(await ommm.balanceOf(contributorAddress), weeklyBudget);
  assert.equal(await ommm.previewRedeem(ethers.parseEther('1')), 90n);

  await mined(ommm.connect(learner).redeem(ethers.parseEther('1'), 90n));
  assert.equal(await asset.balanceOf(learnerAddress), 90n);
  assert.equal(await ommm.previewRedeem(ethers.parseEther('1')), 90n);
  console.log(`Validated local-only fork at Base block ${block}; remote chain was read-only.`);
});
