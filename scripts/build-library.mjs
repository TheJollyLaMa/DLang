import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { YEAR_LIBRARY, librarySVG } from '../public/dlang/library.mjs';
const scenes = YEAR_LIBRARY.map(scene => ({ ...scene, svgSHA256: createHash('sha256').update(librarySVG(scene)).digest('hex') }));
fs.writeFileSync(new URL('../public/dlang/year-library.json', import.meta.url), JSON.stringify({
  version: 1, days: 365, sessionsPerDay: 3, generation: 'Original procedural SVG compositions; repeated themes and parameterized object designs, not individually commissioned paintings.',
  license: 'CC-BY-4.0', concepts: 36, designsPerConcept: 32, scenes
}));
console.log(`Built ${scenes.length} original reproducible scene recipes and SVG checksums.`);
