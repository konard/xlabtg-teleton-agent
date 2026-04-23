---
title: "[AUDIT-FULL-L2] `doctor` does not exercise encrypted-wallet decryption"
labels: ["bug", "audit-finding-full", "low", "cli", "ux"]
milestone: "v3.0 - Production Ready"
severity: low
category: ux
effort: small
priority: P3
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-L2).

## Описание

Читает `wallet.json` и рапортует «OK» при наличии `wallet.address`, но никогда не вызывает `loadWallet()` / `resolveEncryptionKey()`. Ошибки шифрования всплывают при первом переводе, а не во время `teleton doctor`.

## Местоположение

- `src/cli/commands/doctor.ts:188-226`.

## Влияние

Ложное чувство безопасности: оператор считает, что wallet здоров, пока реальный transfer не упадёт с decryption-ошибкой.

## Предложенное исправление

Вызвать `loadWallet()` в `checkWallet` и сообщать `ok` / `warn` (плейнтекст-легаси) / `error` (decryption failed).

## Критерии приёмки

- [ ] `checkWallet` вызывает `loadWallet()`.
- [ ] Возвращает три состояния: `ok` / `warn` / `error`.
- [ ] Регрессионный тест: плейнтекст-кошелёк → `warn`.
- [ ] Регрессионный тест: валидный зашифрованный кошелёк → `ok`.
- [ ] Регрессионный тест: неверный ключ/повреждённый файл → `error`.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P3 — opportunistic.
