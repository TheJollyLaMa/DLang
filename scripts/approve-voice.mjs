import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateVoice, validateVoices, MAX_VOICE_BYTES } from '../public/dlang/audio.mjs';
import { createStorage, cid, digest } from '../public/dlang/storage.mjs';

export async function approveVoice({ metadataCID, reviewer, auditioned, ipfs, manifest }) {
  if (!auditioned || typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 100)
    throw Error('A named fluent reviewer must audition the recording and confirm pronunciation, attribution, native-speaker declaration and public CC BY 4.0 permission. Pass --auditioned only after that review.');
  const metadata = JSON.parse(await (await ipfs.read(cid(metadataCID), 16384)).text());
  validateVoice(metadata);
  const blob = await ipfs.read(metadata.cid, MAX_VOICE_BYTES);
  if (blob.size !== metadata.size || await digest(blob) !== metadata.sha256) throw Error('Audio bytes do not match the submitted metadata.');
  const voice = { ...metadata, metadataCID, approved: true, reviewedBy: reviewer.trim(), reviewedAt: new Date().toISOString() };
  const result = { version: 1, voices: [...validateVoices(manifest), voice] };
  validateVoices(result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const option = name => args[args.indexOf(name) + 1];
    if (!args.includes('--metadata-cid') || !args.includes('--reviewer')) throw Error('Usage: node scripts/approve-voice.mjs --metadata-cid CID --reviewer "Public reviewer credit" --auditioned');
    const file = new URL('../public/dlang/community-voices.json', import.meta.url);
    const ipfs = createStorage({ storage: { getItem: () => null }, signer: async () => { throw Error('Review never signs or uploads.'); } });
    const manifest = await approveVoice({ metadataCID: option('--metadata-cid'), reviewer: option('--reviewer'), auditioned: args.includes('--auditioned'), ipfs, manifest: JSON.parse(await fs.readFile(file, 'utf8')) });
    await fs.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
    console.log('Reviewed voice added locally. Run tests and publish the reviewed manifest to enable rotation.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
