---
title: "[AUDIT-L1] Config schema `version` default disagrees with package version"
labels: ["audit-finding", "low", "config"]
milestone: "v2.2 - Stability & Reliability"
severity: low
category: technical-debt
effort: small
priority: P3
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-L1).

## Описание

В `src/config/schema.ts:189`:
```ts
version: z.string().default("1.0.0")
```
в то время как `package.json` указывает `"version": "0.8.10"`. Рассинхронизация: дефолт схемы не отражает реальную версию релиза.

## Местоположение

- `src/config/schema.ts:189`
- `package.json` (поле `version`)

## Влияние

- Путаница в логах / миграциях: конфиг без `version` получает отличающуюся от реальной версии строку.
- Потенциальный баг в будущем, если какой-то код сравнивает `config.version` с `package.json`.

## Предложенное исправление

Вариант A: читать дефолт из `package.json`:
```ts
import pkg from "../../package.json" with { type: "json" };
// ...
version: z.string().default(pkg.version)
```

Вариант B: убрать default вообще и требовать явного значения.

## Критерии приёмки

- [ ] Дефолт `version` в schema либо читается из `package.json`, либо убран.
- [ ] Юнит-тест: `parseConfig({})` возвращает `version` равный `pkg.version`.
- [ ] Build / bundle не ломается от JSON-import.

## Оценка

**Effort:** small (≈ 30 минут).
**Priority:** P3 — opportunistic.
