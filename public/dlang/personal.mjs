import { emptyIdentity, validateIdentity, identityLinks, saveIdentity, IDENTITY_KEY, MAX_IMAGE_BYTES } from './identity.mjs';
export function mountPersonal({ storage, report }) {
  const $ = id => document.getElementById(id);
  let profile = emptyIdentity(), image = '';
  function render() {
    $('identity-name').value = profile.displayName; $('identity-ens').value = profile.ensName; $('identity-discord').value = profile.discordId;
    $('identity-consent').checked = profile.linksConsent;
    image = profile.avatar;
    $('identity-title').textContent = profile.displayName || 'Your observation notebook';
    $('identity-image').src = image || './dlang/art/rabbit.svg';
    $('identity-image').alt = image ? 'Your chosen local profile image — not an identity verification' : 'White rabbit notebook guide';
    $('identity-links').replaceChildren(...identityLinks(profile).map(({ label, url }) => {
      const link = document.createElement('a'); link.textContent = label; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      return link;
    }));
  }
  try {
    const raw = storage.getItem(IDENTITY_KEY);
    if (raw) { profile = validateIdentity(JSON.parse(raw)); $('identity-remember').checked = true; }
  } catch { $('identity-status').textContent = 'Local profile unavailable or invalid. No external lookup or identity verification attempted.'; }
  render();
  $('identity-image').onerror = () => {
    if (image) { image = ''; $('identity-image').src = './dlang/art/rabbit.svg'; $('identity-status').textContent = 'Image could not be decoded; using the local rabbit. Your identity is not verified.'; }
  };
  $('identity-photo').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES) throw Error('Choose a local PNG/JPEG/WebP up to 192 KiB. No SVG, remote image or upload.');
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 2048 || bitmap.height > 2048) { bitmap.close(); throw Error('Image dimensions must be at most 2048×2048.'); }
      bitmap.close();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      validateIdentity({ ...emptyIdentity(), avatar: data });
      image = data; $('identity-image').src = data;
      $('identity-status').textContent = 'Local preview only. Save explicitly to keep this image; nothing uploaded.';
    } catch (error) { $('identity-status').textContent = error.message || 'Image unavailable.'; }
    finally { event.target.value = ''; }
  };
  $('identity-form').onsubmit = event => {
    event.preventDefault();
    try {
      const candidate = validateIdentity({ version: 1, displayName: $('identity-name').value, ensName: $('identity-ens').value, discordId: $('identity-discord').value, avatar: image, linksConsent: $('identity-consent').checked });
      profile = saveIdentity(storage, candidate, $('identity-remember').checked);
      render();
      $('identity-status').textContent = $('identity-remember').checked ? 'Saved only in this browser by consent. Links are self-entered, not ownership verified. No external request.' : 'Kept only in this tab; any browser profile copy removed. No external request.';
    } catch (error) { $('identity-status').textContent = `${error.message} Not saved; any prior browser copy is unchanged.`; }
  };
  $('identity-consent').onchange = () => {
    if ($('identity-consent').checked) return;
    profile = { ...profile, ensName: '', discordId: '', linksConsent: false };
    $('identity-links').replaceChildren(); $('identity-ens').value = ''; $('identity-discord').value = '';
    try { saveIdentity(storage, profile, $('identity-remember').checked); $('identity-status').textContent = 'Link consent withdrawn. Personal links removed from memory and this browser copy.'; }
    catch { $('identity-status').textContent = 'Links removed from memory. Browser storage unavailable: remove any old copy in browser settings.'; }
  };
  $('identity-clear').onclick = () => {
    profile = emptyIdentity(); $('identity-remember').checked = false; render();
    try { storage.removeItem(IDENTITY_KEY); $('identity-status').textContent = 'Personal profile cleared. Weekly attempts and ungraded stories are unchanged.'; }
    catch { $('identity-status').textContent = 'Tab profile cleared; browser storage unavailable. Remove any older copy in browser settings.'; }
    report('Personal profile cleared; no wallet, scoring or financial authority changed.');
  };
  $('identity-remove-photo').onclick = () => {
    image = ''; $('identity-image').src = './dlang/art/rabbit.svg';
    $('identity-status').textContent = 'Image removed from this draft. Save explicitly to update any browser copy.';
  };
}
