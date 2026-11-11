import { emptyIdentity, migrateIdentity, validateIdentity, saveIdentity, IDENTITY_KEY, MAX_IMAGE_BYTES, resolveArtwork } from './identity.mjs';
import { readPractice, practiceStats } from './library.mjs';
export function mountPersonal({ storage, report }) {
  const $ = id => document.getElementById(id);
  let profile, address = '', artwork = {}, generation = 0;
  const key = () => address ? `${IDENTITY_KEY}:${address.toLowerCase()}` : IDENTITY_KEY;
  function render() {
    $('identity-name').value = profile.displayName; $('identity-ens').value = profile.ensName;
    $('identity-title').textContent = profile.displayName || artwork.ensName || (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Your observation notebook');
    $('identity-image').src = profile.avatar || artwork.avatar || './dlang/art/rabbit.svg';
    $('identity-image').hidden = false;
    const banner = profile.banner || artwork.banner;
    $('identity-banner').hidden = !banner;
    if (banner) $('identity-banner').src = banner; else $('identity-banner').removeAttribute('src');
    $('identity-wallet').textContent = address || 'Guest notebook · connect a wallet for ENS artwork';
    $('identity-links').textContent = artwork.ensName ? `ENS: ${artwork.ensName} · forward-resolved` : '';
    try {
      const stats = practiceStats(readPractice(storage));
      $('personal-stats').replaceChildren(...[
        ['Sessions today', `${stats.today} / 3`], ['Practice days', stats.days], ['Objects touched', stats.touched],
        ['Remembered', stats.remembered], ['Concepts explored', stats.concepts], ['Due for review', stats.due]
      ].map(([label, value]) => { const item = document.createElement('div'), count = document.createElement('strong'), title = document.createElement('span'); count.textContent = value; title.textContent = label; item.append(count, title); return item; }));
    } catch (error) { $('identity-status').textContent = error.message; }
  }
  function load() {
    profile = emptyIdentity();
    try { const raw = storage.getItem(key()); if (raw) profile = migrateIdentity(JSON.parse(raw)); }
    catch (error) { $('identity-status').textContent = `Profile could not be loaded: ${error.message}`; }
    render();
  }
  async function lookup() {
    const current = ++generation, wallet = address, name = $('identity-ens').value.trim();
    if (!wallet && !name) { $('identity-status').textContent = 'Connect a wallet or enter your ENS name.'; return; }
    $('identity-status').textContent = 'Resolving ENS artwork…';
    let provider;
    try {
      const { loadEthers } = await import('../vendor/decent-head/2.0.0/js/wallet.js');
      const { JsonRpcProvider, FetchRequest } = await loadEthers();
      const request = new FetchRequest('https://ethereum-rpc.publicnode.com'); request.timeout = 8000;
      provider = new JsonRpcProvider(request, 1, { staticNetwork: true });
      const result = await resolveArtwork(wallet, name, provider);
      if (current !== generation) return;
      artwork = result; render();
      $('identity-status').textContent = result.ensName ? 'ENS artwork loaded. Your own images override it.' : 'No primary ENS name found. You can load your own artwork.';
    } catch (error) { if (current === generation) $('identity-status').textContent = `ENS unavailable: ${error.message}`; }
    finally { provider?.destroy(); }
  }
  for (const field of ['avatar', 'banner']) {
    const input = $(field === 'avatar' ? 'identity-photo' : 'identity-banner-file');
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      const current = generation;
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES) throw Error('Choose a PNG/JPEG/WebP up to 192 KiB.');
        const bitmap = await createImageBitmap(file);
        const valid = bitmap.width <= 2048 && bitmap.height <= 2048; bitmap.close();
        if (!valid) throw Error('Maximum image size is 2048 × 2048.');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Image read failed.')); reader.readAsDataURL(file); });
        if (current !== generation) return;
        const next = validateIdentity({ ...profile, [field]: data });
        profile = saveIdentity(storage, next, key()); render();
        $('identity-status').textContent = 'Your image is saved in this browser.';
      } catch (error) { $('identity-status').textContent = error.message; }
      finally { input.value = ''; }
    };
    $(field === 'avatar' ? 'identity-remove-photo' : 'identity-remove-banner').onclick = () => {
      try { profile = saveIdentity(storage, { ...profile, [field]: '' }, key()); render(); $('identity-status').textContent = 'Using ENS artwork when available.'; }
      catch (error) { $('identity-status').textContent = error.message; }
    };
  }
  for (const field of ['image', 'banner']) $(`identity-${field}`).onerror = () => {
    const image = $(`identity-${field}`);
    if (field === 'image' && !image.src.endsWith('/dlang/art/rabbit.svg')) image.src = './dlang/art/rabbit.svg';
    else { image.removeAttribute('src'); image.hidden = true; }
    $('identity-status').textContent = 'Artwork could not be loaded. Load your own image or retry ENS.';
  };
  $('identity-form').onsubmit = event => {
    event.preventDefault();
    try { profile = saveIdentity(storage, { ...profile, displayName: $('identity-name').value, ensName: $('identity-ens').value }, key()); render(); $('identity-status').textContent = 'Profile saved in this browser.'; }
    catch (error) { $('identity-status').textContent = error.message; }
  };
  $('identity-resolve').onclick = lookup;
  $('identity-clear').onclick = () => {
    try { storage.removeItem(key()); artwork = {}; generation++; load(); $('identity-status').textContent = 'Profile cleared; practice records unchanged.'; }
    catch (error) { report(error.message); }
  };
  load();
  window.addEventListener('dlang:practice', render);
  return { async wallet(next) {
    generation++; address = next || ''; artwork = {}; load();
    if (address) await lookup();
  }, refresh: render };
}
