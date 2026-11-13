#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSensoryCatalog } from '../public/dlang/sensory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/dlang');
const catalogFile = path.join(root, 'sensory-catalog.json');
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
validateSensoryCatalog(catalog);
function measure(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Audio measurement failed: ${result.stderr}`);
  const mean = Number(result.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);
  const peak = Number(result.stderr.match(/max_volume: (-?[\d.]+) dB/)?.[1]);
  if (!Number.isFinite(mean) || !Number.isFinite(peak)) throw Error('Audio loudness measurements are unavailable.');
  return { mean, peak };
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const concept of ['wind', 'rain']) {
  const asset = catalog.assets.find(item => item.kind === 'sound' && item.concept === concept && item.status === 'draft');
  if (!asset) throw Error(`Draft weather asset missing: ${concept}`);
  if (asset.processing?.version === 2) {
    const measured = measure(path.join(root, asset.path));
    if (Math.abs(measured.mean + 30) > 0.5 || measured.peak > -3) throw Error('Previously normalized asset is outside its loudness limits.');
    console.log(JSON.stringify({ concept, unchanged: true, ...measured }));
    continue;
  }
  const originalPath = asset.path, original = path.join(root, originalPath);
  const originalBytes = await fs.readFile(original);
  if (digest(originalBytes) !== asset.sha256) throw Error('Original weather asset checksum changed.');
  const before = measure(original);
  const gainDb = Math.min(-30 - before.mean, -4 - before.peak);
  if (gainDb <= 0) throw Error('Weather sound does not need amplification.');
  const outputPath = originalPath.replace(/-v1\.mp3$/, '-v2.mp3');
  if (outputPath === originalPath) throw Error('Expected versioned source filename.');
  const output = path.join(root, outputPath), temp = `${output}.tmp.mp3`;
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-i', original, '-af', `volume=${gainDb}dB`,
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-n', temp], { stdio: 'pipe' });
    const after = measure(temp);
    if (Math.abs(after.mean + 30) > 0.5 || after.peak > -3) throw Error('Normalized weather sound failed RMS or peak limits.');
    await fs.rename(temp, output);
    const bytes = await fs.readFile(output);
    Object.assign(asset, { path: outputPath, bytes: bytes.length, sha256: digest(bytes),
      processing: { version: 2, originalPath, originalSha256: digest(originalBytes), method: 'constant-gain',
        gainDb, targetMeanDb: -30, maximumPeakDb: -3, before, after } });
    validateSensoryCatalog(catalog);
    await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
    console.log(JSON.stringify({ concept, gainDb, before, after }));
  } finally {
    try { await fs.unlink(temp); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
