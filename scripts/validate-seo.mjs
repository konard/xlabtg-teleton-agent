#!/usr/bin/env node
// SEO baseline validator for Teleton Agent.
//
// Validates the deployable SEO assets so a broken sitemap, robots policy, or a
// missing `noindex` on the private console can never reach production:
//   - seo/sitemap.xml   — well-formed XML + valid <urlset>/<loc> semantics
//   - seo/robots.txt     — declares the sitemap, keeps the private console out
//   - web/index.html     — the private operator console stays noindex
//   - host consistency   — every asset agrees on the canonical public host
//
// Zero runtime dependencies on purpose: the CI step gated on `seo/` changes
// must run with nothing but Node, no `npm ci`. The pure functions are exported
// for the unit tests in scripts/__tests__/validate-seo.test.mjs.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CANONICAL_HOST = 'https://teletonagent.dev'

// Paths the robots policy must keep out of the index (the private console).
export const REQUIRED_DISALLOW = ['/api/', '/setup', '/login']

// ---------------------------------------------------------------------------
// XML well-formedness
// ---------------------------------------------------------------------------

const NAME_START = /[A-Za-z_:]/
const NAME_CHAR = /[A-Za-z0-9_:.-]/
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/

function checkText(text, errors, where) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '<') {
      errors.push(`unescaped '<' in ${where}`)
      return
    }
    if (ch === '&') {
      if (!ENTITY.test(text.slice(i))) {
        errors.push(`malformed entity (unescaped '&') in ${where}`)
        return
      }
    }
  }
}

/**
 * Validate XML well-formedness with a single-pass tokenizer. Returns
 * `{ valid, errors, root }`. Handles the XML declaration, comments, CDATA,
 * DOCTYPE, processing instructions, elements (open/close/self-close),
 * attributes (quote balancing + duplicate detection) and entity escaping —
 * everything the sitemap format relies on.
 */
export function validateXml(input) {
  const errors = []
  let src = input
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1) // strip BOM

  const stack = []
  let root = null
  let i = 0
  const n = src.length

  // Optional XML declaration must be the very first thing (after whitespace).
  const lead = src.slice(0, i)
  if (lead.trim().length > 0) errors.push('content before XML declaration')

  while (i < n) {
    const ch = src[i]
    if (ch !== '<') {
      // Text node: only allowed inside an element.
      let j = i
      while (j < n && src[j] !== '<') j++
      const text = src.slice(i, j)
      if (text.trim().length > 0) {
        if (stack.length === 0) {
          errors.push('text content outside the root element')
        } else {
          checkText(text, errors, `<${stack[stack.length - 1]}>`)
        }
      }
      i = j
      continue
    }

    // Markup starting at '<'.
    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end === -1) {
        errors.push('unterminated processing instruction / declaration')
        break
      }
      i = end + 2
      continue
    }

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end === -1) {
        errors.push('unterminated comment')
        break
      }
      if (src.slice(i + 4, end).includes('--')) {
        errors.push("'--' is not allowed inside a comment")
      }
      i = end + 3
      continue
    }

    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end === -1) {
        errors.push('unterminated CDATA section')
        break
      }
      i = end + 3
      continue
    }

    if (src.startsWith('<!', i)) {
      // DOCTYPE or other declaration — skip to matching '>'.
      const end = src.indexOf('>', i)
      if (end === -1) {
        errors.push('unterminated declaration')
        break
      }
      i = end + 1
      continue
    }

    // Closing tag </name>
    if (src.startsWith('</', i)) {
      let j = i + 2
      let name = ''
      while (j < n && NAME_CHAR.test(src[j])) name += src[j++]
      while (j < n && /\s/.test(src[j])) j++
      if (src[j] !== '>') {
        errors.push(`malformed closing tag </${name}`)
        break
      }
      if (name === '') {
        errors.push('empty closing tag name')
      } else if (stack.length === 0) {
        errors.push(`unexpected closing tag </${name}> (no open element)`)
      } else if (stack[stack.length - 1] !== name) {
        errors.push(`mismatched closing tag: expected </${stack[stack.length - 1]}>, got </${name}>`)
        stack.pop()
      } else {
        stack.pop()
      }
      i = j + 1
      continue
    }

    // Opening or self-closing tag <name ...>
    let j = i + 1
    if (j >= n || !NAME_START.test(src[j])) {
      errors.push("invalid tag: '<' not followed by a valid element name")
      break
    }
    let name = ''
    while (j < n && NAME_CHAR.test(src[j])) name += src[j++]

    const seenAttrs = new Set()
    let selfClose = false
    let closed = false
    while (j < n) {
      while (j < n && /\s/.test(src[j])) j++
      if (src[j] === '>') {
        closed = true
        j++
        break
      }
      if (src.startsWith('/>', j)) {
        selfClose = true
        closed = true
        j += 2
        break
      }
      // Attribute name
      if (!NAME_START.test(src[j])) {
        errors.push(`invalid attribute name in <${name}>`)
        closed = true
        break
      }
      let attr = ''
      while (j < n && NAME_CHAR.test(src[j])) attr += src[j++]
      while (j < n && /\s/.test(src[j])) j++
      if (src[j] !== '=') {
        errors.push(`attribute '${attr}' in <${name}> is missing a value`)
        closed = true
        break
      }
      j++
      while (j < n && /\s/.test(src[j])) j++
      const quote = src[j]
      if (quote !== '"' && quote !== "'") {
        errors.push(`attribute '${attr}' in <${name}> value is not quoted`)
        closed = true
        break
      }
      j++
      const valStart = j
      while (j < n && src[j] !== quote) {
        if (src[j] === '<') errors.push(`unescaped '<' in attribute '${attr}' of <${name}>`)
        j++
      }
      if (j >= n) {
        errors.push(`unterminated attribute value for '${attr}' in <${name}>`)
        closed = true
        break
      }
      checkText(src.slice(valStart, j), errors, `attribute '${attr}' of <${name}>`)
      j++ // closing quote
      if (seenAttrs.has(attr)) errors.push(`duplicate attribute '${attr}' in <${name}>`)
      seenAttrs.add(attr)
    }

    if (!closed) {
      errors.push(`unterminated tag <${name}>`)
      break
    }

    if (root !== null && stack.length === 0) {
      errors.push(`multiple root elements (found a second <${name}> at the document root)`)
    }
    if (root === null) root = name
    if (!selfClose) stack.push(name)
    i = j
  }

  if (stack.length > 0) {
    errors.push(`unclosed element(s): ${stack.map((s) => `<${s}>`).join(', ')}`)
  }
  if (root === null) errors.push('no root element found')

  return { valid: errors.length === 0, errors, root }
}

// ---------------------------------------------------------------------------
// Sitemap semantics
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Extract all `<loc>` URLs from a sitemap (assumes well-formed XML). */
export function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1])
}

/**
 * Validate the sitemap body: well-formed XML, a <urlset> root, at least one
 * <loc>, absolute http(s) <loc> URLs, ISO <lastmod> dates and sane <priority>.
 */
export function validateSitemap(xml) {
  const errors = []
  const { valid, errors: xmlErrors, root } = validateXml(xml)
  if (!valid) return { valid: false, errors: xmlErrors.map((e) => `XML: ${e}`) }

  if (root !== 'urlset') errors.push(`root element must be <urlset>, got <${root}>`)

  const locs = extractLocs(xml)
  if (locs.length === 0) errors.push('sitemap contains no <loc> entries')
  for (const loc of locs) {
    if (!/^https?:\/\//.test(loc)) errors.push(`<loc> is not an absolute http(s) URL: ${loc}`)
  }

  for (const m of xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)) {
    if (!ISO_DATE.test(m[1])) errors.push(`<lastmod> is not an ISO date (YYYY-MM-DD): ${m[1]}`)
  }

  for (const m of xml.matchAll(/<priority>\s*([^<]+?)\s*<\/priority>/g)) {
    const p = Number(m[1])
    if (Number.isNaN(p) || p < 0 || p > 1) errors.push(`<priority> must be between 0.0 and 1.0: ${m[1]}`)
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/** Validate robots.txt declares the sitemap and disallows the private console. */
export function validateRobots(txt, { host = CANONICAL_HOST } = {}) {
  const errors = []
  const lines = txt
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)

  const sitemap = lines.find((l) => /^sitemap:/i.test(l))
  if (!sitemap) {
    errors.push('robots.txt is missing a "Sitemap:" directive')
  } else {
    const url = sitemap.split(/:\s*/).slice(1).join(':').trim()
    if (!url.startsWith(host)) errors.push(`Sitemap directive host mismatch: expected ${host}, got ${url}`)
    if (!/\/sitemap\.xml$/.test(url)) errors.push(`Sitemap directive should point to /sitemap.xml: ${url}`)
  }

  if (!lines.some((l) => /^user-agent:/i.test(l))) errors.push('robots.txt is missing a "User-agent:" line')

  const disallows = lines
    .filter((l) => /^disallow:/i.test(l))
    .map((l) => l.split(/:\s*/).slice(1).join(':').trim())
  for (const path of REQUIRED_DISALLOW) {
    if (!disallows.some((d) => d === path || d === path.replace(/\/$/, ''))) {
      errors.push(`robots.txt must disallow the private console path: ${path}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// web/index.html — the private operator console
// ---------------------------------------------------------------------------

/** Ensure the private operator console is kept out of the search index. */
export function validateConsoleHtml(html) {
  const errors = []
  const robotsMeta = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i)
  if (!robotsMeta) {
    errors.push('web/index.html is missing a <meta name="robots"> tag')
  } else {
    const content = robotsMeta[1].toLowerCase()
    if (!content.includes('noindex')) errors.push('private console must declare robots "noindex"')
    if (!content.includes('nofollow')) errors.push('private console must declare robots "nofollow"')
  }
  if (!/<meta\s+name=["']description["']/i.test(html)) {
    errors.push('web/index.html is missing a <meta name="description"> tag')
  }
  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Run every SEO check against the given file contents. */
export function validateAll({ sitemap, robots, consoleHtml, host = CANONICAL_HOST }) {
  const results = [
    { name: 'seo/sitemap.xml', ...validateSitemap(sitemap) },
    { name: 'seo/robots.txt', ...validateRobots(robots, { host }) },
    { name: 'web/index.html', ...validateConsoleHtml(consoleHtml) },
  ]

  // Host consistency across sitemap + robots.
  const hostErrors = []
  if (!extractLocs(sitemap).some((l) => l.startsWith(host))) {
    hostErrors.push(`sitemap has no <loc> on the canonical host ${host}`)
  }
  results.push({ name: 'host consistency', valid: hostErrors.length === 0, errors: hostErrors })

  return { valid: results.every((r) => r.valid), results }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function runCli() {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '..')
  const read = (p) => readFileSync(join(repoRoot, p), 'utf8')

  const { valid, results } = validateAll({
    sitemap: read('seo/sitemap.xml'),
    robots: read('seo/robots.txt'),
    consoleHtml: read('web/index.html'),
  })

  for (const r of results) {
    if (r.valid) {
      console.log(`✓ ${r.name}`)
    } else {
      console.error(`✗ ${r.name}`)
      for (const e of r.errors) console.error(`    - ${e}`)
    }
  }

  if (!valid) {
    console.error('\nSEO validation failed.')
    process.exit(1)
  }
  console.log('\nAll SEO checks passed.')
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli()
}
