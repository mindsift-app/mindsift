# Plan: MindSift mehrsprachig machen

Stand 2026-11-03. Ziel: Jeder Nutzer wählt seine Sprache, die ganze Oberfläche und alles, was der Server in seinem Namen schreibt (E-Mails, Push, Tageszusammenfassung, Journal), erscheint darin. Erste weitere Sprache ist **Englisch**; weitere Sprachen sollen ohne Code-Änderung dazukommen können (Beiträge im öffentlichen Repo).

## Ausgangslage

- Alle Texte stehen fest im Code, auf Deutsch: rund **1.200 Zeilen in 114 Frontend-Dateien** und rund **470 Zeichenketten im Go-Backend** (Fehlermeldungen, E-Mails, Push, Seed- und Hilfe-Notizen).
- Formate sind fest auf Deutsch: 14 × `'de-DE'`, eigene Wochentags- und Monatslisten (`lib/due.ts`, `api/journal.go`), `HumanDue` mit „Uhr“ (`domain/due.go`), Spracherkennung `recognition.lang = 'de-DE'`, `<html lang="de">`, `manifest.json`.
- Es gibt keine i18n-Bibliothek und kein Sprachfeld am Nutzer.

## Entscheidungen (Vorschlag)

| Frage | Vorschlag | Begründung |
|---|---|---|
| Bibliothek | **i18next + react-i18next** | Verbreitet, Pluralformen, Platzhalter, Nachladen je Sprache, typisierte Schlüssel. Eigenbau lohnt bei ~1.200 Texten nicht. |
| Quellsprache | **Deutsch** bleibt Quelle und Rückfallsprache | Die Texte sind auf Deutsch geschrieben und geprüft; Englisch wird daraus übersetzt. |
| Schlüssel | sprechend und nach Bereich: `tasks.detail.saveAndClose` | Lesbar im Code, Konflikte unwahrscheinlich. |
| Dateien | `frontend/src/locales/<sprache>/<bereich>.json` (Namespaces wie `features/`) | Übersetzer arbeiten ohne Code; Deutsch wird mitgebündelt, andere Sprachen erst bei Bedarf geladen. |
| Sprachwahl | Feld `language` am Nutzer; ohne Wahl die Browsersprache, sonst Instanz-Standard (`DEFAULT_LANGUAGE`, Vorgabe `de`) | Vor der Anmeldung (Login, Registrierung) zählt die Browsersprache. |
| Backend | eigener kleiner Katalog `internal/i18n` (Go-Maps je Sprache, `T(lang, key, args)`) | Wenige Dutzend Texte, keine Abhängigkeit nötig. |
| API-Fehler | Antwort bekommt zusätzlich einen festen `code`; die Oberfläche übersetzt anhand des Codes, `message` bleibt als Rückfall | Fehler entstehen oft ohne Nutzerbezug (z. B. vor dem Login). |
| MCP | Werkzeugbeschreibungen und Fehlermeldungen für Agenten **auf Englisch**, unabhängig vom Nutzer | Agenten verstehen Englisch am zuverlässigsten; Inhalte des Nutzers bleiben unverändert. |
| Nicht übersetzt | Inhalte der Nutzer (Notizen, Aufgaben, Hashtags), gespeicherte Journal-Titel, `Doku/` | Journal-Titel entstehen beim Anlegen in der Sprache des Nutzers und bleiben dann, wie sie sind. |

## Was alles betroffen ist

**Frontend**
- Alle sichtbaren Texte, `aria-label`, `title`, Platzhalter, Bestätigungen, Toasts.
- Zahlen mit Mehrzahl („1 Aufgabe“ / „3 Aufgaben“) über i18next-Pluralformen statt eigener Bedingungen.
- Datum und Uhrzeit: ein zentrales `lib/format.ts` auf Basis von `Intl.DateTimeFormat` mit der aktuellen Sprache; `WEEKDAYS` in `lib/due.ts` und alle `'de-DE'` entfallen. Wochenbeginn bleibt Montag (später ggf. aus der Sprache).
- Spracherkennung (`useVoiceInput.ts`) nimmt die Nutzersprache.
- `<html lang>` wird zur Laufzeit gesetzt.
- Eingebaute Themes und Kanban-Standardspalten: Namen über Schlüssel statt gespeicherter deutscher Texte (eigene Namen der Nutzer bleiben).
- Hilfe-Ansicht (`HelpView.tsx`, ~1.000 Zeilen) ist vor allem Fließtext: je Sprache eine eigene Markdown-Datei statt vieler einzelner Schlüssel.

**Backend**
- E-Mails (`mailtemplate.go`, Passwort zurücksetzen, Registrierung), Push und Tageszusammenfassung (`notify.go`, `alarms.go`): Sprache des Empfängers.
- `HumanDue` und `journalTitle`: Format je Sprache.
- Seed-Daten: Hilfe-Notizen (`seed_help.go`) und Demo-Daten (`seed.go`, `demo.go`) je Sprache; die Demo nimmt den Instanz-Standard.
- `manifest.json` (Name, Verknüpfungen): vom Server je nach `Accept-Language` ausgeliefert. Android übernimmt Änderungen erst beim nächsten App-Update.

## Umsetzung in Schritten

Jeder Schritt ist ein eigenes Release. Die Schritte 1 und 2 sind reine Umbauten ohne sichtbare Änderung; als Sicherheitsnetz dient wie beim Aufteilen des Frontends `e2e/refshots.sh`: alle deutschen Screenshots müssen danach gleich aussehen.

1. **Grundgerüst** (Patch): i18next einbinden, `lib/format.ts`, Feld `language` am Nutzer (Migration, `GET/PUT /me`), Sprachwahl in den Kontoeinstellungen, vorerst nur mit Deutsch. Test, dass jede Sprachdatei dieselben Schlüssel hat wie Deutsch.
2. **Texte herausziehen** (mehrere Patches, Bereich für Bereich wie die `features/`-Ordner): `app/`, `workspace/`, Aufgaben, Listen, Triage, Einstellungen, Auth, Hilfe. Danach eine ESLint-Regel gegen neue feste Texte in JSX (`i18next/no-literal-string`), damit nichts Neues hart codiert dazukommt.
3. **Englisch** (Minor): englische Sprachdateien, Auswahl freigeschaltet, zweiter Satz Referenz-Screenshots auf Englisch (vor allem für die Handy-Ansichten: englische Texte sind oft kürzer, deutsche länger; Umbrüche prüfen).
4. **Backend** (Patch oder Minor): `internal/i18n`, Fehlercodes in den API-Antworten, E-Mails, Push, Tageszusammenfassung, Journal, `HumanDue`, MCP auf Englisch. Zeitabhängige Tests wie gehabt mit mehreren `TZ` laufen lassen.
5. **Seed, Hilfe, Manifest**: Hilfe-Notizen und Demo-Daten auf Englisch, Manifest je Sprache, `Doku/i18n.md` mit der Anleitung „neue Sprache hinzufügen“ für Beiträge im öffentlichen Repo.

## Aufwand und Risiken

- **Aufwand: groß.** Der größte Teil ist Schritt 2 (Fleißarbeit, aber mechanisch); Schritt 4 ist mittel.
- **Risiko Regression:** gering dank Referenz-Screenshots; größte Gefahr sind vergessene Texte (die Schlüsselprüfung und die ESLint-Regel fangen das auf).
- **Risiko Layout:** längere Übersetzungen sprengen Schaltflächen am Handy. Wird mit dem englischen Screenshot-Satz geprüft.
- **Laufender Betrieb:** Bestehende Nutzer bekommen `language` leer, sehen also weiter Deutsch (oder ihre Browsersprache, wenn es sie gibt; zu klären, siehe unten).

## Offene Fragen an den Nutzer

1. Sollen bestehende Nutzer ohne gewählte Sprache automatisch ihre Browsersprache bekommen oder bei Deutsch bleiben?
2. Weitere Sprachen außer Englisch geplant, oder vorerst nur Deutsch und Englisch?
3. MCP auf Englisch (Vorschlag) oder in der Sprache des Nutzers?
4. Soll das `README.md` des öffentlichen Repos auf Englisch umgestellt werden (eigene Entscheidung, nicht Teil dieses Plans)?
