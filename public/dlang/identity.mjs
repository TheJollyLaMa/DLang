export const IDENTITY_KEY = 'dlang-personal-profile-v1';
export const MAX_IMAGE_BYTES = 192 * 1024;
const MAX_IMAGE_STRING = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;
export function emptyIdentity() { return { version: 2, displayName: '', ensName: '', avatar: '', banner: '' }; }
export function validateIdentity(input) {
  if (!input || input.version !== 2 || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !Object.hasOwn(emptyIdentity(), key))) throw Error('Invalid local profile.');
  const profile = emptyIdentity();
  for (const [field, limit] of [['displayName', 60], ['ensName', 100], ['avatar', MAX_IMAGE_STRING], ['banner', MAX_IMAGE_STRING]]) {
    if (typeof input[field] !== 'string' || input[field].length > limit) throw Error(`Invalid ${field}.`);
    profile[field] = input[field].trim();
  }
  if (profile.ensName && !/^[a-z0-9](?:[a-z0-9.-]{0,96}[a-z0-9])?\.eth$/i.test(profile.ensName)) throw Error('Enter an ASCII .eth name, not a URL.');
  for (const field of ['avatar', 'banner']) if (profile[field] && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profile[field])) throw Error('Use a local PNG, JPEG or WebP image only.');
  return profile;
}
export function imageURL(raw) {
  if (!raw) return '';
  if (raw.startsWith('ipfs://')) raw = `https://ipfs.io/ipfs/${raw.slice(7).replace(/^ipfs\//, '')}`;
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('ENS artwork must use HTTPS or IPFS.');
  return url.href;
}
export function migrateIdentity(input) {
  if (input?.version === 1) return validateIdentity({ ...emptyIdentity(), displayName: input.displayName || '', ensName: input.linksConsent ? input.ensName || '' : '', avatar: input.avatar || '' });
  return validateIdentity(input);
}
export function saveIdentity(storage, profile, key = IDENTITY_KEY) {
  const valid = validateIdentity(profile);
  storage.setItem(key, JSON.stringify(valid));
  return valid;
}
export async function resolveArtwork(address, name, provider) {
  const ensName = name || await provider.lookupAddress(address);
  if (!ensName) return { ensName: '', avatar: '', banner: '' };
  const owner = await provider.resolveName(ensName);
  if (!owner || address && owner.toLowerCase() !== address.toLowerCase()) throw Error('ENS name does not resolve to the connected wallet.');
  const resolver = await provider.getResolver(ensName);
  if (!resolver) throw Error('ENS resolver unavailable.');
  const [avatar, banner, header] = await Promise.all([resolver.getAvatar(), resolver.getText('banner'), resolver.getText('header')]);
  return { ensName, avatar: imageURL(typeof avatar === 'string' ? avatar : avatar?.url || ''), banner: imageURL(banner || header || '') };
}

export async function resolveContributorCredit(credit, contributorWallet, provider) {
  if (typeof contributorWallet !== 'string' || !/^0x[0-9a-f]{40}$/i.test(contributorWallet)) {
    throw Error('Connect a valid contributor wallet before verifying public credit.');
  }
  if (typeof credit !== 'string') throw Error('Enter a wallet address or ASCII .eth name for public credit.');
  const supplied = credit.trim();
  let resolved, kind;
  if (/^0x[0-9a-f]{40}$/i.test(supplied)) {
    resolved = supplied; kind = 'wallet';
  } else {
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,96}[a-z0-9])?\.eth$/i.test(supplied)
      || supplied.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-'))) {
      throw Error('Enter a wallet address or ASCII .eth name, not a nickname or URL.');
    }
    if (!provider || BigInt((await provider.getNetwork()).chainId) !== 1n) {
      throw Error('Ethereum mainnet ENS resolution is required to verify public credit.');
    }
    resolved = await provider.resolveName(supplied.toLowerCase()); kind = 'ens';
    if (!resolved || !/^0x[0-9a-f]{40}$/i.test(resolved)) throw Error('ENS credit has no valid wallet resolution.');
  }
  if (resolved.toLowerCase() !== contributorWallet.toLowerCase()) {
    throw Error('Public credit must resolve to the signing contributor wallet.');
  }
  return { kind, credit: supplied.toLowerCase(), wallet: contributorWallet.toLowerCase() };
}
