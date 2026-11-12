import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, JsonRpcProvider, id, parseEther } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

test('local Base USDC: 50/50 settlement crosses $2, holder dividend and inventory withdrawal preserve $1 backing', { timeout: 180_000 }, async t => {
  const rpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const abi = [
    'function masterMinter() view returns(address)', 'function paused() view returns(bool)',
    'function configureMinter(address,uint256) returns(bool)', 'function mint(address,uint256) returns(bool)',
    'function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)',
    'function allowance(address,address) view returns(uint256)'
  ];
  const remote = new JsonRpcProvider(rpc, 8453, { staticNetwork: true });
  let chain, provider;
  t.after(async () => { remote.destroy(); provider?.destroy(); await chain?.disconnect(); });
  const block = await remote.getBlockNumber(), real = new Contract(token, abi, remote);
  const master = await real.masterMinter({ blockTag: block });
  assert.equal(await real.paused({ blockTag: block }), false);
  chain = ganache.provider({
    logging: { quiet: true }, fork: { url: rpc, blockNumber: block, disableCache: true },
    chain: { chainId: 8453, hardfork: 'shanghai' },
    wallet: { deterministic: true, unlockedAccounts: [master] }
  });
  provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const steward = await provider.getSigner(0), survivor = await provider.getSigner(1), dropped = await provider.getSigner(2);
  const administrator = await steward.getAddress(), learner = await survivor.getAddress(), nonqualifier = await dropped.getAddress();
  await provider.send('evm_setAccountBalance', [master, '0xde0b6b3a7640000']);
  const mined = async tx => (await tx).wait();
  const usdc = new Contract(token, abi, steward);
  await mined(new Contract(token, abi, await provider.getSigner(master)).configureMinter(administrator, 20_000_000_000n));
  await mined(usdc.mint(administrator, 10_000_000_000n));
  for (const address of [learner, nonqualifier]) await mined(usdc.mint(address, 1_000_000n));
  const deploy = async (name, args) => {
    const artifact = compileContract(name);
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, steward).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const pool = await deploy('OmmmStaircase', [token, administrator]);
  const trial = await deploy('DLangStaircaseTrial', [token, administrator, [learner, nonqualifier], pool.target]);
  await mined(usdc.approve(pool.target, 8_799_500_000n));
  await mined(pool.bootstrap());
  await mined(pool.awardLevel(learner, 1, id('local reviewed level')));
  await mined(pool.fund(8_799_500_000n - 440_000n));
  assert.equal(await pool.resetCount(), 0n);
  const now = async () => Number((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp);
  const start = await now() + 100, end = start + 6 * 86400;
  await mined(trial.openRound(start, end, id('local successor split terms')));
  for (const signer of [survivor, dropped]) {
    await mined(usdc.connect(signer).approve(trial.target, 1_000_000n));
    await mined(trial.connect(signer).join(1, id('es')));
  }
  await provider.send('evm_increaseTime', [end - await now()]); await provider.send('evm_mine', []);
  await mined(trial.propose(1, [76, 75], id('local reviewed weekly evidence')));
  await provider.send('evm_increaseTime', [48 * 3600]); await provider.send('evm_mine', []);
  await mined(trial.finalize(1));
  assert.equal(await trial.credit(learner), 1_500_000n);
  assert.equal(await trial.staircaseCredit(), 500_000n);
  assert.equal(await pool.resetCount(), 0n);
  await mined(trial.connect(dropped).fundStaircase());
  assert.equal(await pool.resetCount(), 1n);
  assert.equal(await pool.reserveAssets(), 4_400_000_000n);
  assert.equal(await pool.claimableDividend(learner), 1_000_000n);
  assert.equal(await pool.claimableDividend(pool.target), 4_399_000_000n);
  await mined(pool.claimDividendFor(learner));
  await mined(pool.withdrawInventoryDividend(administrator, 4_399_000_000n));
  assert.equal(await pool.dividendLiabilities(), 0n);
  await mined(trial.claimFor(learner));
  assert.equal(await usdc.balanceOf(learner), 2_500_000n);
  assert.equal(await trial.liabilities(), 0n);
  await mined(pool.connect(survivor).redeem(parseEther('1'), 1_000_000n));
  assert.equal(await pool.totalSupply(), parseEther('4399'));
  assert.equal(await pool.reserveAssets(), 4_399_000_000n);
  assert.equal(await usdc.balanceOf(learner), 3_500_000n);
  assert.equal(await usdc.allowance(administrator, pool.target), 0n);
  console.log(`Verified successor flow on local-only Base fork at block ${block}; no remote signing, funding or deployment.`);
});
