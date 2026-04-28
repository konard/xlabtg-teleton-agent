# Teleton Agent — Руководство пользователя WebUI / WebUI User Guide

[English](#english) · [Русский](#russian)

---

<a id="english"></a>

## English

This is the operator handbook for the Teleton Agent web interface. It covers every page of the WebUI in the order they appear in the sidebar, walks through the initial setup wizard, and explains the day-to-day workflow for running the agent safely.

> The WebUI ships with an **English-only** interface today. The Russian version of this guide translates every concept and procedure, but the on-screen labels you click stay in English. UI labels in the Russian text are kept in English in parentheses, e.g. «Панель управления (Dashboard)», so you can match the guide to what you see.

### Start here

| # | Section | Use it when |
| --- | --- | --- |
| 1 | [Quick Start](en/01-quick-start.md) | First install or onboarding a new operator. |
| 2 | [Dashboard](en/02-dashboard.md) | Daily status check, widgets, quick actions. |
| 3 | [Autonomous Mode](en/03-autonomous-mode.md) | Long-running goal-oriented tasks. |
| 4 | [Tools](en/04-tools.md) | Enabling, scoping and auditing tools. |
| 5 | [Soul Editor](en/05-soul-editor.md) | Editing the agent personality and policies. |
| 6 | [Analytics](en/06-analytics.md) | Tokens, cost, latency, anomalies, feedback. |
| 7 | [Sessions](en/07-sessions.md) | Browsing chat history and corrections. |
| 8 | [Security Center](en/08-security.md) | Audit trail, approvals, policies, secrets. |
| 9 | [Hooks](en/09-hooks.md) | Keyword blocklists, context triggers, rule builder. |
| 10 | [Advanced Features](en/10-advanced-features.md) | Workspace, Tasks, Workflows, Pipelines, Events, MCP, Network, Plugins, Memory, Self-Improve, Feedback. |
| 11 | [Settings](en/11-settings.md) | Configuration tabs (LLM, Telegram, MTProto, vector memory, etc.). |
| 12 | [Troubleshooting](en/12-troubleshooting.md) | Login, agent, Telegram, tools, vectors, costs. |
| 13 | [FAQ and Best Practices](en/13-faq-best-practices.md) | Common questions and recommended habits. |

### Visual assets

- Screenshots: [`assets/screenshots/en/`](assets/screenshots/en) (English text), [`assets/screenshots/ru/`](assets/screenshots/ru) (RU labels reuse English UI captures because the live UI is English), and [`assets/screenshots/common/`](assets/screenshots/common) for the login and setup screens captured from the bundled WebUI build.
- Diagrams: [Architecture](assets/diagrams/architecture-v2.svg) · [Autonomous state machine](assets/diagrams/autonomous-state-machine.svg) · [Task creation flow](assets/diagrams/task-creation-flow.svg) · [Events and webhooks](assets/diagrams/webhooks-event-bus.svg) · [Multi-agent network](assets/diagrams/multi-agent-network.svg)

### Pages covered

Dashboard, Agents, Tools, Plugins, Soul, Memory, Workspace, Tasks, Workflows, Pipelines, Events, MCP, Integrations, Network, Hooks, Sessions, Analytics, Feedback, Security, Self-Improve, Autonomous Mode, Configuration. Login screen and the seven-step setup wizard are described in [Quick Start](en/01-quick-start.md).

---

<a id="russian"></a>

## Russian / Русский

Это руководство оператора по веб-интерфейсу Teleton Agent. Оно описывает каждую страницу WebUI в порядке появления в боковом меню, шаг за шагом проводит через мастер первичной настройки и объясняет ежедневную работу по безопасному управлению агентом.

> На сегодняшний день WebUI работает **только на английском языке**. Русская версия руководства переводит все понятия и процедуры, но подписи кнопок и пунктов меню остаются английскими. Чтобы вы могли быстро найти их в интерфейсе, английские названия даны в скобках рядом с переводом, например «Панель управления (Dashboard)».

### С чего начать

| № | Раздел | Когда использовать |
| --- | --- | --- |
| 1 | [Быстрый старт](ru/01-quick-start.md) | Первая установка или ввод нового оператора. |
| 2 | [Панель управления (Dashboard)](ru/02-dashboard.md) | Ежедневная проверка статуса, виджеты, быстрые действия. |
| 3 | [Автономный режим (Autonomous Mode)](ru/03-autonomous-mode.md) | Длительные задачи с целью. |
| 4 | [Инструменты (Tools)](ru/04-tools.md) | Включение, ограничение и аудит инструментов. |
| 5 | [Редактор Soul](ru/05-soul-editor.md) | Редактирование характера и политик агента. |
| 6 | [Аналитика (Analytics)](ru/06-analytics.md) | Токены, стоимость, задержки, аномалии, обратная связь. |
| 7 | [Сессии (Sessions)](ru/07-sessions.md) | Просмотр истории чатов и коррекций. |
| 8 | [Центр безопасности (Security Center)](ru/08-security.md) | Журнал аудита, согласования, политики, секреты. |
| 9 | [Хуки (Hooks)](ru/09-hooks.md) | Блок-листы, контекстные триггеры, конструктор правил. |
| 10 | [Продвинутые возможности](ru/10-advanced-features.md) | Workspace, Tasks, Workflows, Pipelines, Events, MCP, Network, Plugins, Memory, Self-Improve, Feedback. |
| 11 | [Настройки (Configuration)](ru/11-settings.md) | Вкладки конфигурации (LLM, Telegram, MTProto, векторная память и пр.). |
| 12 | [Устранение неполадок](ru/12-troubleshooting.md) | Вход, агент, Telegram, инструменты, векторы, стоимость. |
| 13 | [FAQ и лучшие практики](ru/13-faq-best-practices.md) | Типичные вопросы и рекомендуемые привычки. |

### Визуальные материалы

- Скриншоты: [`assets/screenshots/en/`](assets/screenshots/en) (англоязычные подписи), [`assets/screenshots/ru/`](assets/screenshots/ru) (используются те же английские снимки, так как живой интерфейс на английском) и [`assets/screenshots/common/`](assets/screenshots/common) — для экрана входа и мастера установки, снятых из текущей сборки WebUI.
- Диаграммы: [Архитектура](assets/diagrams/architecture-v2.svg) · [Конечный автомат автономной задачи](assets/diagrams/autonomous-state-machine.svg) · [Поток создания задачи](assets/diagrams/task-creation-flow.svg) · [События и вебхуки](assets/diagrams/webhooks-event-bus.svg) · [Мультиагентная сеть](assets/diagrams/multi-agent-network.svg)

### Какие страницы описаны

Dashboard, Agents, Tools, Plugins, Soul, Memory, Workspace, Tasks, Workflows, Pipelines, Events, MCP, Integrations, Network, Hooks, Sessions, Analytics, Feedback, Security, Self-Improve, Autonomous Mode, Configuration. Экран входа и семь шагов мастера установки описаны в разделе [Быстрый старт](ru/01-quick-start.md).
