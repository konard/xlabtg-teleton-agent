---
title: "[AUDIT-FULL-M8] `markdownToTelegramHtml` does not escape link text; one `<` in a title DoSes outbound replies"
labels: ["bug", "audit-finding-full", "medium", "output-encoding", "telegram"]
milestone: "v3.0 - Production Ready"
severity: medium
category: output-encoding
effort: small
priority: P2
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M8).

## Описание

Захваченный внутренний `text` вставляется в HTML без экранирования. Любой `<`, `>`, `&` в тексте (название подарка Telegram с `<`, display-name пользователя с `<`, agent-интерполированное поле) даёт невалидный HTML. Telegram отвечает `CAN_NOT_PARSE`, и агент молча дропает ответ.

## Местоположение

- `src/telegram/formatting.ts:46-49,71-74,88-91`
  ```ts
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g,
           (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`);
  ```

## Влияние

Silent-DoS исходящих ответов при контенте с `<`/`>`/`&`: агент выглядит зависшим на стороне пользователя.

## Предложенное исправление

Экранировать `text` через `escapeHtml(text)` во всех трёх replacement-ах (link, blockquote). Добавить тест на `[<x>](https://a.test)`.

## Критерии приёмки

- [ ] `escapeHtml` применяется к link-тексту, blockquote, коду внутри.
- [ ] Регрессионный тест: `[<x>](https://a.test)` → валидный HTML, Telegram не возвращает `CAN_NOT_PARSE`.
- [ ] Регрессионный тест: `[a & b](https://a.test)` → корректный `&amp;`.
- [ ] Существующие formatting-тесты проходят.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P2 — next maintenance.
