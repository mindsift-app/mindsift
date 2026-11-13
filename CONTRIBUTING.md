# Contributing to MindSift

Thanks for taking the time. Bug reports, ideas and pull requests are welcome; for security problems please follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## How the project is made

MindSift is developed with a lot of AI assistance. One person decides what goes in, tries it on real devices and answers for every commit; all commits are made under the project identity `MindSift <noreply@mindsift.app>`. What keeps the code honest are the checks below, and they apply to every contribution, written by a person or with an assistant.

## Before you open a pull request

Run the checks locally. They need only podman (or Docker with `ENGINE=docker`), no local Node or Go:

```bash
ci/local-checks.sh          # tsc, ESLint, Vitest, gofmt, go vet, golangci-lint, Go tests, build plan
E2E=1 ci/local-checks.sh    # plus the browser tests (Playwright, a few minutes)
```

`E2E=1` is required for changes to notes, sharing, sync, locks or sign-in; see [e2e/README.md](e2e/README.md). The pipeline does not run these tests for you, so a pull request should say that both were green.

ESLint runs without warnings, and new code should not add any. An intentionally omitted hook dependency gets a one-line reason above its `// eslint-disable-next-line react-hooks/exhaustive-deps`.

## Language

- **German is the main language of the interface** and the language of the tests: unit tests, browser tests and screenshots of checks run against the German interface and the German sample data (start a test server with `DEFAULT_LANGUAGE=de`). Write new tests with German texts.
- **No interface text in the code.** Texts, messages and mails live in the locale files, `frontend/src/locales/<code>/<area>.json` for each of the five languages (de, en, es, fr, it), and are read with `t('…')`. ESLint rejects literal strings in JSX, and a test checks that every key exists. The server's messages are in `internal/i18n`. Details: [Doku/i18n.md](Doku/i18n.md).
- Code comments, commit messages, the changelog, `README.md` and `Doku/` are English.

## Commits and changelog

- Commit messages follow `type(area): summary`, e.g. `feat(tasks): …`, `fix(sync): …`, `docs: …`, `style(notes): …`, `chore: …`.
- Changes people notice get an entry in [CHANGELOG.md](CHANGELOG.md) under `## [Unreleased]`, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) form (Added, Changed, Fixed, Removed), written from the user's point of view. Do not bump the version; that happens at release.
- When behaviour or the API changes, update `README.md` and the files in [Doku/](Doku/README.md) (`api/rest.md`, `architecture.md`) in the same pull request.

## Dependencies

Few dependencies is a design goal (see [Doku/architecture.md](Doku/architecture.md#design-decisions)). Before adding one, check whether a few lines of own code would do. A new version of a dependency, base image or build tool is taken only once that release is **at least 14 days old**; fixes for a known vulnerability are the exception.

## Interface

Reuse the existing components and patterns in [Doku/ui-patterns.md](Doku/ui-patterns.md), use the theme colours instead of fixed ones, check the phone layout (below 768 px) as well as the desktop, and use no browser dialogs (`alert`, `confirm`, `prompt`).
