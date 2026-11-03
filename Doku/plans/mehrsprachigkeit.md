# Plan: A Multilingual MindSift

As of 2026-11-03. Goal: everyone picks their language, and the whole interface plus everything the server writes on their behalf (emails, push, daily summary, journal) appears in it. Languages offered: **German, English, Spanish, French and Italian**; further languages can be added without code changes (contributions in the public repo). `Doku/` is in English.

## Status

| Step | Content | Status |
|---|---|---|
| 1 | Groundwork: i18next, `users.language`, admin default language | done (v0.73.0) |
| 2 | Move all interface texts into language files | done (v0.73.1–v0.73.6) |
| 3 | English in the interface | done (v0.74.0) |
| 4 | Backend in English: emails, push, daily summary, journal, due dates, default columns, error codes, MCP in English | in progress (Claude): error messages, error codes and MCP done in v0.74.2; emails, push, summary, journal, due dates, columns next |
| 5 | Demo and help notes per language, `manifest.json` per language, guide "adding a language" | mechanism by Claude, content by Gemini |
| 6 | Spanish, French, Italian (interface, help, backend catalog, demo content) | Gemini, after step 4 |

## Decisions

Agreed with the user on 2026-11-03: existing users stay on German; more languages follow (es, fr, it); the admin sets the default language; MCP texts are English; `Doku/` is English; the `README.md` is left out and revised separately later.

| Question | Decision | Reason |
|---|---|---|
| Library | **i18next + react-i18next** | Widely used, plurals, placeholders, loading per language. |
| Source language | **German** stays the source and fallback | The texts were written and checked in German. |
| Keys | descriptive, by area: `tasks.detail.saveAndClose` | Readable in the code. |
| Files | `frontend/src/locales/<lang>/<area>.json` (namespaces like `features/`) | Translators work without code; German is bundled, other languages load on first use. |
| Key check | a test instead of TypeScript types | The project compiles without `strictNullChecks`, where i18next cannot type its keys. The test checks that every `t('…')` exists and that every language has the German keys and placeholders (plural forms may differ). |
| Fixed text | ESLint rule `i18next/no-literal-string` (JSX text) | Keeps new hard-coded text out; names like MindSift, OAuth, Discord, keys and MCP tool names are excluded. |
| Help | one content file per language (`features/help/content/<lang>.tsx`) instead of Markdown | Keeps the help's layout exactly as it is; translators copy one file. |
| Language choice | `language` per user; without a choice the browser language (if supported), else the server's default | Before signing in, the browser language and then the default apply as well. |
| Existing users | migration sets `language = 'de'` for all existing accounts | Nothing changes for them. |
| Default language | admin setting (system settings); `DEFAULT_LANGUAGE` only gives the start value (default `de`) | Applies to new accounts without a matching browser language, demo and seed data, emails to addresses without an account. |
| Backend | small catalog `internal/i18n` (Go maps per language, `T(lang, key, args)`) | A few dozen texts, no dependency needed. |
| API errors | responses get a fixed `code` in addition; the interface translates by code, `message` stays as fallback | Errors often happen without a known user (e.g. before signing in). |
| MCP | tool descriptions and agent-facing errors **in English**, regardless of the user | Agents understand English most reliably; user content stays unchanged. |
| Slash commands | names stay (`/diktat` included) and keep their German search aliases | Aliases per language can be added later. |
| Not translated | user content (notes, tasks, hashtags), stored journal titles | Journal titles are created in the user's language and stay as they are. |

## What is affected

**Frontend** (done in steps 1–3): all visible texts, `aria-label`, `title`, placeholders, confirmations, toasts; plurals via i18next; dates via `lib/format.ts`; voice recognition and `<html lang>` follow the language; built-in theme and default column names via keys.

**Backend** (step 4)
- Emails (`mailtemplate.go`, password reset, registration), push and daily summary (`notify.go`, `alarms.go`): in the recipient's language.
- `HumanDue` and `journalTitle`: format per language.
- Default columns of new task lists (`storage/tasklists.go`): in the creator's language.
- API errors: a stable `code` per error; the frontend shows the translated text, the server's `message` stays as fallback. Then the login check for unconfirmed emails no longer matches the German text.
- MCP: descriptions and errors in English.
- Export folder names (`Aufgaben/`, `Listen/` in the Markdown archive): per language.

**Seed and manifest** (step 5)
- Help notes (`seed_help.go`) and demo data (`seed.go`, `demo.go`) per language; the demo uses the default language.
- `manifest.json` (name, shortcuts): served per `Accept-Language`. Android applies changes only with its next app update.

## Steps

Every step is a release of its own. Steps 1 and 2 changed nothing visible; the German reference screenshots (`e2e/refshots.sh`) stayed identical. `e2e/enshots.mjs` takes English screenshots for checking translations and line breaks.

1. **Groundwork** (done): i18next, `lib/format.ts`, `users.language`, admin default language, language choice in the account settings.
2. **Extract texts** (done): area by area, then the ESLint rule.
3. **English** (done): English language files and help, loaded on demand, English screenshots.
4. **Backend**: `internal/i18n` catalog, error codes, emails, push, daily summary, journal, `HumanDue`, default columns, MCP in English. Run time-dependent tests with several `TZ` values as usual.
5. **Seed, help, manifest**: seed data per language (mechanism by Claude, English content by Gemini), manifest per language, `Doku/i18n.md` with the guide "adding a language".
6. **Spanish, French, Italian** (Gemini): locale files, help content, backend catalog and demo content per language; codes added to `LANGUAGES` and `Supported`.

## Effort and risks

- **Regressions:** low thanks to reference screenshots; forgotten texts are caught by the key test and the ESLint rule.
- **Layout:** longer translations can break buttons on phones; check with `e2e/enshots.mjs` (adapted per language).
- **Running instances:** existing users have `language = 'de'` and keep German until they change it.
- **More languages:** a language consists of locale files, a help file, a backend catalog and demo content; plural rules of other languages are covered by i18next. Right-to-left scripts are not planned.

## Not part of this plan

- `README.md`: revised separately later.
