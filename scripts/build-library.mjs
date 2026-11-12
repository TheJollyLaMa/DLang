import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { YEAR_LIBRARY, LIBRARY_CONCEPTS, librarySVG } from '../public/dlang/library.mjs';
import { LEVELS } from '../public/dlang/curriculum.mjs';
const scenes = YEAR_LIBRARY.map(scene => ({ ...scene, svgSHA256: createHash('sha256').update(librarySVG(scene)).digest('hex') }));
fs.writeFileSync(new URL('../public/dlang/year-library.json', import.meta.url), JSON.stringify({
  version: 2, sceneVersion: 2, days: 365, sessionsPerDay: 3, generation: 'Original procedural SVG compositions; repeated themes and parameterized object designs, not individually commissioned paintings.',
  license: 'CC-BY-4.0', concepts: LIBRARY_CONCEPTS.length, designsPerConcept: 32,
  curriculum: LEVELS.map(({ id, title, kind, startDay, concepts }) => ({ id, title, kind, startDay, concepts })), scenes
}));
console.log(`Built ${scenes.length} original reproducible scene recipes and SVG checksums across ${LEVELS.length} curriculum levels.`);
