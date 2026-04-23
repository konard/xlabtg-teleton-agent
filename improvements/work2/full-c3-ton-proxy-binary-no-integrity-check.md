---
title: "[AUDIT-FULL-C3] TON-proxy binary downloaded from GitHub Releases with no integrity verification"
labels: ["bug", "audit-finding-full", "critical", "security", "supply-chain", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
severity: critical
category: security
effort: medium
priority: P0
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-C3).

## Описание

`install()` скачивает платформенный бинарь ton-proxy из GitHub Releases (`latest` по умолчанию), пишет в `~/.teleton/ton-proxy/` и выставляет `chmod +x` **без контрольной суммы, без подписи, без верхней границы размера, без proxy-конфигурации**. Ручка Management API `/v1/ton-proxy` (`src/api/server.ts:240`) и WebUI-роут `/api/ton-proxy/start` триггерят install/restart. Повторы — до 3 раз с авто-рестартом.

## Местоположение

- `src/ton-proxy/manager.ts:69-104` (`install()`)
  ```ts
  const releaseRes = await fetch(releaseUrl, { ... });
  ...
  const res = await fetch(downloadUrl);
  ...
  const fileStream = createWriteStream(dest);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, fileStream);
  chmodSync(dest, 0o755);
  ```

## Влияние

Компрометация GitHub-аккаунта upstream, передача репозитория / takeover либо MITM на анонимной скачке приводят к исполнению кода с правами владельца кошелька. Поскольку proxy запускается непрерывно как child-процесс, у троянца появляется постоянная точка входа и сетевой egress. Классический путь от «скомпрометирован аккаунт» к «слит TON-кошелёк».

## Предложенное исправление

1. Зафиксировать известный release-тег (а не `latest`) и добавить файл `src/ton-proxy/checksums.json` с SHA-256 digestом для каждой платформы/архитектуры. Проверять перед `chmod +x`.
2. Валидировать `Content-Length` относительно разумной верхней границы (≤ 50 MB). После редиректов убедиться, что `res.ok && res.url.startsWith("https://github.com/...")` — не допускать cross-domain.
3. При провале верификации — удалить частично скачанный файл и показать пользователю чёткую ошибку; **без авто-повтора**.
4. Задокументировать ожидаемый хэш бинаря в `docs/ton-wallet.md`.

## Критерии приёмки

- [ ] Релиз-тег зафиксирован в коде либо в конфиге (не `latest`).
- [ ] Рядом с менеджером лежит `checksums.json` для всех поддерживаемых платформ.
- [ ] После `pipeline` вычисляется SHA-256 и сравнивается с ожидаемым.
- [ ] Content-Length и redirect-домен валидируются.
- [ ] Тест: подмена бинаря mock-сервером → `install()` прерывается до `chmod +x`.
- [ ] `docs/ton-wallet.md` описывает процесс верификации.

## Оценка

**Effort:** medium (≈ 1 день).
**Priority:** P0 — до выхода v3.0 с авто-установкой proxy.
