# Public landing page (`teletonagent.dev`)

The public marketing/landing page for Teleton Agent, delivered for
[issue #491](https://github.com/xlabtg/teleton-agent/issues/491).

This is a **separate, public** static site. It is **not** the operator WebUI —
the operator console lives in [`web/`](../web/) and stays `noindex`.

## Contents

| File | Purpose |
| ---- | ------- |
| [`index.html`](./index.html) | English landing page (hero, features, quick start, ecosystem, SEO metadata, OG/Twitter cards, `SoftwareApplication` JSON-LD). |
| [`ru/index.html`](./ru/index.html) | Russian translation, linked via `hreflang`. |
| [`404.html`](./404.html) | Branded not-found page (served by GitHub Pages on unknown paths). |
| [`robots.txt`](./robots.txt) | Crawl policy for the landing host + sitemap declaration. |
| [`sitemap.xml`](./sitemap.xml) | Sitemap covering the pages this host actually serves. |
| [`CNAME`](./CNAME) | Custom domain for GitHub Pages (`teletonagent.dev`). |
| [`assets/`](./assets/) | Logos, SVG favicon, and the 1200×630 Open Graph image. |

The broader ecosystem sitemap/robots (docs + TON/crypto links) lives in
[`/seo`](../seo/).

## Design

- Single static HTML/CSS page per language, **zero build dependencies**.
- CSS is inlined for a single request; one small inline script powers the
  "copy install command" buttons. The page works fully without JavaScript.
- Dark theme using the TON brand blue (`#0098EA`).

## Local preview

```bash
# from the repository root
python3 -m http.server 8080 --directory site
# then open http://localhost:8080/
```

## Deployment

The page deploys to **GitHub Pages** via
[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) on every push to
`main` that touches `site/**`. To go live on the custom domain:

1. In the repository settings, enable **Pages → Source: GitHub Actions**.
2. Set the custom domain to `teletonagent.dev` (the [`CNAME`](./CNAME) file does
   this automatically once Pages is enabled) and add the DNS records that
   GitHub provides.
3. Wait for the certificate to provision, then verify:
   ```bash
   curl -sI https://teletonagent.dev/ | head -n1
   curl -s  https://teletonagent.dev/robots.txt
   ```

GitHub Pages can equally be swapped for Vercel or Cloudflare Pages — point the
host's web root at this `site/` directory.

## Maintenance

- Keep highlights (135+ tools, 16 LLM providers, 23 WebUI pages) and the
  `softwareVersion` in the JSON-LD in sync with the [README](../README.md) and
  [`package.json`](../package.json).
- Bump the `<lastmod>` dates in [`sitemap.xml`](./sitemap.xml) on content changes.
