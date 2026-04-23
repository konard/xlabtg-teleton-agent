---
title: "[AUDIT-FULL-M5] Per-session transcripts grow unbounded in RAM and on disk"
labels: ["bug", "audit-finding-full", "medium", "reliability", "performance", "memory"]
milestone: "v3.0 - Production Ready"
severity: medium
category: performance
effort: medium
priority: P2
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-M5).

## Описание

`appendToTranscript` дописывает по одной JSONL-строке на сообщение и пушит в `transcriptCache` без cap. `readTranscript` делает полный `readFileSync` при первом промахе, затем держит весь массив сообщений в `transcriptCache` на время жизни процесса. Нет ротации, LRU, byte-cap. `archiveTranscript` вызывается только на узких путях.

## Местоположение

- `src/session/transcript.ts:35-52,127-166`.

## Влияние

Долгоживущие owner-чаты аккумулируют сотни мегабайт; `readTranscript` доминирует в tail-латентности с ростом файла; кэш удерживает каждую сессию в памяти → OOM на мульти-чат развёртываниях.

## Предложенное исправление

1. Capping per-transcript на N сообщений (e.g., 5 000), auto-archive при превышении.
2. Заменить `transcriptCache` на LRU (переиспользовать `src/utils/weighted-lru-cache.ts`).
3. Стримить последние N строк через `readline` для файлов выше порога.

## Критерии приёмки

- [ ] Cap по количеству сообщений per-transcript, auto-archive.
- [ ] `transcriptCache` → LRU (weighted).
- [ ] Stream-чтение для больших файлов.
- [ ] Регрессионный тест: транскрипт >N сообщений → архивируется, `readTranscript` возвращает последние N.
- [ ] Регрессионный тест: LRU вытесняет старые чаты.

## Оценка

**Effort:** medium (≈ 0.5–1 день).
**Priority:** P2 — next maintenance.
