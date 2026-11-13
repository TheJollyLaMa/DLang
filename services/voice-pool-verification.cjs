'use strict';
const { Contract, Interface, keccak256, getAddress } = require('ethers');
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ABI = ['function asset() view returns(address)', 'function funded() view returns(bool)',
  'function prototypeRetired() view returns(bool)', 'function WEEK_START() view returns(uint256)',
  'function WEEK_END() view returns(uint256)', 'function VOICE_SUPPLY() view returns(uint256)',
  'function bootstrapAssets() view returns(uint256)', 'function reserveAssets() view returns(uint256)',
  'function totalSupply() view returns(uint256)', 'event Funded(address indexed sponsor,uint256 assets)'];
async function verifyVoiceFunding(provider, manifest) {
  if (BigInt((await provider.getNetwork()).chainId) !== 8453n) throw Error('Voice pool must be on Base.');
  const pool = new Contract(getAddress(manifest.pool), ABI, provider);
  const code = await provider.getCode(pool.target);
  if (code === '0x' || keccak256(code) !== manifest.runtimeHash) throw Error('Voice pool runtime does not match reviewed deployment.');
  const [asset, funded, retired, start, end, supply, assets, reserve, outstanding, receipt] = await Promise.all([
    pool.asset(), pool.funded(), pool.prototypeRetired(), pool.WEEK_START(), pool.WEEK_END(),
    pool.VOICE_SUPPLY(), pool.bootstrapAssets(), pool.reserveAssets(), pool.totalSupply(),
    provider.getTransactionReceipt(manifest.transactionHash)
  ]);
  if (asset.toLowerCase() !== USDC.toLowerCase() || !funded || retired || start !== BigInt(manifest.start)
    || end !== BigInt(manifest.end) || supply !== BigInt(manifest.units) || assets !== 1000000n
    || outstanding > supply || reserve < (outstanding * 100n + 10n ** 18n - 1n) / (10n ** 18n)
    || !receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== pool.target.toLowerCase()) throw Error('Voice funding state or receipt mismatch.');
  const iface = new Interface(ABI);
  const event = receipt.logs.filter(row => row.address.toLowerCase() === pool.target.toLowerCase()).map(row => {
    try { return iface.parseLog(row); } catch { return null; }
  }).find(row => row?.name === 'Funded' && row.args.assets === 1000000n);
  if (!event) throw Error('Exact $1 bootstrap event missing.');
  if (manifest.administrator && event.args.sponsor.toLowerCase() !== getAddress(manifest.administrator).toLowerCase()) throw Error('Bootstrap sponsor mismatch.');
  const transfer = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const fundedTransfer = receipt.logs.filter(row => row.address.toLowerCase() === USDC.toLowerCase()).map(row => {
    try { return transfer.parseLog(row); } catch { return null; }
  }).find(row => row?.name === 'Transfer' && row.args.from.toLowerCase() === event.args.sponsor.toLowerCase()
    && row.args.to.toLowerCase() === pool.target.toLowerCase() && row.args.value === 1000000n);
  // Native USDC emits Transfer; testing providers must supply the same exact evidence.
  if (!fundedTransfer) throw Error('Exact native USDC bootstrap transfer receipt missing.');
  return true;
}
module.exports = { verifyVoiceFunding, USDC };
