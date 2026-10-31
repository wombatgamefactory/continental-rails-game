// Generates the route-map.js module of each engine from its route-map.json:
//   src/engine/data/route-map.js        (Continental Rails)
//   src/engine-pr2e/data/route-map.js   (Pacific Rails, second edition)
//
// Why both files exist: a browser cannot `import` a JSON file everywhere
// without import assertions, and Node cannot `fetch` a local file. Each engine
// therefore imports the ES module, identically in Node, in the page and in a
// Web Worker. The JSON stays as the readable, swappable source.
//
// Usage (from the repo folder):
//   node tools/build-route-map-module.mjs          # both engines
//   node tools/build-route-map-module.mjs pr2e     # the second edition only
//   node tools/build-route-map-module.mjs continental
// The current map is route map v3 (35 cities, 65 routes, 134 slots). The two
// engines each keep their own copy of the JSON; the copies must stay identical
// (tests/rules-data.test.mjs checks that, and that each module agrees with its JSON).
// To swap the map: replace both route-map.json files, run this script, run `npm test`.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const continentalHeader = [
  '// GENERATED FILE - do not edit by hand.',
  '// Source: src/engine/data/route-map.json',
  '// Regenerate with: node tools/build-route-map-module.mjs',
  '//',
  '// Board: 600 x 350 mm (board.w, board.h). Cities: id, name, x, y (mm on the',
  '// board), role ("w" = west start city, "e" = east start city, "" = inland',
  '// city). Routes: a, b (city ids), terrain (one letter per slot from a to b:',
  '// G = Ground, T = Tunnel, B = Bridge, W = wild slot, any built tile fits),',
  '// slots (x, y, angle for the UI), line (whether the art draws a black line),',
  '// bow. Also: slot {l, w, outline}, city_r, city_style, labels (where the art',
  '// puts each city name).',
  '',
].join('\n');

const pr2eHeader = [
  '// GENERATED FILE - do not edit by hand.',
  '// Source: src/engine-pr2e/data/route-map.json (route map v3)',
  '// Regenerate with: node tools/build-route-map-module.mjs pr2e',
  '//',
  '// Cities: id, name, x, y (mm on the 600 x 350 board), role ("w" = west',
  '// start city, "e" = east start city, "" = inland city).',
  '// Routes: a, b (city ids), terrain (one letter per slot from a to b:',
  '// G = Ground, T = Tunnel, B = Bridge, W = wild slot: any built tile fits),',
  '// slots (x, y, angle, type for the UI), line (whether the art draws a black',
  '// line between the cities), bow. Also: labels (where the art puts each city',
  '// name), city_style, slot size (l, w, outline).',
  '',
].join('\n');

const targets = {
  continental: { dir: join(here, '..', 'src', 'engine', 'data'), header: continentalHeader },
  pr2e: { dir: join(here, '..', 'src', 'engine-pr2e', 'data'), header: pr2eHeader },
};

const wanted = process.argv.slice(2);
for (const name of wanted) {
  if (!targets[name]) {
    process.stderr.write(`unknown target "${name}" (use continental or pr2e)\n`);
    process.exit(2);
  }
}

for (const name of wanted.length ? wanted : Object.keys(targets)) {
  const { dir, header } = targets[name];
  const data = JSON.parse(readFileSync(join(dir, 'route-map.json'), 'utf8'));
  const body = `export const ROUTE_MAP = ${JSON.stringify(data, null, 1)};\n`;
  writeFileSync(join(dir, 'route-map.js'), (header + body).replace(/\r\n/g, '\n'), 'utf8');
  process.stdout.write(
    `${name}: route-map.js written: ${data.cities.length} cities, ${data.routes.length} routes\n`,
  );
}
