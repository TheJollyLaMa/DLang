import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256, Transaction } from 'ethers';

const broadcast = process.argv.includes('--broadcast');
const envPath = process.argv[process.argv.indexOf('--env') + 1];
if (!process.argv.includes('--env') || !envPath) throw Error('Pass --env followed by the authorized signing-file path');
const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const key = env.DEPLOYER_PRIVATE_KEY;
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key || '')) throw Error('Deployment key missing or invalid; value withheld');
let wallet;
try { wallet = new Wallet(key.startsWith('0x') ? key : `0x${key}`); }
catch { throw Error('Deployment key invalid; value withheld'); }
const manifest = JSON.parse(fs.readFileSync(new URL('build/unsigned-deployment.json', import.meta.url)));
const artifact = JSON.parse(fs.readFileSync(new URL('build/artifact.json', import.meta.url)));
const preflightFile = new URL('build/deployment-preflight.json', import.meta.url);
const reviewed = broadcast ? JSON.parse(fs.readFileSync(preflightFile)) : null;
const source = fs.readFileSync(new URL('../contracts/dlang/DLangTrial.sol', import.meta.url));
const roster = JSON.parse(fs.readFileSync(new URL('../public/dlang/pilot-roster.json', import.meta.url)));
const token = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const steward = getAddress('0xcaeed8422fb5682c298b7f0971906d446ffd4e7a');
const cap = 1_000_000_000_000_000n;
if (wallet.address !== steward || manifest.steward !== steward || manifest.token !== token
  || manifest.chainId !== 8453 || manifest.sourceHash !== keccak256(source)
  || manifest.creationCodeHash !== keccak256(artifact.bytecode)
  || JSON.stringify(manifest.members) !== JSON.stringify(roster.members.map(row => getAddress(row.walletAddress.toLowerCase()))))
  throw Error('Signer/source/asset/roster does not match the reviewed deployment');
const factory = new ContractFactory(artifact.abi, artifact.bytecode);
const creation = await factory.getDeployTransaction(token, steward, manifest.members);
if (creation.data !== manifest.data) throw Error('Constructor transaction differs from reviewed manifest');
const provider = new JsonRpcProvider('https://mainnet.base.org', 8453, { staticNetwork: true, cacheTimeout: -1 });
try {
  if (await provider.send('eth_chainId', []) !== '0x2105') throw Error('Wrong chain');
  if (keccak256(await provider.getCode(token)) !== manifest.expectedTokenCodeHash) throw Error('USDC code changed; review again');
  const pending = await provider.getTransactionCount(wallet.address, 'pending');
  if (await provider.getTransactionCount(wallet.address, 'latest') !== pending) throw Error('Signer has a pending transaction; wait and review');
  const submittedFile = new URL('build/deployment-submitted.json', import.meta.url);
  if (fs.existsSync(submittedFile)) throw Error('A deployment was already recorded. Reconcile its receipt; never deploy again automatically');
  const address = getCreateAddress({ from: wallet.address, nonce: pending });
  if (await provider.getCode(address) !== '0x') throw Error('Predicted address already contains code');
  const estimate = await provider.estimateGas({ from: wallet.address, data: creation.data });
  const gasLimit = estimate * 120n / 100n;
  const fees = await provider.getFeeData();
  if (!fees.maxFeePerGas || !fees.maxPriorityFeePerGas) throw Error('Fee data unavailable');
  const transaction = { chainId: 8453, type: 2, nonce: pending, value: 0n, data: creation.data,
    gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  const unsignedSize = (Transaction.from(transaction).unsignedSerialized.length - 2) / 2;
  const oracle = new Contract('0x420000000000000000000000000000000000000F',
    ['function getL1FeeUpperBound(uint256) view returns(uint256)'], provider);
  const block = new Contract('0x4200000000000000000000000000000000000015',
    ['function operatorFeeScalar() view returns(uint32)', 'function operatorFeeConstant() view returns(uint64)'], provider);
  if (await block.operatorFeeScalar() !== 0n || await block.operatorFeeConstant() !== 0n)
    throw Error('Nonzero operator fees need a new reviewed calculation');
  const l1Bound = await oracle.getL1FeeUpperBound(unsignedSize + 68);
  const maximumBudget = gasLimit * fees.maxFeePerGas + l1Bound * 2n;
  if (maximumBudget > cap || await provider.getBalance(wallet.address) < maximumBudget)
    throw Error('Conservative full deployment fee/balance check failed');
  const report = { chainId: 8453, from: wallet.address, nonce: pending, predictedAddress: address,
    token, steward, members: manifest.members, valueWei: '0', gasLimit: String(gasLimit),
    maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
    l1FeeUpperBoundWei: String(l1Bound), conservativeTotalWei: String(maximumBudget), capWei: String(cap),
    sourceHash: manifest.sourceHash, constructorDataHash: keccak256(creation.data),
    signed: false, paymentsEnabled: false };
  if (reviewed && (reviewed.from !== report.from || reviewed.nonce !== pending
    || reviewed.predictedAddress !== address || reviewed.constructorDataHash !== report.constructorDataHash
    || Date.now() - fs.statSync(preflightFile).mtimeMs > 600000))
    throw Error('Reviewed preflight changed or expired; run a fresh dry-run before signing');
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(preflightFile, JSON.stringify(report, null, 2));
  if (broadcast) {
    if (await provider.getTransactionCount(wallet.address, 'pending') !== pending) throw Error('Signer nonce changed; review again');
    const raw = await wallet.signTransaction(transaction);
    const hash = keccak256(raw);
    fs.writeFileSync(submittedFile, JSON.stringify({ ...report, signed: true, hash }, null, 2), { flag: 'wx' });
    const sent = await provider.broadcastTransaction(raw);
    if (sent.hash !== hash) throw Error('Broadcast hash mismatch');
    const receipt = await provider.waitForTransaction(hash, 3, 180000);
    if (!receipt || receipt.status !== 1 || getAddress(receipt.contractAddress || '') !== address)
      throw Error('Deployment not confirmed successfully; reconcile the recorded hash');
    const runtime = await provider.getCode(address);
    let normalized = runtime.slice(2);
    for (const refs of Object.values(artifact.runtime.immutableReferences)) {
      for (const { start, length } of refs)
        normalized = normalized.slice(0, start * 2) + '0'.repeat(length * 2) + normalized.slice((start + length) * 2);
    }
    if (normalized !== artifact.runtime.object) throw Error('Deployed runtime does not match compiled source');
    const contract = new Contract(address, artifact.abi, provider);
    if (await contract.token() !== token || await contract.steward() !== steward
      || await contract.memberCount() !== BigInt(manifest.members.length) || await contract.roundCount() !== 0n
      || await contract.liabilities() !== 0n) throw Error('Deployed configuration mismatch');
    for (let i = 0; i < manifest.members.length; i++)
      if (await contract.members(i) !== manifest.members[i]) throw Error('Deployed roster mismatch');
    const rawReceipt = await provider.send('eth_getTransactionReceipt', [hash]);
    if (!rawReceipt.l1Fee) throw Error('Receipt L1 fee unavailable; reconcile actual total fee');
    const actualWei = receipt.gasUsed * receipt.gasPrice + BigInt(rawReceipt.l1Fee);
    const result = { ...report, signed: true, contract: address, hash, blockNumber: receipt.blockNumber,
      runtimeCodeHash: keccak256(runtime), runtimeSourceMatch: true, actualTotalWei: String(actualWei),
      deploymentConfirmed: true, fundedRoundOpened: false, verifiedAt: new Date().toISOString() };
    fs.writeFileSync(new URL('build/deployment-confirmed.json', import.meta.url), JSON.stringify(result, null, 2));
    if (actualWei > cap) throw Error('Actual fee exceeded the approved cap; deployment already occurred, do not retry');
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  provider.destroy();
}
