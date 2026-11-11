import { PRACTICE_KEY, readPractice, validatePractice } from './library.mjs';
import { digest } from './storage.mjs';
export function mountStorage({ ipfs, storage, openDialog }) {
  const $ = id => document.getElementById(id);
  const status = text => { $('storage-status').textContent = text; };
  $('storage-provider').value = ipfs.settings.provider; $('storage-api').value = ipfs.settings.api; $('storage-gateway').value = ipfs.settings.gateway;
  $('storage-open').onclick = () => openDialog('storage-dialog');
  $('storage-form').onsubmit = async event => {
    event.preventDefault();
    try {
      ipfs.configure({ provider: $('storage-provider').value, api: $('storage-api').value, gateway: $('storage-gateway').value }, $('storage-token').value);
      $('storage-token').value = ''; status('Checking provider…'); status((await ipfs.check()).detail);
    } catch (error) { status(error.message); }
  };
  $('storage-check').onclick = async () => { try { status('Checking provider…'); status((await ipfs.check()).detail); } catch (error) { status(error.message); } };
  $('storage-backup').onclick = async () => {
    $('storage-backup').disabled = true;
    try {
      const backup = new Blob([JSON.stringify({ version: 1, practice: readPractice(storage) })], { type: 'application/json' });
      status('Publishing practice history to public IPFS…');
      const receipt = await ipfs.upload(backup, 'dlang-practice-backup.json');
      $('storage-cid').value = receipt.cid;
      status(`Pinned ${receipt.uri}; checking gateway bytes…`);
      const recovered = await ipfs.read(receipt.cid);
      if (await digest(recovered) !== receipt.sha256) throw Error(`Pinned ${receipt.uri}, but gateway bytes do not match. Do not treat this as a verified backup.`);
      status(`Verified public backup: ${receipt.uri} · SHA-256 ${receipt.sha256}. Save the CID to recover on another device. No profile image, private key or voice draft included.`);
    } catch (error) { status(`Backup incomplete: ${error.message}`); }
    finally { $('storage-backup').disabled = false; }
  };
  $('storage-restore').onclick = async () => {
    try {
      if (storage.getItem('dlang-practice-active-v1')) throw Error('Finish your active practice before restoring records.');
      status('Reading public practice backup…');
      const blob = await ipfs.read($('storage-cid').value.trim());
      const data = JSON.parse(await blob.text());
      if (data.version !== 1) throw Error('Unsupported backup version.');
      const practice = validatePractice(data.practice);
      const existing = readPractice(storage);
      if (existing.attempts.length && JSON.stringify(existing) !== JSON.stringify(practice)) throw Error('This browser already has different practice records. Export/clear them before replacing; no records were overwritten.');
      storage.setItem(PRACTICE_KEY, JSON.stringify(practice));
      window.dispatchEvent(new StorageEvent('storage', { key: PRACTICE_KEY }));
      status('Practice restored. Reload to continue; imported records remain editable, not financial evidence.');
      window.dispatchEvent(new Event('dlang:practice'));
    } catch (error) { status(`Restore refused: ${error.message}`); }
  };
  status(ipfs.status.detail);
}
