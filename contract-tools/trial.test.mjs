import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, ZeroAddress } from 'ethers';

const source = fs.readFileSync(new URL('../contracts/dlang/DLangTrial.sol', import.meta.url), 'utf8');
const mock = `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
contract Token {
    uint8 public constant decimals = 6;
    mapping(address=>uint256) public balanceOf;
    mapping(address=>mapping(address=>uint256)) public allowance;
    bool public fail; bool public fee; uint8 public returnMode;
    address public callback; bool public callbackSucceeded;
    function configure(bool f, bool g) external { fail=f; fee=g; }
    function behavior(uint8 mode,address target) external {returnMode=mode;callback=target;}
    function hook() private {
        if(callback!=address(0)) (callbackSucceeded,)=callback.call(abi.encodeWithSignature("claimFor(address)",msg.sender));
        if(returnMode==1) assembly { return(0,0) }
        if(returnMode==2) assembly { mstore(0,1) return(31,1) }
    }
    function mint(address a,uint256 n) external { balanceOf[a]+=n; }
    function approve(address a,uint256 n) external returns(bool) { allowance[msg.sender][a]=n; return true; }
    function transfer(address a,uint256 n) external returns(bool) { if(fail)return false; balanceOf[msg.sender]-=n; balanceOf[a]+=fee?n-1:n; hook(); return true; }
    function transferFrom(address f,address t,uint256 n) external returns(bool) { if(fail)return false; allowance[f][msg.sender]-=n; balanceOf[f]-=n; balanceOf[t]+=fee?n-1:n; hook(); return true; }
}`;
const input = { language: 'Solidity', sources: {
  'DLangTrial.sol': { content: source }, 'Token.sol': { content: mock }
}, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
assert.deepEqual((output.errors || []).filter(e => e.severity === 'error'), []);
const artifact = name => Object.values(output.contracts).find(v => v[name])?.[name];
const mined = async tx => (await tx).wait();
async function setup(t, count = 3) {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
    wallet: { deterministic: true, totalAccounts: 10 } });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all(Array.from({ length: 10 }, (_, i) => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(s => s.getAddress()));
  const deploy = async (name, args = []) => {
    const a = artifact(name);
    const c = await new ContractFactory(a.abi, `0x${a.evm.bytecode.object}`, signers[0]).deploy(...args);
    await c.waitForDeployment(); return c;
  };
  const token = await deploy('Token');
  const members = addresses.slice(1, count + 1);
  const trial = await deploy('DLangTrial', [token.target, addresses[0], members]);
  for (let i = 1; i <= count; i++) {
    await mined(token.mint(addresses[i], 100_000_000));
    await mined(token.connect(signers[i]).approve(trial.target, 100_000_000));
  }
  const now = async () => Number((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp);
  const at = async timestamp => {
    await provider.send('evm_increaseTime', [timestamp - await now()]);
    await provider.send('evm_mine', []);
  };
  async function open() {
    const count = await trial.roundCount();
    const previousEnd = count ? Number((await trial.rounds(count)).end) : 0;
    const start = Math.max(await now() + 100, previousEnd + 15 * 3600);
    const end = start + 6 * 86400 + 9 * 3600;
    await mined(trial.openRound(start, end, id('public terms')));
    const round = await trial.roundCount();
    return { start, end, round };
  }
  const join = async (round, i) => mined(trial.connect(signers[i]).join(round, id('en')));
  const propose = async (r, scores) => {
    await at(r.end);
    await mined(trial.propose(r.round, scores, id('privacy-safe evidence')));
    const stored = await trial.rounds(r.round);
    await at(Number(stored.proposedAt) + 48 * 3600);
  };
  return { provider, signers, addresses, members, trial, token, deploy, now, at, open, join, propose };
}

test('immutable configuration rejects bad token/admin/roster', async t => {
  const f = await setup(t);
  for (const args of [
    [ZeroAddress, f.addresses[0], f.members],
    [f.token.target, ZeroAddress, f.members],
    [f.token.target, f.addresses[0], []],
    [f.token.target, f.addresses[0], [f.members[0], f.members[0]]],
    [f.token.target, f.addresses[0], [ZeroAddress]],
    [f.token.target, f.addresses[0], f.addresses.slice(1)]
  ]) await assert.rejects(() => f.deploy('DLangTrial', args));
});
test('enrollment requires fixed roster, exact deposit, single entry and open cutoff', async t => {
  const f = await setup(t);
  const r = await f.open();
  await assert.rejects(() => f.trial.connect(f.signers[0]).join(r.round, id('en')));
  await assert.rejects(() => f.trial.connect(f.signers[1]).join(r.round, '0x' + '00'.repeat(32)));
  await f.join(r.round, 1);
  await assert.rejects(() => f.join(r.round, 1));
  assert.equal(await f.trial.liabilities(), 1_000_000n);
  await f.at(r.start);
  await assert.rejects(() => f.join(r.round, 2));
  await assert.rejects(() => f.trial.openRound(r.end - 1, r.end + 6 * 86400, id('next')));
});
test('75 fails,76 qualifies, principal and forfeiture share conserve balance', async t => {
  const f = await setup(t);
  const r = await f.open();
  for (let i = 1; i <= 3; i++) await f.join(r.round, i);
  await f.propose(r, [76, 84, 75]);
  await mined(f.trial.connect(f.signers[4]).finalize(r.round));
  assert.equal(await f.trial.credit(f.members[0]), 1_500_000n);
  assert.equal(await f.trial.credit(f.members[1]), 1_500_000n);
  assert.equal(await f.trial.credit(f.members[2]), 0n);
  await mined(f.trial.connect(f.signers[4]).claimFor(f.members[0]));
  assert.equal(await f.token.balanceOf(f.members[0]), 100_500_000n);
  await assert.rejects(() => f.trial.claimFor(f.members[0]));
  await mined(f.trial.claimFor(f.members[1]));
  assert.equal(await f.trial.liabilities(), 0n);
  assert.equal(await f.token.balanceOf(f.trial.target), 0n);
});
test('steward review is48h, results cannot be overwritten and nonentrants cannot score', async t => {
  const f = await setup(t);
  const r = await f.open();
  await f.join(r.round, 1);
  await assert.rejects(() => f.trial.propose(r.round, [76, 0, 0], id('early')));
  await f.at(r.end);
  await assert.rejects(() => f.trial.connect(f.signers[1]).propose(r.round, [76, 0, 0], id('x')));
  await assert.rejects(() => f.trial.propose(r.round, [85, 0, 0], id('x')));
  await assert.rejects(() => f.trial.propose(r.round, [76, 1, 0], id('x')));
  await mined(f.trial.propose(r.round, [76, 0, 0], id('x')));
  await assert.rejects(() => f.trial.propose(r.round, [0, 0, 0], id('other')));
  const stored = await f.trial.rounds(r.round);
  await f.at(Number(stored.proposedAt) + 48 * 3600 - 2);
  await assert.rejects(() => f.trial.finalize(r.round));
  await f.at(Number(stored.proposedAt) + 48 * 3600);
  await mined(f.trial.finalize(r.round));
  await assert.rejects(() => f.trial.cancel(r.round));
});
test('cancellation and admin-triggered refund can never redirect principal', async t => {
  const f = await setup(t);
  const r = await f.open();
  await f.join(r.round, 1); await f.join(r.round, 2);
  await assert.rejects(() => f.trial.connect(f.signers[1]).cancel(r.round));
  await mined(f.trial.cancel(r.round));
  await mined(f.trial.claimFor(f.members[0]));
  assert.equal(await f.token.balanceOf(f.members[0]), 100_000_000n);
  assert.equal(await f.trial.credit(f.members[1]), 1_000_000n);
  await assert.rejects(() => f.trial.cancel(r.round));
});
test('no winners preserves origin-owned carry; shutdown refunds original contributors', async t => {
  const f = await setup(t);
  const r = await f.open();
  for (let i = 1; i <= 3; i++) await f.join(r.round, i);
  await f.propose(r, [75, 0, 74]);
  await mined(f.trial.finalize(r.round));
  assert.equal(await f.trial.carryTotal(), 3_000_000n);
  const next = await f.open(); await f.join(next.round, 1);
  await mined(f.trial.stop());
  assert.equal(await f.trial.credit(f.members[0]), 2_000_000n);
  assert.equal(await f.trial.credit(f.members[1]), 1_000_000n);
  assert.equal(await f.trial.carryTotal(), 0n);
  await assert.rejects(() => f.open());
  for (const account of f.members) await mined(f.trial.claimFor(account));
  assert.equal(await f.trial.liabilities(), 0n);
});
test('carry awards next enrolled qualifiers; sub-USDC dust remains origin-owned', async t => {
  const f = await setup(t, 4);
  const first = await f.open(); await f.join(first.round, 4);
  await f.propose(first, [0, 0, 0, 0]); await mined(f.trial.finalize(first.round));
  const next = await f.open();
  for (let i = 1; i <= 3; i++) await f.join(next.round, i);
  await f.propose(next, [76, 80, 84, 0]); await mined(f.trial.finalize(next.round));
  assert.equal(await f.trial.carryTotal(), 1n);
  assert.equal(await f.trial.carry(f.members[3]), 1n);
  assert.equal(await f.trial.credit(f.members[0]), 1_333_333n);
  await mined(f.trial.stop());
  for (const account of f.members) await mined(f.trial.claimFor(account));
  assert.equal(await f.token.balanceOf(f.trial.target), 0n);
});
test('steward inactivity permits timeout refund and permanent carry recovery', async t => {
  const f = await setup(t);
  const r = await f.open(); await f.join(r.round, 1);
  await assert.rejects(() => f.trial.connect(f.signers[1]).expire(r.round));
  await f.at(r.end + 14 * 86400);
  await mined(f.trial.connect(f.signers[1]).expireAndStop());
  await mined(f.trial.connect(f.signers[1]).claimFor(f.members[0]));
  assert.equal(await f.trial.stopped(), true);
  assert.equal(await f.token.balanceOf(f.members[0]), 100_000_000n);
});
test('false return and transfer fees revert enrollment and claims atomically', async t => {
  const f = await setup(t); const r = await f.open();
  await mined(f.token.configure(true, false)); await assert.rejects(() => f.join(r.round, 1));
  await mined(f.token.configure(false, true)); await assert.rejects(() => f.join(r.round, 1));
  assert.equal(await f.trial.liabilities(), 0n);
  await mined(f.token.configure(false, false)); await f.join(r.round, 1);
  await mined(f.trial.cancel(r.round));
  await mined(f.token.configure(true, false)); await assert.rejects(() => f.trial.claimFor(f.members[0]));
  assert.equal(await f.trial.credit(f.members[0]), 1_000_000n);
});
test('next Monday enrollment overlaps the prior review, with ordered carry settlement', async t => {
  const f = await setup(t);
  const first = await f.open(); await f.join(first.round, 1);
  await f.at(first.end - 3600);
  const next = await f.open(); await f.join(next.round, 2);
  await f.at(first.end);
  await mined(f.trial.propose(first.round, [0, 0, 0], id('first reviewed')));
  await f.at(next.start);
  await assert.rejects(() => f.join(next.round, 3));
  assert.equal((await f.trial.rounds(first.round)).phase, 2n);
  assert.equal((await f.trial.rounds(next.round)).phase, 1n);
  const proposed = await f.trial.rounds(first.round);
  await f.at(Number(proposed.proposedAt) + 48 * 3600);
  await mined(f.trial.finalize(first.round));
  assert.equal(await f.trial.carryTotal(), 1_000_000n);
  await f.propose(next, [0, 76, 0]);
  await mined(f.trial.finalize(next.round));
  assert.equal(await f.trial.credit(f.members[1]), 2_000_000n);
});
test('shutdown cancels every bounded unresolved week and future scheduling cannot be unlimited', async t => {
  const f = await setup(t);
  const first = await f.open(); await f.join(first.round, 1);
  const now = await f.now();
  await assert.rejects(() => f.trial.openRound(now + 30 * 86400, now + 37 * 86400, id('far future')));
  await f.at(first.end - 3600);
  const next = await f.open(); await f.join(next.round, 2);
  await mined(f.trial.stop());
  assert.equal(await f.trial.resolvedCount(), 2n);
  assert.equal(await f.trial.credit(f.members[0]), 1_000_000n);
  assert.equal(await f.trial.credit(f.members[1]), 1_000_000n);
});
test('no-return token compatibility, malformed return refusal and callback lock', async t => {
  const f = await setup(t); const r = await f.open();
  await mined(f.token.behavior(2, ZeroAddress));
  await assert.rejects(() => f.join(r.round, 1));
  assert.equal(await f.trial.liabilities(), 0n);
  await mined(f.token.behavior(1, f.trial.target));
  await f.join(r.round, 1);
  assert.equal(await f.token.callbackSucceeded(), false);
  await mined(f.trial.cancel(r.round));
  await mined(f.trial.claimFor(f.members[0]));
  assert.equal(await f.token.callbackSucceeded(), false);
  assert.equal(await f.trial.liabilities(), 0n);
});
test('multi-origin dust, eight-member accounting, claims and stop conserve every base unit', async t => {
  const f = await setup(t, 8);
  const first = await f.open();
  for (let i = 1; i <= 8; i++) await f.join(first.round, i);
  await f.propose(first, Array(8).fill(0));
  await mined(f.trial.finalize(first.round));
  const next = await f.open();
  for (let i = 1; i <= 8; i++) await f.join(next.round, i);
  await f.propose(next, [76, 80, 84, 0, 0, 0, 0, 0]);
  await mined(f.trial.finalize(next.round));
  const liabilities = await f.trial.liabilities();
  let accounted = await f.trial.carryTotal();
  let originTotal = 0n;
  for (const account of f.members) {
    accounted += await f.trial.credit(account);
    originTotal += await f.trial.carry(account);
  }
  assert.equal(originTotal, await f.trial.carryTotal());
  assert.equal(accounted, liabilities);
  await mined(f.trial.stop());
  for (const account of f.members) {
    if (await f.trial.credit(account)) await mined(f.trial.claimFor(account));
  }
  assert.equal(await f.trial.liabilities(), 0n);
  assert.equal(await f.token.balanceOf(f.trial.target), 0n);
});
