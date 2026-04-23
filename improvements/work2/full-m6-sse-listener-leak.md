---
title: "[AUDIT-FULL-M6] SSE listener on `/v1/agent/events` survives up to 30 s after disconnect; `lifecycle` closures leak"
labels: ["bug", "audit-finding-full", "medium", "reliability", "api"]
milestone: "v3.0 - Production Ready"
severity: medium
category: reliability
effort: small
priority: P2
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M6).

## Описание

`onStateChange` навешивается через `lifecycle.on("stateChange", …)` и снимается только после выхода из цикла `while (!aborted)`; цикл ждёт `stream.sleep(30_000)`. Клиент, отключившийся на первой секунде, оставляет listener висеть до 30 секунд, удерживая ссылки на прерванный stream.

## Местоположение

- `src/api/server.ts:324-381`.

## Влияние

Утечки замыканий и памяти при активных переподключениях SSE-клиентов; лишние события lifecycle, посылаемые в закрытые streams; повышенная нагрузка CPU/GC.

## Предложенное исправление

Снять listener внутри `stream.onAbort(...)`:
```ts
const detach = () => lifecycle.off("stateChange", onStateChange);
stream.onAbort(() => { aborted = true; detach(); });
// ...также detach при штатном выходе из цикла.
```

## Критерии приёмки

- [ ] Listener `stateChange` снимается сразу при `onAbort`.
- [ ] После штатного выхода тоже снимается.
- [ ] Регрессионный тест: подключить SSE, отключить — `lifecycle.listenerCount("stateChange")` не растёт.
- [ ] Существующие SSE-тесты проходят.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P2 — next maintenance.
