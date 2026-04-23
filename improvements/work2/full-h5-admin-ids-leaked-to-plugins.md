---
title: "[AUDIT-FULL-H5] `~/.teleton/plugins/` leaks `admin_ids` to every plugin"
labels: ["bug", "audit-finding-full", "high", "security", "plugins", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
severity: high
category: security
effort: small
priority: P0
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H5).

## Описание

«Санитизированный» конфиг, передаваемый любому внешнему плагину, всё ещё содержит полный список `admin_ids`.

## Местоположение

- `src/agent/tools/plugin-validator.ts:115-127`
  ```ts
  export function sanitizeConfigForPlugins(config: Config): Record<string, unknown> {
    return {
      agent: { provider: config.agent.provider, model: config.agent.model, max_tokens: config.agent.max_tokens },
      telegram: { admin_ids: config.telegram.admin_ids },
      deals: { enabled: config.deals.enabled },
    };
  }
  ```

## Влияние

Как только плагин получает Telegram-ID владельца, он может таргетировать социнжиниринг непосредственно на него, эмитировать tool-calls, правдоподобно выглядящие «от его имени», и минимизировать окно обнаружения — действуя только когда админ в сети. Также это увеличивает blast radius FULL-C1: от «исполнение кода» до «исполнение кода против известного владельца TON-кошелька».

## Предложенное исправление

1. Убрать `admin_ids` из `sanitizeConfigForPlugins`.
2. Предоставить узкий SDK-capability: `isAdmin(userId): boolean` — без экспонирования списка.
3. Аналогично удалить `agent.provider` / `agent.model`, если плагин не демонстрирует нужду — они fingerprint-ят окружение.

## Критерии приёмки

- [ ] `sanitizeConfigForPlugins` больше не возвращает `admin_ids`.
- [ ] В SDK добавлена функция `isAdmin(userId): boolean`.
- [ ] Регрессионный тест: санитизированный конфиг не содержит массив `admin_ids`.
- [ ] Регрессионный тест: `sdk.isAdmin(knownAdmin)` → true; `sdk.isAdmin(randomUser)` → false.
- [ ] Документация `docs/plugins.md` обновлена с новым API.

## Оценка

**Effort:** small (≈ 2–3 часа).
**Priority:** P0 — до включения плагинов в продакшене.
