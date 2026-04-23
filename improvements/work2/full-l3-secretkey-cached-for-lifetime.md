---
title: "[AUDIT-FULL-L3] Derived `secretKey` cached for the process lifetime with no zeroize path"
labels: ["bug", "audit-finding-full", "low", "security", "secrets"]
milestone: "v3.0 - Production Ready"
severity: low
category: security
effort: small
priority: P3
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-L3).

## Описание

`_keyPairCache` держится до остановки; `/pause`, lock-timeout и известные compromise-события не могут его выселить.

## Местоположение

- `src/ton/wallet-service.ts:22,383-391`.

## Влияние

Долгое удержание деривированного `secretKey` в памяти расширяет окно эксплуатации при memory-dump / side-channel атаках. После compromise-события нельзя «перевыпустить» in-memory ключ без полного рестарта.

## Предложенное исправление

Добавить `clearKeyPair()`, вызывать из `/pause` и SIGTERM; `secretKey.fill(0)` при выселении. Дополнительно логгировать **warn** (не debug), когда сохраняется легаси-плейнтекст-кошелёк.

## Критерии приёмки

- [ ] `clearKeyPair()` реализован, вызывается при `/pause` и SIGTERM.
- [ ] Зануление `secretKey.fill(0)` при выселении.
- [ ] Warn-лог при сохранении плейнтекст-кошелька.
- [ ] Регрессионный тест: после `/pause` повторный transfer требует повторной деривации.
- [ ] Существующие wallet-тесты проходят.

## Оценка

**Effort:** small (≈ 2 часа).
**Priority:** P3 — opportunistic.
