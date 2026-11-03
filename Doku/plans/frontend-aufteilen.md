# Plan: Große Frontend-Dateien aufteilen (umgesetzt)

Stand 2026-11-03. Löst [FLAW-41](../flaws.md). Ziel: Die großen Ansichten werden in Komponenten, Hooks und reine Hilfsfunktionen zerlegt, sodass man eine Stelle findet, ohne 3.000 Zeilen zu lesen, Änderungen seltener kollidieren und die Logik testbar wird. **Für Nutzer ändert sich nichts**, weder Verhalten noch Aussehen.

## Heute

| Datei | Zeilen | `useState` | `useEffect` | Eigene Tests |
|---|---|---|---|---|
| `features/triage/TasksView.tsx` | 3.349 | 51 | 16 | keine |
| `features/workspace/WorkspaceView.tsx` | 3.147 | 60 | 22 | nur Seitenleiste |
| `features/settings/UserSettingsView.tsx` | 2.202 | 51 | 6 | nur Alarme |
| `lib/api.ts` | 2.059 | – | – | keine |
| `App.tsx` | 2.005 | 38 | 22 | keine |
| `features/settings/AdminSettingsView.tsx` | 1.632 | 32 | 2 | keine |
| `features/lists/SharedListsView.tsx` | 1.597 | 25 | 11 | keine |

Darunter liegen `OutlinerBlock.tsx` (1.825) und `DocumentEditor.tsx` (1.635). Die beiden sind groß, aber fachlich zusammenhängend (Editor-Kern), und sind nicht Teil dieses Plans.

## Grundsätze

- **Reiner Umbau.** Jeder Schritt verschiebt Code, ohne Logik zu ändern. Fehler, die dabei auffallen, kommen in die Mindsift-Liste und werden getrennt behoben, nicht nebenbei.
- **Erst das Netz, dann der Schnitt.** Bevor eine Datei zerlegt wird, sichern Tests und Screenshots ihr heutiges Verhalten (siehe unten).
- **Kleine Schritte.** Ein Schnitt pro Commit (eine Komponente oder ein Hook heraus), danach `tsc`, Lint, Tests. So lässt sich jeder Fehler auf einen Schritt eingrenzen.
- **Schnittstellen bleiben.** Was andere Dateien importieren (`api`, `TasksView`, `WorkspaceView`), behält Namen und Pfad. Neue Dateien liegen neben der alten im selben `features/…`-Ordner, Hooks heißen `use…` wie das vorhandene `useKanbanTouchDrag`.
- **Kein neues State-Framework.** Zustand, den mehrere Teile brauchen, bleibt in der Ansicht und geht per Props weiter. Nur wo das über mehr als zwei Ebenen reicht, kommt ein kleiner Context pro Ansicht dazu (z. B. `TasksContext`). Kein Redux, kein Zustand o. Ä.
- **Richtwert ≤ 800 Zeilen** pro Datei, nicht dogmatisch. Lieber eine zusammenhängende Datei mit 900 Zeilen als drei künstlich zerschnittene.

## Sicherheitsnetz (Schritt 0, vor jedem Schnitt)

1. **Screenshots als Referenz:** `e2e/refshots.sh capture vorher` nimmt 57 Ansichten auf (Desktop 1440 px, Handy 390 px: Triage, Aufgaben als Liste und Kanban in „Alle Aufgaben“ und einer Liste, Aufgaben-Details, Workspace mit Notiz, To-Dos, Hashtags, Hashtag-Seite, Journal, Fokus-Modus (auch mit angepinnten Leisten), Teilen-Dialog einer Notiz, Listen mit ihrem Teilen-Dialog, Profilmenü, jeder Bereich der Kontoeinstellungen in einem hohen Fenster (auch: ungespeicherte Eingaben überstehen einen Bereichswechsel; Rückfrage der Gefahrenzone), jeder Bereich der Administration, Hilfe (auch: Scroll-Position bleibt nach einem Seitenwechsel), globale Suche per Strg+K und /, Abmelden und Anmelden über das Formular, Aufgaben-Papierkorb, aufgeklappte und gefilterte Hashtag-Zeile, Teilen-Dialog einer Aufgabenliste, am Handy Installations-Angebot und -Anleitung, Profil-Sheet, Quick-Dump-Sheet mit Speichern, Erfassen-Sheet, Workspace-, Listen- und Aufgaben-Menü und Filter-Sheet). Die Versionsnummer wird durch einen Platzhalter ersetzt; schlägt ein Schritt fehl, liegt ein Bild davon als `FAIL_….png` daneben. Jede Aufnahme läuft auf derselben Datenbank-Vorlage mit fixierter Uhr; zwei Läufe desselben Codes sind pixelgleich, bis auf echte Serverzeiten (Anmeldezeit in der Sitzungsliste, Löschzeit im Papierkorb). Nach jedem Schritt `capture nachher` und `compare vorher nachher`; Abweichungen landen als rote Masken in `.refshots/shots/diff-…`.
2. **Charakterisierungstests** für das, was heute ungetestet ist, und zwar an der Logik, nicht am Markup:
   - Kanban-Spalten: `activeColumns`, `boardColumns`, `ownColumnOf`, `boardIdOf` (zusammengeführte Spalten in „Alle Aufgaben“). Werden in Schritt 2 zu reinen Funktionen und sind dann direkt testbar.
   - `lib/api.ts`: `request()` mit Token-Erneuerung über `X-Session-Token`, Outbox bei Offline, Umschaltung WS → SSE → Long-Polling (mit gemocktem `fetch`/`WebSocket`).
   - `App.tsx`: Scroll-Position pro Seite, Tastenkürzel (Strg+K, `C`, `/`).
3. **Ziehen per Maus und Finger:** `e2e/refshots.sh drag vorher` (`e2e/refdrag.mjs`) zieht auf einer frischen Kopie der Referenzdaten: Kanban-Karte in eine andere Spalte, in die Erledigt-Spalte, innerhalb der Spalte, dann Strg+Z; Listenzeile nach oben, Zeile auf einen anderen Listen-Reiter; abhaken, löschen und aus dem Papierkorb zurückholen per Klick; Aufgabe per Schnelleingabe, neue Aufgabenliste über den Dialog; am Handy eine Karte per Finger. Dazu drei Echtzeit-Schritte: eine Aufgabe wird von außen per API umbenannt, angelegt und gelöscht, die offene Seite muss das ohne Neuladen zeigen. Nach jedem Schritt wird der Aufgaben-Zustand vom Server festgehalten (Liste, Spalte, erledigt, Reihenfolge); zwei Läufe desselben Codes ergeben dieselbe Datei, vorher/nachher per `diff`.

4. **Workspace:** `e2e/refshots.sh ws vorher` (`e2e/refworkspace.mjs`) legt per Klick eine Notiz und einen Ordner an, zieht die Notiz in den Ordner und in den Papierkorb, holt sie zurück, hakt ein To-do in der Sammlung ab und löscht den Ordner nach der Rückfrage, zieht eine Notiz in den Papierkorb und holt sie über „Rückgängig“ im Hinweis zurück, markiert zwei Notizen mit Strg+Klick und zieht sie zusammen in einen Ordner, zieht eine auf die Hauptebene, prüft Echtzeit (Notiz von außen angelegt, umbenannt, gelöscht erscheint in der Seitenleiste; ein Gedanke von außen erhöht den Triage-Zähler); am Handy eine neue Notiz mit Name über das Plus; nach jedem Schritt Notizen, Ordner und Papierkorb vom Server.
5. **Listen:** `e2e/refshots.sh lists vorher` (`e2e/reflists.mjs`) legt Einträge mit Menge und Hashtag an, übernimmt einen Hashtag-Vorschlag, hakt ab, ändert eine Menge, löscht, zieht innerhalb und zwischen Kategorien und auf den Reiter einer anderen Liste, öffnet einen erledigten Eintrag wieder, räumt Erledigtes auf, legt eine Liste an, prüft Echtzeit (Eintrag von außen angelegt und abgehakt) und am Handy das Plus; nach jedem Schritt alle Listen vom Server.

## Reihenfolge

Sortiert nach Nutzen und Risiko: zuerst das, was am meisten entlastet und am wenigsten kaputt machen kann.

### Schritt 1: `lib/api.ts` → `lib/api/` (geringes Risiko) – erledigt

Reine Modul-Verschiebung ohne React.

| Neue Datei | Inhalt |
|---|---|
| `lib/api/client.ts` | Token (`getToken`, `setToken` …), `request()`, Fehlerbehandlung, Outbox |
| `lib/api/tasks.ts`, `docs.ts`, `lists.ts`, `account.ts`, `admin.ts` … | die Endpunkte des heutigen `api`-Objekts, nach Bereich |
| `lib/api/realtime.ts` | WebSocket/SSE/Long-Polling (heute ab Zeile ~1500, gut 500 Zeilen): Verbindungsaufbau, Umschaltung, `onWebSocketMessage`, Räume |
| `lib/api/index.ts` | setzt `export const api = { ...tasks, ...docs, … }` zusammen und exportiert alles wie bisher |

Alle Importe `from '../lib/api'` bleiben gültig. Aufwand: klein.

**Umgesetzt:** wie oben, die REST-Bereiche heißen `auth`, `tasks`, `workspace`, `lists`, `teams`, `admin`, `data`; `rest.ts` setzt sie zu `api` zusammen (Spies und Mocks auf `api` greifen weiter), `realtime.ts` holt `api` von dort, damit kein Import-Kreis entsteht. Größte Datei: `realtime.ts` mit knapp 600 Zeilen. Tests: `lib/__tests__/api.request.test.ts`; Referenz-Screenshots unverändert.

### Schritt 2: `TasksView.tsx` (mittleres Risiko, größter Nutzen) – erledigt

| Herauslösen | Heute etwa | Wohin |
|---|---|---|
| Spalten-Logik (`activeColumns`, `boardColumns`, `ownColumnOf`, `boardIdOf`) | Z. 492–562 | `lib/kanbanColumns.ts`, reine Funktionen mit Tests |
| Kanban-Layout (Spaltenhöhen, Reihen, Handy-Einrasten, Rad springt reihenweise) | Z. 565–697 | Hook `useKanbanLayout` |
| Kanban-Ziehen (Slot, versteckte Karte, Drop) | verteilt, `handle*Drag*` | Hook `useKanbanDrag` (neben `useKanbanTouchDrag`) |
| Board-Darstellung | Z. ~2895–3174 | `KanbanBoard.tsx`, `KanbanColumn.tsx` |
| Listenansicht | vor dem Board | `TaskListView.tsx` |
| Kopf mit Listen-Reitern | Z. ~2056–2370 | `TaskListTabs.tsx` |
| Hashtag-Zeile | Z. ~2372–2450 | `TagFilterRow.tsx` |
| Erfassen-Sheet am Handy | Z. ~2460–2794 | `MobileTaskCreateSheet.tsx` |
| Papierkorb | ab Z. ~3174 | `TaskTrashView.tsx` |
| Laden, Cache je Liste, Realtime-Handler, Rückgängig | Z. ~300–450, ~870–920 | Hooks `useTasksData`, `useTaskUndo` |

Übrig bleibt `TasksView` als Rahmen, der Daten-Hooks und Teilkomponenten zusammensteckt. Aufwand: groß, in 8–10 Commits.

**Umgesetzt (v0.68.3–v0.68.18):** `TasksView` 3.349 → 1.002 Zeilen. Neu in `features/triage/`: Logik `taskListing.ts` (filtern, sortieren, gruppieren), `lib/kanbanColumns.ts`, `tasksMenu.tsx` (Handy-Menü), `taskViewTypes.ts`; Hooks `useKanbanLayout`, `useTaskDrag`, `useTaskRealtime`, `useTaskUndo`, `useTaskActions`; Komponenten `KanbanBoard`, `TaskListView`, `TaskRow`, `TaskListTabs`, `TagFilterRow`, `QuickAddTaskBar`, `ActiveFilterBanner`, `TaskTrashList`, `MobileTaskCreateSheet`, `TasksFilterSheet`, `NewTaskListSheet`, `TaskListShareDialog`. Reine Logik hat Tests (Spalten, Listen-Aufbau, Echtzeit). Jeder Schnitt: Referenz-Screenshots unverändert, `refdrag` (Ziehen, Klick-Aktionen, Echtzeit, Strg+Z, Schnelleingabe, neue Liste) identisch. Laden und Zwischenspeicher je Liste sind bewusst in der Ansicht geblieben (eng mit dem Listenwechsel verknüpft).

### Schritt 3: `WorkspaceView.tsx` (mittleres Risiko) – erledigt

| Herauslösen | Heute etwa | Wohin |
|---|---|---|
| Ordnerbaum (Ordner, Unterordner, Notizen, Markieren mit Strg/Umschalt) | Z. ~160–300 + Ziehen | `FolderTree.tsx`, Hook `useDocDragDrop` |
| Reiterleiste mit Live-, Teilen- und Speicherstatus | Z. ~1672–1900 | `WorkspaceTabBar.tsx` |
| Fokus-Modus-Rahmen (einblendende Leisten, Pins) | Z. ~1913–1990 | `FocusModeChrome.tsx` |
| Seitenleiste | ab Z. ~1991 | `WorkspaceSidebar.tsx` |
| Hashtag-Übersicht (Kacheln) | Z. ~2406–2564 | `HashtagOverview.tsx` |
| Hashtag-Seite | Z. ~2564–2652 | `TagDetailView.tsx` |
| To-Do-Sammlung | Z. ~2652–2990 | `TodoRollupView.tsx` |
| Ordner-Dialoge, Löschen-Rückfrage | Z. ~2990–3060 | `FolderDialogs.tsx` |
| Laden von Notizen/Ordnern/Tags/Journal | Z. ~540–600 | Hook `useWorkspaceData` |
| Journal-Zustand, Zusammenführen mit Rückgängig | Z. ~367–391, ~499–1010 | Hooks `useJournal`, `useMergeNotes` |
| Leiste beim Scrollen wegschieben (v0.67.0) | bei `wsBar` | Hook `useTabRowSnap` |

Aufwand: groß, in 8–10 Commits.

**Umgesetzt (v0.69.2–v0.69.18):** `WorkspaceView` 3.147 → 1.119 Zeilen. Neu in `features/workspace/`: Logik `workspaceListing.ts` (To-do-Sammlung, Hashtag-Seite und -Kacheln, mit Tests), `workspaceMenu.tsx` (Handy-Menü), `workspaceTypes.ts`; Hooks `useWorkspaceData` (Laden und Echtzeit), `useDocDragDrop` (Ziehen und Markieren), `useFocusMode`, `useJournal`, `useTabRowSnap`, `useToast`, `useShareModal`; Komponenten `FolderTree`, `FolderTreeItem`, `SidebarSections` (Journal-Eintrag, Hashtags, Papierkorb), `WorkspaceTabBar`, `FocusModeChrome`, `FolderDialogs`, `WorkspaceToast`, `WorkspaceShareModal`, `TodoRollupView`, `HashtagOverview`, `TagDetailView`. Jeder Schnitt: Referenz-Screenshots unverändert, `refworkspace` identisch; wo ein Schnitt Ungeprüftes berührte, kam vorher ein Schritt ins Sicherheitsnetz (angepinnter Fokusmodus, Teilen-Dialog, Handy-Menü, Ordner löschen, Markieren, Hauptebene, Rückgängig im Hinweis, Echtzeit). Bewusst in der Ansicht geblieben: Zusammenführen (`handleMerged` steuert vor allem Zustand der Ansicht), Rahmen und Kopf der Seitenleiste, Anlegen, Umbenennen und Löschen von Notizen und Ordnern. Nebenbei gefunden: der Papierkorb im Workspace lag seit v0.67.0 unter dem Fensterrand (behoben in v0.69.1); eine angeheftete Notiz verliert die Anheftung nach Papierkorb und Wiederherstellen (als Aufgabe notiert).

### Schritt 4: `App.tsx` (mittleres Risiko) – erledigt

`AppHeader.tsx`, `MobileNav.tsx`, Hooks `useScrollPositions` (Scroll-Position pro Seite), `useGlobalShortcuts`, `useSessionBootstrap` (Anmeldung, Status, Demo-Reset). `App` behält nur Seitenwahl und Rahmen. Aufwand: mittel.

**Umgesetzt (v0.69.19–v0.69.25):** `App` 2.005 → 776 Zeilen. Neu in `src/app/`: `appTabs.ts`, `ViewErrorBoundary.tsx`, `AppHeader.tsx` (Kopfleiste Handy und Desktop, Seiten-Reiter), `MobileNav.tsx`, `ProfileMenus.tsx` (Profilmenü Desktop und Handy), `MobileCaptureSheet.tsx`, `PwaInstallSheet.tsx`; Hooks `useSessionBootstrap` (Status, Anmeldung, Zähler, Realtime-Verbindung, Demo-Reset), `useScrollPositions`, `useCommandPaletteShortcuts`, `useMobileCapture`, `usePwaInstall`. Vor jedem Schnitt kam das Betroffene ins Sicherheitsnetz (Scroll-Position, globale Suche, Installations-Angebot, Profilmenüs, Quick-Dump-Sheet mit Speichern, Ab- und Anmelden, Triage-Zähler per Echtzeit). In `App` geblieben: Seitenwahl, Themes, Teilen aus anderen Apps, App-Verknüpfungen, das Handy-Menü je Seite und der Rahmen. Nicht abgedeckt: der Demo-Countdown statt der Version und der Demo-Reset (die Prüfläufe laufen ohne Demo-Modus).

### Schritt 5: Einstellungen und Listen (geringes Risiko) – erledigt

`UserSettingsView` und `AdminSettingsView` haben natürliche Schnittlinien: je Reiter oder Abschnitt eine Datei (Profil, Benachrichtigungen, Aufbewahrung, Themes, Sitzungen; Benutzer & Einladungen, Server, Organisationen, Backups). `SharedListsView` nach demselben Muster wie `TasksView` (Reiter, Liste, Einträge). Aufwand: mittel, wenig Risiko.

**Umgesetzt (v0.69.26–v0.69.38):**
- `UserSettingsView` 2.202 → 302 Zeilen. Je Bereich eine Komponente in `features/settings/user/` (Profil mit Gefahrenzone, Darstellung & Themes, Alarme, Spracheingabe, Aufbewahrung, Export & Import). Der Zustand bleibt über je einen Hook in der Ansicht, damit ungespeicherte Eingaben einen Bereichswechsel überstehen (im Sicherheitsnetz geprüft).
- `AdminSettingsView` 1.632 → 192 Zeilen. Die Bereiche teilen sich ihre Daten, deshalb ein Hook `useAdminSettings` und je Bereich eine Komponente in `features/settings/admin/`.
- `SharedListsView` 1.597 → 573 Zeilen. Neu in `features/lists/`: `listItems.ts` (Einträge lesen, gruppieren, Hashtag-Vorschläge; mit Tests), `useListRealtime` (mit Tests), `useListDrag`, `useItemEditing`, `ListItemGroups`, `ListHeaders`, `listsMenu.tsx`. Vorher kam `e2e/reflists.mjs` dazu.
- Zum Abschluss aus `WorkspaceView` noch Ordnerbaum (reine Funktionen mit Tests) und Papierkorb-Aktionen (`useTrashActions`): 1.119 → 1.030 Zeilen.
- Nebenbei bemerkt, nicht geändert: Ein in eine andere Kategorie gezogener Listeneintrag speichert die Kategorie kleingeschrieben; im Handy-Menü der Listen ist das Plus bei „Neuen Eintrag hinzufügen“ unsichtbar (Akzentfarbe auf Akzentfläche).

## Bekannte Fallen

- **DOM-Verknüpfungen bleiben:** Scroll- und Einrast-Effekte suchen Elemente über `data-app-scroll`, `data-kanban-col`, `data-kanban-list`, `data-ws-pane`, `data-mobile-nav`. Die Attribute müssen beim Verschieben erhalten bleiben.
- **Refs über Effekte hinweg** (`kanbanBoardRef`, `tagRowRef`, der einmal registrierte Realtime-Handler mit Ref auf die aktuelle Liste): Beim Herauslösen in Hooks die Ref mitnehmen bzw. vom Hook zurückgeben, nicht neu anlegen.
- **Keine neuen `exhaustive-deps`-Warnungen.** Wo eine Abhängigkeit heute bewusst fehlt, bleibt das so und bekommt einen Kommentar, statt nebenbei geändert zu werden.
- **Neu-Renders:** Callbacks, die an herausgelöste Komponenten gehen, mit `useCallback` stabil halten, sonst rendert z. B. jede Kanban-Karte bei jedem Tastendruck neu.
- **Handy und Desktop:** Breakpoints über `isPhoneWidth()`, Klassen `sm:`/`lg:` unverändert übernehmen.

## Releases

Jeder Push ist ein Release. Für reine Umbauten heißt das: die Commits eines Schritts auf `dev` sammeln und als **Patch** veröffentlichen, wenn der Schritt fertig und geprüft ist (CHANGELOG unter „Changed“: „Interne Umstellung, keine sichtbaren Änderungen“). Alternativ mit dem nächsten Feature-Release mitgehen lassen.

## Fertig, wenn

- keine der Dateien aus der Tabelle oben über ~1.000 Zeilen liegt (Richtwert 800),
- die Logik aus Schritt 0 von Tests abgedeckt ist,
- die Referenz-Screenshots unverändert sind.

Dann fällt FLAW-41 aus `flaws.md`.

**Ergebnis (v0.69.38):** `TasksView` 1.024, `WorkspaceView` 1.030, `App.tsx` 776, `SharedListsView` 573, `UserSettingsView` 302, `AdminSettingsView` 192 Zeilen; `lib/api.ts` ist `lib/api/` (größte Datei unter 600). Die Logik aus Schritt 0 und die neuen reinen Module haben Tests (286 insgesamt), die Referenz-Screenshots (57) und die Abläufe `drag`, `ws` und `lists` sind unverändert. FLAW-41 ist aus `flaws.md` entfernt.

## Offene Fragen

- Release-Takt: ein Patch pro Schritt (5 Releases) oder mitlaufen lassen?
- Schritt 5 (Einstellungen) gleich mit erledigen oder erst, wenn dort ohnehin etwas zu tun ist?
