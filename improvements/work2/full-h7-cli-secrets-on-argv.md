---
title: "[AUDIT-FULL-H7] CLI secrets on `argv` and in shell history"
labels: ["bug", "audit-finding-full", "high", "security", "cli", "secrets"]
milestone: "v3.0 - Production Ready"
severity: high
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H7).

## Описание

`teleton config set agent.api_key sk-ant-…` и `teleton setup --api-key sk-ant-…` помещают plaintext-креды на `argv`, видимые через `ps aux`, `/proc/<pid>/cmdline` и история шелла.

## Местоположение

- `src/cli/index.ts:44-50,62`
- `src/cli/commands/config.ts:27-75,116-142`
- `src/cli/commands/config.ts:74` — `console.log(\`✓ ${key} = ${meta.mask(value)}\`)`

## Влияние

Прямое раскрытие LLM API-ключа, Telegram `api_hash`, Tavily-ключа, Groq-ключа, TonAPI/TonCenter-ключей, webui/setup-токенов на мульти-юзер хостах, в контейнерах с процесс-мониторингом, а также в бэкапах `.bash_history` / `.zsh_history`.

## Предложенное исправление

1. Для секретов (`meta.sensitive === true`) отвергать позиционный `value`; требовать interactive prompt, `--value-file <path>` или env `TELETON_<KEY>`.
2. Обнулять слот `argv` после парсинга (`process.argv[i] = "<redacted>"`), чтобы последующие снапшоты не видели ключ.
3. В `config set` заменить `console.log(\`✓ ${key} = ${meta.mask(value)}\`)` на `✓ ${key} updated` (без echo значения).

## Критерии приёмки

- [ ] `teleton config set <sensitive-key> <value>` без `--value-file` отвергается с понятным сообщением.
- [ ] Поддерживается interactive prompt и `--value-file`.
- [ ] Поддерживается env-vars `TELETON_<KEY>`.
- [ ] После парсинга `argv` секрет обнуляется.
- [ ] `config set` больше не echo-ит маскированное значение.
- [ ] Регрессионный тест: `ps aux` (имитация) не содержит секрет после парсинга.

## Оценка

**Effort:** small (≈ 3–4 часа).
**Priority:** P1 — до v3.0.
