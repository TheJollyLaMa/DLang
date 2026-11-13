import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, Transaction, getCreateAddress, keccak256, parseEther } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';
import { runtimeMatches, addresses, assetAbi } from './staircase-launch.mjs';
import { writeDurableJSON } from '../services/durable-json.cjs';
import { allocate, hash, START, END, UNITS, validateReceiptJournal } from '../services/voice-rewards.cjs';
import { verifyVoiceFunding, USDC } from '../services/voice-pool-verification.cjs';

export const GAS_CAP = parseEther('0.001');
export const SETTLEMENT_RESERVE = parseEther('0.0003');
async function confirmedReceipt(provider, transactionHash) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (receipt && await provider.getBlockNumber() >= receipt.blockNumber + 1) return receipt;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error(`Confirmation timed out for ${transactionHash}; reconcile the same journaled transaction.`);
}
const stringify = data => JSON.parse(JSON.stringify(data, (_, value) => typeof value === 'bigint' ? value.toString() : value));
const roster = JSON.parse(await fs.readFile(new URL('../public/dlang/pilot-roster.json', import.meta.url)));
export function assertGasBudget(spent, maximum, reserve = 0n) {
  if (spent < 0n || maximum <= 0n || spent + maximum + reserve > GAS_CAP) throw Error('Additional cumulative 0.001 Base ETH gas cap exceeded.');
}
export async function verifyVoiceSettlement(pool, receipt, settlement) {
  if (!receipt || receipt.status !== 1 || !await pool.settled() || await pool.settlementEvidence() !== settlement.evidence) throw Error('Settlement state/receipt mismatch.');
  const events = receipt.logs.filter(row => row.address.toLowerCase() === pool.target.toLowerCase()).map(row => {
    try { return pool.interface.parseLog(row); } catch { return null; }
  }).filter(Boolean);
  const awards = events.filter(row => row.name === 'VoiceAward');
  const expected = settlement.allocations;
  if (awards.length !== expected.length || awards.some((row, i) => row.args.contributor.toLowerCase() !== expected[i].address
    || row.args.units !== BigInt(expected[i].units) || row.args.evidence !== settlement.evidence)) throw Error('Award events differ from exact frozen allocation.');
  const terminal = events.find(row => row.name === (expected.length ? 'VoiceWeekSettled' : 'VoiceWeekCarried'));
  if (!terminal || terminal.args.evidence !== settlement.evidence
    || expected.length && (terminal.args.recipients !== BigInt(expected.length) || terminal.args.units !== UNITS)
    || !expected.length && terminal.args.inventory !== UNITS) throw Error('Missing exact settlement/carry event; no payout claimed.');
  return { payoutConfirmed: expected.length > 0, carryConfirmed: expected.length === 0, outcome: settlement.outcome };
}

async function main() {
  const step = process.argv[2] || 'preflight';
  if (!['preflight', 'deploy', 'approve', 'fund', 'manifest', 'settle', 'verify'].includes(step)) throw Error('Use preflight|deploy|approve|fund|manifest|settle|verify.');
  const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
  const broadcast = process.argv.includes('--broadcast');
  if (broadcast && !['deploy', 'approve', 'fund', 'settle'].includes(step)) throw Error('Broadcast only for explicit transaction steps.');
  const journalPath = path.resolve(option('--journal') || 'build/voice-pilot/journal.json');
  await fs.mkdir(path.dirname(journalPath), { recursive: true });
  const lock = await fs.open(`${journalPath}.lock`, 'wx', 0o600);
  const request = new FetchRequest(process.env.DLANG_BASE_RPC || 'https://mainnet.base.org'); request.timeout = 15000;
  const provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  try {
    if (BigInt((await provider.getNetwork()).chainId) !== 8453n) throw Error('Not Base.');
    const artifact = compileContract('OmmmVoicePilot');
    const sourceHash = hash(artifact.input);
    let journal = { version: 1, chainId: 8453, administrator: addresses.steward, sourceHash, gasCapWei: GAS_CAP.toString(), steps: {} };
    try { journal = JSON.parse(await fs.readFile(journalPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (journal.sourceHash !== sourceHash || journal.administrator !== addresses.steward || journal.gasCapWei !== GAS_CAP.toString()) throw Error('Journal/compiler/administrator identity mismatch; review required.');
    const save = async () => writeDurableJSON(journalPath, stringify(journal));
    const token = new Contract(USDC, assetAbi, provider);
    if (await token.decimals() !== 6n) throw Error('Native Base USDC decimals mismatch.');
    let spent = 0n;
    for (const entry of Object.values(journal.steps)) {
      if (!entry.transactionHash) continue;
      let receipt = await provider.getTransactionReceipt(entry.transactionHash);
      if (!receipt && broadcast && entry.rawTransaction) {
        await provider.broadcastTransaction(entry.rawTransaction);
        receipt = await confirmedReceipt(provider, entry.transactionHash);
      }
      if (!receipt) throw Error(`Pending ${entry.transactionHash}; reconcile this exact transaction before any new writes.`);
      const raw = await provider.send('eth_getTransactionReceipt', [entry.transactionHash]);
      if (raw.l1Fee == null) throw Error('Base receipt missing L1 fee; do not silently assume zero gas.');
      const actual = receipt.gasUsed * receipt.gasPrice + BigInt(raw.l1Fee);
      entry.receipt = { transactionHash: receipt.hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber,
        status: receipt.status, gasUsed: receipt.gasUsed.toString(), gasPrice: receipt.gasPrice.toString(),
        l1Fee: BigInt(raw.l1Fee).toString(), actualFeeWei: actual.toString(), contractAddress: receipt.contractAddress };
      spent += actual;
      if (receipt.status !== 1) { await save(); throw Error('Recorded transaction failed; no automatic retry under a new nonce.'); }
    }
    journal.actualFeeWei = spent.toString(); await save();
    if (spent > GAS_CAP) throw Error('Actual gas exceeded cap; stop further writes.');
    const block = await provider.getBlock('latest');
    const beforeWeek = block.timestamp < START / 1000;
    const pool = journal.pool ? new Contract(journal.pool, artifact.abi, provider) : null;
    if (pool && !runtimeMatches(artifact, await provider.getCode(pool.target))) throw Error('Voice runtime differs from compiled source.');
    if (pool && journal.steps.deploy?.receipt) {
      journal.runtimeHash = keccak256(await provider.getCode(pool.target));
      await save();
    }
    if (step === 'preflight') {
      if (!beforeWeek) throw Error('Funded week cannot start late; do not deploy/fund a different week without approval.');
      const balance = await token.balanceOf(addresses.steward);
      const deployment = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(USDC, addresses.steward);
      const gas = (await provider.estimateGas({ ...deployment, from: addresses.steward })) * 120n / 100n;
      const fees = await provider.getFeeData();
      if (!fees.maxFeePerGas) throw Error('Base fee quote unavailable.');
      // Conservative startup envelope plus a separate later settlement allowance.
      const startup = (gas + 400000n) * fees.maxFeePerGas + parseEther('0.00005');
      assertGasBudget(spent, startup, SETTLEMENT_RESERVE);
      if (await provider.getBalance(addresses.steward) < startup + SETTLEMENT_RESERVE) throw Error('Insufficient approved gas balance.');
      const learning = {};
      for (const filename of ['ommm-deployment.json', 'staircase-deployment.json']) {
        const manifest = JSON.parse(await fs.readFile(new URL(`../public/dlang/${filename}`, import.meta.url)));
        const existing = new Contract(manifest.contract, ['function totalSupply() view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
          'function dividendLiabilities() view returns(uint256)'], provider);
        learning[manifest.contract] = { assets: (await token.balanceOf(manifest.contract)).toString(),
          supply: (await existing.totalSupply()).toString(), holders: Object.fromEntries(await Promise.all(roster.members.map(async member =>
            [member.walletAddress, (await existing.balanceOf(member.walletAddress)).toString()]))) };
      }
      journal.learningBefore = learning;
      journal.preflight = { at: new Date(block.timestamp * 1000).toISOString(), nativeUSDCUnits: balance.toString(),
        deploymentGas: gas.toString(), startupMaximumWei: startup.toString(), settlementReserveWei: SETTLEMENT_RESERVE.toString(),
        fundingReady: balance >= 1000000n, missingUSDCUnits: (balance >= 1000000n ? 0n : 1000000n - balance).toString() };
      await save();
      console.log(JSON.stringify({ ...journal.preflight, broadcast: false, weekStart: new Date(START).toISOString(), endExclusive: new Date(END).toISOString() }));
      if (balance < 1000000n) throw Error(`Only ${balance} native USDC base units available; $1 unavailable. NO ETH swap is approved. Ask parent.`);
      return;
    }
    if (!journal.preflight || !journal.preflight.fundingReady) throw Error('Run reviewed, funding-ready preflight first. No swap is approved.');
    const fundingManifest = () => ({ version: 1, chainId: 8453, pool: journal.pool, administrator: addresses.steward, asset: USDC,
      assets: '1000000', units: UNITS.toString(), start: START / 1000, end: END / 1000,
      transactionHash: journal.steps.fund?.transactionHash, deploymentHash: journal.steps.deploy?.transactionHash,
      runtimeHash: journal.runtimeHash, additionalGasCapWei: GAS_CAP.toString(), actualFeeWei: spent.toString(), recurring: false });
    if (step === 'manifest' || step === 'verify') {
      if (!pool || !journal.steps.fund?.receipt) throw Error('No confirmed separate $1 funded voice pool.');
      const manifest = fundingManifest();
      await verifyVoiceFunding(provider, manifest);
      if (journal.steps.settle?.receipt) {
        await verifyVoiceSettlement(pool, await provider.getTransactionReceipt(journal.steps.settle.transactionHash), journal.settlement);
      }
      for (const [address, before] of Object.entries(journal.learningBefore)) {
        const existing = new Contract(address, ['function totalSupply() view returns(uint256)', 'function balanceOf(address) view returns(uint256)'], provider);
        if ((await token.balanceOf(address)).toString() !== before.assets || (await existing.totalSupply()).toString() !== before.supply) throw Error('Learning pool changed since preflight; investigate independently.');
        for (const [holder, balance] of Object.entries(before.holders)) if ((await existing.balanceOf(holder)).toString() !== balance) throw Error('Learning holder changed; investigate independently.');
      }
      if (step === 'manifest') await writeDurableJSON(path.join(path.dirname(journalPath), 'funding.json'), manifest);
      console.log(JSON.stringify({ verified: true, manifest, settled: await pool.settled(), evidence: await pool.settlementEvidence() }));
      return;
    }
    if (journal.steps[step]?.receipt) {
      if (step === 'settle') {
        await verifyVoiceSettlement(pool, await provider.getTransactionReceipt(journal.steps.settle.transactionHash), journal.settlement);
      }
      console.log(JSON.stringify({ step, idempotent: true, receipt: journal.steps[step].receipt })); return;
    }
    let transaction;
    if (step === 'deploy') {
      if (!beforeWeek) throw Error('Deploy before the approved funded-week boundary.');
      if (await token.balanceOf(addresses.steward) < 1000000n) throw Error('Native $1 USDC funding disappeared after preflight; no deployment or swap.');
      transaction = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(USDC, addresses.steward);
    } else if (step === 'approve') {
      if (!pool || !beforeWeek) throw Error('Deploy first, before funded week.');
      if (await token.balanceOf(addresses.steward) < 1000000n) throw Error('Native $1 USDC funding unavailable; no approval or swap.');
      transaction = await token.approve.populateTransaction(pool.target, 1000000n);
    } else if (step === 'fund') {
      if (!pool || !beforeWeek || !journal.steps.approve?.receipt || await token.balanceOf(addresses.steward) < 1000000n
        || await token.allowance(addresses.steward, pool.target) !== 1000000n
        || await token.balanceOf(pool.target) !== 0n) throw Error('Exact native $1 approval/balance and empty initial pool required; no swap or replenishment.');
      transaction = await pool.bootstrap.populateTransaction();
    } else {
      if (!pool || block.timestamp < END / 1000 || !journal.steps.fund?.receipt) throw Error('Settle once, after Nov 23 00:00 New York.');
      await verifyVoiceFunding(provider, fundingManifest());
      const ledgerPath = option('--ledger'), origin = option('--origin');
      if (!ledgerPath || !origin) throw Error('Provide durable funded-week --ledger and exact hosted --origin.');
      const ledger = JSON.parse(await fs.readFile(path.resolve(ledgerPath)));
      if (ledger.funding.pool.toLowerCase() !== pool.target.toLowerCase() || ledger.funding.transactionHash !== journal.steps.fund.transactionHash) throw Error('Ledger belongs to a different funded pool.');
      await validateReceiptJournal(ledger, { roster, origin });
      const { resolveContributorCredit } = await import('../public/dlang/identity.mjs');
      const ensRequest = new FetchRequest(process.env.DLANG_ENS_RPC || 'https://ethereum-rpc.publicnode.com'); ensRequest.timeout = 8000;
      const ens = new JsonRpcProvider(ensRequest);
      try {
        for (const row of ledger.enrollments) await resolveContributorCredit(row.requestedCredit, row.wallet, ens);
      } finally { ens.destroy(); }
      const allocation = allocate(ledger.receipts), evidence = `0x${hash({ funding: ledger.funding, receipts: ledger.receipts })}`;
      if (journal.settlement && journal.settlement.evidence !== evidence) throw Error('Frozen settlement input changed; do not allocate twice.');
      journal.settlement = { ...allocation, evidence, ledgerHash: hash(ledger), origin };
      await save();
      if (await pool.settled()) {
        if (await pool.settlementEvidence() !== evidence) throw Error('Different settlement already committed.');
        throw Error('Pool already settled outside this journal; reconcile its exact receipt, do not send another payout.');
      }
      transaction = await pool.settleVoiceWeek.populateTransaction(allocation.allocations.map(row => row.address),
        allocation.allocations.map(row => BigInt(row.units)), evidence);
    }
    const fees = await provider.getFeeData();
    if (!fees.maxFeePerGas || fees.maxPriorityFeePerGas == null) throw Error('Fee quote unavailable.');
    const nonce = await provider.getTransactionCount(addresses.steward, 'pending');
    const gasLimit = (await provider.estimateGas({ ...transaction, from: addresses.steward })) * 120n / 100n;
    const tx = { ...transaction, chainId: 8453, type: 2, value: 0n, nonce, gasLimit,
      maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
    const oracle = new Contract(addresses.oracle, ['function getL1FeeUpperBound(uint256) view returns(uint256)'], provider);
    const encodedLength = (Transaction.from(tx).unsignedSerialized.length - 2) / 2 + 70;
    const l1Bound = await oracle.getL1FeeUpperBound(encodedLength);
    const maximum = gasLimit * fees.maxFeePerGas + l1Bound * 2n;
    assertGasBudget(spent, maximum, step === 'settle' ? 0n : SETTLEMENT_RESERVE);
    if (await provider.getBalance(addresses.steward) < maximum) throw Error('Insufficient ETH gas balance.');
    console.log(JSON.stringify(stringify({ step, broadcast, nonce, transaction: tx, maximumFeeWei: maximum,
      spentWei: spent, outcome: journal.settlement?.outcome, recipients: journal.settlement?.allocations.length })));
    if (!broadcast) return;
    if (!process.env.DLANG_VOICE_PRIVATE_KEY) throw Error('Parent must explicitly supply DLANG_VOICE_PRIVATE_KEY only for approved --broadcast.');
    const signer = new Wallet(process.env.DLANG_VOICE_PRIVATE_KEY);
    if (signer.address !== addresses.steward) throw Error('Approved prototype administrator signer mismatch.');
    const rawTransaction = await signer.signTransaction(tx), transactionHash = keccak256(rawTransaction);
    if (step === 'deploy') journal.pool = getCreateAddress({ from: addresses.steward, nonce });
    journal.steps[step] = { transactionHash, rawTransaction, nonce, maximumFeeWei: maximum.toString(), submittedAt: new Date().toISOString() };
    await save();
    await provider.broadcastTransaction(rawTransaction);
    const receipt = await confirmedReceipt(provider, transactionHash);
    const raw = await provider.send('eth_getTransactionReceipt', [receipt.hash]);
    if (raw.l1Fee == null) throw Error('Missing Base L1 fee; journal transaction requires reconciliation.');
    const actual = receipt.gasUsed * receipt.gasPrice + BigInt(raw.l1Fee);
    journal.steps[step].receipt = stringify({ transactionHash: receipt.hash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber,
      status: receipt.status, gasUsed: receipt.gasUsed, gasPrice: receipt.gasPrice, l1Fee: BigInt(raw.l1Fee),
      actualFeeWei: actual, contractAddress: receipt.contractAddress });
    journal.actualFeeWei = (spent + actual).toString();
    if (step === 'deploy') {
      const code = await provider.getCode(journal.pool);
      if (receipt.contractAddress !== journal.pool || !runtimeMatches(artifact, code)) { await save(); throw Error('Deployment address/runtime mismatch.'); }
      journal.runtimeHash = keccak256(code);
    }
    await save();
    if (receipt.status !== 1 || spent + actual > GAS_CAP) throw Error('Failed receipt or actual gas cap exceeded; stop.');
    const outcome = step === 'settle' ? await verifyVoiceSettlement(pool, receipt, journal.settlement) : {};
    console.log(JSON.stringify({ step, confirmed: true, ...outcome, transactionHash, actualFeeWei: actual.toString() }));
  } finally { provider.destroy(); await lock.close(); await fs.rm(`${journalPath}.lock`, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
