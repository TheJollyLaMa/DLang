'use strict';
const fs = require('node:fs');
const path = require('node:path');

const expectedVersion = '2.24.0';
const entry = require.resolve('livekit-client');
const packageRoot = path.resolve(path.dirname(entry), '..');
const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
if (metadata.version !== expectedVersion || path.basename(entry) !== 'livekit-client.umd.js') {
  throw Error(`Expected livekit-client ${expectedVersion} UMD entry.`);
}

const output = path.join(__dirname, '../public/dlang/vendor');
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(entry, path.join(output, `livekit-client-${expectedVersion}.umd.js`));
fs.copyFileSync(path.join(packageRoot, 'LICENSE'),
  path.join(__dirname, '../LICENSES/livekit-client-2.24.0-Apache-2.0.txt'));
