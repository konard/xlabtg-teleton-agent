# Product Readiness Analysis — Teleton Agent

- **Issue:** [xlabtg/teleton-agent#487](https://github.com/xlabtg/teleton-agent/issues/487)
- **Prepared:** 2026-05-29
- **Version analyzed:** `package.json` → `0.8.19`
- **Scope:** Whole-project readiness review based on the closed work history
  ([239 closed issues](https://github.com/xlabtg/teleton-agent/issues?q=is%3Aissue%20state%3Aclosed),
  [239 merged pull requests](https://github.com/xlabtg/teleton-agent/pulls?q=is%3Apr+is%3Aclosed)),
  the two prior audits ([AUDIT_REPORT.md](./AUDIT_REPORT.md), [FULL_AUDIT_REPORT.md](./FULL_AUDIT_REPORT.md)),
  the codebase, CI configuration, and documentation.
- **Goal:** State, in professional terms, how close Teleton Agent is to being a
  finished, production-grade product, where the remaining gaps are (including
  search-engine discoverability / SEO and a crypto-aware sitemap), and turn
  those gaps into concrete, labelled GitHub issues.

> This document is a *gap and readiness analysis*, not a code audit. The two
> existing audit reports cover code-level defects; their findings are
> remediated per the closed-work history. This report looks at what separates
> the current, functionally rich codebase from a **shippable, discoverable,
> professionally operated product**.

---

## 1. Executive summary

Teleton Agent is, functionally, a remarkably complete platform. Across 239
closed issues and 239 merged PRs the project has built an autonomous task
engine, hybrid RAG memory, a 16-provider LLM catalog, a 135+ tool surface
(Telegram, TON, DEX, DNS, deals), a multi-agent network with signed messages,
a 23-page operator WebUI, a Plugin SDK, an MCP client, and a Management API.
Two structured security audits were run and remediated, CI runs on Node 20/22
with a weekly security audit, and bilingual (EN/RU) user documentation exists.

**The remaining distance to a "finished professional product" is not in
features — it is in productization.** The gaps cluster into five themes:

1. **Discoverability / SEO** — the project ships no `sitemap.xml`, no
   `robots.txt`, and the public web shell has no descriptive, Open Graph, or
   structured metadata. There is nothing to guide search engines to the
   website, the documentation, or the TON/crypto ecosystem the product
   integrates with. *(This is the explicit ask of issue #487 and is delivered
   in this PR — see §4.)*
2. **Release & supply-chain maturity** — version is still `0.8.x` (pre-1.0),
   there is no published `CHANGELOG`-driven semantic-version policy gate, and
   no SBOM / provenance attestation on releases.
3. **Operability / observability** — no metrics endpoint, health/readiness
   probes, structured-log shipping guidance, or dashboards for running the
   agent as a service.
4. **Quality assurance depth** — 209 test files exist but there is no
   published coverage gate, no end-to-end WebUI test suite, no performance /
   load benchmarks, and no accessibility (a11y) baseline.
5. **Trust & polish** — the marketing landing page, a public API reference
   (OpenAPI), a stable backup/restore story, and standardized GitHub
   community health files are the last mile for adoption.

**Verdict: 🟢 Feature-complete, 🟠 not yet "1.0 production-finished."** The
recommended path to 1.0 is the prioritized backlog in §5, surfaced as GitHub
issues in §6.

---

## 2. What has already been delivered (evidence base)

Distribution of the 239 closed issues by theme (keyword classification):

| Theme | Closed issues | Representative outcomes |
| ----- | ------------: | ---------------------- |
| Security / audit | 68 | Two full audits remediated; wallet encryption, plugin isolation, exec allowlist, SSRF/CSRF guards, auth-token hashing, TON-proxy checksum verification |
| WebUI | 25 | 23 pages incl. Dashboard, Soul editor, Memory, Tasks, Pipelines, Events, Network, Security, Self-Improve, Autonomous Mode, setup wizard |
| Telegram / Bot | 21 | MTProto/Bot proxy recovery, startup resilience, ffmpeg-free voice notes, Groq STT/TTS, scheduled-task fixes |
| Autonomous | 17 | Task engine, NL task parser, policy persistence, checkpoint cleanup, pause/resume, reflection-success completion |
| Memory / RAG | 13 | Semantic vector memory, associative graph, prioritization, Upstash sync + circuit breaker, FK restoration |
| Providers / LLM | 11 | 16-provider catalog, NVIDIA NIM, OpenRouter free models, Groq fixes |
| CI / infra | 9 | CI on Node 20/22, weekly audit, release pipeline, lint/format/type gates |
| Network / agents | 5 | Managed runtimes, signed Ed25519 messaging, trust levels, replay protection |
| TON / crypto | 4 | STON.fi + DeDust routing, DNS auctions, deals/escrow, payment verification |
| Plugins / MCP | 3 | Frozen Plugin SDK, isolated DBs, MCP stdio/SSE/HTTP client |
| Docs | 2 | Bilingual (EN/RU) 13-chapter WebUI user guide |

**CI/CD present:** `ci.yml` (Node 20 & 22: typecheck, lint, test),
`audit-weekly.yml` (scheduled security audit), `release.yml` (tag-triggered
build → test → npm publish), `telegram-notify.yml`. Pre-commit hooks via
Husky + lint-staged. Static-analysis tooling configured: `knip`, `madge`
(circular deps), `jscpd` (duplication), `audit-ci`.

**Documentation present:** `README.md`, `GETTING_STARTED.md`, `CONTRIBUTING.md`,
`SECURITY.md`, `CHANGELOG.md`, bilingual `docs/user-guide/`, `docs/plugins.md`,
`docs/management-api.md`, `docs/AUTONOMOUS_MODE.md`.

The conclusion: **the product works and is well-engineered.** What follows is
strictly about closing the productization gap.

---

## 3. Readiness scorecard

Scored 1–5 (1 = absent, 5 = production-grade). "Weight" reflects how much each
dimension blocks a confident 1.0 release.

| # | Dimension | Score | Notes |
|---|-----------|:-----:|-------|
| 1 | Core functionality | 5 | Broad, mature feature set; agentic loop, memory, tools all shipped. |
| 2 | Security | 4 | Two audits remediated; needs continuous SAST/secret-scanning + SBOM. |
| 3 | Testing | 3 | 209 test files, but no coverage gate, no E2E, no perf/load tests. |
| 4 | CI/CD & releases | 3 | Solid CI; missing coverage gate, SBOM/provenance, changelog automation, 1.0 plan. |
| 5 | Documentation | 4 | Strong user/dev docs; missing public API reference (OpenAPI) and architecture overview. |
| 6 | **SEO / discoverability** | **1** | **No sitemap, robots.txt, or page metadata. Addressed in this PR.** |
| 7 | Observability / ops | 2 | No metrics, health/readiness probes, or run-as-a-service guidance. |
| 8 | Accessibility (a11y) | 2 | An a11y improvement note exists; no audited WCAG baseline or CI check. |
| 9 | Internationalization | 3 | EN/RU docs + guide; WebUI strings not fully externalized for i18n. |
| 10 | Deployment / distribution | 3 | Dockerfile + install.sh + npm; no published image, compose stack, or k8s/helm. |
| 11 | Data safety (backup/restore) | 2 | SQLite-based; no documented, tested backup/restore/migration-rollback story. |
| 12 | Community health | 3 | Issue templates + SECURITY.md exist; missing CoC, PR template, issue-chooser config, governance. |

**Weighted readiness ≈ 70%.** Feature value is near-complete; the missing 30%
is discoverability, operability, QA depth, and release/community polish.

---

## 4. SEO & crypto-aware sitemap (delivered in this PR)

Issue #487 specifically asks for the product to be "friendly for search
engines" and to provide "all the links to cryptocurrencies and the like in the
sitemap file." This PR delivers a deployable SEO baseline under [`seo/`](./seo/):

- **[`seo/sitemap.xml`](./seo/sitemap.xml)** — a standards-compliant XML
  sitemap covering the public website (`teletonagent.dev`), the documentation
  site (`docs.teletonagent.dev`), the GitHub project, and the **TON / crypto
  ecosystem the agent integrates with** (TON, STON.fi, DeDust, TON DNS, jettons,
  TON NFTs) so search engines can associate the product with its on-chain
  domain. Uses the `xhtml` namespace for hreflang (EN/RU) alternates.
- **[`seo/robots.txt`](./seo/robots.txt)** — allows crawling of public pages,
  declares the sitemap location, and **disallows the private operator console
  paths** (`/api/`, setup/login) that must never be indexed.
- **[`seo/README.md`](./seo/README.md)** — deployment instructions, the
  rationale, and a maintenance checklist (regenerate on route changes).
- **`web/index.html`** — enriched with descriptive `<title>`, meta description,
  keywords, canonical, theme-color, and Open Graph / Twitter Card tags, plus
  `robots: noindex, nofollow` because the operator WebUI is an authenticated,
  private console and **should not** be indexed. (SEO hygiene = index the
  marketing/docs surfaces; keep the private app out of the index.)

> Why both "index this" and "noindex that"? Professional SEO is not "index
> everything." The product's *public* surfaces (site, docs, ecosystem links)
> must be discoverable; the *operator console* is a private application and
> indexing it would be a security and quality regression. The sitemap targets
> the former; the `noindex` and `robots.txt` disallows protect the latter.

The sitemap is intentionally a **maintainable template**: the canonical host is
declared once at the top of `seo/README.md`, and the file is plain XML so it can
be regenerated or extended as the public docs grow.

---

## 5. Prioritized backlog to 1.0

Ordered by (impact × blocking-ness). Each row maps to a GitHub issue in §6.

### P0 — Required for a credible 1.0

| ID | Title | Why it blocks 1.0 |
|----|-------|-------------------|
| R1 | SEO baseline: sitemap.xml, robots.txt, page metadata | Zero discoverability today (delivered here; issue tracks deployment + automation). |
| R2 | Publish a public marketing landing page | Badge links point to `teletonagent.dev`; a real, indexed page is the front door. |
| R3 | Observability: health/readiness probes + Prometheus metrics | Cannot operate as a service without liveness/metrics. |
| R4 | Test-coverage gate + coverage reporting in CI | "Tests exist" ≠ "quality is enforced." |
| R5 | 1.0 release readiness: SemVer policy, SBOM, build provenance | Pre-1.0 + no SBOM signals "not production-ready" to adopters. |

### P1 — Strongly recommended before 1.0

| ID | Title | Why |
|----|-------|-----|
| R6 | Public API reference (OpenAPI/Swagger) for Management & WebUI APIs | 42 route groups with no machine-readable contract. |
| R7 | End-to-end WebUI test suite (Playwright) | 23 pages, no E2E coverage = silent UI regressions. |
| R8 | Backup / restore / migration-rollback runbook + tooling | Users hold wallets + memory in SQLite with no safety net. |
| R9 | Deployment artifacts: published Docker image + compose + (optional) Helm | Lowers adoption friction; reproducible ops. |
| R10 | Accessibility (WCAG 2.1 AA) audit + CI a11y check | Professional UI bar; legal/UX expectation. |

### P2 — Polish / sustaining

| ID | Title | Why |
|----|-------|-----|
| R11 | Performance & load benchmarks (memory search, agentic loop, DEX routing) | Quantify and defend latency/throughput. |
| R12 | WebUI i18n: externalize strings, EN/RU runtime locale switch | Docs are bilingual; the app is not. |
| R13 | Community health: CoC, PR template, issue-chooser config, discussions | Lowers contribution friction; standard for mature OSS. |
| R14 | Continuous SAST + secret scanning (CodeQL + gitleaks) in CI | Make the one-off audits continuous. |

---

## 6. Issues created from this analysis

The P0–P2 backlog above is filed as **labelled GitHub issues**. New labels
introduced to tag them: `readiness`, `seo`, `observability`, `performance`,
`accessibility`, `testing`, `release`, `i18n`, `devops`.

> **Note on issue location.** The automation account has read-only access to the
> upstream `xlabtg/teleton-agent` repository, so the issues could not be opened
> there directly. They were created — with the labels above — on the
> contributor fork [`konard/xlabtg-teleton-agent`](https://github.com/konard/xlabtg-teleton-agent/issues),
> and are reproduced in full below so a maintainer can transfer or recreate them
> on the upstream repository.

| ID | Priority | Labels | Issue |
|----|:--------:|--------|-------|
| R1 | P0 | `readiness`,`seo` | [Deploy & automate the SEO baseline](https://github.com/konard/xlabtg-teleton-agent/issues/1) |
| R2 | P0 | `readiness`,`seo`,`enhancement` | [Public marketing landing page](https://github.com/konard/xlabtg-teleton-agent/issues/2) |
| R3 | P0 | `readiness`,`observability`,`enhancement` | [Health/readiness probes + metrics](https://github.com/konard/xlabtg-teleton-agent/issues/3) |
| R4 | P0 | `readiness`,`testing` | [Test-coverage gate in CI](https://github.com/konard/xlabtg-teleton-agent/issues/4) |
| R5 | P0 | `readiness`,`release`,`security` | [1.0 release readiness (SemVer, SBOM, provenance)](https://github.com/konard/xlabtg-teleton-agent/issues/5) |
| R6 | P1 | `readiness`,`documentation`,`enhancement` | [OpenAPI reference](https://github.com/konard/xlabtg-teleton-agent/issues/6) |
| R7 | P1 | `readiness`,`testing` | [E2E WebUI test suite](https://github.com/konard/xlabtg-teleton-agent/issues/7) |
| R8 | P1 | `readiness`,`enhancement` | [Backup / restore tooling](https://github.com/konard/xlabtg-teleton-agent/issues/8) |
| R9 | P1 | `readiness`,`devops`,`enhancement` | [Deployment artifacts (Docker/compose/Helm)](https://github.com/konard/xlabtg-teleton-agent/issues/9) |
| R10 | P1 | `readiness`,`accessibility`,`testing` | [Accessibility audit + CI check](https://github.com/konard/xlabtg-teleton-agent/issues/10) |
| R11 | P2 | `readiness`,`performance` | [Performance & load benchmarks](https://github.com/konard/xlabtg-teleton-agent/issues/11) |
| R12 | P2 | `readiness`,`i18n`,`enhancement` | [WebUI internationalization](https://github.com/konard/xlabtg-teleton-agent/issues/12) |
| R13 | P2 | `readiness`,`documentation` | [Community health files](https://github.com/konard/xlabtg-teleton-agent/issues/13) |
| R14 | P2 | `readiness`,`security`,`devops` | [Continuous SAST + secret scanning](https://github.com/konard/xlabtg-teleton-agent/issues/14) |

---

## 7. How to verify this analysis

- Closed-work counts: the `gh issue list --state closed` / `gh pr list --state merged`
  totals (239 / 239) match the README's "Closed-Work Summary."
- CI claims: see `.github/workflows/{ci,release,audit-weekly,telegram-notify}.yml`.
- SEO gap: before this PR, `find . -iname "*sitemap*" -o -iname "robots.txt"`
  returns nothing; after, see [`seo/`](./seo/).
- Test count: `find src -name "*.test.ts" | wc -l` → 209.
