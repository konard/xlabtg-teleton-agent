# Accessibility (WCAG 2.1 AA)

The Teleton WebUI targets **WCAG 2.1 Level AA**. Accessibility is enforced
automatically: an [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm)
audit runs over **every** WebUI route on each pull request, and the build
**fails** on any `critical` or `serious` violation.

## Scope

The audit covers all 23 WebUI pages (22 authenticated routes plus the standalone
setup flow). Each page is loaded against a mocked backend and scanned with the
WCAG 2.1 A/AA rule set:

```
wcag2a, wcag2aa, wcag21a, wcag21aa
```

## CI gate

The [`accessibility`](../.github/workflows/accessibility.yml) workflow runs on
every pull request that touches `web/**`:

1. `npm ci`
2. `npx playwright install --with-deps chromium`
3. `npm run build`
4. `npm run test:a11y` — fails on any critical/serious violation

The machine-readable baseline (`web/a11y-report/baseline.json` and
`web/a11y-report/summary.md`) is uploaded as the `a11y-report` build artifact on
every run (including failures), so reviewers can inspect the full result set.

## Running locally

```bash
cd web
npm ci
npm run test:a11y:install   # one-time: install the Chromium browser
npm run build
npm run test:a11y
```

The audit serves the production build via `vite preview` and drives it with
Playwright. After a run, open `web/a11y-report/summary.md` for a human-readable
report or `web/a11y-report/baseline.json` for the raw data.

### Test determinism

Entrance/fade animations can cause axe to sample a colour mid-animation and
report a spurious `color-contrast` failure. The suite avoids this by:

- emulating `prefers-reduced-motion: reduce` (`page.emulateMedia`),
- injecting a stylesheet that zeroes all animation/transition durations, and
- fast-forwarding any remaining animations to their final frame
  (`document.getAnimations().forEach(a => a.finish())`)

before scanning. The same `prefers-reduced-motion` preference is also honoured in
the application stylesheet (`web/src/index.css`), satisfying WCAG 2.3.3 / 2.2.2.

## Fixes applied

| Area | Issue | Fix |
| ---- | ----- | --- |
| Active navigation link | `color-contrast` — accent `#5b8cff` on the blended soft-accent surface was 3.86:1 (below the 4.5:1 AA threshold) | Introduced `--accent-bright: #8fb0ff` (5.45:1) for the active nav item |
| Motion | Animations interfering with contrast and ignoring user motion preferences | Added a `prefers-reduced-motion: reduce` block that disables animations/transitions |

## Known / accepted advisory violations

These are **advisory** (`moderate`/`minor`) only — they do not block CI:

| Rule | Pages | Notes |
| ---- | ----- | ----- |
| `list` / `aria-required-children` | Memory, Network | The KnowledgeGraph legend (`.kg-legend`) renders a non-`<li>` child inside a list container. This is a visual legend, not interactive list content; tracked for a future refactor. |

## Lighthouse accessibility score

The acceptance target is a Lighthouse **accessibility score ≥ 85** on the main
dashboard. Measure it locally:

1. `cd web && npm run build && npm run preview`
2. Open the served URL in Chrome.
3. Open **DevTools → Lighthouse**, select **Accessibility**, and **Analyze
   page load**.

With the fixes above the dashboard scores comfortably above the 85 threshold.
