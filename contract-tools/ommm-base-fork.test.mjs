import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import * as ethers from 'ethers';
import { compileOmmm } from './ommm-artifact.mjs';
import { connectOmmm, backingQuote } from '../public/dlang/ommm.mjs';

test('real Base USDC fork: bootstrap, reviewed award, browser client verification and exact burn redemption', { timeout: 240_000 }, async t => {
  const rpc = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const token = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const abi = [
    'function masterMinter() view returns(address)', 'function paused() view returns(bool)',
    'function configureMinter(address,uint256) returns(bool)', 'function mint(address,uint256) returns(bool)',
    'function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)',
    'function allowance(address,address) view returns(uint256)'
  ];
  const remote = new ethers.JsonRpcProvider(rpc, 8453, { staticNetwork: true });
  let chain, provider;
  t.after(async () => { remote.destroy(); provider?.destroy(); await chain?.disconnect(); delete globalThis.ethers; });
  const block = await remote.getBlockNumber(), real = new ethers.Contract(token, abi, remote);
  const master = await real.masterMinter({ blockTag: block });
  console.log(`Preparing read-only Base fork at block ${block}.`);
  assert.equal(await real.paused({ blockTag: block }), false);
  chain = ganache.provider({
    logging: { quiet: true }, fork: { url: rpc, blockNumber: block, disableCache: true },
    chain: { chainId: 8453, hardfork: 'shanghai' },
    wallet: { deterministic: true, unlockedAccounts: [master] }
  });
  provider = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  console.log('Local fork provider created.');
  const steward = await provider.getSigner(0), learner = await provider.getSigner(1);
  const stewardAddress = await steward.getAddress(), learnerAddress = await learner.getAddress();
  await provider.send('evm_setAccountBalance', [master, '0xde0b6b3a7640000']);
  const mined = async tx => (await tx).wait();
  const admin = new ethers.Contract(token, abi, await provider.getSigner(master));
  await mined(admin.configureMinter(stewardAddress, 440_000n));
  const usdc = new ethers.Contract(token, abi, steward);
  await mined(usdc.mint(stewardAddress, 440_000n));
  console.log('Local-only USDC mint verified.');
  const artifact = compileOmmm();
  const pool = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, steward).deploy(token, stewardAddress);
  await pool.waitForDeployment();
  await mined(usdc.approve(pool.target, 440_000n)); await mined(pool.bootstrap());
  console.log('Local Ommm reserve bootstrapped with actual USDC implementation.');
  assert.equal(await usdc.allowance(stewardAddress, pool.target), 0n);
  await mined(pool.awardLevel(learnerAddress, 1, ethers.id('local reviewed level')));
  await provider.send('evm_mine', []); await provider.send('evm_mine', []);
  globalThis.ethers = ethers;
  const config = { chainId: 8453, funded: true, contract: pool.target, asset: token,
    runtimeCodeHash: ethers.keccak256(await provider.getCode(pool.target)) };
  const wallet = { connected: true, chainId: '0x2105', address: learnerAddress, provider };
  const state = await connectOmmm(config, wallet);
  assert.equal(state.balance, ethers.parseEther('1'));
  assert.equal(state.reserve, 440_000n);
  assert.equal(backingQuote(state.balance, state.reserve, state.supply), 100n);
  await assert.rejects(() => connectOmmm(config, { ...wallet, chainId: '0x89' }), /Base/);
  await assert.rejects(() => connectOmmm({ ...config, runtimeCodeHash: ethers.ZeroHash }, wallet), /runtime/);
  await mined(pool.connect(learner).redeem(ethers.parseEther('1'), 100n));
  assert.equal(await usdc.balanceOf(learnerAddress), 100n);
  assert.equal(await pool.balanceOf(learnerAddress), 0n);
  assert.equal(await pool.totalSupply(), ethers.parseEther('4399'));
  assert.equal(await pool.reserveAssets(), 439_900n);
  console.log(`Verified local-only fork at Base block ${block}; no remote signatures or transactions.`);
});
