---
title: "[AUDIT-FULL-C1] External plugins load with no isolation (full Node privileges)"
labels: ["bug", "audit-finding-full", "critical", "security", "plugins", "v3.0-blocker"]
milestone: "v3.0 - Production Ready"
severity: critical
category: security
effort: medium-large
priority: P0
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-C1).

## Описание

Плагины загружаются через голый динамический `import()` **без VM-изоляции, без Worker-потока, без permissions-модели и без проверки подписи**. Схема манифеста не требует ни подписи, ни контрольной суммы. `chokidar` смотрит за `~/.teleton/plugins/` с глубиной 1, поэтому подброшенный туда файл будет моментально импортирован. Процесс, удерживающий TON-мнемонику (кэшируется в `src/ton/wallet-service.ts:22` на всё время жизни процесса — см. FULL-L3), является тем же процессом, что исполняет код плагина.

## Местоположение

- `src/agent/tools/plugin-loader.ts:435-436`
  ```ts
  const moduleUrl = pathToFileURL(path).href;
  const mod = (await import(moduleUrl)) as RawPluginExports;
  ```
- `src/agent/tools/plugin-watcher.ts:210-211` (hot reload on change)
  ```ts
  const moduleUrl = pathToFileURL(modulePath).href + `?t=${Date.now()}`;
  const freshMod = await import(moduleUrl);
  ```

## Влияние

Любой атакующий, способный записать в `~/.teleton/plugins/` (вредоносный опубликованный плагин, путь загрузки плагинов в WebUI, ошибка в CI, writable shared-host `$HOME`), получает произвольное исполнение кода с UID владельца кошелька — включая `fs.readFileSync("~/.teleton/wallet.json")`, вызов `sendTon`, прямой доступ к `memory.db`, эксфильтрацию Telegram-сессии. Плагины также могут регистрировать собственные LLM-инструменты (`registry.registerPluginTools`), которые модель будет вызывать автономно, «отмывая» действия через agent-loop.

## Предложенное исправление

1. **Short-term:**
   - требовать per-plugin Ed25519 подпись (публичные ключи, запиненные в репо/пользовательском конфиге), верифицировать при загрузке;
   - отказывать в загрузке плагинов, чья директория имеет group/world write (`stat.mode & 0o022`);
   - гейтить `chokidar` hot-reload за явным флагом `plugins.hot_reload: true` (dev-only) и отключать при `NODE_ENV === "production"`.
2. **Long-term:** запускать каждый плагин в Worker через `worker_threads` с узким `MessageChannel`-SDK. Блокировать `require`/`import` для `fs`, `child_process`, `net` и внутренних модулей Node через permission-policy JSON либо флаги `--experimental-permission --allow-fs-read=<plugin-dir>`.
3. Добавить регрессионный тест: плагин, вызывающий `require("fs").readFileSync(process.env.HOME + "/.teleton/wallet.json")`, должен падать на стадии загрузки либо в рантайме.

## Критерии приёмки

- [ ] В менеджере плагинов появилась верификация подписи/чек-суммы перед `import()`.
- [ ] Hot-reload через `chokidar` гейтирован dev-флагом и отключён в `production`.
- [ ] Проверка прав директории (`stat.mode & 0o022`) выполняется перед загрузкой плагина.
- [ ] CI-тест проверяет, что вредоносный плагин не может прочитать `wallet.json`.
- [ ] Документация `docs/plugins.md` обновлена — описан процесс подписи.
- [ ] Существующие plugin-тесты проходят.

## Оценка

**Effort:** medium–large (2–5 инженерных дней).
**Priority:** P0 — до включения плагинов в продакшене.
