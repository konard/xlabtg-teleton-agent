---
title: "[AUDIT-FULL-L4] Provider error messages forward raw upstream bodies"
labels: ["bug", "audit-finding-full", "low", "security", "providers", "logging"]
milestone: "v3.0 - Production Ready"
severity: low
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-L4).

## Описание

Полный upstream-body бросается как `Error.message`; log-redaction (`src/utils/logger.ts:121-143`) редактирует только структурированные поля, не plain-text. Вдобавок 401-детект использует substring-match на сообщении ошибки — случайный `"401"` в теле ответа триггерит ложный token-refresh.

## Местоположение

- `src/providers/groq/GroqTextProvider.ts:73-79,133-137,205`
- Аналогично: `src/agent/client.ts:305-321`.

## Влияние

Токены и подобные secret-подобные строки могут попасть в логи / pipes, если они эхоим upstream 4xx/5xx body. Ложный 401-детект вызывает лишние refresh-ы.

## Предложенное исправление

1. Труниковать upstream-body до ~200 символов и стрипать `/(sk-|gsk_|Bearer )[^\s"]+/`.
2. Для 401-детекта использовать `response.status`, а не substring-match.

## Критерии приёмки

- [ ] Upstream-body усекается до 200 символов в Error.message.
- [ ] Регекс для удаления секретов применяется.
- [ ] 401-детект основан на `response.status`.
- [ ] Регрессионный тест: upstream body с `sk-…` → error-сообщение не содержит ключ.
- [ ] Регрессионный тест: body с `"detail": "something 401-ish"` + status 200 → token-refresh не триггерится.

## Оценка

**Effort:** small (≈ 2–3 часа).
**Priority:** P3 — opportunistic.
