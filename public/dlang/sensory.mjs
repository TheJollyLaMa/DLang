import { digest } from './storage.mjs';

export function validateSensoryCatalog(catalog) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.assets) || catalog.assets.length > 2000) throw Error('Sensory catalog is invalid.');
  const ids = new Set();
  for (const asset of catalog.assets) {
    if (!asset || !/^[a-z0-9-]+$/.test(asset.id) || ids.has(asset.id) || !['sound', 'image'].includes(asset.kind)
      || !/^[a-z][a-z0-9-]*$/.test(asset.concept) || !['draft', 'approved', 'withdrawn'].includes(asset.status)
      || typeof asset.label !== 'string' || !asset.label.trim() || asset.label.length > 150
      || !/^sensory\/[a-z0-9/-]+\.(mp3|png)$/.test(asset.path) || asset.path.includes('..')
      || asset.kind === 'sound' && !asset.path.endsWith('.mp3') || asset.kind === 'image' && !asset.path.endsWith('.png')
      || asset.preview && (!/^sensory\/[a-z0-9/-]+\.webp$/.test(asset.preview.path) || asset.preview.path.includes('..'))
      || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 2 * 1024 * 1024
      || !asset.source?.provider || !asset.source.model || !asset.source.prompt
      || asset.kind === 'sound' && (!Number.isFinite(asset.seconds) || asset.seconds <= 0 || asset.seconds > 5)
      || asset.status === 'approved' && (!asset.review?.recognition || !asset.review?.rights || !asset.review?.reviewedBy)) {
      throw Error('Sensory asset has invalid provenance, review or media metadata.');
    }
    ids.add(asset.id);
  }
  return catalog.assets;
}

export async function mountSensory({ root, audio, report, getBlocked = () => false, fetchImpl = globalThis.fetch }) {
  let assets = [], player = null, mediaURL = '', generation = 0, live = false;
  root.innerHTML = `<h2>Sensory library</h2>
    <p>Optional sound cues and gentle motion. AI-generated effects are not spoken words or pronunciation examples. Images and sounds awaiting recognition/rights review are previews only, not approved lesson replacements.</p>
    <label><input data-sensory-motion type="checkbox"> Gentle scene motion (off by default)</label>
    <p>Motion respects your device's reduced-motion preference. No flashes, generated video downloads or automatic sound.</p>
    <label>Saved sensory candidate <select data-sensory-choice aria-label="Saved sensory candidate"></select></label>
    <button data-sensory-play disabled>Preview selected sound</button><button data-sensory-stop>Stop sound</button>
    <p data-sensory-status role="status">Loading the reusable library...</p>
    <div data-sensory-gallery></div>`;
  const $ = selector => root.querySelector(selector);
  const motion = $('[data-sensory-motion]'), choice = $('[data-sensory-choice]'), play = $('[data-sensory-play]');
  const status = text => { $('[data-sensory-status]').textContent = text; };
  function stop() {
    generation++;
    player?.pause(); player = null;
    if (mediaURL) URL.revokeObjectURL(mediaURL);
    mediaURL = '';
  }
  function refresh() {
    const blocked = getBlocked() || live || document.hidden;
    document.documentElement.dataset.sensoryMotion = String(motion.checked && !blocked);
    play.disabled = blocked || !assets.some(asset => asset.id === choice.value && asset.kind === 'sound' && asset.status !== 'withdrawn');
    motion.disabled = blocked;
    if (blocked) stop();
  }
  motion.onchange = refresh;
  choice.onchange = refresh;
  $('[data-sensory-stop]').onclick = () => { stop(); status('Sound stopped.'); };
  play.onclick = async () => {
    stop();
    if (getBlocked() || live || document.hidden) { refresh(); return; }
    const asset = assets.find(item => item.id === choice.value && item.kind === 'sound' && item.status !== 'withdrawn');
    if (!asset) { status('No sound is available for this selection.'); return; }
    audio.stopNarration();
    const own = generation;
    try {
      const response = await fetchImpl(`./dlang/${asset.path}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`Sound HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size !== asset.bytes || await digest(blob) !== asset.sha256) throw Error('Sound integrity check failed.');
      if (own !== generation || getBlocked() || live) return;
      mediaURL = URL.createObjectURL(new Blob([blob], { type: 'audio/mpeg' }));
      player = new Audio(mediaURL); player.volume = 0.3;
      player.onended = () => { if (own === generation) stop(); };
      player.onerror = () => { if (own === generation) { stop(); status('Sound could not be decoded.'); } };
      await player.play();
      if (own !== generation) return;
      status(`${asset.label} · ${asset.source.provider} generated · ${asset.status === 'approved' ? 'reviewed cue' : 'preview; human recognition and rights review pending'}.`);
    } catch (error) { if (own === generation) { stop(); status(error.message); report(error.message); } }
  };
  window.addEventListener('dlang:audio-start', stop);
  window.addEventListener('dlang:private-audio', event => { live = event.detail.active; refresh(); });
  window.addEventListener('dlang:panel', () => { stop(); refresh(); });
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', refresh);
  try {
    const response = await fetchImpl('./dlang/sensory-catalog.json', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`Sensory catalog HTTP ${response.status}`);
    assets = validateSensoryCatalog(await response.json());
    for (const asset of assets.filter(item => item.kind === 'sound' && item.status !== 'withdrawn')) {
      choice.add(new Option(`${asset.label} · ${asset.status}`, asset.id));
    }
    for (const asset of assets.filter(item => item.kind === 'image' && item.status !== 'withdrawn')) {
      const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption');
      image.src = `./dlang/${asset.preview?.path || asset.path}`; image.alt = `${asset.concept}: AI-generated candidate, recognition review pending`;
      image.loading = 'lazy'; image.width = 240; image.height = 135; image.style.maxWidth = '100%';
      caption.textContent = `${asset.label} · ${asset.status} · not in lesson rotation`;
      figure.append(image, caption); $('[data-sensory-gallery]').append(figure);
    }
    status(assets.length ? `${assets.length} saved assets. Choose a sound to preview; nothing plays automatically.` : 'No generated assets imported yet. Existing illustrations remain in use.');
  } catch (error) { status(`Sensory library unavailable: ${error.message}`); report(error.message); }
  refresh();
  return { refresh, stop,
    hasConcept: concept => assets.some(asset => asset.kind === 'sound' && asset.concept === concept && asset.status !== 'withdrawn'),
    previewConcept(concept) {
      if (getBlocked() || live || document.hidden) { report('Scene sound unavailable during scored practice, private audio or a hidden page.'); return; }
      const asset = assets.find(item => item.kind === 'sound' && item.concept === concept && item.status !== 'withdrawn');
      if (!asset) { report('No saved sound candidate for this object.'); return; }
      choice.value = asset.id; refresh(); play.click();
      report(`${asset.label} preview requested. AI-generated cue, not pronunciation; human recognition review pending.`);
    }
  };
}
