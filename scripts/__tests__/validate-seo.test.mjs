// Unit tests for the SEO validator. Uses Node's built-in test runner so the
// check stays dependency-free: `node --test scripts/__tests__/`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateXml,
  validateSitemap,
  validateRobots,
  validateConsoleHtml,
  validateAll,
  extractLocs,
  CANONICAL_HOST,
} from '../validate-seo.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(join(repoRoot, p), 'utf8')

// --- validateXml ----------------------------------------------------------

test('validateXml accepts well-formed XML', () => {
  assert.equal(validateXml('<a><b>x</b><c/></a>').valid, true)
})

test('validateXml accepts declaration, comments and attributes', () => {
  const xml = '<?xml version="1.0"?><!-- hi --><root a="1" b="2"><child/></root>'
  assert.equal(validateXml(xml).valid, true)
})

test('validateXml reports the root element name', () => {
  assert.equal(validateXml('<urlset><url/></urlset>').root, 'urlset')
})

test('validateXml rejects mismatched closing tags', () => {
  assert.equal(validateXml('<a><b></a></b>').valid, false)
})

test('validateXml rejects unclosed elements', () => {
  const r = validateXml('<a><b></a>')
  assert.equal(r.valid, false)
})

test('validateXml rejects multiple root elements', () => {
  assert.equal(validateXml('<a/><b/>').valid, false)
})

test('validateXml rejects unterminated comments', () => {
  assert.equal(validateXml('<a><!-- oops </a>').valid, false)
})

test('validateXml rejects unescaped ampersands in text', () => {
  assert.equal(validateXml('<a>tom & jerry</a>').valid, false)
  assert.equal(validateXml('<a>tom &amp; jerry</a>').valid, true)
})

test('validateXml rejects duplicate attributes', () => {
  assert.equal(validateXml('<a x="1" x="2"/>').valid, false)
})

test('validateXml rejects unquoted attribute values', () => {
  assert.equal(validateXml('<a x=1/>').valid, false)
})

// --- validateSitemap -------------------------------------------------------

test('validateSitemap accepts a minimal valid sitemap', () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    '<url><loc>https://teletonagent.dev/</loc><lastmod>2026-05-29</lastmod><priority>1.0</priority></url>' +
    '</urlset>'
  assert.equal(validateSitemap(xml).valid, true)
})

test('validateSitemap rejects a non-urlset root', () => {
  const r = validateSitemap('<noturlset><url><loc>https://x.dev/</loc></url></noturlset>')
  assert.equal(r.valid, false)
})

test('validateSitemap rejects relative loc URLs', () => {
  const r = validateSitemap('<urlset><url><loc>/features</loc></url></urlset>')
  assert.equal(r.valid, false)
})

test('validateSitemap rejects a malformed lastmod', () => {
  const r = validateSitemap('<urlset><url><loc>https://x.dev/</loc><lastmod>May 2026</lastmod></url></urlset>')
  assert.equal(r.valid, false)
})

test('validateSitemap rejects an out-of-range priority', () => {
  const r = validateSitemap('<urlset><url><loc>https://x.dev/</loc><priority>9</priority></url></urlset>')
  assert.equal(r.valid, false)
})

test('validateSitemap rejects an empty sitemap', () => {
  assert.equal(validateSitemap('<urlset></urlset>').valid, false)
})

test('validateSitemap surfaces XML errors', () => {
  const r = validateSitemap('<urlset><url></urlset>')
  assert.equal(r.valid, false)
  assert.ok(r.errors.some((e) => e.startsWith('XML:')))
})

// --- validateRobots --------------------------------------------------------

test('validateRobots accepts a compliant policy', () => {
  const txt = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /setup',
    'Disallow: /login',
    'Sitemap: https://teletonagent.dev/sitemap.xml',
  ].join('\n')
  assert.equal(validateRobots(txt).valid, true)
})

test('validateRobots rejects a missing Sitemap directive', () => {
  const txt = 'User-agent: *\nDisallow: /api/\nDisallow: /setup\nDisallow: /login'
  assert.equal(validateRobots(txt).valid, false)
})

test('validateRobots rejects a sitemap host mismatch', () => {
  const txt = 'User-agent: *\nDisallow: /api/\nDisallow: /setup\nDisallow: /login\nSitemap: https://evil.example/sitemap.xml'
  assert.equal(validateRobots(txt).valid, false)
})

test('validateRobots requires the private console to be disallowed', () => {
  const txt = 'User-agent: *\nAllow: /\nSitemap: https://teletonagent.dev/sitemap.xml'
  const r = validateRobots(txt)
  assert.equal(r.valid, false)
  assert.ok(r.errors.some((e) => e.includes('/api/')))
})

// --- validateConsoleHtml ---------------------------------------------------

test('validateConsoleHtml accepts a noindex console', () => {
  const html = '<meta name="robots" content="noindex, nofollow" /><meta name="description" content="x" />'
  assert.equal(validateConsoleHtml(html).valid, true)
})

test('validateConsoleHtml rejects a missing robots meta', () => {
  assert.equal(validateConsoleHtml('<meta name="description" content="x" />').valid, false)
})

test('validateConsoleHtml rejects an indexable console', () => {
  const html = '<meta name="robots" content="index, follow" /><meta name="description" content="x" />'
  assert.equal(validateConsoleHtml(html).valid, false)
})

test('validateConsoleHtml rejects a missing description', () => {
  assert.equal(validateConsoleHtml('<meta name="robots" content="noindex, nofollow" />').valid, false)
})

// --- extractLocs & validateAll --------------------------------------------

test('extractLocs returns trimmed URLs', () => {
  assert.deepEqual(extractLocs('<loc> https://a.dev/ </loc><loc>https://b.dev/</loc>'), [
    'https://a.dev/',
    'https://b.dev/',
  ])
})

test('validateAll fails when the sitemap has no loc on the canonical host', () => {
  const sitemap = '<urlset><url><loc>https://other.example/</loc></url></urlset>'
  const robots = 'User-agent: *\nDisallow: /api/\nDisallow: /setup\nDisallow: /login\nSitemap: https://teletonagent.dev/sitemap.xml'
  const consoleHtml = '<meta name="robots" content="noindex, nofollow" /><meta name="description" content="x" />'
  const r = validateAll({ sitemap, robots, consoleHtml })
  assert.equal(r.valid, false)
  assert.ok(r.results.find((x) => x.name === 'host consistency' && !x.valid))
})

// --- the real, shipped assets ----------------------------------------------

test('the committed SEO assets pass every check', () => {
  const r = validateAll({
    sitemap: read('seo/sitemap.xml'),
    robots: read('seo/robots.txt'),
    consoleHtml: read('web/index.html'),
    host: CANONICAL_HOST,
  })
  const failures = r.results.filter((x) => !x.valid)
  assert.deepEqual(
    failures,
    [],
    `expected committed assets to pass, got: ${JSON.stringify(failures, null, 2)}`,
  )
  assert.equal(r.valid, true)
})
