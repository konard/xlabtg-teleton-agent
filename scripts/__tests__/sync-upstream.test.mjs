// Unit tests for the fork-sync reporter. Uses Node's built-in test runner so the
// check stays dependency-free: `node --test scripts/__tests__/`.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyPath,
  classifyConflicts,
  intersectConflicts,
  formatReport,
  OWNERSHIP_RULES,
} from '../sync-upstream.mjs'

// --- classifyPath ---------------------------------------------------------

test('classifyPath prefers UPSTREAM for core runtime paths', () => {
  assert.equal(classifyPath('src/agent/client.ts').owner, 'upstream')
  assert.equal(classifyPath('src/memory/search/index.ts').owner, 'upstream')
  assert.equal(classifyPath('packages/sdk/src/types.ts').owner, 'upstream')
})

test('classifyPath prefers FORK for fork-owned feature paths', () => {
  assert.equal(classifyPath('web/src/pages/Dashboard.tsx').owner, 'fork')
  assert.equal(classifyPath('src/services/tts.ts').owner, 'fork')
  assert.equal(classifyPath('src/providers/groq/stt.ts').owner, 'fork')
  assert.equal(classifyPath('src/webui/routes/groq.ts').owner, 'fork')
  assert.equal(classifyPath('improvements/notes.md').owner, 'fork')
})

test('classifyPath marks known shared files as HYBRID', () => {
  for (const p of [
    'package.json',
    'package-lock.json',
    'src/config/schema.ts',
    'src/config/configurable-keys.ts',
    'src/webui/server.ts',
    'src/agent/runtime.ts',
    'src/agent/token-usage.ts',
    'src/agent/hooks/user-hook-evaluator.ts',
    'web/src/lib/api.ts',
    'web/src/pages/Config.tsx',
    'vitest.config.ts',
    '.github/workflows/ci.yml',
  ]) {
    assert.equal(classifyPath(p).owner, 'hybrid', `${p} should be hybrid`)
  }
})

test('classifyPath falls back to HYBRID for unrecognised paths', () => {
  const r = classifyPath('src/some/brand-new-area/thing.ts')
  assert.equal(r.owner, 'hybrid')
  assert.equal(r.rule, 'default')
})

test('classifyPath: more specific HYBRID rule wins over the FORK web/ prefix', () => {
  // web/src/lib/api.ts is under web/ (fork) but is explicitly a hybrid file —
  // first-match-wins ordering must put the hybrid rule first.
  assert.equal(classifyPath('web/src/lib/api.ts').owner, 'hybrid')
  assert.equal(classifyPath('web/package.json').owner, 'hybrid')
  // …while a plain web/ component still resolves to fork.
  assert.equal(classifyPath('web/src/components/Layout.tsx').owner, 'fork')
})

test('classifyPath always returns a known owner and a reason', () => {
  for (const p of ['a', 'b/c', 'src/x.ts', 'README.md', '.github/workflows/x.yml']) {
    const r = classifyPath(p)
    assert.ok(['fork', 'upstream', 'hybrid'].includes(r.owner))
    assert.equal(typeof r.reason, 'string')
    assert.ok(r.reason.length > 0)
  }
})

test('every ownership rule declares a valid owner and matcher', () => {
  for (const rule of OWNERSHIP_RULES) {
    assert.ok(['fork', 'upstream', 'hybrid'].includes(rule.owner))
    assert.equal(typeof rule.match, 'function')
    assert.equal(typeof rule.id, 'string')
  }
})

// --- classifyConflicts ----------------------------------------------------

test('classifyConflicts groups paths into the three buckets', () => {
  const buckets = classifyConflicts([
    'src/agent/client.ts', // upstream
    'web/src/pages/Dashboard.tsx', // fork
    'package.json', // hybrid
    'src/agent/runtime.ts', // hybrid
  ])
  assert.deepEqual(
    buckets.upstream.map((x) => x.path),
    ['src/agent/client.ts']
  )
  assert.deepEqual(
    buckets.fork.map((x) => x.path),
    ['web/src/pages/Dashboard.tsx']
  )
  assert.deepEqual(
    buckets.hybrid.map((x) => x.path),
    ['package.json', 'src/agent/runtime.ts']
  )
})

test('classifyConflicts sorts paths within buckets and never mutates input', () => {
  const input = ['src/memory/b.ts', 'src/agent/a.ts']
  const buckets = classifyConflicts(input)
  assert.deepEqual(
    buckets.upstream.map((x) => x.path),
    ['src/agent/a.ts', 'src/memory/b.ts']
  )
  assert.deepEqual(input, ['src/memory/b.ts', 'src/agent/a.ts'])
})

test('classifyConflicts on an empty list yields empty buckets', () => {
  const buckets = classifyConflicts([])
  assert.deepEqual(buckets, { fork: [], upstream: [], hybrid: [] })
})

// --- intersectConflicts ---------------------------------------------------

test('intersectConflicts returns only files changed on both sides, sorted & deduped', () => {
  const upstream = ['b.ts', 'a.ts', 'shared.ts', 'shared.ts']
  const fork = ['shared.ts', 'c.ts', 'a.ts']
  assert.deepEqual(intersectConflicts(upstream, fork), ['a.ts', 'shared.ts'])
})

test('intersectConflicts returns empty when there is no overlap', () => {
  assert.deepEqual(intersectConflicts(['a.ts'], ['b.ts']), [])
})

// --- formatReport ---------------------------------------------------------

test('formatReport reports a clean state when not behind', () => {
  const md = formatReport({
    mergeBase: 'abc123',
    ahead: 1347,
    behind: 0,
    conflicts: [],
  })
  assert.match(md, /up to date/)
  assert.match(md, /behind upstream by:\*\* 0/)
  // No conflict tables when there is nothing to sync.
  assert.doesNotMatch(md, /Conflict surface/)
})

test('formatReport renders divergence and per-bucket conflict tables', () => {
  const md = formatReport({
    mergeBase: '3fd5732',
    ahead: 1347,
    behind: 206,
    generatedAt: '2026-06-14',
    conflicts: ['src/agent/client.ts', 'web/src/pages/Dashboard.tsx', 'package.json'],
  })
  assert.match(md, /behind upstream by:\*\* 206/)
  assert.match(md, /ahead of upstream by:\*\* 1347/)
  assert.match(md, /Merge-base:\*\* `3fd5732`/)
  assert.match(md, /Conflict surface — 3 file\(s\)/)
  assert.match(md, /### Prefer UPSTREAM — 1 file\(s\)/)
  assert.match(md, /### Prefer FORK — 1 file\(s\)/)
  assert.match(md, /### Manual merge \(HYBRID\) — 1 file\(s\)/)
  assert.match(md, /`src\/agent\/client\.ts`/)
  assert.match(md, /Generated:\*\* 2026-06-14/)
  // The resolution playbook is always appended when there is work to do.
  assert.match(md, /git checkout --theirs/)
  assert.match(md, /git checkout --ours/)
})

test('formatReport shows "_None._" for an empty bucket', () => {
  const md = formatReport({
    mergeBase: 'x',
    ahead: 1,
    behind: 1,
    conflicts: ['src/agent/client.ts'], // upstream only
  })
  // FORK and HYBRID buckets are empty here.
  assert.match(md, /### Prefer FORK — 0 file\(s\)\n\n_None\._/)
})
