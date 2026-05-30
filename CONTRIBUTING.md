# Contributing to Teleton Agent

Thank you for your interest in contributing to Teleton Agent. This guide covers everything you need to get started.

## Table of Contents

- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Commit Conventions](#commit-conventions)
- [Versioning Policy (SemVer)](#versioning-policy-semver)
- [Releases](#releases)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Plugin Development](#plugin-development)
- [Code of Conduct](#code-of-conduct)

## Reporting Bugs

Open a [GitHub Issue](https://github.com/TONresistor/teleton-agent/issues/new?template=bug_report.md) using the bug report template. Include:

- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Node.js version, teleton version, LLM provider)

Search [existing issues](https://github.com/TONresistor/teleton-agent/issues) first to avoid duplicates.

## Suggesting Features

Open a [GitHub Issue](https://github.com/TONresistor/teleton-agent/issues/new?template=feature_request.md) using the feature request template. Describe the use case, your proposed solution, and any alternatives you considered.

## Development Setup

```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent
npm install
npm run dev
```

This starts the agent in watch mode with automatic restarts on file changes.

### Prerequisites

- **Node.js 20.0.0+** ([download](https://nodejs.org/))
- **npm 9+** (ships with Node.js)
- An LLM API key from any [supported provider](README.md#supported-providers) (Anthropic, OpenAI, Google, xAI, Groq, OpenRouter, Mistral, and more)
- Telegram API credentials from [my.telegram.org/apps](https://my.telegram.org/apps)

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in watch mode (tsx) |
| `npm run build` | Build backend (tsup) + frontend (vite) |
| `npm run typecheck` | Type checking (`tsc --noEmit`) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format with Prettier |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Branch Strategy

All work happens on **`main`**. There is no `dev` branch.

- **`main`** is the only branch. Tags and releases are cut from `main` directly.
- External contributors should fork the repo and open PRs against `main`.
- PRs are squash-merged to keep history clean.

## Commit Conventions

This project follows the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification. Commit messages are linted automatically by a Husky `commit-msg` hook (powered by [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint)), and the release tooling derives version bumps and the `CHANGELOG.md` directly from commit history — so the prefix you choose is not cosmetic, it decides the next release version.

Format:

```
<type>(<optional scope>): <description>
```

Common types:

| Type | When to use | Release effect (pre‑1.0 → post‑1.0) |
|------|-------------|-------------------------------------|
| `feat` | A new user-facing feature | minor → minor |
| `fix` | A bug fix | patch → patch |
| `perf` | A performance improvement | patch → patch |
| `docs` | Documentation only | none |
| `refactor` | Code change that neither fixes a bug nor adds a feature | none |
| `test` | Adding or fixing tests | none |
| `build` / `ci` | Build system or CI changes | none |
| `chore` | Tooling, deps, housekeeping | none |

**Breaking changes** are flagged with a `!` after the type/scope **or** a `BREAKING CHANGE:` footer:

```
feat(api)!: rename `sendMessage` to `send`

BREAKING CHANGE: `sendMessage` is removed; use `send` instead.
```

Examples:

```
feat: add DNS record caching for faster lookups
fix(memory): prevent double-send on FloodWaitError retry
docs: update plugin SDK examples
feat(config)!: drop deprecated `legacy_proxy` key
```

## Versioning Policy (SemVer)

Teleton Agent follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`.

- **MAJOR** — incompatible / breaking changes to the public surface (CLI commands and flags, `config.yaml` schema, the Plugin SDK, the WebUI HTTP API, and the on-disk database/migration contract). Signalled by a `feat!:` / `BREAKING CHANGE:` commit.
- **MINOR** — new, backward-compatible functionality (`feat:`).
- **PATCH** — backward-compatible bug fixes and performance improvements (`fix:`, `perf:`).

**Pre-1.0 caveat:** while the package is `0.x`, the public API is not yet considered stable. During this phase breaking changes bump the **minor** version and features/fixes bump the **patch** version, per the SemVer spec's allowance for initial development.

**What counts as a breaking change:**

- Removing or renaming a CLI command, subcommand, or flag.
- Removing, renaming, or changing the type of a `config.yaml` key (adding an optional key is **not** breaking).
- Removing or changing the signature of an exported Plugin SDK symbol or hook.
- Removing or changing the response shape of a WebUI API endpoint.
- A database migration that is not backward-compatible with the previous minor version.

Deprecations are announced at least one minor release before removal, kept working in the meantime, and documented in the `CHANGELOG.md` under a `Deprecated` heading.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please-action):

1. Merges to `main` accumulate into a **release PR** that release-please keeps up to date — it computes the next SemVer version from the Conventional Commits and regenerates `CHANGELOG.md`.
2. Merging that release PR tags the commit (`vX.Y.Z`) and publishes a GitHub Release.
3. The tag triggers the [`release.yml`](.github/workflows/release.yml) workflow, which builds and tests the package, then:
   - publishes to npm with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (`--provenance`),
   - publishes the Docker image to GHCR with a signed build-provenance attestation,
   - generates an [SPDX](https://spdx.dev/) **SBOM** (`teleton-agent.spdx.json`) and attaches it to the GitHub Release,
   - attaches a packed release tarball with a [SLSA Level 1](https://slsa.dev/) build-provenance attestation.

The attestations can be verified with:

```bash
# release tarball downloaded from the GitHub Release
gh attestation verify teleton-<version>.tgz --owner xlabtg

# the published Docker image
gh attestation verify oci://ghcr.io/xlabtg/teleton-agent:<version> --owner xlabtg

# the published npm package
npm audit signatures
```

Because the `CHANGELOG.md` is generated from commit history, do **not** edit it by hand — write good Conventional Commit messages instead.

## Making Changes

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/my-change
   ```
3. **Make your changes.** Keep commits focused on a single logical change.
4. **Write commit messages** following [Conventional Commits](#commit-conventions) — imperative mood, concise and descriptive. The `commit-msg` hook validates them:
   ```
   feat: add DNS record caching for faster lookups
   fix: prevent double-send on FloodWaitError retry
   docs: update plugin SDK examples
   ```
5. **Verify your changes** before pushing:
   ```bash
   npm run typecheck
   npm run lint:fix && npm run format
   npm test
   ```

## Pull Request Process

1. Push your branch to your fork.
2. Open a Pull Request **against `main`**.
3. Fill out the PR template completely.
4. Ensure all CI checks pass (type checking, linting, tests).
5. A maintainer will review your PR. Address any requested changes.
6. Once approved, your PR will be squash-merged into `main`.

### PR Guidelines

- Keep PRs focused. One PR per feature or fix.
- Include tests for new functionality when applicable.
- Update documentation if you change user-facing behavior.
- Do not include unrelated formatting changes or refactors.

## Code Style

The project uses **ESLint** and **Prettier** with pre-configured rules. A pre-commit hook (via Husky + lint-staged) runs automatically on staged files.

To manually check and fix:

```bash
npm run lint:fix && npm run format
```

Key conventions:

- TypeScript strict mode
- ES modules (`import`/`export`, not `require`)
- Explicit return types on exported functions
- Use `zod` for runtime validation of external inputs

## Plugin Development

Plugins extend the agent with custom tools without modifying core code. See the [Plugin SDK documentation](plugins.md) for a complete guide, or refer to the plugin example in the [README](README.md#plugins).

Plugins are loaded from `~/.teleton/plugins/` at startup -- no rebuild required.

---

Questions? Reach out on Telegram: [@ResistanceForum](https://t.me/ResistanceForum) or open a [discussion](https://github.com/TONresistor/teleton-agent/issues).
