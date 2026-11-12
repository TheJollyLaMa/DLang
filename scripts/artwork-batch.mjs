#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../public/dlang/curriculum.mjs';
import { SCENE_VERSION } from '../public/dlang/library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTWORK_DIR = path.join(ROOT, 'public/dlang/artwork');
const CATALOG_FILE = path.join(ROOT, 'public/dlang/artwork-catalog.json');
const CONCEPTS = new Set(LEVELS.flatMap(level => level.concepts));
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PIXEL_BYTES = 24 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer, viewport) {
  assert(Buffer.isBuffer(buffer) && buffer.length >= 45 && buffer.length <= MAX_FILE_BYTES,
    `${viewport} image must be a non-empty PNG no larger than ${MAX_FILE_BYTES} bytes.`);
  assert(buffer.subarray(0, 8).equals(PNG_SIGNATURE), `${viewport} image is not a PNG.`);
  let offset = 8;
  let dimensions;
  let ended = false;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    assert(length <= MAX_FILE_BYTES && offset + 12 + length <= buffer.length, `${viewport} PNG has a truncated chunk.`);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    assert(crc32(buffer.subarray(offset + 4, dataEnd)) === expectedCrc, `${viewport} PNG chunk checksum is invalid.`);
    if (!dimensions) {
      assert(type === 'IHDR' && length === 13, `${viewport} PNG must start with an IHDR chunk.`);
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      const depth = buffer[dataStart + 8];
      const colorType = buffer[dataStart + 9];
      assert(width > 0 && height > 0 && depth === 8 && (colorType === 2 || colorType === 6),
        `${viewport} PNG must use 8-bit RGB or RGBA pixels.`);
      if (viewport === 'desktop') {
        assert(width >= 1200 && height >= 600 && width <= 2400 && height <= 1600,
          'Desktop PNG must be 1200×600 through 2400×1600.');
      } else {
        assert(width >= 375 && height >= 500 && width <= 1200 && height <= 2400,
          'Mobile PNG must be 375×500 through 1200×2400.');
      }
      dimensions = { width, height, bytesPerPixel: colorType === 2 ? 3 : 4 };
    } else if (type === 'IDAT') {
      imageData.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      assert(length === 0, `${viewport} PNG IEND chunk must be empty.`);
      ended = true;
      offset = dataEnd + 4;
      break;
    }
    offset = dataEnd + 4;
  }
  assert(ended && offset === buffer.length && imageData.length > 0, `${viewport} PNG is incomplete or has trailing data.`);
  const rowLength = dimensions.width * dimensions.bytesPerPixel + 1;
  const expectedLength = rowLength * dimensions.height;
  assert(expectedLength <= MAX_PIXEL_BYTES, `${viewport} PNG decoded pixel data exceeds the limit.`);
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: MAX_PIXEL_BYTES });
  } catch {
    throw new Error(`${viewport} PNG image data cannot be decoded.`);
  }
  assert(decoded.length === expectedLength, `${viewport} PNG decoded dimensions do not match its header.`);
  for (let row = 0; row < dimensions.height; row++) {
    assert(decoded[row * rowLength] <= 4, `${viewport} PNG contains an invalid row filter.`);
  }
  return dimensions;
}

function validateReview(review, kind, month, generatedAt) {
  assert(isRecord(review) && review.status === 'approved', `${kind} review must be explicitly approved.`);
  assert(nonempty(review.reviewer), `${kind} review must name a human reviewer.`);
  assert(validDate(review.reviewedAt) && review.reviewedAt.slice(0, 7) >= month,
    `${kind} review must have a valid date no earlier than the batch month.`);
  assert(Date.parse(review.reviewedAt) >= Date.parse(generatedAt), `${kind} review must follow asset generation.`);
  if (kind === 'language') {
    assert(Array.isArray(review.languages) && review.languages.length > 0
      && review.languages.every(language => typeof language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)),
    'Language review must list the reviewed language codes.');
  }
}

export function validateBatch(manifest, { readAsset, concepts = CONCEPTS } = {}) {
  assert(isRecord(manifest) && manifest.schemaVersion === 1, 'Unsupported or missing artwork manifest schemaVersion.');
  assert(/^[a-z0-9][a-z0-9-]{2,63}$/.test(manifest.batchId || ''), 'batchId must be a 3–64 character lowercase slug.');
  assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(manifest.month || ''), 'month must use YYYY-MM format.');
  assert(manifest.status === 'approved', 'Only a fully approved monthly batch can be imported.');
  assert(manifest.sceneVersion === SCENE_VERSION, `sceneVersion must match the current ${SCENE_VERSION} scene version.`);
  assert(isRecord(manifest.provider) && manifest.provider.name === 'Runway'
    && manifest.provider.accountIntegration === 'unavailable'
    && manifest.provider.automation === 'disabled', 'Runway account integration and generation automation must remain explicitly unavailable/disabled.');
  assert(isRecord(manifest.budget) && nonempty(manifest.budget.approvedBy)
    && validDate(manifest.budget.approvedAt) && Number.isFinite(manifest.budget.creditCap)
    && manifest.budget.creditCap > 0 && Number.isFinite(manifest.budget.creditsUsed)
    && manifest.budget.creditsUsed >= 0 && manifest.budget.creditsUsed <= manifest.budget.creditCap,
  'A pre-approved positive credit cap and bounded actual usage are required.');
  assert(Array.isArray(manifest.assets) && manifest.assets.length === 12, 'A monthly batch must contain exactly 12 assets.');
  assert(typeof readAsset === 'function', 'An asset reader is required.');

  const ids = new Set();
  const filePaths = new Set();
  for (const [index, asset] of manifest.assets.entries()) {
    const prefix = `assets[${index}]`;
    assert(isRecord(asset) && /^[a-z0-9][a-z0-9-]{2,63}$/.test(asset.id || ''), `${prefix}.id must be a lowercase slug.`);
    assert(!ids.has(asset.id), `Asset id ${asset.id} is duplicated.`);
    ids.add(asset.id);
    assert(typeof asset.concept === 'string' && concepts.has(asset.concept), `${prefix}.concept is not a stable DLang concept id.`);
    assert(Number.isInteger(asset.artVersion) && asset.artVersion > 0, `${prefix}.artVersion must be a positive integer.`);
    assert(nonempty(asset.style) && nonempty(asset.context) && nonempty(asset.description),
      `${prefix} must identify the style, context, and accessible description.`);
    assert(isRecord(asset.source) && asset.source.provider === 'Runway' && nonempty(asset.source.model)
      && nonempty(asset.source.jobId) && nonempty(asset.source.prompt) && validDate(asset.source.generatedAt)
      && Date.parse(asset.source.generatedAt) >= Date.parse(manifest.budget.approvedAt),
    `${prefix} must preserve its Runway model, source job, prompt, and generation time after budget approval.`);
    assert(isRecord(asset.source.rights) && asset.source.rights.status === 'cleared'
      && nonempty(asset.source.rights.license) && nonempty(asset.source.rights.owner),
    `${prefix} must include cleared rights, license, and owner provenance.`);
    assert(isRecord(asset.review), `${prefix}.review is required.`);
    validateReview(asset.review.visual, 'visual', manifest.month, asset.source.generatedAt);
    validateReview(asset.review.language, 'language', manifest.month, asset.source.generatedAt);
    assert(asset.review.visual.reviewer !== asset.review.language.reviewer,
      `${prefix} visual and language approvals must be separate human reviews.`);
    const recognition = asset.review.recognition;
    assert(isRecord(recognition) && Number.isInteger(recognition.participants) && recognition.participants >= 1
      && Number.isInteger(recognition.recognized) && recognition.recognized >= 0
      && recognition.recognized <= recognition.participants
      && Number.isFinite(recognition.threshold) && recognition.threshold > 0 && recognition.threshold <= 1
      && recognition.recognized / recognition.participants >= recognition.threshold
      && nonempty(recognition.method),
    `${prefix} needs a passed, documented human recognition check.`);
    assert(isRecord(asset.files), `${prefix}.files must include desktop and mobile PNGs.`);
    for (const viewport of ['desktop', 'mobile']) {
      const file = asset.files[viewport];
      assert(isRecord(file) && nonempty(file.path) && /^[a-f0-9]{64}$/.test(file.sha256 || ''),
        `${prefix}.files.${viewport} needs a relative path and SHA-256.`);
      assert(!path.isAbsolute(file.path) && !file.path.split(/[\\/]/).includes('..')
        && !file.path.includes('\\') && !file.path.startsWith('http:') && !file.path.startsWith('https:'),
      `${prefix}.files.${viewport}.path must be a safe local relative path.`);
      assert(!filePaths.has(file.path), `${prefix} reuses a file path.`);
      filePaths.add(file.path);
      const bytes = readAsset(file.path);
      assert(Buffer.isBuffer(bytes), `${prefix}.files.${viewport} could not be read.`);
      assert(createHash('sha256').update(bytes).digest('hex') === file.sha256,
        `${prefix}.files.${viewport} SHA-256 does not match the file.`);
      inspectPng(bytes, viewport);
    }
  }
  return { batchId: manifest.batchId, month: manifest.month, assets: manifest.assets.length, sceneVersion: manifest.sceneVersion };
}

function readBatch(manifestFile) {
  const manifestPath = path.resolve(manifestFile);
  const root = fs.realpathSync(path.dirname(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const readAsset = relativePath => {
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    assert(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative),
      `Asset path escapes the manifest directory: ${relativePath}`);
    const stat = fs.lstatSync(candidate);
    assert(stat.isFile() && !stat.isSymbolicLink(), `Asset must be a regular local file: ${relativePath}`);
    const real = fs.realpathSync(candidate);
    const realRelative = path.relative(root, real);
    assert(realRelative && !realRelative.startsWith(`..${path.sep}`) && realRelative !== '..' && !path.isAbsolute(realRelative),
      `Asset resolves outside the manifest directory: ${relativePath}`);
    return fs.readFileSync(real);
  };
  return { manifest, readAsset };
}

function updateCatalog(manifest) {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  assert(catalog.version === 1 && Array.isArray(catalog.batches), 'Artwork catalog is malformed.');
  assert(!catalog.batches.some(batch => batch.batchId === manifest.batchId), 'This batchId is already imported.');
  assert(!catalog.batches.some(batch => batch.month === manifest.month), 'A batch for this month is already imported.');
  const assets = manifest.assets.map(asset => ({
    ...asset,
    files: Object.fromEntries(['desktop', 'mobile'].map(viewport => [
      viewport,
      { ...asset.files[viewport], path: `artwork/${manifest.batchId}/${asset.id}-${viewport}.png` }
    ]))
  }));
  return {
    ...catalog,
    status: 'available',
    provider: { name: 'Runway', accountIntegration: 'unavailable', generation: 'manual-import-only', automation: 'disabled' },
    batches: [...catalog.batches, {
      batchId: manifest.batchId, month: manifest.month, status: 'approved',
      sceneVersion: manifest.sceneVersion, budget: manifest.budget, assets
    }]
  };
}

function importBatch(manifestFile) {
  const { manifest, readAsset } = readBatch(manifestFile);
  validateBatch(manifest, { readAsset });
  const destination = path.join(ARTWORK_DIR, manifest.batchId);
  const staging = path.join(ARTWORK_DIR, `.${manifest.batchId}.importing`);
  assert(!fs.existsSync(destination) && !fs.existsSync(staging), 'Batch destination already exists.');
  fs.mkdirSync(ARTWORK_DIR, { recursive: true });
  fs.mkdirSync(staging);
  try {
    for (const asset of manifest.assets) {
      for (const viewport of ['desktop', 'mobile']) {
        fs.copyFileSync(path.resolve(path.dirname(path.resolve(manifestFile)), asset.files[viewport].path),
          path.join(staging, `${asset.id}-${viewport}.png`), fs.constants.COPYFILE_EXCL);
      }
    }
    const catalog = updateCatalog(manifest);
    fs.renameSync(staging, destination);
    const nextCatalog = `${CATALOG_FILE}.next`;
    fs.writeFileSync(nextCatalog, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(nextCatalog, CATALOG_FILE);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function main(args) {
  const [command, manifestFile] = args;
  assert(['validate', 'import'].includes(command) && manifestFile, 'Usage: node scripts/artwork-batch.mjs <validate|import> <manifest.json>');
  const { manifest, readAsset } = readBatch(manifestFile);
  const summary = validateBatch(manifest, { readAsset });
  if (command === 'validate') {
    console.log(`Validated ${summary.assets} reviewed assets for ${summary.month} (${summary.batchId}); no generation or publication performed.`);
    return;
  }
  importBatch(manifestFile);
  console.log(`Imported approved ${summary.batchId}; generation remains manual and Runway account integration remains unavailable.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Artwork batch rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
