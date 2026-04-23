import { openSync, writeSync, closeSync, constants, writeFileSync, symlinkSync, readFileSync, rmSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const dir = mkdtempSync(tmpdir() + '/test-nofollow-');
const realFile = dir + '/real.txt';
const symlink = dir + '/link.txt';

writeFileSync(realFile, 'original content');
symlinkSync(realFile, symlink);

// safeWriteFileSync logic
function safeWriteFileSync(path, content) {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW;
  const fd = openSync(path, flags, 0o666);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

let passed = 0, failed = 0;

// Test 1: write to regular file works
try {
  safeWriteFileSync(realFile, 'new content');
  const read = readFileSync(realFile, 'utf-8');
  if (read !== 'new content') throw new Error(`Expected 'new content', got '${read}'`);
  console.log('  PASS: safeWriteFileSync writes to regular file');
  passed++;
} catch (e) {
  console.log('  FAIL: safeWriteFileSync regular file -', e.message);
  failed++;
}

// Test 2: write through symlink throws (O_NOFOLLOW)
try {
  safeWriteFileSync(symlink, 'injected');
  console.log('  FAIL: O_NOFOLLOW should have thrown for symlink');
  failed++;
} catch (e) {
  if (e.code === 'ELOOP' || e.code === 'ENOTSUP') {
    console.log('  PASS: O_NOFOLLOW threw', e.code, 'for symlink');
    passed++;
  } else {
    console.log('  FAIL: unexpected error code', e.code, e.message);
    failed++;
  }
}

rmSync(dir, { recursive: true, force: true });
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
