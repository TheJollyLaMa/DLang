'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

async function writeDurableJSON(filePath, value) {
  const pending = `${filePath}.pending`;
  const file = await fs.open(pending, 'w', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await fs.rename(pending, filePath);
  const directory = await fs.open(path.dirname(filePath), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
module.exports = { writeDurableJSON };
