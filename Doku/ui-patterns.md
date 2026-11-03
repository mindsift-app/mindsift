# UI-Muster

Wiederkehrende Bedienelemente, die überall gleich aussehen und sich gleich verhalten. Wer eines davon neu braucht, nimmt die vorhandene Komponente und baut keine eigene Variante.

## Personen suchen (Type-to-Search)

Komponente: [UserAutocomplete.tsx](../frontend/src/features/UserAutocomplete.tsx)

Eingesetzt beim Teilen (`UnifiedShareModal`), beim Hinzufügen zu Gruppen (`GroupsView`) und beim Zuweisen von Aufgaben (`TaskDetailModal`).

- **Keine Liste vorab:** Solange das Feld leer ist, erscheint nichts, auch nicht beim Reinklicken. Kein Dropdown mit allen Personen.
- **Erst beim Tippen** erscheinen Treffer direkt unter dem Feld, **höchstens 3** (`MAX_RESULTS`). Gesucht wird in Anzeigename, `@Benutzername` und E-Mail.
- Der **erste Treffer ist vorausgewählt**: Tippen + Enter übernimmt ihn. Pfeiltasten wechseln, Escape schließt.
- Bereits gewählte oder freigegebene Personen werden über `excludeUserIds` ausgeblendet.
- **Einzelauswahl** (Teilen, Gruppen): `selectedUser` setzen; das Feld zeigt dann die gewählte Person mit ×.
- **Mehrfachauswahl** (Aufgaben zuweisen): `selectedUser={null}` lassen und in `onSelectUser` zur Liste hinzufügen. Die Gewählten stehen als Chips (Avatar, Name, ×) über dem Feld, das Feld bleibt für die nächste Suche frei.
- Am Handy sind Feld, gewählte Person und Trefferzeilen 44 px hoch (Schrift 16 px, kein Zoom unter iOS), ab `sm` wie bisher 32 px.

## Profilbilder als Stapel

Komponente: [AvatarStack.tsx](../frontend/src/components/AvatarStack.tsx) (nutzt `UserAvatar`)

- Kleine runde Profilbilder, **leicht überlappend**, **höchstens 3**. Weitere Personen erscheinen als monochromer Kreis „+n“.
- Ohne Profilbild zeigt `UserAvatar` die Initialen.
- `ringClass` bekommt die Farbe der Fläche dahinter (meist `ring-[var(--bg-panel)]` oder `ring-[var(--bg-app)]`), damit die Kreise sauber getrennt sind.
- Größen: `xxs` (16 px) in Tabs, Kanban-Karten und Listeneinträgen, `xs` (20 px) in Aufgabenzeilen und Kopfzeilen.
- **Kein Hover-Effekt** im Stapel selbst. Einzige Ausnahme ist die Anwesenheit in Notizen ([PresenceAvatars.tsx](../frontend/src/features/workspace/PresenceAvatars.tsx)): Dort zeigt Hover oder Tastaturfokus die Liste „Gerade online“.

| Ort | Wer wird gezeigt |
|---|---|
| Notiz-Kopfzeile | wer die Notiz gerade geöffnet hat (Profilbilder aus `/users/directory`) |
| Tabs der Aufgabenlisten und Listen | alle mit Zugriff außer mir (`members`) |
| Aufgabenzeile und Kanban-Karte | zugewiesene Personen (nur in geteilten Listen) |
| Eintrag einer geteilten Liste | wer ihn hinzugefügt hat (`createdBy`); ältere Einträge ohne Autor zeigen nichts |

## Schalter

Komponente: [ToggleSwitch.tsx](../frontend/src/components/ToggleSwitch.tsx)

- Ein/Aus-Einstellungen sind immer Schalter, keine Checkbox-Haken und keine „angehakten“ Buttons (Einrichtung, Admin-Bereich, Berechtigungen eines API-Keys, Bereiche beim Import und Wiederherstellen → `SectionPicker`).
- Text links (Titel, darunter eine kurze Erklärung in `text-muted`), Schalter rechts.
- Eine Auswahl **einer** Option aus mehreren (Import-Modus, Ecken, Theme-Folgen) bleibt eine Button-Gruppe mit `role="radio"`.

## Kleine Dialoge (Anlegen, Umbenennen)

Komponente: [FormSheet.tsx](../frontend/src/components/FormSheet.tsx), Tastatur-Abstand über [useKeyboardInset.ts](../frontend/src/lib/useKeyboardInset.ts)

- **Handy:** Bottom-Sheet über die volle Breite, das direkt über der Bildschirmtastatur sitzt (der Abstand kommt aus `visualViewport`), Griff oben, Felder und Buttons mindestens 44 px hoch, Eingaben in 16 px (sonst zoomt iOS), Abbrechen/Erstellen nebeneinander über die ganze Breite.
- **Desktop:** zentriertes Fenster, oder mit `anchor` neben der Klickposition (z. B. „Neuer Ordner“ im Explorer).
- Escape und Klick auf den Hintergrund schließen. Genutzt für neue Aufgabenliste, neue Einkaufsliste, neue Notiz und neuen Ordner; das Emoji-Sheet nutzt denselben Tastatur-Abstand.
- **Icon-Feld:** [EmojiIconButton.tsx](../frontend/src/components/EmojiIconButton.tsx) statt eines Textfelds: zeigt das Emoji (ohne Icon ein dezentes „Icon wählen“) und öffnet denselben Emoji-Auswähler wie der Notiz-Kopf, inklusive „Entfernen“. Im Dialog liegt der Auswähler per Portal über der Seite; Escape schließt nur ihn.

## Bestätigung an der Mausposition

Komponente: [ConfirmPopover.tsx](../frontend/src/components/ConfirmPopover.tsx)

- Für Rückfragen zu einer einzelnen Aktion, z. B. Ordner löschen: ein kleines Fenster direkt an der Stelle des Klicks (unten rechts vom Mauszeiger, am Fensterrand nach oben bzw. links geklappt), kein Dialog in der Bildmitte.
- „Abbrechen“ und die Aktion (gefährliche Aktionen rot mit `danger`); die Aktion hat den Fokus, Enter bestätigt, Escape oder ein Klick daneben schließt. Per Tastatur ausgelöst öffnet es am Knopf. Am Handy sind die Knöpfe 44 px hoch.

## Hinweis mit „Rückgängig“

- Kurzer Hinweis unten mittig (`role="status"`, Fläche `bg-panel-elevated`), am Handy über der unteren Leiste; mit Aktion bleibt er 8–10 s, sonst 3–4 s.
- Nach Löschen in den Papierkorb: „… im Papierkorb · Rückgängig“ (Workspace und Aufgaben). In den Aufgaben macht `Strg+Z` dasselbe; eine neue Aktion blendet den alten Hinweis aus, damit „Rückgängig“ nie einen anderen Schritt trifft.

## Zähler

Komponente: [CountBadge.tsx](../frontend/src/components/CountBadge.tsx), CSS-Klassen `count-badge*` in [index.css](../frontend/src/index.css). Es gibt keine anderen Zähler-Stile mehr.

- **Form:** runder, gefüllter Kreis mit dünnem Rand, ohne Schatten oder Ring, mindestens 16 px, ab 100 als „99+“ (der Screenreader liest die echte Zahl). Bei 0 ausgeblendet, außer mit `showZero` (z. B. Mitgliederzahl, mobiles Menü).
- **Farbe (`variant`):**
  - `accent`: Hier wartet etwas auf dich. Navigationsleiste: Triage (Inbox), Aufgaben (offene Aufgaben), Listen (offene Einträge aller eigenen und geteilten Listen). Workspace hat keinen Zähler.
  - `muted` (Standard): reine Anzahl. Tabs der Aufgabenlisten und Listen, Organisationen, mobiles Menü.
  - Beide kommen aus den Theme-Variablen (`--accent-primary`/`--text-on-accent` bzw. `--text-muted`/`--bg-panel`) und passen sich damit jedem Theme an. Der Akzent liegt auf einer deckenden Panel-Fläche, damit am Handy das Icon darunter nicht durchscheint.
- **Position (`position`):**
  - `text`: an Beschriftungen (Navigation, Reiter der Aufgabenlisten und Listen, Workspace-Kopf). Der Zähler steht im Textfluss direkt hinter dem Wort, leicht angehoben, und hängt immer 2 px über den letzten Buchstaben, egal wie viele Stellen die Zahl hat; breitere Zahlen machen den Reiter breiter. Der Text steht dafür in einem `inline-flex items-center`-Span.
  - `corner`: Benachrichtigungs-Badge oben rechts am nächsten `relative` Elternelement; für Icons, z. B. in der mobilen Leiste (`-top-1.5 -right-2.5`).
  - `inline`: im Textfluss.
- Zahlen im mobilen Menü (`MobileActionContext`, `badge: number`) werden automatisch als `CountBadge` gezeigt; Text-Badges wie „2 aktiv“ bleiben Textmarken.
- **Wichtig für neue Klassen:** Tailwind entfernt Klassen aus `@layer components`, die nicht wörtlich im Code stehen. Klassennamen deshalb nie zusammensetzen (`count-badge-${variant}`), sondern ausschreiben.

## Herkunfts-Badge (API-Schlüssel)

Komponente: [OriginBadge.tsx](../frontend/src/components/OriginBadge.tsx)

- Eine Badge für alles, was ein API-Schlüssel angelegt oder geändert hat (Feld `origin`): neutraler Rahmen, vorne ein Symbol für den Zugang (Webhook = REST/curl, Roboter = MCP), dahinter der Name des Schlüssels. Ältere Einträge ohne Schlüssel zeigen „API“ bzw. „MCP“.
- Höchstens eine Badge pro Eintrag: der Schlüssel, der angelegt hat, sonst der, der zuletzt geändert hat. Sie bleibt dauerhaft, auch nach eigenem Bearbeiten und nach der Triage.
- Details (angelegt / zuletzt geändert, mit Schlüssel und Zeit) per Mouseover und per Tippen (kleines Info-Fenster, am Handy mit vergrößerter Trefferfläche); in der Aufgaben-Detailansicht stehen sie zusätzlich unten (`originDetails`). Ein Tipp auf die Badge öffnet nie den Eintrag.
- Größen: `sm` in Aufgabenzeilen, Inbox-Liste und Detailansicht, `xs` auf Kanban-Karten und in Listen, `md` auf den Triage-Karten.
- In der Aufgaben-Detailansicht steht die Badge am Handy nicht im Kopf (kein Platz neben den Knöpfen); dort zeigen nur die Details unten die Herkunft.

## Liste wechseln (Handy)

Komponente: [ListSwitcher.tsx](../frontend/src/components/ListSwitcher.tsx)

- In der Kopfleiste am Handy (Aufgaben, Listen) ist der Titel der offenen Liste ein Knopf mit Pfeil. Ein Tipp klappt alle Listen auf, mit Icon, Zähler (`CountBadge`, `muted`) und Haken an der offenen; ein Tipp auf eine Liste wechselt dorthin.
- Schließt bei Tipp daneben und mit Escape. Am Desktop bleiben die Reiter über der Liste.

## Kopfzeile: Status | Aktionen

Komponente für den Verbindungsstatus: [LivePill.tsx](../frontend/src/components/LivePill.tsx) (Notizen zeigen ihren eigenen Sync-Weg im selben Aussehen).

- Rechts im Kopf von Notizen, Aufgaben und Listen gilt dieselbe Reihenfolge: links die Statusanzeigen (Live-Pille, „Geteilt“), dann ein senkrechter Trenner (`w-px h-5 bg-border`), rechts die Knöpfe (Teilen, Ansicht, Menü). Am Handy genauso, dort steht in der Pille nur „Live“.

## Mikrofon in Eingabezeilen

Komponente: [VoiceInputButton.tsx](../frontend/src/components/VoiceInputButton.tsx) (nutzt `useVoiceInput` wie der Quick Dump)

- Runder Mikrofon-Knopf direkt in der Zeile, rechts im Feld; diktierter Text wird an den Text angehängt, der beim Start im Feld stand. Am Handy 36 px, am PC 28 px.
- Während der Aufnahme `MicOff` in Akzentfarbe, mit eigenem Whisper-Server zusätzlich die Live-Wellen, danach „Wird erkannt…“ mit Spinner.
- Ausgeblendet, wenn die Spracheingabe aus ist (`STT_DISABLED`, oder `STT_ALLOW_BROWSER=false` ohne Whisper-Server) oder der Browser sie nicht kann (z. B. Firefox ohne eigenen Whisper-Server). Fehler zeigt das Feld kurz als Platzhalter.
- Eingesetzt: Quick Dump (eigene Umsetzung), Aufgabe hinzufügen (Zeile am PC, „Neue Aufgabe anlegen“ am Handy), Listeneintrag hinzufügen.

## Ladebildschirm & Statusleiste

- `manifest.json`: `name` „MindSift“ (kurz, der Slogan steht in `description`), `background_color` und `theme_color` `#2563eb` – Android baut daraus den Splash-Screen.
- `index.html` enthält in `#root` einen reinen HTML-Platzhalter (vollflächig Blau, Logo in der Mitte, kein Text). React ersetzt ihn beim ersten Rendern, dazwischen blitzt nichts Weißes auf.
- `meta theme-color` startet blau und wird von [`theme.ts`](../frontend/src/lib/theme.ts) nach dem Start und bei jedem Theme-Wechsel auf `--bg-app` des aktiven Themes gesetzt, damit die Statusleiste zum Header passt.

## +-Button: Tippen und Halten

Komponente: [HoldToRecordFab.tsx](../frontend/src/features/capture/HoldToRecordFab.tsx)

- **Kurz tippen (< 350 ms):** Führt wie bisher die primäre Aktion der aktuellen Ansicht (`primaryAction`) oder den mobilen Erfassungsdialog (`openMobileTriageCapture`) aus.
- **Gedrückt halten (≥ 350 ms):** Startet direkt eine Sprachaufnahme über `useVoiceInput` (im Server-Modus per Whisper mit echten Pegel-Wellen, sonst über die Spracherkennung des Browsers). Der Button wird zum pulsierenden Mikrofon (`bg-status-err`), darüber zeigt eine schwebende Pille „Ich höre zu… (loslassen speichert)“ samt Live-Transkript.
- **Loslassen:** Stoppt die Aufnahme, wartet kurz auf das letzte Wort und speichert den Text unabhängig von der aktiven Ansicht immer als Gedanken in die Inbox (`source: 'voice'`, `target: 'inbox'`).
- **Nach oben ziehen (> 60 px):** Schaltet die Pille in den Abbruch-Zustand („🗑️ Zum Abbrechen loslassen“); Loslassen dort verwirft die Aufnahme (`abort()`).
- **Fallback:** Ist die Spracheingabe abgeschaltet (`STT_DISABLED=true`), unterstützt der Browser keine Spracherkennung oder ist das Mikrofon gesperrt (`not-allowed`), öffnet Halten wie beim Tippen den Dialog und blendet eine kurze Statusmeldung über der Bottom-Leiste ein.


