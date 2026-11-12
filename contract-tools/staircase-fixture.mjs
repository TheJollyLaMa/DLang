import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, ZeroAddress } from 'ethers';
import { compileContract } from './ommm-artifact.mjs';

export const staircaseArtifact = compileContract('OmmmStaircase');
export const trialArtifact = compileContract('DLangStaircaseTrial');
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources: { 'Mocks.sol': { content: `
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
contract Asset {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public mode;
    address public blocked;
    address public callback;
    bytes public callbackData;
    bool public callbackSucceeded;
    function configure(uint8 m, address b) external { mode=m; blocked=b; }
    function setCallback(address c, bytes calldata data) external { callback=c; callbackData=data; }
    function mint(address to, uint256 n) external { balanceOf[to]+=n; }
    function approve(address to, uint256 n) external returns(bool) { allowance[msg.sender][to]=n; return true; }
    function move(address from, address to, uint256 n) private returns(bool) {
        require(from!=blocked && to!=blocked, "Asset blocked");
        if(mode==1)return false;
        balanceOf[from]-=n;
        balanceOf[to]+=mode==2?n-1:n;
        if(callback!=address(0)) (callbackSucceeded,)=callback.call(callbackData);
        if(mode==3) assembly { return(0,0) }
        return true;
    }
    function transfer(address to, uint256 n) external returns(bool) { return move(msg.sender,to,n); }
    function transferFrom(address from, address to, uint256 n) external returns(bool) {
        allowance[from][msg.sender]-=n; return move(from,to,n);
    }
}
contract Pool {
    address public immutable asset;
    bool public funded=true;
    bool public fail;
    constructor(address token) { asset=token; }
    function configure(bool f) external { fail=f; }
    function checkpoint() external view { require(!fail,"Pool unavailable"); }
}` } }, settings: { evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
})));
assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);

export const mined = async tx => (await tx).wait();
export async function setup(t, { count = 4, bootstrap = true, mockPool = false } = {}) {
  const chain = ganache.provider({
    logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 8453 },
    wallet: { deterministic: true, totalAccounts: 10 }
  });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all(Array.from({ length: 10 }, (_, i) => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  const deploy = async (artifact, args = []) => {
    const bytecode = artifact.bytecode || `0x${artifact.evm.bytecode.object}`;
    const contract = await new ContractFactory(artifact.abi, bytecode, signers[0]).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const asset = await deploy(output.contracts['Mocks.sol'].Asset);
  const pool = mockPool
    ? await deploy(output.contracts['Mocks.sol'].Pool, [asset.target])
    : await deploy(staircaseArtifact, [asset.target, addresses[0]]);
  const members = addresses.slice(1, count + 1);
  const trial = await deploy(trialArtifact, [asset.target, addresses[0], members, pool.target]);
  for (const [i, signer] of signers.entries()) {
    await mined(asset.mint(addresses[i], 100_000_000_000n));
    await mined(asset.connect(signer).approve(pool.target, 100_000_000_000n));
    await mined(asset.connect(signer).approve(trial.target, 100_000_000_000n));
  }
  if (bootstrap && !mockPool) await mined(pool.bootstrap());
  const now = async () => Number((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp);
  const at = async timestamp => {
    const current = await now();
    assert.ok(timestamp >= current, 'fixture cannot move backwards');
    await provider.send('evm_increaseTime', [timestamp - current]); await provider.send('evm_mine', []);
  };
  const open = async () => {
    const count = await trial.roundCount();
    const previousEnd = count ? Number((await trial.rounds(count)).end) : 0;
    const start = Math.max(await now() + 100, previousEnd + 15 * 3600);
    const end = start + 6 * 86400 + 9 * 3600;
    await mined(trial.openRound(start, end, id(`terms-${count}`)));
    return { start, end, round: await trial.roundCount() };
  };
  const join = async (r, i) => mined(trial.connect(signers[i]).join(r.round, id('es')));
  const propose = async (r, scores) => {
    await at(r.end);
    await mined(trial.propose(r.round, scores, id(`results-${r.round}`)));
    const stored = await trial.rounds(r.round);
    await at(Number(stored.proposedAt) + 48 * 3600);
  };
  const award = async (i = 1, level = 1) => mined(pool.awardLevel(addresses[i], level, id(`level-${i}-${level}`)));
  const conserve = async () => {
    let accounted = await trial.staircaseCredit() + await trial.carryTotal();
    let origins = 0n;
    for (const account of members) { accounted += await trial.credit(account); origins += await trial.carry(account); }
    const resolved = await trial.resolvedCount(), count = await trial.roundCount();
    for (let r = resolved + 1n; r <= count; r++) accounted += (await trial.rounds(r)).deposits;
    assert.equal(origins, await trial.carryTotal());
    assert.equal(accounted, await trial.liabilities());
    assert.equal(await asset.balanceOf(trial.target), accounted);
    if (!mockPool) {
      assert.equal(await asset.balanceOf(pool.target), await pool.reserveAssets() + await pool.dividendLiabilities());
    }
  };
  const configureAsset = (mode = 0, blocked = ZeroAddress) => mined(asset.configure(mode, blocked));
  return { provider, signers, addresses, members, asset, pool, trial, deploy, now, at,
    open, join, propose, award, conserve, configureAsset };
}
