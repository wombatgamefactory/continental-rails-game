// tmp.mjs - temporary files for tests, safe to run twice at the same moment.
//
// Every test that writes files uses a folder of its own, made with fs.mkdtemp under the
// OPERATING SYSTEM's temp folder (never a fixed name inside the repository). Two runs
// overlapping in time therefore never share a file, and a file-sync tool, which
// briefly locks a file it has just seen written, cannot get in the way of a clean-up.
//
// Clean-up is best effort: a folder that cannot be removed after a few short retries is
// left for the operating system to clear. A failed clean-up never fails a test.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Blocks the thread for a few milliseconds (the callers are synchronous test set-up and tear-down). */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Retries a file operation a few times while a lock (EPERM, EBUSY, EACCES) is held; returns true on success. */
function retrying(operation, tries = 6, delayMs = 60) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      operation();
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return true; // already gone
      if (attempt === tries) return false;
      pause(delayMs * attempt);
    }
  }
  return false;
}

/** A new empty folder under the operating system's temp folder, named for the prefix and this process. */
export function makeTempDir(prefix = 'cr-test') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${process.pid}-`));
}

/** Removes a folder made by makeTempDir. Retries briefly, then gives up quietly. Returns whether it is gone. */
export function removeTempDir(dir) {
  return retrying(() => fs.rmSync(dir, { recursive: true, force: true }));
}

/** Removes one file, tolerating a lock. Returns whether it is gone. */
export function removeFile(file) {
  return retrying(() => fs.rmSync(file, { force: true }));
}

/**
 * Writes a file for a person to look at later (a screenshot, a log). The folder is created if need be.
 * A locked stale file is retried and then skipped with a note: evidence is never worth failing a run for.
 */
export function writeEvidence(file, data) {
  const ok = retrying(() => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  });
  if (!ok) process.stderr.write(`note: could not write ${file} (locked); skipped\n`);
  return ok;
}
