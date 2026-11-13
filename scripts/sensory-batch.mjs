#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOUND_SEEDS = [
  ['cat', 'A single friendly domestic cat meowing softly, isolated clean recording, no speech, no music.'],
  ['bird', 'A small songbird chirping gently twice, isolated clean nature sound, no speech, no music.'],
  ['wind', 'Gentle wind rustling leaves, quiet outdoor breeze, no howling, no speech, no music.'],
  ['rain', 'Soft steady rain pattering on a window, calm and quiet, no thunder, no speech, no music.'],
  ['bell', 'One soft small bicycle bell ringing clearly and fading, no startling impact, no speech, no music.'],
  ['surprise', 'A gentle playful rising chime expressing curiosity and pleasant surprise, no human voice, no speech, no music.']
];
const IMAGE_SEEDS = ['cat', 'bird', 'tree', 'flower', 'book', 'chair', 'table', 'cup', 'lamp', 'window', 'bicycle', 'basket'];
const hash = data => createHash('sha256').update(data).digest('hex');
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function save(file, value) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
async function runway(endpoint, body) {
  if (!process.env.RUNWAYML_API_SECRET) throw Error('RUNWAYML_API_SECRET is required.');
  const response = await fetch(`https://api.dev.runwayml.com/v1/${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`, 'X-Runway-Version': '2024-11-06', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw Error(`Runway ${endpoint.split('/')[0]} HTTP ${response.status}; inspect journal before retrying.`);
  return response.json();
}
export async function generateBatch(provider, month) {
  if (!['sounds', 'images'].includes(provider) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw Error('Usage: sensory-batch.mjs sounds|images YYYY-MM. Requires explicit budget approval.');
  }
  const folder = path.join(root, 'data', 'sensory', month);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const journal = path.join(folder, `${provider}.json`);
  let batch;
  try { batch = await json(journal); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    batch = { version: 1, month, provider: provider === 'sounds' ? 'ElevenLabs' : 'Runway',
      status: 'pending-human-review', createdAt: new Date().toISOString(), assets: [] };
  }
  const client = provider === 'sounds' ? new ElevenLabsClient({ maxRetries: 0 }) : null;
  const subscription = async () => {
    const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error(`ElevenLabs budget check HTTP ${response.status}`);
    return response.json();
  };
  if (provider === 'sounds') {
    if (!process.env.ELEVENLABS_API_KEY) throw Error('ELEVENLABS_API_KEY is required.');
    const account = await subscription();
    batch.initialUsage ??= account.character_count;
    batch.creditCap = 5000;
    if (account.character_limit - account.character_count < 480 || account.character_count - batch.initialUsage + 480 > batch.creditCap) {
      throw Error('Insufficient included credits or batch budget; no generation started.');
    }
  } else {
    const account = await runway('organization');
    batch.initialBalance ??= account.creditBalance;
    batch.creditCap = 60;
    if (account.creditBalance < 60 || batch.initialBalance - account.creditBalance > batch.creditCap) {
      throw Error('Runway pilot budget unavailable; no top-up or generation started.');
    }
  }
  await save(journal, batch);
  const seeds = provider === 'sounds' ? SOUND_SEEDS : IMAGE_SEEDS.map(concept => [concept,
    `One clearly recognizable ${concept}, entirely visible, centered with generous empty space on a plain warm ivory background. ${
      ['cat', 'bird', 'tree', 'flower'].includes(concept) ? 'Realistic natural photograph' : 'Realistic product photograph'
    }. Educational vocabulary illustration. No text, letters, logos, extra objects, people or dramatic shadows.`]);
  for (const [concept, prompt] of seeds) {
    let asset = batch.assets.find(item => item.concept === concept);
    if (asset?.state === 'saved') continue;
    if (asset?.state === 'requested' && !asset.taskId) throw Error(`Ambiguous ${concept} request; do not automatically repeat.`);
    if (!asset) {
      const reserved = batch.assets.length * (provider === 'sounds' ? 80 : 5);
      if (reserved + (provider === 'sounds' ? 80 : 5) > batch.creditCap) throw Error('Conservative reserved-credit cap reached.');
      asset = { id: `${month}-${provider}-${concept}-v1`, concept, prompt,
        model: provider === 'sounds' ? 'eleven_text_to_sound_v3' : 'gen4_image',
        state: 'requested', generatedAt: new Date().toISOString(), review: 'pending',
        rights: 'Operator must review provider license and distribution rights before approving lesson rotation.' };
      batch.assets.push(asset);
      await save(journal, batch);
    }
    let data;
    if (provider === 'sounds') {
      const stream = await client.textToSoundEffects.convert({
        text: prompt, modelId: asset.model, durationSeconds: 2, promptInfluence: 0.6, loop: false,
        outputFormat: 'mp3_44100_128'
      }, { maxRetries: 0 });
      data = Buffer.from(await new Response(stream).arrayBuffer());
      const account = await subscription();
      batch.creditsUsed = account.character_count - batch.initialUsage;
      if (batch.creditsUsed > batch.creditCap) throw Error('Provider usage exceeded budget; stop and inspect before continuing.');
    } else {
      if (!asset.taskId) {
        const task = await runway('text_to_image', { model: asset.model, promptText: prompt, ratio: '1280:720' });
        if (typeof task.id !== 'string') throw Error('Runway returned no task ID; inspect ambiguous request.');
        asset.taskId = task.id; await save(journal, batch);
      }
      let output;
      for (let poll = 0; poll < 90; poll++) {
        const task = await runway(`tasks/${asset.taskId}`);
        if (task.status === 'SUCCEEDED') { output = task.output?.[0]; break; }
        if (['FAILED', 'CANCELLED'].includes(task.status)) throw Error(`Runway ${concept} task ${task.status}; no automatic regeneration.`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      if (!output || new URL(output).protocol !== 'https:') throw Error('Runway output unavailable; task can be polled later.');
      const response = await fetch(output, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw Error(`Image download HTTP ${response.status}; task retained.`);
      data = Buffer.from(await response.arrayBuffer());
      batch.creditsUsed = batch.initialBalance - (await runway('organization')).creditBalance;
      if (batch.creditsUsed > batch.creditCap) throw Error('Runway pilot budget exceeded; stop before next request.');
    }
    if (!data.length || data.length > 10 * 1024 * 1024) throw Error('Generated asset size invalid; inspect journal before retrying.');
    const filename = `${asset.id}.${provider === 'sounds' ? 'mp3' : 'image'}`;
    await fs.writeFile(path.join(folder, filename), data, { flag: 'wx', mode: 0o600 });
    Object.assign(asset, { state: 'saved', file: filename, bytes: data.length, sha256: hash(data) });
    await save(journal, batch);
    console.log(JSON.stringify({ saved: asset.id, bytes: data.length, creditsUsed: batch.creditsUsed, review: 'pending' }));
  }
  batch.creditsUsed = provider === 'sounds'
    ? (await subscription()).character_count - batch.initialUsage
    : batch.initialBalance - (await runway('organization')).creditBalance;
  batch.usageObservedAt = new Date().toISOString();
  await save(journal, batch);
  return batch;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateBatch(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
