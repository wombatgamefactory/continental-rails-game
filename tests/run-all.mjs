import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
// The suites of tests/ (Continental Rails and the contract-level suites), then the rule suites of
// Pacific Rails, second edition in tests/pr2e/.
const SUB_SUITES = ['pr2e'];
const files = [
  ...readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort(),
  ...SUB_SUITES.flatMap((sub) => readdirSync(join(dir, sub)).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `${sub}/${f}`)),
];
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
  if (r.status === 0) console.log(`PASS ${f}`);
  else { console.log(`FAIL ${f}`); failed++; }
}
console.log(`${files.length} suites, ${failed} failed`);
process.exit(failed ? 1 : 0);
