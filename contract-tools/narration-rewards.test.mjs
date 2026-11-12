import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id, Wallet, ZeroAddress } from 'ethers';

const source = fs.readFileSync(new URL('../contracts/dlang/DLangNarrationRewards.sol', import.meta.url), 'utf8');
const mocks = `// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
contract MockOmmm {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
}
contract MockMilestones {
    mapping(bytes32 => bool) public used;
    mapping(address => uint256) public minted;
    function mintMilestone(address to, bytes32 awardId, bytes32, string calldata) external returns (uint256) {
        require(!used[awardId], "duplicate");
        used[awardId] = true; minted[to]++; return minted[to];
    }
}`;
const input = { language: 'Solidity', sources: {
  'DLangNarrationRewards.sol': { content: source }, 'Mocks.sol': { content: mocks }
}, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);
const artifact = name => Object.values(output.contracts).find(contracts => contracts[name])?.[name];
const mined = async tx => (await tx).wait();
const expectRevert = async operation => assert.rejects(operation);

async function setup(t, expectedChainId = 1337) {
  const chain = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 1337 },
    wallet: { deterministic: true, totalAccounts: 8 } });
  const provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  t.after(async () => { provider.destroy(); await chain.disconnect(); });
  const signers = await Promise.all(Array.from({ length: 8 }, (_, index) => provider.getSigner(index)));
  const addresses = await Promise.all(signers.map(signer => signer.getAddress()));
  const accounts = chain.getInitialAccounts();
  const wallets = addresses.map(address => new Wallet(accounts[address.toLowerCase()].secretKey));
  const deploy = async (name, args = []) => {
    const item = artifact(name);
    const contract = await new ContractFactory(item.abi, `0x${item.evm.bytecode.object}`, signers[0]).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };
  const token = await deploy('MockOmmm');
  const minter = await deploy('MockMilestones');
  const rewards = await deploy('DLangNarrationRewards', [addresses[0], addresses[0], token.target, minter.target, expectedChainId]);
  return { provider, signers, wallets, addresses, token, minter, rewards, deploy };
}

const REVIEW_TYPES = { NarrationReview: [
  { name: 'narrationId', type: 'bytes32' }, { name: 'versionHash', type: 'bytes32' },
  { name: 'languageHash', type: 'bytes32' }, { name: 'reviewer', type: 'address' },
  { name: 'approve', type: 'bool' }, { name: 'deadline', type: 'uint256' }
] };
const CLAIM_TYPES = { RewardClaim: [
  { name: 'steward', type: 'address' }, { name: 'recordId', type: 'bytes32' },
  { name: 'awardId', type: 'bytes32' }, { name: 'claimId', type: 'bytes32' },
  { name: 'ommmUnits', type: 'uint256' }, { name: 'metadataURI', type: 'string' },
  { name: 'deadline', type: 'uint256' }
] };

function domain(rewards, chainId = 1337) {
  return { name: 'DLangNarrationRewards', version: '1', chainId, verifyingContract: rewards.target };
}

test('review signatures bind immutable scene/audio version and exactly three language-qualified non-author reviewers', async t => {
  const { signers, wallets, addresses, rewards } = await setup(t);
  const languageHash = id('en'), frenchHash = id('fr');
  for (const address of addresses.slice(1, 5)) await mined(rewards.setReviewerQualification(languageHash, address, true));
  await mined(rewards.setReviewerQualification(frenchHash, addresses[5], true));
  const recordId = id('narration-one'), versionHash = id('immutable-version-one');
  const audioHash = id('audio-sha256'), sceneHash = id('scene-version-sha256');
  const panel = addresses.slice(1, 4);
  await expectRevert(rewards.registerNarration(recordId, versionHash, languageHash, audioHash, sceneHash,
    [addresses[0], panel[1], panel[2]]));
  await expectRevert(rewards.registerNarration(recordId, versionHash, languageHash, audioHash, sceneHash,
    [panel[0], panel[0], panel[2]]));
  await expectRevert(rewards.registerNarration(recordId, versionHash, languageHash, audioHash, sceneHash,
    [panel[0], panel[1], addresses[5]]));
  await mined(rewards.registerNarration(recordId, versionHash, languageHash, audioHash, sceneHash, panel));

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const makeVote = async (reviewerIndex, approve, patch = {}) => {
    const vote = { narrationId: recordId, versionHash, languageHash, reviewer: addresses[reviewerIndex], approve, deadline, ...patch };
    const signature = await wallets[reviewerIndex].signTypedData(domain(rewards), REVIEW_TYPES, vote);
    return { vote, signature };
  };
  const wrongVersion = await makeVote(1, true, { versionHash: id('different-version') });
  await expectRevert(rewards.submitReview(wrongVersion.vote, wrongVersion.signature));
  const wrongLanguage = await makeVote(1, true, { languageHash: frenchHash });
  await expectRevert(rewards.submitReview(wrongLanguage.vote, wrongLanguage.signature));
  const unassigned = { ...wrongLanguage.vote, languageHash, reviewer: addresses[5] };
  await expectRevert(rewards.submitReview(unassigned, await wallets[5].signTypedData(domain(rewards), REVIEW_TYPES, unassigned)));

  const first = await makeVote(1, true);
  const second = await makeVote(2, true);
  await mined(rewards.connect(signers[6]).submitReview(first.vote, first.signature));
  assert.equal(await rewards.isNarrationActive(recordId), false);
  await mined(rewards.connect(signers[7]).submitReview(second.vote, second.signature));
  assert.equal(await rewards.isNarrationActive(recordId), true);
  await expectRevert(rewards.submitReview(first.vote, first.signature));
  await expectRevert(rewards.submitReview((await makeVote(3, false)).vote, '0x'));

  const summary = await rewards.narrationSummary(recordId);
  assert.equal(summary.approvals, 2n);
  assert.equal(summary.rejections, 0n);
  assert.equal(summary.active, true);
});

test('revocation and replacement are explicit; a replacement reviewer may cast the new third-panel vote', async t => {
  const { signers, wallets, addresses, rewards } = await setup(t);
  const languageHash = id('ga'), recordId = id('replace-reviewer'), versionHash = id('version-replacement');
  for (const address of addresses.slice(1, 5)) await mined(rewards.setReviewerQualification(languageHash, address, true));
  await mined(rewards.registerNarration(recordId, versionHash, languageHash, id('audio'), id('scene'), addresses.slice(1, 4)));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const submit = async index => {
    const vote = { narrationId: recordId, versionHash, languageHash, reviewer: addresses[index], approve: true, deadline };
    await mined(rewards.submitReview(vote, await wallets[index].signTypedData(domain(rewards), REVIEW_TYPES, vote)));
  };
  await submit(1);
  await mined(rewards.revokeReviewVote(recordId, addresses[1], id('explicit-revocation-reason')));
  await mined(rewards.replaceReviewer(recordId, addresses[1], addresses[4], id('explicit-replacement-reason')));
  await submit(2);
  await submit(4);
  assert.equal(await rewards.isNarrationActive(recordId), true);
  assert.equal(await rewards.hasVoted(recordId, addresses[1]), true);
});

test('signed reward claim transfers configured Ommm and mints one milestone; replay, wrong chain and absent assets fail closed', async t => {
  const { signers, wallets, addresses, token, minter, rewards, deploy } = await setup(t);
  await mined(token.mint(rewards.target, 9001n));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const reward = {
    steward: addresses[6], recordId: id('learner-record'), awardId: id('first-scene-dnft'),
    claimId: id('unique-claim'), ommmUnits: 9001n, metadataURI: 'ipfs://bafy' + 'a'.repeat(52), deadline
  };
  const signature = await wallets[0].signTypedData(domain(rewards), CLAIM_TYPES, reward);
  await mined(rewards.connect(signers[6]).claim(reward, signature));
  assert.equal(await token.balanceOf(addresses[6]), 9001n);
  assert.equal(await minter.minted(addresses[6]), 1n);
  await expectRevert(rewards.claim(reward, signature));
  const reusedAward = { ...reward, claimId: id('second-claim-same-award') };
  await expectRevert(rewards.claim(reusedAward, await wallets[0].signTypedData(domain(rewards), CLAIM_TYPES, reusedAward)));
  const expired = { ...reward, recordId: id('expired-record'), awardId: id('expired-award'), claimId: id('expired-claim'), deadline: 1n };
  await expectRevert(rewards.claim(expired, await wallets[0].signTypedData(domain(rewards), CLAIM_TYPES, expired)));
  const wrongSigner = await wallets[1].signTypedData(domain(rewards), CLAIM_TYPES, { ...reward, claimId: id('wrong-signer-claim') });
  await expectRevert(rewards.claim({ ...reward, claimId: id('wrong-signer-claim') }, wrongSigner));

  const wrongChain = await deploy('DLangNarrationRewards', [addresses[0], addresses[0], token.target, minter.target, 8453]);
  const wrongChainVoucher = { ...reward, claimId: id('wrong-chain-claim') };
  const wrongChainSig = await wallets[0].signTypedData(domain(wrongChain), CLAIM_TYPES, wrongChainVoucher);
  await expectRevert(wrongChain.claim(wrongChainVoucher, wrongChainSig));

  const noAssets = await deploy('DLangNarrationRewards', [addresses[0], addresses[0], ZeroAddress, ZeroAddress, 1337]);
  const gatedVoucher = { ...reward, recordId: id('unconfigured-record'), awardId: id('unconfigured-award'), claimId: id('unconfigured-claim') };
  const gatedSig = await wallets[0].signTypedData(domain(noAssets), CLAIM_TYPES, gatedVoucher);
  await expectRevert(noAssets.claim(gatedVoucher, gatedSig));
});
