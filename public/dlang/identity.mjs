export const IDENTITY_KEY = 'dlang-personal-profile-v1';
export const MAX_IMAGE_BYTES = 192 * 1024;
const MAX_IMAGE_STRING = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;
export function emptyIdentity() {
  return { version: 1, displayName: '', ensName: '', discordId: '', avatar: '', linksConsent: false };
}
export function validateIdentity(input) {
  if (!input || input.version !== 1 || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(emptyIdentity(), key))) throw Error('Invalid local profile.');
  const profile = emptyIdentity();
  for (const [field, limit] of [['displayName', 60], ['ensName', 100], ['discordId', 20], ['avatar', MAX_IMAGE_STRING]]) {
    if (typeof input[field] !== 'string' || input[field].length > limit) throw Error(`Invalid ${field}.`);
    profile[field] = input[field].trim();
  }
  if (typeof input.linksConsent !== 'boolean') throw Error('Explicit link consent required.');
  profile.linksConsent = input.linksConsent;
  profile.ensName = profile.ensName.toLowerCase();
  if (profile.ensName && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.eth$/.test(profile.ensName)) throw Error('Use a simple ASCII .eth name; no URLs or unsupported name formats.');
  if (profile.discordId && !/^[0-9]{17,20}$/.test(profile.discordId)) throw Error('Discord user ID must contain 17–20 digits, not a token or password.');
  if ((profile.ensName || profile.discordId) && !profile.linksConsent) throw Error('Consent is required before keeping personal ENS or Discord links.');
  if (profile.avatar && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profile.avatar)) throw Error('Use a local PNG, JPEG or WebP image only.');
  return profile;
}
export function identityLinks(input) {
  const p = validateIdentity(input);
  if (!p.linksConsent) return [];
  return [
    ...(p.ensName ? [{ label: `${p.ensName} · self-entered, not verified`, url: `https://app.ens.domains/name/${encodeURIComponent(p.ensName)}` }] : []),
    ...(p.discordId ? [{ label: 'Discord profile · self-entered, not verified', url: `https://discord.com/users/${p.discordId}` }] : [])
  ];
}
export function saveIdentity(storage, profile, remember) {
  const valid = validateIdentity(profile);
  if (remember) storage.setItem(IDENTITY_KEY, JSON.stringify(valid));
  else storage.removeItem(IDENTITY_KEY);
  return valid;
}
