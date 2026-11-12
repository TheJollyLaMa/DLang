import fs from 'node:fs';
import { parseEnv } from 'node:util';
import {
  Contract, ContractFactory, JsonRpcProvider, Wallet, Transaction,
  getAddress, getCreateAddress, keccak256, parseEther
} from 'ethers';
import { compileOmmm } from './ommm-artifact.mjs';

const argument = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const step = argument('--step'), envPath = argument('--env'), broadcast = process.argv.includes('--broadcast');
const award = ['day', 'level'].includes(step);
if (!envPath || !['deploy', 'approve', 'bootstrap', 'day', 'level'].includes(step)) {
  throw Error('Pass --env <authorized signing file> and --step deploy|approve|bootstrap|day|level. Default is unsigned preflight.');
}
let recipient, period, evidence, operation = step;
if (award) {
  recipient = getAddress(argument('--recipient') || '');
  evidence = argument('--evidence')?.toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(evidence || '') || /^0x0+$/.test(evidence)) throw Error('Pass a nonzero --evidence hash of the steward-reviewed record.');
  const rawPeriod = argument('--period');
  if (step === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawPeriod || '')
      || new Date(`${rawPeriod}T00:00:00Z`).toISOString().slice(0, 10) !== rawPeriod) throw Error('Day --period must be an exact UTC YYYY-MM-DD.');
    period = Date.parse(`${rawPeriod}T00:00:00Z`) / 86400000;
  } else {
    if (!/^[1-6]$/.test(rawPeriod || '')) throw Error('Level --period must be 1 through 6.');
    period = Number(rawPeriod);
  }
  operation = `${step}-${recipient.toLowerCase()}-${period}`;
}
const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(env.DEPLOYER_PRIVATE_KEY || '')) throw Error('Deployment key missing or invalid; value withheld.');
let wallet;
try { wallet = new Wallet(env.DEPLOYER_PRIVATE_KEY.startsWith('0x') ? env.DEPLOYER_PRIVATE_KEY : `0x${env.DEPLOYER_PRIVATE_KEY}`); }
catch { throw Error('Deployment key invalid; value withheld.'); }
const steward = getAddress('0xcaeed8422fb5682c298b7f0971906d446ffd4e7a');
if (wallet.address !== steward) throw Error('Signer does not match the authorized decentagency identity.');
const asset = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const cap = 1_000_000_000_000_000n, initialAssets = 440_000n;
const artifact = compileOmmm();
const build = new URL('build/ommm/', import.meta.url);
fs.mkdirSync(build, { recursive: true });
const file = name => new URL(`${name}.json`, build);
const read = name => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const write = (name, value, options) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2), options);
const provider = new JsonRpcProvider('https://base-rpc.publicnode.com', 8453, { staticNetwork: true, cacheTimeout: -1 });
const ens = new JsonRpcProvider('https://ethereum-rpc.publicnode.com', 1, { staticNetwork: true });
const usdc = new Contract(asset, [
  'function decimals() view returns(uint8)', 'function symbol() view returns(string)',
  'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)'
], provider);

function runtimeMatches(code) {
  let normalized = code.slice(2);
  for (const refs of Object.values(artifact.runtime.immutableReferences || {})) {
    for (const { start, length } of refs) {
      normalized = normalized.slice(0, start * 2) + '0'.repeat(length * 2) + normalized.slice((start + length) * 2);
    }
  }
  return normalized === artifact.runtime.object;
}

try {
  if (await provider.send('eth_chainId', []) !== '0x2105' || await ens.resolveName('decentagency.eth') !== steward) {
    throw Error('Base network or decentagency.eth identity verification failed.');
  }
  if (await usdc.decimals() !== 6n || await usdc.symbol() !== 'USDC') throw Error('Unexpected Base reserve asset.');
  let spent = 0n;
  const submitted = fs.readdirSync(build).filter(name => name.endsWith('-submitted.json'))
    .map(name => name.slice(0, -'-submitted.json'.length));
  for (const previous of submitted) {
    const submission = read(`${previous}-submitted`);
    const receipt = await provider.getTransactionReceipt(submission.hash);
    if (!receipt || receipt.status !== 1 || await receipt.confirmations() < 3) {
      throw Error(`Recorded ${previous} transaction requires reconciliation: ${submission.hash}. Never automatically resubmit.`);
    }
    const raw = await provider.send('eth_getTransactionReceipt', [submission.hash]);
    if (raw.l1Fee == null) throw Error('Confirmed receipt lacks Base L1 fee; reconcile budget.');
    const actual = receipt.gasUsed * receipt.gasPrice + BigInt(raw.l1Fee);
    spent += actual;
    write(`${previous}-confirmed`, { ...submission, actualTotalWei: String(actual),
      blockNumber: receipt.blockNumber, receiptStatus: receipt.status });
    if (previous === operation) throw Error(`${operation} already confirmed: ${submission.hash}. Do not repeat this step.`);
  }
  const nonce = await provider.getTransactionCount(steward, 'pending');
  if (nonce !== await provider.getTransactionCount(steward, 'latest')) throw Error('Signer has a pending transaction; wait.');
  let poolAddress, request;
  if (step === 'deploy') {
    poolAddress = getCreateAddress({ from: steward, nonce });
    if (await provider.getCode(poolAddress) !== '0x') throw Error('Predicted address already contains code.');
    request = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(asset, steward);
    if (await usdc.balanceOf(steward) < initialAssets) throw Error('The approved .44 USDC reserve funding is unavailable.');
  } else {
    const deployed = read('deploy-confirmed');
    poolAddress = deployed.pool;
    if (!runtimeMatches(await provider.getCode(poolAddress))) throw Error('Deployed Ommm runtime differs from compiled source.');
    const pool = new Contract(poolAddress, artifact.abi, provider);
    if (await pool.owner() !== steward || await pool.asset() !== asset) throw Error('Reserve owner/asset changed; review.');
    if (award) {
      read('bootstrap-confirmed');
      if (!await pool.funded()) throw Error('Awards require the confirmed funded reserve.');
      request = step === 'day'
        ? await pool.awardDay.populateTransaction(recipient, period, evidence)
        : await pool.awardLevel.populateTransaction(recipient, period, evidence);
    } else {
      if (await pool.funded()
        || await pool.totalSupply() !== parseEther('4400') || await pool.balanceOf(poolAddress) !== parseEther('4400')
        || await pool.reserveAssets() !== 0n) throw Error('Pre-funding reserve configuration changed; review.');
      const allowance = await usdc.allowance(steward, poolAddress);
      if (step === 'approve') {
        if (allowance !== 0n) throw Error('Existing allowance requires reconciliation, not another approval.');
        request = await usdc.approve.populateTransaction(poolAddress, initialAssets);
      } else {
        read('approve-confirmed');
        if (allowance !== initialAssets || await usdc.balanceOf(steward) < initialAssets) throw Error('Exact .44 USDC approval/balance required.');
        request = await pool.bootstrap.populateTransaction();
      }
    }
  }
  const estimate = await provider.estimateGas({ from: steward, ...request });
  const gasLimit = estimate * 120n / 100n;
  const fees = await provider.getFeeData();
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw Error('Fee data unavailable.');
  const transaction = { chainId: 8453, type: 2, nonce, value: 0n, ...request, gasLimit,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  const oracle = new Contract('0x420000000000000000000000000000000000000F',
    ['function getL1FeeUpperBound(uint256) view returns(uint256)'], provider);
  const block = new Contract('0x4200000000000000000000000000000000000015',
    ['function operatorFeeScalar() view returns(uint32)', 'function operatorFeeConstant() view returns(uint64)'], provider);
  if (await block.operatorFeeScalar() !== 0n || await block.operatorFeeConstant() !== 0n) {
    throw Error('Nonzero Base operator fees need a reviewed budget calculation.');
  }
  const size = (Transaction.from(transaction).unsignedSerialized.length - 2) / 2 + 68;
  const l1Bound = await oracle.getL1FeeUpperBound(size);
  const maximum = gasLimit * fees.maxFeePerGas + l1Bound * 2n;
  if (spent + maximum > cap || await provider.getBalance(steward) < maximum) throw Error('Cumulative .001 ETH gas ceiling/balance check failed.');
  const report = { step, operation, ...(award ? { recipient, period, evidence } : {}),
    chainId: 8453, from: steward, pool: poolAddress, asset, nonce,
    sourceHash: keccak256(Buffer.from(artifact.source)), creationCodeHash: keccak256(artifact.bytecode),
    dataHash: keccak256(request.data), gasLimit: String(gasLimit),
    maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
    l1FeeUpperBoundWei: String(l1Bound), conservativeStepWei: String(maximum),
    priorActualWei: String(spent), capWei: String(cap), sponsorAssets: String(initialAssets),
    at: new Date().toISOString(), signed: false };
  if (broadcast) {
    const reviewed = read(`${operation}-preflight`);
    if (Date.now() - Date.parse(reviewed.at) > 600_000 || reviewed.nonce !== nonce
      || reviewed.pool !== poolAddress || reviewed.dataHash !== report.dataHash
      || reviewed.creationCodeHash !== report.creationCodeHash || reviewed.from !== steward) {
      throw Error('Preflight changed or expired; run unsigned preflight again.');
    }
  }
  write(`${operation}-preflight`, report);
  write('compiler-input', artifact.input);
  console.log(JSON.stringify(report, null, 2));
  if (broadcast) {
    if (await provider.getTransactionCount(steward, 'pending') !== nonce) throw Error('Signer nonce changed; review.');
    const raw = await wallet.signTransaction(transaction), hash = keccak256(raw);
    write(`${operation}-submitted`, { ...report, signed: true, hash }, { flag: 'wx' });
    const sent = await provider.broadcastTransaction(raw);
    if (sent.hash !== hash) throw Error('Broadcast hash mismatch; reconcile recorded hash.');
    const receipt = await provider.waitForTransaction(hash, 3, 180_000);
    if (!receipt || receipt.status !== 1) throw Error('Transaction not confirmed successfully; reconcile recorded hash, never retry.');
    if (step === 'deploy' && (receipt.contractAddress !== poolAddress || !runtimeMatches(await provider.getCode(poolAddress)))) {
      throw Error('Deployed address/runtime verification failed; do not continue.');
    }
    const rawReceipt = await provider.send('eth_getTransactionReceipt', [hash]);
    if (rawReceipt.l1Fee == null) throw Error('L1 fee missing; reconcile recorded hash.');
    const actual = receipt.gasUsed * receipt.gasPrice + BigInt(rawReceipt.l1Fee);
    write(`${operation}-confirmed`, { ...report, signed: true, hash, actualTotalWei: String(actual),
      blockNumber: receipt.blockNumber, receiptStatus: receipt.status });
    if (spent + actual > cap) throw Error('Actual fee exceeded cap; transaction occurred, stop all further writes.');
    if (step === 'approve' && await usdc.allowance(steward, poolAddress) !== initialAssets) throw Error('Approval not exact.');
    if (award) {
      const pool = new Contract(poolAddress, artifact.abi, provider);
      const expected = step === 'day' ? parseEther('0.1') : parseEther('1');
      const event = receipt.logs.filter(log => log.address.toLowerCase() === poolAddress.toLowerCase())
        .map(log => pool.interface.parseLog(log)).find(log => log?.name === 'LearningAward'
          && log.args.steward === recipient && log.args.kind === (step === 'day' ? 0n : 1n)
          && log.args.period === BigInt(period) && log.args.units === expected && log.args.evidence === evidence);
      if (!event) throw Error('Award receipt did not match the reviewed record; reconcile the recorded transaction.');
    }
    if (step === 'bootstrap') {
      const code = await provider.getCode(poolAddress), pool = new Contract(poolAddress, artifact.abi, provider);
      if (!runtimeMatches(code) || await pool.owner() !== steward || await pool.asset() !== asset
        || !await pool.funded() || await pool.reserveAssets() !== initialAssets
        || await pool.totalSupply() !== parseEther('4400') || await pool.balanceOf(poolAddress) !== parseEther('4400')
        || await usdc.allowance(steward, poolAddress) !== 0n) throw Error('Funded pool verification failed.');
      const transactions = Object.fromEntries(['deploy', 'approve', 'bootstrap'].map(action => [action, read(`${action}-confirmed`)]));
      const manifest = { format: 'dlang-ommm-reserve', version: 1, chainId: 8453, contract: poolAddress,
        asset, steward, name: 'Ommm', symbol: 'Ommm', decimals: 18, funded: true,
        initialSupply: String(parseEther('4400')), initialAssets: String(initialAssets),
        runtimeCodeHash: keccak256(code), sourceHash: report.sourceHash, compiler: artifact.compiler,
        polygonReference: '0x1a74f818F1b42dBFcE449c7Fa93B107C6e4A2433', bridged: false,
        transactions, actualGasTotalWei: String(spent + actual), verifiedAt: new Date().toISOString() };
      fs.writeFileSync(new URL('../public/dlang/ommm-deployment.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(JSON.stringify({ step, hash, pool: poolAddress, confirmed: true, actualTotalWei: String(actual),
      cumulativeActualWei: String(spent + actual) }, null, 2));
  }
} finally {
  provider.destroy(); ens.destroy();
}
