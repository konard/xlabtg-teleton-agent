# SEO assets

Search-engine discoverability baseline for Teleton Agent, delivered for
[issue #487](https://github.com/xlabtg/teleton-agent/issues/487).

| File | Purpose |
| ---- | ------- |
| [`sitemap.xml`](./sitemap.xml) | XML sitemap for the public website, docs, GitHub project, and the TON/crypto ecosystem the agent integrates with (TON, STON.fi, DeDust, TON DNS, NFT marketplaces). |
| [`robots.txt`](./robots.txt) | Crawl policy — allow public surfaces, disallow the private operator console, declare the sitemap. |

> **Deployment & automation** of this baseline is tracked in
> [issue #490](https://github.com/xlabtg/teleton-agent/issues/490).

## Canonical host

All URLs assume the canonical public host **`https://teletonagent.dev`**. If the
host changes, update it in `sitemap.xml`, `robots.txt`, and the meta tags in
[`web/index.html`](../web/index.html).

## Validation (automated)

Every change to these assets is validated automatically. The check is
**dependency-free** — it runs with nothing but Node, no `npm ci`:

```bash
npm run validate:seo   # validate the committed sitemap / robots / noindex
npm run test:seo       # unit tests for the validator itself
```

[`scripts/validate-seo.mjs`](../scripts/validate-seo.mjs) enforces that:

- `sitemap.xml` is **well-formed XML**, has a `<urlset>` root, at least one
  `<loc>`, absolute `http(s)` URLs, ISO `<lastmod>` dates and in-range
  `<priority>` values;
- `robots.txt` declares a `Sitemap:` directive on the canonical host and keeps
  the private console (`/api/`, `/setup`, `/login`) disallowed;
- [`web/index.html`](../web/index.html) keeps `noindex, nofollow` on the
  private operator console and carries a `<meta name="description">`;
- the sitemap and robots policy agree on the **canonical host**.

CI runs this on every PR that touches `seo/**`, `web/index.html`, or the
validator — see [`.github/workflows/seo-validate.yml`](../.github/workflows/seo-validate.yml).
A malformed sitemap therefore fails the build before it can ship.

## Deployment

These files describe the **public** site. The landing page itself lives in
[`site/`](../site/) (see [issue #491](https://github.com/xlabtg/teleton-agent/issues/491))
and ships its own root-level `robots.txt` / `sitemap.xml`; the assets here cover
the broader docs + TON/crypto ecosystem. To deploy these ecosystem assets to the
public host:

1. Run `npm run validate:seo` locally (CI also enforces this).
2. Copy `sitemap.xml` and `robots.txt` to the web root of the public host so
   they resolve at:
   - `https://teletonagent.dev/sitemap.xml`
   - `https://teletonagent.dev/robots.txt`
3. Submit the sitemap in [Google Search Console](https://search.google.com/search-console)
   and [Bing Webmaster Tools](https://www.bing.com/webmasters).
4. Verify the live endpoints return HTTP 200 with the expected content:
   ```bash
   curl -sSI https://teletonagent.dev/robots.txt | head -n 1
   curl -sS  https://teletonagent.dev/robots.txt
   curl -sS  https://teletonagent.dev/sitemap.xml | head -n 5
   ```

### Deployment checklist

- [ ] `https://teletonagent.dev/robots.txt` returns HTTP 200 with the correct
      `Sitemap:` directive
- [ ] `https://teletonagent.dev/sitemap.xml` returns HTTP 200 with valid XML
- [ ] Sitemap submitted to Google Search Console (indexed, error-free)
- [ ] Sitemap submitted to Bing Webmaster Tools
- [ ] `npm run validate:seo` passes in CI on every PR touching `seo/`

## What is intentionally NOT indexed

The Teleton Agent **operator WebUI** is a private, authenticated console. It is
served from this repository's [`web/`](../web/) app and:

- carries `<meta name="robots" content="noindex, nofollow">` in
  [`web/index.html`](../web/index.html), and
- has its `/api/`, `/setup`, and `/login` paths disallowed in `robots.txt`.

Indexing a private control plane would be a security and quality regression, so
SEO here means: **make the public site and docs discoverable, keep the private
console out of the index.**

## Regeneration workflow

When public website or documentation routes change:

1. Edit `sitemap.xml`:
   - add/remove `<url>` entries to match the live public routes;
   - bump the `<lastmod>` date of every changed entry to the edit date
     (`YYYY-MM-DD`);
   - keep the TON/crypto ecosystem links current with the integrations
     advertised in the [README](../README.md).
2. Update `robots.txt` if new private paths need to be kept out of the index.
3. If the canonical host changes, update it in `sitemap.xml`, `robots.txt`, and
   the meta tags in [`web/index.html`](../web/index.html) (see
   [Canonical host](#canonical-host)).
4. Run `npm run validate:seo` and `npm run test:seo` — both must pass.
5. Open a PR; the **SEO validation** workflow re-runs the same checks.
6. After merge, redeploy following the [Deployment](#deployment) steps and
   resubmit the sitemap in Search Console / Bing if routes changed materially.

> Long term, sitemap generation can be wired into the public site's build
> pipeline so route changes regenerate `sitemap.xml` automatically. Until then,
> the validator above guards against regressions on every PR.
