#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { voiceSeedMessage } from '../public/dlang/voice-seeding.mjs';
import { pilotEligibility } from '../public/dlang/pilot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export function verifyVoiceConsent(request, roster) {
  const signer = verifyMessage(voiceSeedMessage(request), request.signature);
  if (signer.toLowerCase() !== request.wallet.toLowerCase()) throw Error('Consent signature does not match contributor.');
  if (request.action === 'opt-in' && !pilotEligibility(roster, signer).eligible) throw Error('Contributor is not on reviewed whitelist.');
  const age = Date.now() - Date.parse(request.issuedAt);
  if (age < -60000 || request.action === 'opt-in' && age > 30 * 86400000) throw Error('Consent date is invalid or older than 30 days.');
  return signer;
}
async function main() {
  const [action, requestFile, sampleOrReceipt, approvalFile] = process.argv.slice(2);
  if (!['inspect', 'clone', 'withdraw'].includes(action) || !requestFile || !sampleOrReceipt) {
    throw Error('Usage: voice-seed.mjs inspect|clone request.json sample.wav [private-operator-approval.json], or withdraw request.json receipt.json');
  }
  const request = await read(requestFile), roster = await read(path.join(root, 'public/dlang/pilot-roster.json'));
  verifyVoiceConsent(request, roster);
  const folder = path.join(root, 'data/voice-seeds');
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const client = new ElevenLabsClient({ maxRetries: 0 });
  if (action === 'withdraw') {
    if (request.action !== 'withdraw') throw Error('A signed withdrawal is required.');
    const receipt = await read(sampleOrReceipt);
    if (receipt.requestId !== request.id || receipt.wallet !== request.wallet.toLowerCase() || receipt.sampleHash !== request.sampleHash) throw Error('Withdrawal does not match clone receipt.');
    receipt.state = 'withdrawn-provider-deletion-pending';
    receipt.generationEnabled = false;
    receipt.withdrawal = request;
    await fs.writeFile(sampleOrReceipt, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    if (typeof receipt.voiceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(receipt.voiceId)) throw Error('Voice ID unavailable; manual provider deletion required.');
    await client.voices.delete(receipt.voiceId, { maxRetries: 0 });
    receipt.state = 'withdrawn-provider-deleted';
    await fs.writeFile(sampleOrReceipt, JSON.stringify(receipt, null, 2), { mode: 0o600 });
    console.log('Future generation disabled in receipt; provider voice deleted. Review distributed audio and backups separately; no complete-erasure promise.');
    return;
  }
  if (request.action !== 'opt-in') throw Error('An opt-in request is required.');
  const info = await fs.stat(sampleOrReceipt);
  if (!info.isFile() || info.size < 1 || info.size > 25 * 1024 * 1024) throw Error('Sample must be a private audio file no larger than 25 MiB.');
  const hash = createHash('sha256').update(await fs.readFile(sampleOrReceipt)).digest('hex');
  if (hash !== request.sampleHash) throw Error('Sample does not match the speaker-signed hash.');
  if (action === 'inspect') { console.log('Signature, whitelist, scope and sample hash verified. Adult status, actual speaker ownership, audio quality and provider retention still require operator review. No audio uploaded.'); return; }
  if (!approvalFile) throw Error('Private operator approval required before uploading any sample.');
  const approval = await read(approvalFile);
  if (approval.requestId !== request.id || approval.sampleHash !== request.sampleHash || !approval.approvedBy
    || !Number.isFinite(Date.parse(approval.approvedAt)) || approval.adultEligibilityVerified !== true
    || approval.speakerOwnershipVerified !== true || approval.retentionExplained !== true
    || approval.dedicatedSampleReviewed !== true) throw Error('Operator approval is incomplete; sample not uploaded.');
  if (!process.env.ELEVENLABS_API_KEY) throw Error('ELEVENLABS_API_KEY is required.');
  const receiptFile = path.join(folder, `${request.id}.json`);
  const receipt = { version: 1, requestId: request.id, wallet: request.wallet.toLowerCase(), sampleHash: hash,
    consent: request, operatorApproval: approval, state: 'clone-requested',
    generationEnabled: false, rewardIntents: [
      { kind: 'one-time-approved-voice', status: 'pending-speaker-and-language-review', amount: null },
      { kind: 'reviewed-narration-usage', status: 'rates-and-caps-not-configured', amount: null }
    ] };
  await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  const result = await client.voices.ivc.create({
    name: `DLang ${request.language} ${request.id.slice(0, 8)}`,
    files: [createReadStream(sampleOrReceipt)],
    description: 'Consented adult contributor. Reviewed DLang lesson narration only; no live AI conversation.',
    removeBackgroundNoise: false
  }, { maxRetries: 0 });
  if (!result.voiceId) throw Error('Clone response ambiguous; do not retry. Inspect provider and journal.');
  Object.assign(receipt, { voiceId: result.voiceId, state: 'awaiting-speaker-preview-and-language-review' });
  await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log('Private clone receipt saved. No generation enabled, public voice sharing, lesson activation or gems paid.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
