---
title: "[AUDIT-FULL-M3] Workspace path validator has a TOCTOU and `existsSync` follows symlinks in a parent chain"
labels: ["bug", "audit-finding-full", "medium", "security", "workspace"]
milestone: "v3.0 - Production Ready"
severity: medium
category: security
effort: medium
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M3).

## Описание

`existsSync(absolutePath)` следует по symlink-ам вдоль родительской цепочки. `lstatSync(absolutePath)` инспектирует только leaf, поэтому parent-directory symlink, выводящий за `WORKSPACE_ROOT`, не обнаруживается. Повторный `lstatSync` перед возвратом удваивает TOCTOU-окно между валидацией и фактическими `readFileSync`/`writeFileSync`.

## Местоположение

- `src/workspace/validator.ts:122-152`.

## Влияние

Плагин (или prompt-injected последовательность, сначала создающая workspace symlink, затем вызывающая `workspace_write`) может обхитрить проверку и переписать файлы вне workspace — в первую очередь `~/.teleton/wallet.json` или `~/.teleton/config.yaml`.

## Предложенное исправление

1. Резолвить полную цепочку через `fs.realpathSync.native()` (или `promises.realpath`) и **после** убеждаться, что resolved-путь внутри `WORKSPACE_ROOT`.
2. Для записей открывать с `O_NOFOLLOW` через `fs.open(..., constants.O_NOFOLLOW | ...)` и писать в fd. Убрать двухшаговый `existsSync`+`write`.

## Критерии приёмки

- [ ] Валидатор использует `realpath` вместо `lstatSync` только на leaf.
- [ ] Writes открываются с `O_NOFOLLOW`.
- [ ] Регрессионный тест: parent-directory symlink на `/etc` → запись отклоняется.
- [ ] Регрессионный тест: symlink на leaf также отклоняется.
- [ ] Существующие workspace-тесты проходят.

## Оценка

**Effort:** medium (≈ 0.5–1 день).
**Priority:** P1 — до v3.0.
