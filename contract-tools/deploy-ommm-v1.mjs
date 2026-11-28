// Deploys shared Ommm v1 with the DLang learning and voice pools, and retires the three
// earlier Base Ommm prototypes. Default is a full rehearsal on a local Base fork;
// --broadcast signs on Base mainnet, recording every hash before sending and resuming safely.
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import * as ethers from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

const { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress, keccak256, parseEther } = ethers;
const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const broadcast = process.argv.includes('--broadcast');
const envPath = argument('--env');
if (!envPath) throw Error('Pass --env <file containing AGENCY_ENS_PRIVATE_KEY>. Default is a local fork rehearsal.');

const STEWARD = getAddress('0xcaeed8422fb5682c298b7f0971906d446ffd4e7a');
const USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const OLD = {
  reserve: getAddress('0xD5062a20A9eC942322fb63407DC5B327cF9AA8b6'),
  staircase: getAddress('0xFEEe3bEBa3e897f3db00D45CCF4Ed6927e0e301f'),
  voicePilot: getAddress('0x8fff93A94eDe08c462C2e6D1A61FE64Fb2F3aDB1')
};
const CAP = parseEther('1000000'), LEARNING_BUDGET = parseEther('4400'), WEEKLY_BUDGET = parseEther('10000');
const LEARNING_ASSETS = 440_000n, VOICE_ASSETS = 856_000n, FUNDING = LEARNING_ASSETS + VOICE_ASSETS;
const GAS_CEILING = parseEther('0.0004');

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const key = env.AGENCY_ENS_PRIVATE_KEY || '';
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) throw Error('AGENCY_ENS_PRIVATE_KEY missing or invalid; value withheld.');
const rpc = env.BASE_RPC_URL && /^https:\/\//.test(env.BASE_RPC_URL) ? env.BASE_RPC_URL : 'https://mainnet.base.org';
// Public Base RPCs rate-limit receipt polling; retry those reads instead of aborting mid-sequence.
class RetryingProvider extends JsonRpcProvider {
  async send(method, params) {
    for (let attempt = 0; ; attempt++) {
      try { return await super.send(method, params); }
      catch (error) {
        if (attempt < 10 && method !== 'eth_sendRawTransaction' && /request limit|rate limit|429|Too Many/i.test(String(error?.error?.message || error?.message))) {
          await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
  }
}
const remote = new RetryingProvider(rpc, 8453, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
remote.pollingInterval = 3000;
const ensProvider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com', 1, { staticNetwork: true });

const artifacts = { Ommm: compileContract('Ommm'), Learning: compileContract('DLangOmmmLearningPool'),
  Voice: compileContract('DLangOmmmVoicePool') };
const LEGACY_ABI = ['function owner() view returns(address)', 'function recoverPrototype(address,address)',
  'function pauseAwards()', 'function paused() view returns(bool)', 'function prototypeRetired() view returns(bool)',
  'function recoveryDisabled() view returns(bool)', 'function balanceOf(address) view returns(uint256)',
  'function totalSupply() view returns(uint256)'];
const USDC_ABI = ['function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)'];

const build = new URL('build/ommm-v1/', import.meta.url);
const record = name => new URL(`${name}.json`, build);
const readRecord = name => fs.existsSync(record(name)) ? JSON.parse(fs.readFileSync(record(name), 'utf8')) : null;

async function preconditions(provider) {
  if (await provider.send('eth_chainId', []) !== '0x2105') throw Error('Not Base mainnet.');
  if (await ensProvider.resolveName('decentagency.eth') !== STEWARD) throw Error('decentagency.eth no longer resolves to the steward.');
  for (const [name, address] of Object.entries(OLD)) {
    const legacy = new Contract(address, LEGACY_ABI, provider);
    if (await legacy.owner() !== STEWARD) throw Error(`${name} owner changed; review.`);
    if (await legacy.balanceOf(address) !== await legacy.totalSupply()) throw Error(`${name} has outside holders; migration needed.`);
  }
}

function plan(state) {
  const ommm = { interface: new ethers.Interface(artifacts.Ommm.abi) };
  return [
    { name: 'retire-staircase', to: OLD.staircase, data: new ethers.Interface(LEGACY_ABI).encodeFunctionData('recoverPrototype', [USDC, STEWARD]) },
    { name: 'retire-voice-pilot', to: OLD.voicePilot, data: new ethers.Interface(LEGACY_ABI).encodeFunctionData('recoverPrototype', [USDC, STEWARD]) },
    { name: 'pause-reserve', to: OLD.reserve, data: new ethers.Interface(LEGACY_ABI).encodeFunctionData('pauseAwards', []) },
    { name: 'deploy-ommm', deploy: () => new ContractFactory(artifacts.Ommm.abi, artifacts.Ommm.bytecode).getDeployTransaction(USDC, STEWARD, CAP) },
    { name: 'deploy-learning', deploy: () => new ContractFactory(artifacts.Learning.abi, artifacts.Learning.bytecode).getDeployTransaction(state.ommm, STEWARD) },
    { name: 'deploy-voice', deploy: () => new ContractFactory(artifacts.Voice.abi, artifacts.Voice.bytecode).getDeployTransaction(state.ommm, STEWARD, WEEKLY_BUDGET) },
    { name: 'approve-usdc', to: USDC, data: () => new ethers.Interface(USDC_ABI).encodeFunctionData('approve', [state.ommm, FUNDING]) },
    { name: 'open-learning', to: () => state.ommm, data: () => ommm.interface.encodeFunctionData('openPool', [state.learning, 'DLang learning', LEARNING_BUDGET, LEARNING_ASSETS]) },
    { name: 'open-voice', to: () => state.ommm, data: () => ommm.interface.encodeFunctionData('openPool', [state.voice, 'DLang voice', WEEKLY_BUDGET, VOICE_ASSETS]) }
  ];
}

async function run(provider, signer, { persist }) {
  const state = {}, spent = [];
  if (persist) fs.mkdirSync(build, { recursive: true });
  for (const step of plan(state)) {
    const prior = persist && readRecord(step.name);
    if (prior) {
      const receipt = await provider.getTransactionReceipt(prior.hash);
      if (!receipt || receipt.status !== 1) throw Error(`${step.name} recorded ${prior.hash} is unconfirmed/failed; reconcile, never resubmit.`);
      if (prior.contract) state[step.name.replace('deploy-', '')] = prior.contract;
      console.log(`✓ ${step.name} already confirmed ${prior.hash}`);
      continue;
    }
    const request = step.deploy ? await step.deploy()
      : { to: typeof step.to === 'function' ? step.to() : step.to, data: typeof step.data === 'function' ? step.data() : step.data };
    const sent = await signer.sendTransaction(request);
    if (persist) fs.writeFileSync(record(step.name), JSON.stringify({ step: step.name, hash: sent.hash, nonce: sent.nonce, at: new Date().toISOString() }, null, 2), { flag: 'wx' });
    const receipt = await sent.wait(persist ? 2 : 1, 180_000);
    if (!receipt || receipt.status !== 1) throw Error(`${step.name} failed: ${sent.hash}; stop and reconcile.`);
    let fee = receipt.gasUsed * receipt.gasPrice;
    if (persist) {
      const raw = await provider.send('eth_getTransactionReceipt', [sent.hash]);
      fee += BigInt(raw.l1Fee || 0);
    }
    spent.push([step.name, receipt.gasUsed, fee]);
    const entry = { step: step.name, hash: sent.hash, blockNumber: receipt.blockNumber, gasUsed: String(receipt.gasUsed), feeWei: String(fee) };
    if (step.deploy) {
      entry.contract = receipt.contractAddress;
      state[step.name.replace('deploy-', '')] = receipt.contractAddress;
    }
    if (persist) fs.writeFileSync(record(step.name), JSON.stringify(entry, null, 2));
    console.log(`✓ ${step.name} ${sent.hash}${entry.contract ? ` → ${entry.contract}` : ''}`);
  }
  return { state, spent };
}

async function verify(provider, state) {
  const ommm = new Contract(state.ommm, artifacts.Ommm.abi, provider);
  const usdc = new Contract(USDC, USDC_ABI, provider);
  const checks = {
    owner: await ommm.owner() === STEWARD, asset: await ommm.asset() === USDC, cap: await ommm.supplyCap() === CAP,
    reserve: await ommm.reserveAssets() === FUNDING, committed: await ommm.committedSupply() === LEARNING_BUDGET + WEEKLY_BUDGET,
    learningBudget: await ommm.remainingBudget(state.learning) === LEARNING_BUDGET,
    voiceBudget: await ommm.remainingBudget(state.voice) === WEEKLY_BUDGET,
    allowanceSpent: await usdc.allowance(STEWARD, state.ommm) === 0n
  };
  for (const name of ['staircase', 'voicePilot']) {
    const legacy = new Contract(OLD[name], LEGACY_ABI, provider);
    checks[`${name}Retired`] = await legacy.prototypeRetired() && await usdc.balanceOf(OLD[name]) === 0n;
  }
  checks.reservePaused = await new Contract(OLD.reserve, LEGACY_ABI, provider).paused();
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) throw Error(`Post-deployment verification failed: ${failed.join(', ')}`);
  return checks;
}

try {
  await preconditions(remote);
  const wallet = new Wallet(key.startsWith('0x') ? key : `0x${key}`);
  if (wallet.address !== STEWARD) throw Error('Key does not belong to decentagency.eth; value withheld.');
  if (!broadcast) {
    const { default: ganache } = await import('ganache');
    const block = await remote.getBlockNumber();
    const chain = ganache.provider({ logging: { quiet: true }, fork: { url: rpc, blockNumber: block, disableCache: true },
      chain: { chainId: 8453, hardfork: 'shanghai' }, wallet: { unlockedAccounts: [STEWARD] } });
    const fork = new ethers.BrowserProvider(chain, undefined, { cacheTimeout: -1 });
    fork.pollingInterval = 10;
    await fork.send('evm_setAccountBalance', [STEWARD, '0xde0b6b3a7640000']);
    const { state, spent } = await run(fork, await fork.getSigner(STEWARD), { persist: false });
    const checks = await verify(fork, state);
    const gasUsed = spent.reduce((sum, [, gas]) => sum + gas, 0n);
    const fees = await remote.getFeeData();
    const l2Estimate = gasUsed * (fees.maxFeePerGas ?? fees.gasPrice);
    console.log(JSON.stringify({ rehearsal: 'local fork only', block, checks, totalGas: String(gasUsed),
      l2FeeEstimateWei: String(l2Estimate), stewardEth: ethers.formatEther(await remote.getBalance(STEWARD)) }, null, 2));
    await chain.disconnect();
  } else {
    const nonce = await remote.getTransactionCount(STEWARD, 'pending');
    if (nonce !== await remote.getTransactionCount(STEWARD, 'latest')) throw Error('Steward has a pending transaction; wait.');
    const before = await remote.getBalance(STEWARD);
    const { state, spent } = await run(remote, wallet.connect(remote), { persist: true });
    const total = spent.reduce((sum, [, , fee]) => sum + fee, 0n);
    if (total > GAS_CEILING) console.warn(`Gas exceeded ceiling: ${ethers.formatEther(total)} ETH`);
    const checks = await verify(remote, state);
    const runtimeCodeHash = keccak256(await remote.getCode(state.ommm));
    const confirmed = name => readRecord(name);
    const manifest = {
      format: 'dlang-ommm-v1', version: 1, chainId: 8453, contract: state.ommm, asset: USDC, steward: STEWARD,
      name: 'Ommm', symbol: 'Ommm', decimals: 18, funded: true, supplyCap: String(CAP), runtimeCodeHash,
      initialPrice: '100', maxDropBps: 1000, sourceHash: keccak256(Buffer.from(artifacts.Ommm.source)),
      compiler: artifacts.Ommm.compiler, prototypeRecovery: true,
      pools: {
        learning: { contract: state.learning, label: 'DLang learning', budget: String(LEARNING_BUDGET), assets: String(LEARNING_ASSETS),
          runtimeCodeHash: keccak256(await remote.getCode(state.learning)) },
        voice: { contract: state.voice, label: 'DLang voice', budget: String(WEEKLY_BUDGET), weeklyBudget: String(WEEKLY_BUDGET),
          assets: String(VOICE_ASSETS), runtimeCodeHash: keccak256(await remote.getCode(state.voice)) }
      },
      retired: {
        reserve: { contract: OLD.reserve, action: 'awards paused; no recovery function, 0.44 USDC remains locked, no outside holders', tx: confirmed('pause-reserve').hash },
        staircase: { contract: OLD.staircase, action: 'prototype recovered to steward', tx: confirmed('retire-staircase').hash },
        voicePilot: { contract: OLD.voicePilot, action: 'prototype recovered to steward; week Nov 16–23 had zero plays', tx: confirmed('retire-voice-pilot').hash }
      },
      transactions: Object.fromEntries(plan({}).map(({ name }) => [name, confirmed(name).hash])),
      actualGasTotalWei: String(total), stewardEthBefore: String(before), verifiedAt: new Date().toISOString()
    };
    fs.writeFileSync(new URL('../public/dlang/ommm-deployment.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ checks, ommm: state.ommm, learning: state.learning, voice: state.voice,
      gasEth: ethers.formatEther(total) }, null, 2));
  }
} finally {
  remote.destroy(); ensProvider.destroy();
}
