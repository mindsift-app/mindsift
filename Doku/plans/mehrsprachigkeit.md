# Plan: MindSift mehrsprachig machen

Stand 2026-11-03. Ziel: Jeder Nutzer wählt seine Sprache, die ganze Oberfläche und alles, was der Server in seinem Namen schreibt (E-Mails, Push, Tageszusammenfassung, Journal), erscheint darin. Erste weitere Sprache ist **Englisch**; **weitere Sprachen folgen** und sollen ohne Code-Änderung dazukommen können (Beiträge im öffentlichen Repo). Außerdem wird `Doku/` auf Englisch umgestellt.

## Ausgangslage

- Alle Texte stehen fest im Code, auf Deutsch: rund **1.200 Zeilen in 114 Frontend-Dateien** und rund **470 Zeichenketten im Go-Backend** (Fehlermeldungen, E-Mails, Push, Seed- und Hilfe-Notizen).
- Formate sind fest auf Deutsch: 14 × `'de-DE'`, eigene Wochentags- und Monatslisten (`lib/due.ts`, `api/journal.go`), `HumanDue` mit „Uhr“ (`domain/due.go`), Spracherkennung `recognition.lang = 'de-DE'`, `<html lang="de">`, `manifest.json`.
- Es gibt keine i18n-Bibliothek und kein Sprachfeld am Nutzer.

## Entscheidungen

Mit dem Nutzer abgestimmt (2026-11-03): bestehende Nutzer bleiben bei Deutsch; weitere Sprachen kommen; der Administrator legt die Standardsprache fest; MCP auf Englisch; `Doku/` wird englisch; das `README.md` bleibt außen vor und wird später gesondert überarbeitet.

| Frage | Entscheidung | Begründung |
|---|---|---|
| Bibliothek | **i18next + react-i18next** | Verbreitet, Pluralformen, Platzhalter, Nachladen je Sprache, typisierte Schlüssel. Eigenbau lohnt bei ~1.200 Texten nicht. |
| Quellsprache | **Deutsch** bleibt Quelle und Rückfallsprache | Die Texte sind auf Deutsch geschrieben und geprüft; Englisch wird daraus übersetzt. |
| Schlüssel | sprechend und nach Bereich: `tasks.detail.saveAndClose` | Lesbar im Code, Konflikte unwahrscheinlich. |
| Dateien | `frontend/src/locales/<sprache>/<bereich>.json` (Namespaces wie `features/`) | Übersetzer arbeiten ohne Code; Deutsch wird mitgebündelt, andere Sprachen erst bei Bedarf geladen. |
| Sprachwahl | Feld `language` am Nutzer; ohne Wahl die Browsersprache (wenn es sie gibt), sonst die Standardsprache der Instanz | Vor der Anmeldung (Login, Registrierung) zählt ebenso die Browsersprache, dann die Standardsprache. |
| Bestehende Nutzer | Die Migration setzt `language = 'de'` für alle vorhandenen Konten | Für sie ändert sich nichts, auch wenn ihr Browser englisch ist. |
| Standardsprache | Der Administrator stellt sie in den Admin-Einstellungen ein (gespeichert in der Datenbank wie die übrigen Instanz-Einstellungen); `DEFAULT_LANGUAGE` gibt nur den Startwert für neue Installationen vor (Vorgabe `de`) | Gilt für neue Konten ohne passende Browsersprache, für Demo- und Seed-Daten und für E-Mails an Adressen ohne Konto. |
| Backend | eigener kleiner Katalog `internal/i18n` (Go-Maps je Sprache, `T(lang, key, args)`) | Wenige Dutzend Texte, keine Abhängigkeit nötig. |
| API-Fehler | Antwort bekommt zusätzlich einen festen `code`; die Oberfläche übersetzt anhand des Codes, `message` bleibt als Rückfall | Fehler entstehen oft ohne Nutzerbezug (z. B. vor dem Login). |
| MCP | Werkzeugbeschreibungen und Fehlermeldungen für Agenten **auf Englisch**, unabhängig vom Nutzer | Agenten verstehen Englisch am zuverlässigsten; Inhalte des Nutzers bleiben unverändert. |
| Doku | `Doku/` wird auf Englisch umgestellt (einmalige Übersetzung, danach wird nur noch englisch geschrieben) | Öffentliches Repo, Beiträge aus anderen Sprachen. Das `README.md` bleibt vorerst deutsch. |
| Nicht übersetzt | Inhalte der Nutzer (Notizen, Aufgaben, Hashtags), gespeicherte Journal-Titel | Journal-Titel entstehen beim Anlegen in der Sprache des Nutzers und bleiben dann, wie sie sind. |

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

1. **Grundgerüst** (Patch): i18next einbinden, `lib/format.ts`, Feld `language` am Nutzer (Migration setzt vorhandene Konten auf `de`, `GET/PUT /me`), Standardsprache in den Admin-Einstellungen, Sprachwahl in den Kontoeinstellungen, vorerst nur mit Deutsch. Test, dass jede Sprachdatei dieselben Schlüssel hat wie Deutsch.
2. **Texte herausziehen** (mehrere Patches, Bereich für Bereich wie die `features/`-Ordner): `app/`, `workspace/`, Aufgaben, Listen, Triage, Einstellungen, Auth, Hilfe. Danach eine ESLint-Regel gegen neue feste Texte in JSX (`i18next/no-literal-string`), damit nichts Neues hart codiert dazukommt.
3. **Englisch** (Minor): englische Sprachdateien, Auswahl freigeschaltet, zweiter Satz Referenz-Screenshots auf Englisch (vor allem für die Handy-Ansichten: englische Texte sind oft kürzer, deutsche länger; Umbrüche prüfen).
4. **Backend** (Patch oder Minor): `internal/i18n`, Fehlercodes in den API-Antworten, E-Mails, Push, Tageszusammenfassung, Journal, `HumanDue`, MCP auf Englisch. Zeitabhängige Tests wie gehabt mit mehreren `TZ` laufen lassen.
5. **Seed, Hilfe, Manifest**: Hilfe-Notizen und Demo-Daten auf Englisch, Manifest je Sprache, `Doku/i18n.md` mit der Anleitung „neue Sprache hinzufügen“ für Beiträge im öffentlichen Repo.

## Aufwand und Risiken

- **Aufwand: groß.** Der größte Teil ist Schritt 2 (Fleißarbeit, aber mechanisch); Schritt 4 ist mittel.
- **Risiko Regression:** gering dank Referenz-Screenshots; größte Gefahr sind vergessene Texte (die Schlüsselprüfung und die ESLint-Regel fangen das auf).
- **Risiko Layout:** längere Übersetzungen sprengen Schaltflächen am Handy. Wird mit dem englischen Screenshot-Satz geprüft.
- **Laufender Betrieb:** Bestehende Nutzer bekommen `language = 'de'` und sehen weiter Deutsch, bis sie selbst umstellen.
- **Weitere Sprachen:** Von Anfang an so gebaut, dass eine Sprache nur aus Sprachdateien (Frontend und `internal/i18n`) plus Hilfe-Markdown besteht; Sprachen mit anderen Pluralregeln (z. B. Polnisch) deckt i18next ab. Rechts-nach-links-Schrift ist nicht vorgesehen.

## Nicht Teil dieses Plans

- `README.md`: wird später gesondert überarbeitet.
- Übersetzung von `Doku/` ins Englische: läuft getrennt auf einem eigenen Branch und wird danach gemergt; danach gilt für neue Doku Englisch.
