// Quick standalone test for the parent-dir symlink fix logic
// Tests the resolveNearestAncestor logic in pure Node.js

import { existsSync, realpathSync, symlinkSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, basename, resolve, relative } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// Replicate the resolveNearestAncestor logic
function resolveNearestAncestor(p) {
  if (existsSync(p)) {
    return realpathSync(p);
  }
  const parent = dirname(p);
  if (parent === p) return p;
  const resolvedParent = resolveNearestAncestor(parent);
  return resolve(resolvedParent, basename(p));
}

const WORKSPACE_ROOT = mkdtempSync(tmpdir() + '/teleton-workspace-test-');
console.log('Workspace:', WORKSPACE_ROOT);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS:', name);
    passed++;
  } catch (e) {
    console.log('  FAIL:', name, '-', e.message);
    failed++;
  }
}

function assertThrows(fn, msgContains) {
  try {
    fn();
    throw new Error('Expected error but none thrown');
  } catch (e) {
    if (msgContains && !e.message.includes(msgContains)) {
      throw new Error(`Expected error containing "${msgContains}" but got: "${e.message}"`);
    }
  }
}

function validatePath(inputPath, allowCreate = false) {
  let absolutePath = resolve(WORKSPACE_ROOT, inputPath);
  const relativePath = relative(WORKSPACE_ROOT, absolutePath);
  if (relativePath.startsWith('..') || relativePath.startsWith('/')) {
    throw new Error(`Access denied: outside workspace`);
  }

  const resolvedPath = resolveNearestAncestor(absolutePath);
  const resolvedRelative = relative(WORKSPACE_ROOT, resolvedPath);

  if (resolvedRelative.startsWith('..') || resolvedRelative.startsWith('/')) {
    throw new Error(`Access denied: resolves outside workspace via symlink`);
  }

  return resolvedPath;
}

// Test 1: regular file within workspace
writeFileSync(WORKSPACE_ROOT + '/regular.txt', 'hello');
test('regular file passes validation', () => {
  const result = validatePath('regular.txt');
  if (!result.includes('regular.txt')) throw new Error('wrong path');
});

// Test 2: non-existent file within workspace (allowCreate)
test('non-existent file within workspace passes with allowCreate', () => {
  validatePath('new-file.txt', true);
});

// Test 3: path traversal is rejected
test('path traversal rejected', () => {
  assertThrows(() => validatePath('../../etc/passwd'), 'outside workspace');
});

// Test 4: parent-dir symlink pointing outside workspace
const evilDir = WORKSPACE_ROOT + '/evil-dir';
symlinkSync('/etc', evilDir);
test('parent-dir symlink to /etc is rejected', () => {
  assertThrows(() => validatePath('evil-dir/passwd', true), 'via symlink');
});
rmSync(evilDir, { force: true });

// Test 5: parent-dir symlink to /tmp is rejected
const evilTmpDir = WORKSPACE_ROOT + '/evil-tmp';
symlinkSync('/tmp', evilTmpDir);
test('parent-dir symlink to /tmp is rejected', () => {
  assertThrows(() => validatePath('evil-tmp/injected.txt', true), 'via symlink');
});
rmSync(evilTmpDir, { force: true });

// Test 6: deep path through valid dir but with symlink ancestor
mkdirSync(WORKSPACE_ROOT + '/legit');
symlinkSync('/etc', WORKSPACE_ROOT + '/legit/escape');
test('symlink nested inside real dir is rejected', () => {
  assertThrows(() => validatePath('legit/escape/passwd', true), 'via symlink');
});
rmSync(WORKSPACE_ROOT + '/legit/escape', { force: true });
rmSync(WORKSPACE_ROOT + '/legit', { recursive: true, force: true });

// Test 7: normal subdir access passes
mkdirSync(WORKSPACE_ROOT + '/subdir');
writeFileSync(WORKSPACE_ROOT + '/subdir/file.txt', 'content');
test('normal subdir access passes', () => {
  validatePath('subdir/file.txt');
});

// Cleanup
rmSync(WORKSPACE_ROOT, { recursive: true, force: true });

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
