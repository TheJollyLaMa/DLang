import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, parseEther } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';
import { addresses, assetAbi, connectBase, initialAssets, quoteSwap, roster, runtimeMatches, swapCap } from './staircase-launch.mjs';

test('real Base fork: exact-output swap, successor deployment, bootstrap and full prototype recovery', { timeout: 240_000 }, async t => {
  const remote = connectBase();
  let chain, provider;
  t.after(async () => { remote.destroy(); provider?.destroy(); await chain?.disconnect(); });
  const block = await remote.getBlockNumber();
  chain = ganache.provider({
    logging: { quiet: true }, fork: { url: 'https://mainnet.base.org', blockNumber: block, disableCache: true, requestsPerSecond: 8 },
    chain: { chainId: 8453, hardfork: 'shanghai' },
    wallet: { deterministic: true, unlockedAccounts: [addresses.steward] }
  });
  provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  await provider.send('evm_setAccountBalance', [addresses.steward, '0xde0b6b3a7640000']);
  const signer = await provider.getSigner(addresses.steward);
  const usdc = new Contract(addresses.asset, assetAbi, signer);
  const before = await usdc.balanceOf(addresses.steward);
  const { request, quote } = await quoteSwap(provider);
  assert(BigInt(quote.maximumETHWei) <= swapCap);
  assert.equal(quote.exactUSDC, '440000');
  const swap = await (await signer.sendTransaction(request)).wait();
  assert.equal(swap.status, 1);
  assert.equal(await usdc.balanceOf(addresses.steward) - before, initialAssets);
  const reserveArtifact = compileContract('OmmmStaircase'), trialArtifact = compileContract('DLangStaircaseTrial');
  const reserve = await new ContractFactory(reserveArtifact.abi, reserveArtifact.bytecode, signer)
    .deploy(addresses.asset, addresses.steward);
  await reserve.waitForDeployment();
  assert(runtimeMatches(reserveArtifact, await provider.getCode(reserve.target)));
  const weekly = await new ContractFactory(trialArtifact.abi, trialArtifact.bytecode, signer)
    .deploy(addresses.asset, addresses.steward, roster, reserve.target);
  await weekly.waitForDeployment();
  assert(runtimeMatches(trialArtifact, await provider.getCode(weekly.target)));
  await (await usdc.approve(reserve.target, initialAssets)).wait();
  await (await reserve.bootstrap()).wait();
  assert.equal(await reserve.reserveAssets(), initialAssets);
  assert.equal(await reserve.totalSupply(), parseEther('4400'));
  assert.equal(await reserve.balanceOf(reserve.target), parseEther('4400'));
  assert.equal(await reserve.currentStep(), 100n);
  assert.equal(await usdc.allowance(addresses.steward, reserve.target), 0n);
  assert.equal(await weekly.staircase(), reserve.target);
  assert.equal(await weekly.roundCount(), 0n);
  assert.equal(await weekly.prototypeRetired(), false);
  await (await reserve.recoverPrototype(addresses.asset, addresses.steward)).wait();
  assert.equal(await reserve.prototypeRetired(), true);
  assert.equal(await reserve.funded(), false);
  assert.equal(await usdc.balanceOf(reserve.target), 0n);
  assert.equal(await usdc.balanceOf(addresses.steward), before + initialAssets);
  await assert.rejects(() => reserve.bootstrap());
  console.log(`LOCAL ONLY Base block ${block}: real Uniswap exact-output swap, native USDC funding, full recovery; no remote signatures.`);
});
