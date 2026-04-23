---
title: "[AUDIT-FULL-H3] `sendTon` fabricates a tx hash and does not wait for on-chain confirmation"
labels: ["bug", "audit-finding-full", "high", "reliability", "financial", "ton"]
milestone: "v3.0 - Production Ready"
severity: high
category: reliability
effort: medium
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H3).

## Описание

Возвращаемый «хэш» — `<seqno>_<ms>_<amount>`, это **не** TON-хэш транзакции и не может быть сверен он-чейн. После `sendTransfer` нет опроса `getTransactions`, и код возвращает success в момент broadcast, а не в момент фактической посадки в блок.

## Местоположение

- `src/ton/transfer.ts:57-76`
  ```ts
  const seqno = await contract.getSeqno();
  await contract.sendTransfer({ seqno, ... });
  const pseudoHash = `${seqno}_${Date.now()}_${amount.toFixed(2)}`;
  ```
- Персистится в `deals.agent_sent_tx_hash`.

## Влияние

1. Audit trail невозможно сверить с цепочкой — экспортированные CSV/журналы заявляют «хэш», которого нет.
2. При краше/ретрае `deals.executor.ts` не может отличить «отправлено, статус неизвестен» от «отправлено и подтверждено» и от «не отправлено». Именно это состояние провоцирует double-spend (существующий лок `UPDATE ... WHERE agent_sent_at IS NULL` дедуплицирует только инициацию).
3. Для любого downstream-интегратора «confirmation» — false positive.

## Предложенное исправление

1. После `sendTransfer` опрашивать `getTransactions(wallet, { limit: 5 })` в поисках транзакции с `outMsg.info.src === wallet` и соответствующим `seqno`; сохранять `tx.hash()` как каноническую запись. Бюджет: 60 с с backoff 2 с. При отсутствии транзакции — выставить распространённое состояние `pending`.
2. Различать состояния: `pending` / `confirmed` / `failed` в БД.
3. Регрессионный тест: `sendTransfer` ok, `getTransactions` возвращает `[]` → итог `pending`, а не success.

## Критерии приёмки

- [ ] `sendTon` больше не возвращает псевдо-хэш.
- [ ] Реальный `tx.hash()` записывается в `deals.agent_sent_tx_hash` только после конфирмации.
- [ ] В БД добавлено поле статуса (`pending` / `confirmed` / `failed`), миграция.
- [ ] Тест на сценарий «sent, not confirmed» возвращает `pending`.
- [ ] Тест на сценарий confirm — возвращает `confirmed` + реальный хэш.
- [ ] Документация `docs/ton-wallet.md` обновлена.

## Оценка

**Effort:** medium (≈ 1–1.5 дня).
**Priority:** P1 — до v3.0.
