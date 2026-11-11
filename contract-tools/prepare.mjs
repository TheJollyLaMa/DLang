import fs from 'node:fs';
import solc from 'solc';
import { Contract, ContractFactory, JsonRpcProvider, getAddress, keccak256 } from 'ethers';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('contracts/dlang/DLangTrial.sol', root), 'utf8');
const input = { language: 'Solidity', sources: { 'DLangTrial.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter(error => error.severity === 'error');
if (errors.length) throw Error(errors.map(error => error.formattedMessage).join('\n'));
const artifact = output.contracts['DLangTrial.sol'].DLangTrial;
const roster = JSON.parse(fs.readFileSync(new URL('public/dlang/pilot-roster.json', root), 'utf8'));
const members = roster.members.map(row => getAddress(row.walletAddress.toLowerCase()));
const steward = getAddress('0xcaeed8422fb5682c298b7f0971906d446ffd4e7a');
const token = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
const factory = new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`);
const request = await factory.getDeployTransaction(token, steward, members);
const provider = new JsonRpcProvider('https://base-rpc.publicnode.com', 8453, { staticNetwork: true });
try {
  const chain = await provider.send('eth_chainId', []);
  if (chain !== '0x2105') throw Error('Wrong chain');
  const code = await provider.getCode(token);
  if (code === '0x') throw Error('USDC code unavailable');
  const usdc = new Contract(token, ['function decimals() view returns(uint8)', 'function symbol() view returns(string)'], provider);
  if (await usdc.decimals() !== 6n || await usdc.symbol() !== 'USDC') throw Error('Unexpected token metadata');
  const estimate = await provider.estimateGas({ from: steward, data: request.data });
  const gasLimit = estimate * 120n / 100n;
  const fees = await provider.getFeeData();
  if (!fees.maxFeePerGas || !fees.maxPriorityFeePerGas) throw Error('Fee data unavailable');
  const estimatedL2Maximum = gasLimit * fees.maxFeePerGas;
  const cap = 1_000_000_000_000_000n;
  if (estimatedL2Maximum >= cap) throw Error('L2 deployment estimate exceeds cap');
  const manifest = {
    format: 'dlang-unsigned-deployment-review', version: 1, chainId: 8453,
    contract: null, deploymentAuthorized: false, paymentsEnabled: false,
    compiler: solc.version(), sourceHash: keccak256(Buffer.from(source)),
    creationCodeHash: keccak256(`0x${artifact.evm.bytecode.object}`),
    expectedTokenCodeHash: keccak256(code),
    token, steward, members, participantLabels: roster.members.map(row => row.label),
    data: request.data, gasEstimate: estimate.toString(), gasLimit: gasLimit.toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    estimatedL2MaximumWei: estimatedL2Maximum.toString(), totalCostCapWei: cap.toString(),
    estimatedAt: new Date().toISOString(),
    warning: 'UNSIGNED. L2 estimate excludes Base L1 data fees. Total wallet fee including L1 must fit cap. Fee estimates expire. Base-USDC fork, reviewed transaction UI, operator and language review remain gates. No funded round.'
  };
  fs.mkdirSync(new URL('build/', import.meta.url), { recursive: true });
  fs.writeFileSync(new URL('build/compiler-input.json', import.meta.url), JSON.stringify(input, null, 2));
  fs.writeFileSync(new URL('build/artifact.json', import.meta.url), JSON.stringify({
    abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`,
    runtime: artifact.evm.deployedBytecode, metadata: artifact.metadata
  }, null, 2));
  fs.writeFileSync(new URL('build/unsigned-deployment.json', import.meta.url), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ chain: 8453, steward, members: members.length, gasEstimate: String(estimate),
    l2MaximumWei: String(estimatedL2Maximum), capWei: String(cap), signed: false,
    remaining: 'L1 fee and deployment/signing review; no transaction broadcast' }, null, 2));
} finally {
  provider.destroy();
}
