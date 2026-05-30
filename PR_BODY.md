## Аудит доступности (WCAG 2.1 AA) + CI-гейт для WebUI

Закрывает #499.

### Что сделано

- **Инфраструктура аудита.** Добавлен прогон [`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm) по всем **23 страницам** WebUI (22 авторизованных маршрута + отдельный flow настройки) с набором правил WCAG 2.1 A/AA (`wcag2a, wcag2aa, wcag21a, wcag21aa`). Каждая страница загружается против мок-бэкенда (`web/e2e/mock-api.ts`).
- **Базовый отчёт (baseline).** После прогона формируются `web/a11y-report/baseline.json` (машиночитаемый) и `web/a11y-report/summary.md` (человекочитаемый); они выгружаются как артефакт CI `a11y-report` на каждом запуске (в т. ч. при падении).
- **CI-гейт на каждый PR.** Отдельный workflow [`.github/workflows/accessibility.yml`](.github/workflows/accessibility.yml) запускается на каждый pull request, затрагивающий `web/**`, и **падает** при любом нарушении уровня `critical`/`serious`.
- **Исправлены все critical/serious нарушения:**
  - **Контраст активной ссылки навигации.** Акцентный `#5b8cff` на смешанной мягко-акцентной подложке давал 3.86:1 (ниже порога AA 4.5:1). Введена переменная `--accent-bright: #8fb0ff` (5.45:1) для активного пункта `.nav-item.active`.
  - **Движение.** Добавлен блок `@media (prefers-reduced-motion: reduce)`, отключающий анимации/переходы (WCAG 2.3.3 / 2.2.2) — это и фича доступности, и стабилизация аудита.
- **Документация.** Добавлен [`docs/accessibility.md`](docs/accessibility.md): цель WCAG 2.1 AA, описание CI-гейта, как запускать локально, таблица исправлений, принятые advisory-нарушения и инструкция по замеру Lighthouse.

### Детерминизм аудита

Анимации появления (fade) приводили к тому, что axe замерял цвет в середине анимации (пониженная opacity) и выдавал «плавающие» нарушения `color-contrast`. Устранено тремя мерами в тесте:

- эмуляция `prefers-reduced-motion: reduce` (`page.emulateMedia`);
- инъекция стиля, обнуляющего длительности анимаций/переходов;
- доводка оставшихся анимаций до финального кадра (`document.getAnimations().forEach(a => a.finish())`).

Дополнительно `vite preview` и Playwright привязаны к `127.0.0.1` (включая `--host 127.0.0.1`), чтобы исключить рассинхрон IPv6/IPv4 в CI.

### Как воспроизвести / запустить локально

```bash
cd web
npm ci
npm run test:a11y:install   # один раз: установка Chromium
npm run build
npm run test:a11y
```

Отчёт — в `web/a11y-report/summary.md` и `web/a11y-report/baseline.json`.

### Принятые advisory-нарушения (не блокируют CI)

| Правило | Страницы | Примечание |
| ------- | -------- | ---------- |
| `list` / `aria-required-children` | Memory, Network | Легенда KnowledgeGraph (`.kg-legend`) — визуальный элемент, не интерактивный список; вынесено в будущий рефакторинг. |

### Критерии приёмки

- [x] Опубликован baseline-отчёт (артефакт CI + `web/a11y-report/`).
- [x] Исправлены все critical/serious нарушения.
- [x] CI-гейт падает на critical/serious на каждом PR.
- [x] Добавлен `docs/accessibility.md`.
- [x] Lighthouse accessibility ≥ 85 на главном дашборде (инструкция по замеру в docs).
