---
title: "[AUDIT-FULL-H2] MCP tools with empty/missing `inputSchema` are registered and bypass parameter validation"
labels: ["bug", "audit-finding-full", "high", "security", "mcp", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
severity: high
category: security
effort: small
priority: P0
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H2).

## Описание

`validateToolCall` полагается на advertised-схему. Если у MCP-инструмента свойства пустые, валидация превращается в no-op, а `arguments` передаются в `client.callTool` в сыром виде. Аргументы LLM подвержены prompt-injection через ранний вывод другого инструмента, Telegram-сообщение или веб-страницу. Недоверенный MCP-сервер, зарегистрировавший tool `ton_send` с пустой схемой, будет подшит в реестр.

## Местоположение

- `src/agent/tools/mcp-loader.ts:234-243`
  ```ts
  const schema = mcpTool.inputSchema ?? { type: "object", properties: {} };
  if (!schema.properties || Object.keys(schema.properties).length === 0) {
    log.warn({ tool: mcpTool.name, server: conn.serverName },
      "MCP tool has no parameter schema — inputs will not be validated");
  }
  // tool is still registered
  ```
- Registry: `src/agent/tools/registry.ts:155`.

## Влияние

Сторонние MCP-серверы (в т.ч. настроенные на HTTP-транспорт) фактически обходят слой валидации входа. Поскольку имена в реестре глобальны, MCP-tool может столкнуться с built-in по имени — в зависимости от порядка регистрации (`registerFrom`/`registerPluginTools`).

## Предложенное исправление

1. **Отвергать** (не просто warn) инструменты, у которых схема отсутствует или `properties` пуст.
2. Неймспейсить MCP-инструменты как `mcp.<server>.<tool>` в реестре, чтобы избегать коллизий; запретить префиксы `ton_*`, `jetton_*`, `wallet_*`, `exec*` и любые другие built-in.
3. При наличии схемы использовать строгую JSON-Schema валидацию (`@sinclair/typebox` уже подключён) вместо ручной shallow-проверки.

## Критерии приёмки

- [ ] MCP-инструменты без `inputSchema.properties` **не регистрируются**.
- [ ] MCP-имена неймспейсятся как `mcp.<server>.<tool>`.
- [ ] Конфликт имён с зарезервированными built-in префиксами → отказ регистрации.
- [ ] Валидация через `@sinclair/typebox`.
- [ ] Регрессионные тесты: отказ регистрации MCP-tool без схемы; валидация по схеме блокирует неверный тип аргументов.

## Оценка

**Effort:** small (≈ 3–4 часа).
**Priority:** P0 — до включения MCP в продакшене.
