---
title: "[AUDIT-FULL-H8] `install.sh install_git` re-pulls from whatever remote an existing `~/.teleton-app` points to"
labels: ["bug", "audit-finding-full", "high", "security", "supply-chain", "installer"]
milestone: "v3.0 - Production Ready"
severity: high
category: security
effort: small
priority: P1
---

## Источник

Найдено в ходе полного аудита — issue #304, отчёт [`FULL_AUDIT_REPORT.md`](../../FULL_AUDIT_REPORT.md) (FULL-H8).

## Описание

Отсутствует проверка того, что у предсуществующего репозитория `origin` действительно указывает на `github.com/tonresistor/teleton-agent`. Атакующий, однажды подбросивший «похожий» `~/.teleton-app` с чужим remote, может молча перенаправить последующие апгрейды.

## Местоположение

- `install.sh:93-108`
  ```bash
  if [ -d "${install_dir}" ]; then
    warn "Directory ${install_dir} already exists, updating..."
    git -C "${install_dir}" pull --ff-only
  else
    git clone "https://github.com/${REPO}.git" "${install_dir}"
  fi
  ```

## Влияние

Повторный запуск one-liner-установщика (задокументированный путь апгрейда) способен подменить codebase и выполнить `npm install` + `npm run build` с доступом к TON-кошельку, Telegram-сессии и API-ключам.

## Предложенное исправление

```bash
local expected="https://github.com/${REPO}.git"
local actual
actual=$(git -C "${install_dir}" remote get-url origin 2>/dev/null || echo "")
if [ "${actual}" != "${expected}" ]; then
  error "Existing ${install_dir} has unexpected origin (${actual}). Remove it and re-run."
fi
```

Также отвергать `pull` с грязной working-tree.

## Критерии приёмки

- [ ] `install.sh` проверяет `origin` до `git pull`.
- [ ] Dirty working-tree отклоняется с понятной ошибкой.
- [ ] Ручной тест: подставлен ложный `origin` → install.sh завершается с ошибкой.
- [ ] Ручной тест: корректный `origin` → install.sh успешно обновляет репозиторий.
- [ ] `README` / `docs/installation.md` описывают новое поведение.

## Оценка

**Effort:** small (≈ 1–2 часа).
**Priority:** P1 — до v3.0.
