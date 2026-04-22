---
title: "[AUDIT-M6] Path-traversal guard inconsistent between servers"
labels: ["audit-finding", "medium", "security", "webui"]
milestone: "v2.2 - Stability & Reliability"
severity: medium
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-M6).

## Описание

Проверка path-traversal реализована по-разному в двух серверах:
- `src/webui/setup-server.ts:198-199` — использует `rel.startsWith("..")` после `relative()`.
- `src/webui/server.ts:417-418` — дополнительно проверяет `resolve(filePath) !== filePath`.

Это источник багов и рассинхрона: при изменении одного места второе легко забывают.

## Местоположение

- `src/webui/setup-server.ts:198-199`
- `src/webui/server.ts:417-418`

## Влияние

Риск того, что одна из проверок пропустит traversal, которую другая ловит (например, на специальных символах, symlinks, UNC-путях в Windows).

## Предложенное исправление

1. Вынести проверку в общий helper `src/webui/utils/path-safety.ts`:
   ```ts
   export function isPathInside(child: string, parent: string): boolean {
     const resolvedChild = resolve(child);
     const resolvedParent = resolve(parent);
     const rel = relative(resolvedParent, resolvedChild);
     return (
       rel !== "" &&
       !rel.startsWith("..") &&
       !isAbsolute(rel)
     );
   }
   ```
2. Использовать `isPathInside(requestedPath, allowedRoot)` в обоих серверах.
3. Добавить юнит-тесты на граничные случаи: `..`, symlinks, абсолютный путь, pure-dot, unicode.

## Критерии приёмки

- [ ] Общий helper создан и покрыт юнит-тестами (≥ 10 кейсов).
- [ ] Оба сервера (`setup-server.ts`, `server.ts`) используют helper.
- [ ] Юнит-тесты на: `..`, `../..`, абсолютные пути, symlinks внутри/снаружи root.
- [ ] Документация helper'а.

## Оценка

**Effort:** small (≈ 2–3 часа).
**Priority:** P3 — opportunistic.
