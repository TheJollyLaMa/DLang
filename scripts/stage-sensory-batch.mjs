#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSensoryCatalog } from '../public/dlang/sensory.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const month = process.argv[2];
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw Error('Usage: stage-sensory-batch.mjs YYYY-MM');
const publicRoot = path.join(root, 'public/dlang');
const folder = path.join(root, 'data/sensory', month), target = path.join(publicRoot, 'sensory', month);
await fs.mkdir(target, { recursive: true });
const catalogFile = path.join(publicRoot, 'sensory-catalog.json');
let catalog;
try { catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; catalog = { version: 1, assets: [] }; }
validateSensoryCatalog(catalog);
const digest = data => createHash('sha256').update(data).digest('hex');
async function previewFor(sourceFile, id) {
  const file = path.join(target, `${id}-preview.webp`);
  execFileSync('ffmpeg', ['-v', 'error', '-i', sourceFile, '-frames:v', '1', '-vf',
    'scale=360:216:force_original_aspect_ratio=decrease,pad=360:216:(ow-iw)/2:(oh-ih)/2:white', '-c:v', 'libwebp', '-quality', '75', '-n', file], { stdio: 'pipe' });
  const data = await fs.readFile(file);
  return { path: `sensory/${month}/${path.basename(file)}`, bytes: data.length, sha256: digest(data) };
}
for (const provider of ['sounds', 'images']) {
  const batch = JSON.parse(await fs.readFile(path.join(folder, `${provider}.json`), 'utf8'));
  for (const asset of batch.assets) {
    if (asset.state !== 'saved' || !/^[a-z0-9-]+$/.test(asset.id) || path.basename(asset.file) !== asset.file) throw Error('Only saved, safe batch assets may be staged.');
    const sourceFile = path.join(folder, asset.file), bytes = await fs.readFile(sourceFile);
    if (digest(bytes) !== asset.sha256) throw Error('Private source checksum changed.');
    const existing = catalog.assets.find(item => item.id === asset.id);
    if (existing) {
      if (existing.source.sha256 !== asset.sha256) throw Error('Asset ID already exists with different source.');
      existing.batch = { month, creditCap: batch.creditCap, reportedCreditsUsed: batch.creditsUsed,
        ...(batch.usageObservedAt ? { usageObservedAt: batch.usageObservedAt } : {}), finalBillingVerified: false };
      if (existing.kind === 'image' && !existing.preview) {
        existing.preview = await previewFor(sourceFile, asset.id);
      }
      await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
      continue;
    }
    const filename = `${asset.id}.${provider === 'sounds' ? 'mp3' : 'png'}`, output = path.join(target, filename);
    let seconds, mobile;
    if (provider === 'sounds') {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', sourceFile], { encoding: 'utf8' }));
      seconds = Number(probe.format.duration);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5) throw Error('Sound duration must be at most five seconds.');
      execFileSync('ffmpeg', ['-v', 'error', '-i', sourceFile, '-f', 'null', '-'], { stdio: 'pipe' });
      await fs.writeFile(output, bytes, { flag: 'wx' });
    } else {
      for (const [variant, width, height] of [['desktop', 1200, 720], ['mobile', 600, 800]]) {
        const file = variant === 'desktop' ? output : path.join(target, `${asset.id}-mobile.png`);
        execFileSync('ffmpeg', ['-v', 'error', '-i', sourceFile, '-frames:v', '1', '-vf',
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:white,format=rgb24`, '-compression_level', '9', '-n', file], { stdio: 'pipe' });
        if (variant === 'mobile') {
          const data = await fs.readFile(file);
          mobile = { path: `sensory/${month}/${path.basename(file)}`, bytes: data.length, sha256: digest(data) };
        }
      }
    }
    const data = await fs.readFile(output);
    const item = { id: asset.id, kind: provider === 'sounds' ? 'sound' : 'image', concept: asset.concept,
      label: `${asset.concept} ${provider === 'sounds' ? 'sound cue' : 'visual candidate'}`, status: 'draft',
      path: `sensory/${month}/${filename}`, bytes: data.length, sha256: digest(data),
      ...(seconds ? { seconds } : { mobile, preview: await previewFor(sourceFile, asset.id) }),
      source: { provider: batch.provider, model: asset.model, prompt: asset.prompt, generatedAt: asset.generatedAt,
        ...(asset.taskId ? { taskId: asset.taskId } : {}), sha256: asset.sha256,
        license: 'Provider account terms; operator rights review pending' },
      review: null, batch: { month, creditCap: batch.creditCap, reportedCreditsUsed: batch.creditsUsed, finalBillingVerified: false } };
    catalog.assets.push(item);
    validateSensoryCatalog(catalog);
    await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
    console.log(`Staged draft ${item.id}; not approved for lessons.`);
  }
}
