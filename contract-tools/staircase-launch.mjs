import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  Contract, ContractFactory, FetchRequest, JsonRpcProvider, Transaction, Wallet,
  ZeroAddress, getCreateAddress, keccak256, parseEther
} from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

export const addresses = {
  steward: '0xcAeEd8422fB5682C298B7F0971906d446fFd4e7a',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  weth: '0x4200000000000000000000000000000000000006',
  factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  router: '0x2626664c2603336E57B271c5C0b26F421741e481',
  quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  oracle: '0x420000000000000000000000000000000000000F'
};
export const initialAssets = 440_000n;
export const gasCap = parseEther('0.001');
export const swapCap = parseEther('0.00025');
const readPublic = name => JSON.parse(fs.readFileSync(new URL(`../public/dlang/${name}.json`, import.meta.url), 'utf8'));
const original = readPublic('ommm-deployment'), weekly = readPublic('deployment');
export const roster = weekly.members;
export const assetAbi = [
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)', 'function decimals() view returns(uint8)'
];
const routerAbi = [
  'function WETH9() view returns(address)', 'function factory() view returns(address)',
  'function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96)) payable returns(uint256)',
  'function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])', 'function refundETH() payable'
];
export function connectBase() {
  const request = new FetchRequest('https://mainnet.base.org');
  request.timeout = 30_000;
  return new JsonRpcProvider(request, 8453, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
}

// Exact-output ETH swap: no token approvals, bounded input, atomic refund and deadline.
export async function quoteSwap(provider) {
  const { steward, asset, weth, factory, router, quoter } = addresses;
  const r = new Contract(router, routerAbi, provider);
  if (await r.WETH9() !== weth || await r.factory() !== factory) throw Error('Router identity mismatch.');
  const f = new Contract(factory, ['function getPool(address,address,uint24) view returns(address)'], provider);
  const pool = await f.getPool(weth, asset, 500);
  if (pool === ZeroAddress) throw Error('Expected native USDC/WETH pool unavailable.');
  const pair = new Contract(pool, [
    'function token0() view returns(address)', 'function token1() view returns(address)',
    'function factory() view returns(address)', 'function fee() view returns(uint24)', 'function liquidity() view returns(uint128)'
  ], provider);
  if (await pair.token0() !== weth || await pair.token1() !== asset || await pair.factory() !== factory
    || await pair.fee() !== 500n || await pair.liquidity() === 0n) throw Error('Unexpected swap pool.');
  const q = new Contract(quoter, [
    'function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256 amountIn,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)'
  ], provider);
  const result = await q.quoteExactOutputSingle.staticCall([weth, asset, initialAssets, 500, 0]);
  const input = result.amountIn, maximum = (input * 101n + 99n) / 100n;
  if (input <= 0n || maximum > swapCap) throw Error('Quote exceeds approved ETH cap.');
  const feed = new Contract('0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', [
    'function description() view returns(string)', 'function decimals() view returns(uint8)',
    'function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'
  ], provider);
  const block = await provider.getBlock('latest'), round = await feed.latestRoundData();
  const decimals = await feed.decimals();
  if (await feed.description() !== 'ETH / USD' || round[1] <= 0n || round[3] === 0n || round[4] < round[0]
    || BigInt(block.timestamp) < round[3] || BigInt(block.timestamp) - round[3] > 7200n) throw Error('Stale/invalid ETH price feed.');
  const referenceInput = initialAssets * 10n ** 18n * 10n ** decimals / (1_000_000n * round[1]);
  if (input * 100n > referenceInput * 102n || input * 100n < referenceInput * 98n) {
    throw Error('Swap quote differs by over 2% from the independent ETH/USD feed.');
  }
  const deadline = block.timestamp + 600;
  const data = r.interface.encodeFunctionData('multicall(uint256,bytes[])', [deadline, [
    r.interface.encodeFunctionData('exactOutputSingle', [[weth, asset, 500, steward, initialAssets, maximum, 0]]),
    r.interface.encodeFunctionData('refundETH')
  ]]);
  return { request: { to: router, data, value: maximum }, quote: {
    pool, fee: 500, exactUSDC: String(initialAssets), quotedETHWei: String(input),
    maximumETHWei: String(maximum), slippageBps: 100, deadline, blockNumber: block.number,
    ethUsdAnswer: String(round[1]), ethUsdDecimals: Number(decimals), oracleUpdatedAt: String(round[3])
  } };
}

export function runtimeMatches(artifact, code) {
  let normalized = code.slice(2);
  for (const refs of Object.values(artifact.runtime.immutableReferences || {})) {
    for (const { start, length } of refs) {
      normalized = normalized.slice(0, start * 2) + '0'.repeat(length * 2) + normalized.slice((start + length) * 2);
    }
  }
  return normalized === artifact.runtime.object;
}

async function main() {
  const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
  const step = argument('--step'), broadcast = process.argv.includes('--broadcast');
  if (!['swap', 'reserve', 'trial', 'approve', 'bootstrap', 'manifest'].includes(step)) throw Error('Use --step swap|reserve|trial|approve|bootstrap|manifest.');
  const directory = new URL('build/staircase/', import.meta.url);
  fs.mkdirSync(directory, { recursive: true });
  const file = name => new URL(`${name}.json`, directory);
  const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
  const write = (name, data, options) => fs.writeFileSync(file(name), JSON.stringify(data, (_, value) =>
    typeof value === 'bigint' ? String(value) : value, 2) + '\n', options);
  const provider = connectBase();
  try {
    const { steward, asset } = addresses;
    if (await provider.send('eth_chainId', []) !== '0x2105') throw Error('Not Base.');
    const usdc = new Contract(asset, assetAbi, provider);
    if (await usdc.decimals() !== 6n) throw Error('Unexpected USDC decimals.');
    let spent = BigInt(original.actualGasTotalWei) + BigInt(weekly.actualTotalFeeWei);
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith('-submitted.json'))) {
      const submitted = JSON.parse(fs.readFileSync(new URL(name, directory), 'utf8'));
      const receipt = await provider.getTransactionReceipt(submitted.hash);
      if (!receipt || receipt.status !== 1 || await receipt.confirmations() < 3) {
        throw Error(`Reconcile ${submitted.hash}; never automatically resubmit.`);
      }
      const raw = await provider.send('eth_getTransactionReceipt', [submitted.hash]);
      if (raw.l1Fee == null) throw Error('Missing L1 receipt fee.');
      const actual = receipt.gasUsed * receipt.gasPrice + BigInt(raw.l1Fee);
      spent += actual;
      write(name.replace('-submitted.json', '-confirmed'), {
        ...submitted, actualTotalWei: String(actual), blockNumber: receipt.blockNumber, receiptStatus: receipt.status
      });
      if (submitted.step === step) throw Error(`${step} already confirmed: ${submitted.hash}.`);
    }
    const reserveArtifact = compileContract('OmmmStaircase'), trialArtifact = compileContract('DLangStaircaseTrial');
    let reserveAddress;
    if (step !== 'swap' && step !== 'reserve') reserveAddress = read('reserve-confirmed').contract;
    const pool = reserveAddress ? new Contract(reserveAddress, reserveArtifact.abi, provider) : null;
    if (pool && (!runtimeMatches(reserveArtifact, await provider.getCode(reserveAddress))
      || await pool.owner() !== steward || await pool.asset() !== asset
      || await pool.prototypeRetired() || await pool.recoveryDisabled())) throw Error('Successor configuration changed.');
    if (step === 'manifest') {
      const trialAddress = read('trial-confirmed').contract;
      const trial = new Contract(trialAddress, trialArtifact.abi, provider);
      if (!await pool.funded() || await pool.reserveAssets() !== initialAssets
        || await pool.totalSupply() !== parseEther('4400') || await pool.balanceOf(reserveAddress) !== parseEther('4400')
        || await usdc.allowance(steward, reserveAddress) !== 0n
        || !runtimeMatches(trialArtifact, await provider.getCode(trialAddress))
        || await trial.steward() !== steward || await trial.token() !== asset
        || await trial.staircase() !== reserveAddress || await trial.roundCount() !== 0n
        || await trial.liabilities() !== 0n || await trial.prototypeRetired() || await trial.recoveryDisabled()
        || await trial.memberCount() !== BigInt(roster.length)) throw Error('Funded deployment verification failed.');
      for (let i = 0; i < roster.length; i++) if (await trial.members(i) !== roster[i]) throw Error('Roster mismatch.');
      const transactions = Object.fromEntries(['swap', 'reserve', 'trial', 'approve', 'bootstrap'].map(action => {
        const { hash, blockNumber, receiptStatus, actualTotalWei } = read(`${action}-confirmed`);
        return [action, { hash, blockNumber, receiptStatus, actualTotalWei }];
      }));
      const manifest = {
        format: 'dlang-staircase-deployment', version: 1, chainId: 8453, contract: reserveAddress,
        asset, steward, funded: true, prototypeRecovery: true, recoveryDisabled: false,
        runtimeCodeHash: keccak256(await provider.getCode(reserveAddress)),
        sourceHash: keccak256(Buffer.from(reserveArtifact.source)), compiler: reserveArtifact.compiler,
        initialSupply: String(parseEther('4400')), initialAssets: String(initialAssets),
        originalReserve: original.contract, migration: false, transactions, cumulativeGasWei: String(spent),
        weekly: { contract: trialAddress, runtimeCodeHash: keccak256(await provider.getCode(trialAddress)),
          sourceHash: keccak256(Buffer.from(trialArtifact.source)), steward, members: roster, staircase: reserveAddress,
          roundCount: 0, paymentsEnabled: false, prototypeRecovery: true },
        verifiedAt: new Date().toISOString()
      };
      fs.writeFileSync(new URL('../public/dlang/staircase-deployment.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
    const nonce = await provider.getTransactionCount(steward, 'pending');
    if (nonce !== await provider.getTransactionCount(steward, 'latest')) throw Error('Signer has pending transactions.');
    const oldPool = new Contract(original.contract, ['function balanceOf(address) view returns(uint256)', 'function reserveAssets() view returns(uint256)'], provider);
    const oldTrial = new Contract(weekly.contract, ['function roundCount() view returns(uint256)', 'function liabilities() view returns(uint256)'], provider);
    if (await oldPool.balanceOf(original.contract) !== parseEther('4400') || await oldPool.reserveAssets() !== initialAssets
      || await oldTrial.roundCount() !== 0n || await oldTrial.liabilities() !== 0n) throw Error('Original pool/trial changed; review coexistence.');
    let request, quote, contract, artifact;
    const beforeUSDC = await usdc.balanceOf(steward), beforeETH = await provider.getBalance(steward);
    if (step === 'swap') {
      if (broadcast) {
        const previous = read('swap-preflight');
        if (previous.quote.deadline < Math.floor(Date.now() / 1000) + 60) throw Error('Swap quote expired.');
        request = { ...previous.request, value: BigInt(previous.request.value) }; quote = previous.quote;
        if (BigInt(request.value) > swapCap || quote.exactUSDC !== String(initialAssets) || quote.slippageBps !== 100) throw Error('Swap parameters changed.');
      } else ({ request, quote } = await quoteSwap(provider));
      await provider.call({ ...request, from: steward });
    } else if (['reserve', 'trial'].includes(step)) {
      if (beforeUSDC < initialAssets) throw Error('Fresh reserve funding unavailable.');
      artifact = step === 'reserve' ? reserveArtifact : trialArtifact;
      contract = getCreateAddress({ from: steward, nonce });
      if (await provider.getCode(contract) !== '0x') throw Error('Deployment address occupied.');
      request = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(...(
        step === 'reserve' ? [asset, steward] : [asset, steward, roster, reserveAddress]));
    } else {
      if (await pool.funded() || await pool.reserveAssets() !== 0n || beforeUSDC < initialAssets) throw Error('Pre-bootstrap state changed.');
      const allowance = await usdc.allowance(steward, reserveAddress);
      if (step === 'approve') {
        if (allowance !== 0n) throw Error('Allowance must start at zero.');
        request = await usdc.approve.populateTransaction(reserveAddress, initialAssets);
      } else {
        read('approve-confirmed');
        if (allowance !== initialAssets) throw Error('Exact bootstrap allowance missing.');
        request = await pool.bootstrap.populateTransaction();
      }
    }
    const gasLimit = (await provider.estimateGas({ from: steward, ...request })) * 120n / 100n;
    const fees = await provider.getFeeData();
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw Error('Fee data unavailable.');
    const transaction = { chainId: 8453, type: 2, nonce, value: 0n, ...request, gasLimit,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
    const l1 = new Contract(addresses.oracle, ['function getL1FeeUpperBound(uint256) view returns(uint256)'], provider);
    const info = new Contract('0x4200000000000000000000000000000000000015', [
      'function operatorFeeScalar() view returns(uint32)', 'function operatorFeeConstant() view returns(uint64)'
    ], provider);
    if (await info.operatorFeeScalar() !== 0n || await info.operatorFeeConstant() !== 0n) throw Error('Unexpected operator fees.');
    const l1Bound = await l1.getL1FeeUpperBound((Transaction.from(transaction).unsignedSerialized.length - 2) / 2 + 68);
    const maximumFee = gasLimit * fees.maxFeePerGas + l1Bound * 2n;
    if (spent + maximumFee > gasCap || beforeETH < maximumFee + BigInt(transaction.value)) throw Error('Cumulative gas budget/balance exceeded.');
    const report = { step, contract, reserve: reserveAddress, nonce, request, quote, gasLimit,
      maxFeePerGas: fees.maxFeePerGas, maximumFeeWei: maximumFee, priorActualWei: spent,
      dataHash: keccak256(request.data), beforeUSDC, beforeETH, at: new Date().toISOString(),
      ...(artifact ? { creationCodeHash: keccak256(artifact.bytecode), sourceHash: keccak256(Buffer.from(artifact.source)) } : {}) };
    if (broadcast) {
      const previous = read(`${step}-preflight`);
      if (Date.now() - Date.parse(previous.at) > 600_000 || previous.nonce !== nonce
        || previous.dataHash !== report.dataHash || previous.creationCodeHash !== report.creationCodeHash
        || previous.beforeUSDC !== String(beforeUSDC) || previous.beforeETH !== String(beforeETH)) throw Error('Preflight changed or expired.');
    }
    write(`${step}-preflight`, report);
    write('reserve-compiler-input', reserveArtifact.input);
    write('trial-compiler-input', trialArtifact.input);
    console.log(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? String(value) : value, 2));
    if (!broadcast) return;
    const envPath = argument('--env');
    if (!envPath) throw Error('Explicit authorized --env required to broadcast.');
    const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(env.DEPLOYER_PRIVATE_KEY || '')) throw Error('Authorized key missing; withheld.');
    const key = env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`;
    const wallet = new Wallet(key);
    if (wallet.address !== steward) throw Error('Wrong authorized signer.');
    if (await provider.getTransactionCount(steward, 'pending') !== nonce) throw Error('Nonce changed.');
    const signed = await wallet.signTransaction(transaction), hash = keccak256(signed);
    write(`${step}-submitted`, { ...report, hash }, { flag: 'wx' });
    const sent = await provider.broadcastTransaction(signed);
    if (sent.hash !== hash) throw Error('Broadcast hash mismatch; reconcile journal.');
    const receipt = await provider.waitForTransaction(hash, 3, 180_000);
    if (!receipt || receipt.status !== 1) throw Error(`Reconcile recorded transaction ${hash}; no automatic retry.`);
    const raw = await provider.send('eth_getTransactionReceipt', [hash]);
    if (raw.l1Fee == null) throw Error('Reconcile missing receipt fee.');
    const actual = receipt.gasUsed * receipt.gasPrice + BigInt(raw.l1Fee);
    write(`${step}-confirmed`, { ...report, hash, actualTotalWei: String(actual),
      blockNumber: receipt.blockNumber, receiptStatus: receipt.status });
    if (spent + actual > gasCap) throw Error('Actual fee exceeded cap; stop further writes.');
    if (artifact && (receipt.contractAddress !== contract || !runtimeMatches(artifact, await provider.getCode(contract)))) {
      throw Error('Deployment runtime mismatch.');
    }
    if (step === 'swap') {
      const received = await usdc.balanceOf(steward) - beforeUSDC;
      const input = beforeETH - await provider.getBalance(steward) - actual;
      if (received !== initialAssets || input <= 0n || input > BigInt(request.value)) throw Error('Swap balance delta mismatch; reconcile.');
      write('swap-deltas', { hash, receivedMicroUSDC: received, spentETHWei: input });
    }
    console.log(JSON.stringify({ step, hash, confirmed: true, contract, actualFeeWei: String(actual) }));
  } finally { provider.destroy(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
