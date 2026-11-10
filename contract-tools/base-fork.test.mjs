import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, JsonRpcProvider, id } from 'ethers';

test('pinned Base-native-USDC fork: exact entry, steward settlement and participant-only refund', { timeout: 180000 }, async t => {
  const rpc = process.env.BASE_RPC_URL || 'https://base-rpc.publicnode.com';
  const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const abi = [
    'function masterMinter() view returns(address)',
    'function paused() view returns(bool)',
    'function decimals() view returns(uint8)',
    'function configureMinter(address,uint256) returns(bool)',
    'function mint(address,uint256) returns(bool)',
    'function approve(address,uint256) returns(bool)',
    'function balanceOf(address) view returns(uint256)'
  ];
  const remote = new JsonRpcProvider(rpc, 8453, { staticNetwork: true });
  let chain, provider;
  t.after(async () => { remote.destroy(); provider?.destroy(); await chain?.disconnect(); });
  const block = await remote.getBlockNumber();
  const real = new Contract(token, abi, remote);
  const master = await real.masterMinter({ blockTag: block });
  assert.equal(await real.paused({ blockTag: block }), false, 'Paused USDC blocks the pilot');
  assert.equal(await real.decimals({ blockTag: block }), 6n);
  // All sends below execute only on local Ganache; remote RPC is the fork's read source.
  chain = ganache.provider({
    logging: { quiet: true }, fork: { url: rpc, blockNumber: block, disableCache: true },
    chain: { chainId: 31337, hardfork: 'shanghai' },
    wallet: { deterministic: true, unlockedAccounts: [master] }
  });
  provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const steward = await provider.getSigner(0);
  const learner = await provider.getSigner(1);
  const learnerAddress = await learner.getAddress();
  await provider.send('evm_setAccountBalance', [master, '0xde0b6b3a7640000']);
  const adminToken = new Contract(token, abi, await provider.getSigner(master));
  const mined = async tx => (await tx).wait();
  await mined(adminToken.configureMinter(await steward.getAddress(), 10_000_000));
  const usdc = new Contract(token, abi, steward);
  await mined(usdc.mint(learnerAddress, 3_000_000));
  const artifact = JSON.parse(fs.readFileSync(new URL('build/artifact.json', import.meta.url)));
  const trial = await new ContractFactory(artifact.abi, artifact.bytecode, steward)
    .deploy(token, await steward.getAddress(), [learnerAddress]);
  await trial.waitForDeployment();
  await mined(usdc.connect(learner).approve(trial.target, 2_000_000));
  const now = async () => Number((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp);
  const start = await now() + 100, end = start + 6 * 86400 + 9 * 3600;
  await mined(trial.openRound(start, end, id('local fork terms')));
  await mined(trial.connect(learner).join(1, id('hi')));
  assert.equal(await usdc.balanceOf(trial.target), 1_000_000n);
  await provider.send('evm_increaseTime', [end - await now()]);
  await provider.send('evm_mine', []);
  await mined(trial.propose(1, [76], id('local reviewed results')));
  await provider.send('evm_increaseTime', [48 * 3600]);
  await provider.send('evm_mine', []);
  await mined(trial.finalize(1));
  await mined(trial.claimFor(learnerAddress));
  assert.equal(await usdc.balanceOf(learnerAddress), 3_000_000n);
  const secondStart = await now() + 100;
  await mined(trial.openRound(secondStart, secondStart + 6 * 86400 + 9 * 3600, id('second local terms')));
  await mined(trial.connect(learner).join(2, id('zh-Hans')));
  await mined(trial.stop());
  await mined(trial.claimFor(learnerAddress));
  assert.equal(await usdc.balanceOf(learnerAddress), 3_000_000n);
  assert.equal(await trial.liabilities(), 0n);
  console.log(`Verified local fork of Base block ${block}; no remote transactions sent.`);
});
