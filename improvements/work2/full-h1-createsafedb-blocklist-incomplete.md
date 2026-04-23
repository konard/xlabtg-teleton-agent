---
title: "[AUDIT-FULL-H1] `createSafeDb` is a block-list; `loadExtension`/`backup`/`pragma`/`function` remain callable from plugins"
labels: ["bug", "audit-finding-full", "high", "security", "plugins", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
severity: high
category: security
effort: medium
priority: P0
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H1).

## Описание

Proxy перехватывает только `exec` и `prepare`. Любой другой метод `better-sqlite3` возвращается связанным с реальной БД, поэтому плагин может вызвать `sdk.db.loadExtension("/tmp/evil.so")` (native-исполнение в процессе), `sdk.db.backup("/tmp/exfil.db")` (полная копия БД), `sdk.db.serialize()` (in-memory копия всех данных — в т.ч. мнемоника, если она попадала в любую таблицу), `sdk.db.function("eval", ...)` (регистрация SQL-функции, вызываемой из последующих запросов), `sdk.db.pragma(...)` (отключение foreign keys / journal mode). Регулярка `BLOCKED_SQL_RE` аналогично пропускает `PRAGMA`/`VACUUM`/`ALTER`.

## Местоположение

- `src/sdk/index.ts:142-179`
  ```ts
  const BLOCKED_SQL_RE = /\b(ATTACH|DETACH)\s+DATABASE\b/i;
  function createSafeDb(db) {
    return new Proxy(db, { get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "exec") return (sql) => { if (isSqlBlocked(sql)) throw ...; return target.exec(sql); };
      if (prop === "prepare") return (sql) => { if (isSqlBlocked(sql)) throw ...; return target.prepare(sql); };
      return typeof value === "function" ? value.bind(target) : value;
    }});
  }
  ```

## Влияние

В паре с FULL-C1 (плагин всё равно запускается с полными правами Node) это defense-in-depth, который не защищает. Когда появится изоляция плагинов, именно этот block-list станет слабым звеном для MCP-инструментов и любой будущей in-process extension-модели.

## Предложенное исправление

1. Перейти на allow-list Proxy: экспонировать только `prepare`, `transaction`, `close` (no-op), `inTransaction`. Всё остальное — `undefined`.
2. Обернуть `prepare` в scope-limited shim: запретить `all()` против `sqlite_master` или таблиц других плагинов; enforce префикс таблиц `plugin:<name>_*` из `module-db.ts`.
3. Расширить SQL-denylist: `PRAGMA`, `VACUUM`, `ALTER`, `.load` (dot-команды не парсятся, но defense-in-depth).

## Критерии приёмки

- [ ] `createSafeDb` переписан на allow-list стратегию.
- [ ] `sdk.db.loadExtension`, `sdk.db.backup`, `sdk.db.serialize`, `sdk.db.function`, `sdk.db.pragma` **не доступны** из плагина (undefined / throw).
- [ ] SQL denylist покрывает `PRAGMA`/`VACUUM`/`ALTER`.
- [ ] Регрессионный тест: попытка `sdk.db.loadExtension("./x.so")` → throw.
- [ ] Существующие плагин-тесты зелёные.

## Оценка

**Effort:** medium (≈ 1 день).
**Priority:** P0 — до включения плагинов в продакшене.
