---
title: "[AUDIT-C4] Full WebUI auth token printed to stdout at startup"
labels: ["bug", "audit-finding", "critical", "security", "webui"]
milestone: "v2.2 - Stability & Reliability"
severity: critical
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-C4).

## Описание

При старте WebUI в stdout печатается URL `/auth/exchange?token=<plaintext>` — **полный токен в открытом виде** — даже несмотря на то, что следующая строка использует `maskToken()`. Любой централизованный сбор логов (journalctl, Docker log driver, `tsx --log-file`, CI-артефакты, `teleton --debug > log.txt`) навсегда сохраняет валидный 7-дневный сессионный токен.

## Местоположение

`src/webui/server.ts:503`

```ts
log.info(`URL: ${url}/auth/exchange?token=${this.authToken}`);
log.info(`Token: ${maskToken(this.authToken)} (use Bearer header for API access)`);
```

TTL токена — `COOKIE_MAX_AGE` в `src/webui/middleware/auth.ts` (7 дней).

## Влияние

Любой, имеющий доступ к логам процесса агента, получает **полный API-доступ к WebUI на срок до 7 дней**, включая эндпоинты кошелька и автономных задач. Это утечка долгоживущего секрета через штатный канал логирования.

## Предложенное исправление

Не печатать токен в журналируемый stdout. Возможные варианты:

1. Печатать URL без токена и токен — только в masked-форме:
   ```ts
   log.info(`URL:   ${url}/auth/exchange`);
   log.info(`Token: ${maskToken(this.authToken)} (Bearer header / cookie)`);
   log.info(`One-shot exchange link is printed to stderr below (not logged).`);
   process.stderr.write(`\n>>> One-time link: ${url}/auth/exchange?token=${this.authToken}\n\n`);
   ```
2. Ещё лучше — не печатать токен вообще и передавать его через файл (`teleton_session.txt`, режим `0600`) или CLI-флаг.
3. Сделать exchange-токен одноразовым (invalidate после первого обмена), тогда даже утёкший токен из лога не даст доступ.

## Критерии приёмки

- [ ] Полный токен больше не появляется в любых `log.*` выходах.
- [ ] Grep после бута: `grep "$AUTH_TOKEN" logs/*.log` возвращает **ноль** совпадений.
- [ ] Добавлен юнит-тест, захватывающий stdout/stderr в тесте бута и проверяющий отсутствие токена в stdout (stderr допустим, если он явно not-logged).
- [ ] Документация обновлена: где пользователь получает токен и почему он больше не в логах.
- [ ] Рассмотрен апгрейд до одноразового exchange-токена (опционально, может быть отдельным issue).

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P1 — fix before re-enabling autonomous wallet mode.
