---
title: "[AUDIT-H2] Escalations never reach the user (log-only `notify`)"
labels: ["bug", "audit-finding", "high", "security", "ux", "autonomous"]
milestone: "v2.2 - Stability & Reliability"
severity: high
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе аудита кодовой базы — issue #250, отчёт [`AUDIT_REPORT.md`](../../AUDIT_REPORT.md) (AUDIT-H2).

## Описание

Продакшен-реализация `notify` записывает эскалации **только в logger**. Нет сообщения в Telegram через `deps.bridge`, нет события в WebUI, нет отдельной записи в БД помимо execution log. Policy-триггерная эскалация (`requiresEscalation === true` в `loop.ts:192-209`) ставит задачу на паузу — и пользователь узнаёт об этом, только если сам опрашивает UI.

## Местоположение

`src/autonomous/integration.ts:110-115`

```ts
notify: async (message: string, taskId: string): Promise<void> => {
  log.warn({ taskId, message }, "Autonomous task escalation");
},
```

## Влияние

Human-in-the-loop safeguard, который реализует policy engine, **фактически не вовлекает человека**. Для TON-spending эскалаций это прямой регресс безопасности: агент ставит задачу на паузу, ожидая подтверждения, но пользователь никак не уведомлён.

## Предложенное исправление

1. Проксировать эскалации через `deps.bridge.sendMessage` на `admin_ids[0]` (или на всех админов в `admin_ids`).
2. Эмитить событие через `notificationBus`, чтобы WebUI поднял уведомление в реальном времени (SSE / WS).
3. Записывать эскалацию в отдельную таблицу `autonomous_escalations` для истории.
4. Сохранить `log.warn` как фоллбэк на случай, если bridge/bus недоступны.

Пример реализации:

```ts
notify: async (message: string, taskId: string): Promise<void> => {
  log.warn({ taskId, message }, "Autonomous task escalation");
  try {
    const adminId = config.telegram.admin_ids[0];
    if (adminId) {
      await deps.bridge.sendMessage(adminId, `⚠️ Task ${taskId} paused: ${message}`);
    }
    deps.notificationBus.emit("escalation", { taskId, message });
  } catch (err) {
    log.error({ err, taskId }, "failed to deliver escalation notification");
  }
},
```

## Критерии приёмки

- [ ] Эскалация отправляется в Telegram через bridge всем админам (или первому, если определён политикой).
- [ ] Эскалация эмитится в `notificationBus` для WebUI.
- [ ] При недоступности bridge или bus — fallback на log.warn без падения (try/catch).
- [ ] Юнит-тест: `notify` вызывает `bridge.sendMessage` с корректным user_id.
- [ ] Юнит-тест: notify устойчив к ошибке bridge и всё ещё логирует.
- [ ] Интеграционный тест: policy-эскалация → сообщение доставлено в mock bridge.

## Оценка

**Effort:** small (≈ 4–6 часов, с учётом тестов).
**Priority:** P1 — fix before re-enabling autonomous wallet mode.
