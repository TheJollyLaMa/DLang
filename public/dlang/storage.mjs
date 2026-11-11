export const SHARED_SERVICE = 'https://decentbusking.onrender.com';
const KEY = 'dlang-ipfs-settings-v1';
export function endpoint(value, local = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash
    || url.protocol !== 'https:' && !(local && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    throw Error('Use HTTPS, or HTTP for your local IPFS node only. No credentials in URLs.');
  return url.href.replace(/\/$/, '');
}
export function cid(value) {
  if (typeof value !== 'string' || !/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,120}|bafk[a-z2-7]{20,120})$/.test(value)) throw Error('Invalid IPFS CID.');
  return value;
}
export async function digest(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function createStorage({ storage, signer, fetchImpl = globalThis.fetch, origin = globalThis.location?.origin }) {
  let settings = { provider: 'shared', api: 'http://127.0.0.1:5001', gateway: 'https://ipfs.io/ipfs' }, token = '', status = { state: 'idle', detail: 'IPFS not checked yet.' };
  try { const raw = storage.getItem(KEY); if (raw) settings = validateSettings(JSON.parse(raw)); }
  catch (error) { status = { state: 'error', detail: `IPFS settings invalid: ${error.message}` }; }
  function validateSettings(value) {
    if (!['shared', 'pinata', 'local'].includes(value?.provider)) throw Error('Unknown IPFS provider.');
    return { provider: value.provider, api: endpoint(value.api, true), gateway: endpoint(value.gateway) };
  }
  async function request(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(20000), credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw Error(`IPFS request failed (${response.status}).`);
    return response;
  }
  async function check() {
    status = { state: 'pending', detail: 'Checking IPFS…' };
    try {
      if (settings.provider === 'shared') {
        const result = await (await request(`${SHARED_SERVICE}/health`)).json();
        if (result.ok !== true || result.ipfsProvider !== 'pinata') throw Error('Shared pinning service is not ready.');
        status = { state: 'ready', detail: 'Decent shared Pinata service reachable. Uploads require its configured mint-owner wallet signature, not contributor eligibility; other learners can use their own provider. No write has been tested by this health check.' };
      } else if (settings.provider === 'pinata') {
        if (!token) throw Error('Enter your Pinata JWT for this tab.');
        await request('https://api.pinata.cloud/data/testAuthentication', { headers: { Authorization: `Bearer ${token}` } });
        status = { state: 'ready', detail: 'Your Pinata credentials work. No content uploaded.' };
      } else {
        const result = await (await request(`${settings.api}/api/v0/version`, { method: 'POST' })).json();
        if (!result.Version) throw Error('Kubo version unavailable.');
        status = { state: 'ready', detail: `Your Kubo ${result.Version} is reachable. Browser CORS must allow this site.` };
      }
      return status;
    } catch (error) { status = { state: 'error', detail: error.message }; throw error; }
  }
  async function upload(blob, name) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > 2 * 1024 * 1024) throw Error('Public upload must be 1 byte to 2 MiB.');
    let url, headers = {}, network = false;
    if (settings.provider === 'shared') {
      const wallet = await signer();
      if (!wallet) throw Error('Connect an authorized wallet for shared pinning, or select your own provider.');
      const address = await wallet.getAddress(), issuedAt = new Date().toISOString();
      const body = { address, origin, name, size: blob.size, type: blob.type || 'application/octet-stream', issuedAt };
      const message = ['DecentBusking IPFS upload authorization', `Wallet: ${address.toLowerCase()}`, `Origin: ${origin}`, `File: ${name}`, `Size: ${blob.size}`, `Type: ${body.type}`, `Issued At: ${issuedAt}`].join('\n');
      body.signature = await wallet.signMessage(message);
      const result = await (await request(`${SHARED_SERVICE}/api/ipfs/upload-url`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
      url = result.url;
      const signed = new URL(url);
      if (signed.protocol !== 'https:' || !(signed.hostname === 'uploads.pinata.cloud' || signed.hostname.endsWith('.pinata.cloud')) || signed.username || signed.password) throw Error('Untrusted shared upload destination.');
      network = true;
    } else if (settings.provider === 'pinata') {
      if (!token) throw Error('Enter your Pinata JWT for this tab.');
      url = 'https://api.pinata.cloud/pinning/pinFileToIPFS'; headers.Authorization = `Bearer ${token}`;
    } else url = `${settings.api}/api/v0/add?cid-version=1&pin=true`;
    const form = new FormData(); form.append('file', blob, name); if (network) form.append('network', 'public');
    const result = await (await request(url, { method: 'POST', headers, body: form })).json();
    const value = cid(result.IpfsHash || result.Hash || result.data?.cid || result.cid);
    return { cid: value, sha256: await digest(blob), uri: `ipfs://${value}` };
  }
  async function read(value, max = 2 * 1024 * 1024) {
    const response = await request(`${settings.gateway}/${cid(value)}`);
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.length; if (size > max) throw Error('IPFS object exceeds the size limit.'); chunks.push(chunk); } }
    finally { await reader.cancel(); }
    return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
  }
  return { get settings() { return { ...settings }; }, get status() { return status; }, check, upload, read,
    configure(value, jwt = '') {
      const next = validateSettings(value);
      if (jwt && !/^[A-Za-z0-9._-]{20,4096}$/.test(jwt)) throw Error('Invalid JWT format.');
      storage.setItem(KEY, JSON.stringify(next)); settings = next; token = jwt; status = { state: 'idle', detail: 'Provider changed; check connection.' };
    }
  };
}
