// Generates src/engine/data/route-map.js from src/engine/data/route-map.json.
//
// Why both files exist: a browser cannot `import` a JSON file everywhere
// without import assertions, and Node cannot `fetch` a local file. The engine
// therefore imports the ES module, identically in Node, in the page and in a
// Web Worker. The JSON stays as the readable, swappable source.
//
// Usage (from the repo folder):  node tools/build-route-map-module.mjs
// To swap the map: replace route-map.json, run this script, run `npm test`
// (tests/rules-data.test.mjs checks that the two files agree).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'engine', 'data');
const jsonPath = join(dataDir, 'route-map.json');
const modulePath = join(dataDir, 'route-map.js');

const data = JSON.parse(readFileSync(jsonPath, 'utf8'));

const header = [
  '// GENERATED FILE - do not edit by hand.',
  '// Source: src/engine/data/route-map.json',
  '// Regenerate with: node tools/build-route-map-module.mjs',
  '//',
  '// Cities: id, name, x, y (mm on the 500 x 400 board), role ("w" = west',
  '// start city, "e" = east start city, "" = inland city).',
  '// Routes: a, b (city ids), terrain (one letter per slot from a to b:',
  '// G = Ground, T = Tunnel, B = Bridge), slots (x, y, angle for the UI).',
  '',
].join('\n');

const body = `export const ROUTE_MAP = ${JSON.stringify(data, null, 1)};\n`;
writeFileSync(modulePath, (header + body).replace(/\r\n/g, '\n'), 'utf8');

process.stdout.write(
  `route-map.js written: ${data.cities.length} cities, ${data.routes.length} routes\n`,
);
