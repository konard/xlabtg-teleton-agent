---
title: "[AUDIT-H3] `deps_planWithTimeout` leaks a `setTimeout` on every plan step"
labels: ["bug", "audit-finding", "high", "reliability", "autonomous", "memory-leak"]
milestone: "v2.2 - Stability & Reliability"
severity: high
category: reliability
effort: small
priority: P2
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-H3).

## Описание

`deps_planWithTimeout` использует паттерн `Promise.race` с таймаутом, но **не отменяет таймер**, когда `planNextAction` резолвится первым. Таймер и замыкание, удерживающие `task`, `history`, `checkpoint`, остаются жить 30 секунд на event loop'е на каждый шаг планирования.

## Местоположение

`src/autonomous/loop.ts:359-370`

```ts
const timeout = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("Planning timed out after 30s")), PLAN_TIMEOUT_MS)
);
return Promise.race([deps.planNextAction(task, history, checkpoint), timeout]);
```

## Влияние

Для задач с сотнями/тысячами итераций event loop заполняется pending-таймерами; GC также удерживает замыкания, на которые они ссылаются (`task`, `history`, `checkpoint`). **Память растёт примерно линейно** с количеством итераций, пока таймеры не отработают (до 30 с).

## Предложенное исправление

Использовать `AbortController` для отмены таймера при успешном резолве:

```ts
const controller = new AbortController();
const timeout = new Promise<never>((_, reject) => {
  const t = setTimeout(() => reject(new Error("Planning timed out")), PLAN_TIMEOUT_MS);
  controller.signal.addEventListener("abort", () => clearTimeout(t));
});
try {
  return await Promise.race([deps.planNextAction(task, history, checkpoint), timeout]);
} finally {
  controller.abort();
}
```

Альтернативно — захватить `timerId`, сохранить в переменной и очистить в `finally`.

## Критерии приёмки

- [ ] Таймер очищается при успешном резолве `planNextAction`.
- [ ] Таймер очищается при отвергнутом промисе (catch).
- [ ] Юнит-тест: после 100 успешных планирований активных таймеров нет (можно проверить через `process._getActiveHandles()` или `process.getActiveResourcesInfo()`).
- [ ] Юнит-тест: таймаут всё ещё корректно работает для медленного `planNextAction`.
- [ ] Проверено отсутствие утечки замыкания (тест с weak ref / memory snapshot — опционально).

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P2 — next minor release.
