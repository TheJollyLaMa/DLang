const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {deflateSync} = require('node:zlib');
const {chromium} = require('playwright');
const {createServer} = require('../index');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function png(width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;ihdr[9] = 2;
  const row = Buffer.alloc(width * 3 + 1);
  const pixels = Buffer.concat(Array.from({length: height}, () => row));
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function fixture() {
  const assets = Array.from({length: 12}, (_, index) => {
    const id = `asset-${String(index + 1).padStart(2, '0')}`;
    const desktopPath = `${id}-desktop.png`, mobilePath = `${id}-mobile.png`;
    return {
      id, concept: ['chair', 'cat', 'dog'][index % 3], artVersion: 1, style: 'watercolor',
      context: 'home', description: 'A clear recognizable subject in a home setting.',
      source: {provider: 'Runway', model: 'test-model', jobId: `job-${id}`, prompt: 'Test-only prompt',
        generatedAt: '2026-11-01T10:01:00.000Z',
        rights: {status: 'cleared', license: 'CC BY 4.0', owner: 'Test contributor'}},
      review: {
        visual: {status: 'approved', reviewer: 'Visual reviewer', reviewedAt: '2026-11-02T10:00:00.000Z'},
        language: {status: 'approved', reviewer: 'Language reviewer', reviewedAt: '2026-11-02T10:00:00.000Z', languages: ['en']},
        recognition: {participants: 3, recognized: 3, threshold: 0.8, method: 'Test-only fixture'}
      },
      files: {desktop: {path: desktopPath}, mobile: {path: mobilePath}}
    };
  });
  const images = new Map();
  for (const asset of assets) {
    const desktop = png(1200, 600), mobile = png(375, 500);
    images.set(asset.files.desktop.path, desktop);
    images.set(asset.files.mobile.path, mobile);
    asset.files.desktop.sha256 = createHash('sha256').update(desktop).digest('hex');
    asset.files.mobile.sha256 = createHash('sha256').update(mobile).digest('hex');
  }
  return {
    manifest: {
      schemaVersion: 1, batchId: '2026-11-review', month: '2026-11', status: 'approved', sceneVersion: 2,
      provider: {name: 'Runway', accountIntegration: 'unavailable', automation: 'disabled'},
      budget: {approvedBy: 'Test steward', approvedAt: '2026-11-01T10:00:00.000Z', creditCap: 20, creditsUsed: 12},
      assets
    },
    readAsset: key => images.get(key) || null
  };
}

test('monthly artwork import gate accepts exactly twelve bounded, versioned and human-reviewed desktop/mobile pairs', async () => {
  const {validateBatch} = await import('../scripts/artwork-batch.mjs');
  const {manifest, readAsset} = fixture();
  assert.deepEqual(validateBatch(manifest, {readAsset, concepts: new Set(['chair', 'cat', 'dog'])}),
    {batchId: '2026-11-review', month: '2026-11', assets: 12, sceneVersion: 2});
});

test('artwork gate rejects missing human review, unsafe paths, unapproved spend and broken images', async () => {
  const {validateBatch} = await import('../scripts/artwork-batch.mjs');
  const {manifest, readAsset} = fixture();
  const options = {readAsset, concepts: new Set(['chair', 'cat', 'dog'])};
  for (const mutate of [
    copy => {copy.assets[0].review.visual.status = 'pending';},
    copy => {copy.assets[0].files.mobile.path = '../outside.png';},
    copy => {copy.budget.creditsUsed = copy.budget.creditCap + 1;},
    copy => {copy.assets[0].source.rights.status = 'unknown';},
    copy => {copy.assets[0].source.generatedAt = '2026-10-31T23:59:59.000Z';},
    copy => {copy.assets[0].review.language.reviewer = copy.assets[0].review.visual.reviewer;},
    copy => {copy.assets[0].review.recognition.recognized = 1;},
    copy => {copy.assets.pop();}
  ]) {
    const copy = structuredClone(manifest);mutate(copy);
    assert.throws(() => validateBatch(copy, options));
  }
  const corrupt = structuredClone(manifest);
  corrupt.assets[0].files.desktop.sha256 = createHash('sha256').update(Buffer.from('not a PNG')).digest('hex');
  assert.throws(() => validateBatch(corrupt, {readAsset: key => key === corrupt.assets[0].files.desktop.path
    ? Buffer.from('not a PNG') : readAsset(key), concepts: new Set(['chair', 'cat', 'dog'])}), /PNG/);
});

test('artwork resolver returns approved version-compatible assets or an explicit fallback state', async () => {
  const {resolveArtwork} = await import('../public/dlang/artwork.mjs');
  const {sceneSVG, SCENES} = await import('../public/dlang/scenes.mjs');
  const catalog = require('../public/dlang/artwork-catalog.json');
  const defaultSceneSvg = sceneSVG(SCENES[0]);
  assert.doesNotMatch(defaultSceneSvg, /data-artwork-state|data-artwork-reason|Artwork status:/);
  assert.equal((defaultSceneSvg.match(/data-target=/g) || []).length, 12);
  assert.deepEqual(resolveArtwork(catalog, 'cat', {sceneVersion: 2}),
    {available: false, state: 'unavailable', reason: 'No reviewed artwork is published; keep the original scene renderer.'});
  const approved = {
    ...catalog, status: 'available', batches: [{
      batchId: '2026-11-review', month: '2026-11', status: 'approved', sceneVersion: 2,
      assets: [{
        id: 'asset-cat', concept: 'cat', artVersion: 1, description: 'A cat with clear anatomy.',
        source: {provider: 'Runway', model: 'reviewed-model', jobId: 'reviewed-job',
          rights: {status: 'cleared', owner: 'Artist', license: 'CC BY 4.0'}},
        review: {visual: {status: 'approved', reviewer: 'Artist', reviewedAt: '2026-11-02'},
          language: {status: 'approved', reviewer: 'Language reviewer', reviewedAt: '2026-11-02', languages: ['en']},
          recognition: {participants: 3, recognized: 3, threshold: 0.8, method: 'Small learner check'}},
        files: {mobile: {path: 'artwork/2026-11-review/asset-cat-mobile.png'},
          desktop: {path: 'artwork/2026-11-review/asset-cat-desktop.png'}}
      }]
    }]
  };
  const resolved = resolveArtwork(approved, 'cat', {sceneVersion: 2, viewport: 'mobile'});
  assert.equal(resolved.asset.files.mobile.path, 'artwork/2026-11-review/asset-cat-mobile.png');
  const scene = SCENES[0];
  const artSvg = sceneSVG(scene, {artworkCatalog: approved, artworkViewport: 'mobile'});
  assert.match(artSvg, /data-artwork-state="approved"/);
  assert.match(artSvg, /data-artwork-id="asset-cat"/);
  assert.match(artSvg, /data-artwork-version="1"/);
  assert.match(artSvg, /data-artwork-batch="2026-11-review"/);
  assert.match(artSvg, /data-artwork-provenance=/);
  assert.equal((artSvg.match(/data-target=/g) || []).length, 12);
  assert.match(artSvg, /data-target="d1-cat"/);
  assert.equal(resolveArtwork(approved, 'cat', {sceneVersion: 1}).state, 'fallback');
  assert.match(sceneSVG(scene, {artworkCatalog: approved, artworkViewport: 'mobile'}), /data-artwork-state="approved"/);
  const staleSvg = sceneSVG(scene, {artworkCatalog: {...approved, batches: approved.batches.map(batch => ({...batch, sceneVersion: 1}))}, artworkViewport: 'mobile'});
  assert.match(staleSvg, /data-artwork-state="fallback"/);
  assert.match(staleSvg, /Artwork status: No approved artwork matches this scene version/);
  assert.doesNotMatch(staleSvg, /<image /);
  const malformedSvg = sceneSVG(scene, {artworkCatalog: {version: 1, batches: [{status: 'approved', sceneVersion: 2, assets: [{concept: 'cat'}]}]}});
  assert.match(malformedSvg, /data-artwork-state="fallback"/);
  assert.doesNotMatch(malformedSvg, /<image /);
});

test('approved artwork renders in browser at desktop and mobile widths; malformed and stale catalogs use procedural fallback', async t => {
  const {SCENES} = await import('../public/dlang/scenes.mjs');
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless: true});
  t.after(async () => {await browser.close();await new Promise(resolve => server.close(resolve));});
  const approved = fixture().manifest;
  const targetAsset = approved.assets.find(asset => asset.concept === 'cat');
  targetAsset.id = 'asset-cat';
  targetAsset.files.desktop.path = 'artwork/2026-11-review/asset-cat-desktop.png';
  targetAsset.files.mobile.path = 'artwork/2026-11-review/asset-cat-mobile.png';
  targetAsset.source.rights.owner = 'Reviewed artist';
  const catalog = {
    version: 1, status: 'available', batches: [{
      batchId: approved.batchId, month: approved.month, status: 'approved',
      sceneVersion: approved.sceneVersion, assets: [targetAsset]
    }]
  };
  const desktopPng = png(1200, 600);
  for (const width of [1280, 375]) {
    const context = await browser.newContext({viewport: {width, height: 812}});
    const page = await context.newPage();
    await page.route('**/dlang/artwork/**', route => route.fulfill({status: 200, contentType: 'image/png', body: desktopPng}));
    await page.goto(`${base}/dlang.html`);
    const viewport = width <= 600 ? 'mobile' : 'desktop';
    const responsePromise = page.waitForResponse(response => response.url().includes(`/asset-cat-${viewport}.png`));
    const rendered = await page.evaluate(async catalog => {
      const {SCENES, sceneSVG} = await import('/dlang/scenes.mjs');
      const host = document.createElement('div');
      host.id = 'fixture-scene';
      host.style.cssText = 'position:fixed;left:0;top:0;width:1000px;height:600px';
      host.innerHTML = sceneSVG(SCENES[0], {artworkCatalog: catalog});
      document.body.appendChild(host);
      const svg = host.querySelector('svg');
      const target = svg.querySelector('[data-target="d1-cat"]');
      const image = target.querySelector('image');
      const hitbox = target.querySelector('.hitbox');
      return {
        status: svg.getAttribute('data-artwork-state'),
        href: image.getAttribute('href'),
        artworkId: target.getAttribute('data-artwork-id'),
        artVersion: target.getAttribute('data-artwork-version'),
        batch: target.getAttribute('data-artwork-batch'),
        targetId: target.getAttribute('data-target'),
        hitboxWidth: hitbox.getAttribute('width'),
        hasProceduralFallback: !!target.querySelector('[data-artwork-fallback="procedural"]'),
        provenance: svg.querySelector('[data-artwork-provenance]')?.getAttribute('data-artwork-provenance')
      };
    }, catalog);
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    assert.equal(rendered.status, 'approved');
    assert.equal(rendered.href, `./dlang/artwork/2026-11-review/asset-cat-${viewport}.png`);
    assert.equal(rendered.artworkId, 'asset-cat');
    assert.equal(rendered.artVersion, '1');
    assert.equal(rendered.batch, '2026-11-review');
    assert.equal(rendered.targetId, 'd1-cat');
    assert.equal(rendered.hitboxWidth, SCENES[0].targets.find(target => target.concept === 'cat').box[2].toString());
    assert.equal(rendered.hasProceduralFallback, true);
    const provenance = JSON.parse(rendered.provenance);
    assert.equal(provenance.provider, 'Runway');
    assert.equal(provenance.model, targetAsset.source.model);
    assert.equal(provenance.jobId, targetAsset.source.jobId);
    assert.equal(provenance.rights.owner, 'Reviewed artist');
    assert.equal(provenance.rights.license, 'CC BY 4.0');
    assert.equal(provenance.visualReview.reviewer, 'Visual reviewer');
    assert.equal(provenance.languageReview.reviewer, 'Language reviewer');
    const fallbacks = await page.evaluate(async catalog => {
      const {SCENES, sceneSVG} = await import('/dlang/scenes.mjs');
      const scene = SCENES[0];
      return [
        {label: 'malformed', source: {version: 9, batches: []}},
        {label: 'stale', source: {...catalog, batches: catalog.batches.map(batch => ({...batch, sceneVersion: 1}))}}
      ].map(({label, source}) => {
        const svg = new DOMParser().parseFromString(sceneSVG(scene, {artworkCatalog: source}), 'image/svg+xml').documentElement;
        const target = svg.querySelector('[data-target="d1-cat"]');
        return {
          label,
          state: svg.getAttribute('data-artwork-state'),
          reason: svg.getAttribute('data-artwork-reason'),
          hasImage: !!target.querySelector('image'),
          hasProcedural: !!target.querySelector('path'),
          target: target.getAttribute('data-target'),
          hotspots: svg.querySelectorAll('[data-target]').length,
          statusDescription: svg.querySelector('desc')?.textContent
        };
      });
    }, catalog);
    assert.equal(fallbacks[0].state, 'unavailable');
    assert.match(fallbacks[0].reason, /missing or unsupported/);
    assert.equal(fallbacks[1].state, 'fallback');
    assert.match(fallbacks[1].reason, /scene version/);
    for (const fallback of fallbacks) {
      assert.equal(fallback.hasImage, false, fallback.label);
      assert.equal(fallback.hasProcedural, true, fallback.label);
      assert.equal(fallback.target, 'd1-cat', fallback.label);
      assert.equal(fallback.hotspots, 12, fallback.label);
      assert.match(fallback.statusDescription, /Artwork status:/);
    }
    await context.close();
  }
});
