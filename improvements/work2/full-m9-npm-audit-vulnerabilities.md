---
title: "[AUDIT-FULL-M9] npm audit reports 14 vulnerabilities (7 high, 7 moderate) in transitive deps"
labels: ["bug", "audit-finding-full", "medium", "dependencies", "security"]
milestone: "v3.0 - Production Ready"
severity: medium
category: dependency
effort: small
priority: P2
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M9).

## Описание

`npm audit --audit-level=low` возвращает 14 уязвимостей. `audit-ci.jsonc` сейчас фейлит только на `critical`.

| Package | Severity | Issue |
| --- | --- | --- |
| `hono` (≤4.12.13) | moderate | multiple CVEs: middleware bypass via repeated slashes, cookie prefix bypass, IPv4-mapped IPv6 в `ipRestriction`, path traversal в `toSSG`, HTML injection в `hono/jsx`. |
| `@hono/node-server` (<1.19.13) | moderate | middleware bypass via repeated slashes in `serveStatic` (GHSA-92pp-h63x-v22m). |
| `axios` (<1.15.0) | moderate | NO_PROXY normalization bypass → SSRF (GHSA-3p68-rc4w-qgx5). |
| `yaml` (≤2.8.2) | moderate | stack overflow via deeply nested collections (GHSA-48c2-rrv3-qjmp). |
| `fast-xml-parser` (≤5.6.0) | high | entity expansion bypass + XML comment injection в XMLBuilder. |
| `flatted` (≤3.4.1) | high | unbounded recursion DoS + prototype pollution. |
| `follow-redirects` (≤1.15.11) | moderate | leaks custom auth headers on cross-domain redirect. |
| `path-to-regexp` (8.0.0–8.3.0) | high | two ReDoS vectors. |
| `picomatch` | high | ReDoS + method injection в POSIX character classes. |
| `smol-toml` (<1.6.1) | moderate | DoS via commented lines. |
| `vite` (7.0.0–7.3.1) | high | three CVEs: path traversal в `.map`, `server.fs.deny` bypass, arbitrary file read via WebSocket. |

## Местоположение

- `package-lock.json`.
- `audit-ci.jsonc`.

## Влияние

`hono` и `@hono/node-server` прямо питают WebUI и Management API; некоторые CVE доступны с публичной поверхности. `vite` dev-only, но используется в `web/` build-пайплайне. `fast-xml-parser`/`flatted`/`picomatch`/`path-to-regexp` приходят через tooling — runtime-риск ниже, но попадают в CI.

## Предложенное исправление

1. `npm audit fix` (в этой lockfile — non-breaking по `fixAvailable: true`; попробовать в отдельной ветке).
2. Ужесточить `audit-ci.jsonc`: фейлить на `high` в CI (дропнуть `"critical": true`, оставить `"high": true` либо `"moderate": true`).
3. Завести weekly CI-задачу с `npm outdated` + `npm audit`.

## Критерии приёмки

- [ ] `npm audit --audit-level=high` зелёный (либо все уязвимости задокументированы и подавлены).
- [ ] `audit-ci.jsonc` обновлён до `high` fail-threshold.
- [ ] Еженедельная CI-задача для audit/outdated добавлена.
- [ ] PR не ломает существующие тесты.

## Оценка

**Effort:** small (≈ 3–4 часа).
**Priority:** P2 — next maintenance.
