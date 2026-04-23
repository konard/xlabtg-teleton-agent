---
title: "[AUDIT-FULL-M4] `ATTACH DATABASE` interpolates an unescaped `TELETON_ROOT`; apostrophe in home dir → SQL injection"
labels: ["bug", "audit-finding-full", "medium", "security", "sql-injection"]
milestone: "v3.0 - Production Ready"
severity: medium
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M4).

## Описание

`MAIN_DB_PATH = join(TELETON_ROOT, "memory.db")`. `TELETON_ROOT` получается из `homedir()` либо из env. Одинарная кавычка в пути (легальна на POSIX, например `/home/o'brien/`, или установлена атакующим через env) закрывает литерал и превращает остаток в SQL.

## Местоположение

- `src/utils/module-db.ts:107`
  ```ts
  moduleDb.exec(`ATTACH DATABASE '${MAIN_DB_PATH}' AS main_db`);
  ```

## Влияние

Повреждение или эксфильтрация main memory DB из plugin-DB миграционных код-путей.

## Предложенное исправление

Двойное экранирование `MAIN_DB_PATH.replace(/'/g, "''")`, либо валидация `TELETON_ROOT` на старте через `^[A-Za-z0-9._/\-]+$`.

## Критерии приёмки

- [ ] Путь экранируется до подстановки в `ATTACH DATABASE`.
- [ ] `TELETON_ROOT` валидируется при старте.
- [ ] Регрессионный тест: `TELETON_ROOT = "/tmp/o'brien"` → `ATTACH` успешен, нет injection.
- [ ] Регрессионный тест: `TELETON_ROOT` с shell-metacharacters отклоняется на старте.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P1 — до v3.0.
