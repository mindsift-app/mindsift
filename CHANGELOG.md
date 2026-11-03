# Changelog

Alle nennenswerten Änderungen an MindSift stehen in dieser Datei.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern folgen ab v0.6.0 [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Solange die Hauptversion 0 ist, können sich API und Datenformate mit jeder Minor-Version ändern; solche Änderungen stehen unter „Changed“ bzw. „Removed“ und sind mit **Achtung** markiert.

## [Unreleased]

## [0.70.0] - 2026-11-03

### Changed
- **Attention:** MindSift is now developed in the public repository [github.com/mindsift-app/mindsift](https://github.com/mindsift-app/mindsift). Images come from GitHub's container registry: `ghcr.io/mindsift-app/mindsift` (`:latest`, `:dev`, version tags). Existing installations change the `image:` line in their compose file accordingly.
- `docker-compose.yml`, `compose.yaml` and the install script use `:latest` (the tested state of `main`) instead of `:dev`; the install script loads its files from GitHub.
- A public demo runs at [demo.mindsift.app](https://demo.mindsift.app).
- Versions up to 0.69.38 were developed before the move; their history is summarised in this file, there are no compare links for them.

## [0.69.38] - 2026-11-03

### Changed
- Internal frontend restructuring completed: the large views are now split into components, hooks and tested modules. Nothing changes for users.

## [0.69.37] - 2026-11-03

### Changed
- Internal frontend restructuring: the phone menu of the shopping lists is a module of its own. Nothing changes for users.

## [0.69.36] - 2026-11-03

### Changed
- Internal frontend restructuring: the list tabs and the phone header of the shopping lists are components of their own. Nothing changes for users.

## [0.69.35] - 2026-11-03

### Changed
- Internal frontend restructuring: the open and done entries of a shopping list are components of their own. Nothing changes for users.

## [0.69.34] - 2026-11-03

### Changed
- Internal frontend restructuring: realtime updates of the shopping lists are a tested module of their own. Nothing changes for users.

## [0.69.33] - 2026-11-03

### Changed
- Internal frontend restructuring: the hashtag suggestions of the shopping lists are tested functions of their own. Nothing changes for users.

## [0.69.32] - 2026-11-03

### Changed
- Internal frontend restructuring: dragging shopping list entries is a module of its own. Nothing changes for users.

## [0.69.31] - 2026-11-03

### Changed
- Internal frontend restructuring: reading and grouping shopping list entries is a tested module of its own. Nothing changes for users.

## [0.69.30] - 2026-11-03

### Changed
- Internal frontend restructuring: the sections of the administration are components of their own. Nothing changes for users.

## [0.69.29] - 2026-11-03

### Changed
- Internal frontend restructuring: the retention, voice input and export sections of the account settings are components of their own. Nothing changes for users.

## [0.69.28] - 2026-11-03

### Changed
- Internal frontend restructuring: the profile and security settings with the danger zone are a component of their own. Nothing changes for users.

## [0.69.27] - 2026-11-03

### Changed
- Internal frontend restructuring: the appearance and theme settings are a component of their own. Nothing changes for users.

## [0.69.26] - 2026-11-03

### Changed
- Internal frontend restructuring: the alarm settings in the account settings are a component of their own. Nothing changes for users.

## [0.69.25] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Anmeldung, Zähler, Echtzeit-Verbindung und Demo-Reset sind ein eigener Baustein. Damit ist die Aufteilung von App.tsx abgeschlossen. Für Nutzer ändert sich nichts.

## [0.69.24] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Kopfleiste (Handy und Desktop) und die Seiten-Reiter sind eigene Komponenten. Für Nutzer ändert sich nichts.

## [0.69.23] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Quick-Dump-Sheet am Handy samt Spracheingabe ist ein eigener Baustein. Für Nutzer ändert sich nichts.

## [0.69.22] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Profilmenü (Desktop und Handy) ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.21] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Angebot, MindSift als App zu installieren, ist ein eigener Baustein. Für Nutzer ändert sich nichts.

## [0.69.20] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Navigationsleiste am Handy und die Tastenkürzel der globalen Suche sind eigene Bausteine. Für Nutzer ändert sich nichts.

## [0.69.19] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Seitenliste, Fehleranzeige einer Ansicht und das Merken der Scroll-Position je Seite sind eigene Bausteine. Für Nutzer ändert sich nichts.

## [0.69.18] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Handy-Menü des Workspace ist ein eigener Baustein. Damit ist die Aufteilung des Workspace abgeschlossen. Für Nutzer ändert sich nichts.

## [0.69.17] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: welche To-dos und Hashtags der Workspace zeigt, berechnen jetzt eigene, getestete Funktionen. Für Nutzer ändert sich nichts.

## [0.69.16] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Laden der Notizen, Ordner und Hashtags im Workspace samt Echtzeit-Aktualisierung ist ein eigener Baustein. Für Nutzer ändert sich nichts.

## [0.69.15] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Ordnerbaum, Journal-Eintrag, Hashtags und Papierkorb der Seitenleiste sind eigene Komponenten. Für Nutzer ändert sich nichts.

## [0.69.14] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: der Teilen-Dialog für Notizen und Ordner im Workspace ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.13] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: der Rahmen des Fokusmodus (einblendende Leiste, Rand zum Öffnen der Seitenleiste) ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.12] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: der Hinweis unten im Workspace (z. B. mit „Rückgängig“) ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.11] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Wegschieben der Reiterleiste im Workspace ist ein eigener Baustein. Für Nutzer ändert sich nichts.

## [0.69.10] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Dialoge der Ordnerleiste (neuer Ordner, neue Notiz am Handy, Ordner löschen) sind eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.9] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Journal (Tage, Kalender, Sprung zu einem Tag) hat einen eigenen Baustein für seinen Zustand. Für Nutzer ändert sich nichts.

## [0.69.8] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: der Zustand des Fokusmodus (angepinnte Leisten, Tastenkürzel) ist ein eigener Baustein. Für Nutzer ändert sich nichts.

## [0.69.7] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Ziehen und Markieren von Notizen in der Seitenleiste ist ein eigener Baustein. Für Nutzer ändert sich nichts.

## [0.69.6] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Leiste über dem Workspace (Ansichten, Live- und Speicherstatus) ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.5] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Hashtag-Seite im Workspace ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.4] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Hashtag-Übersicht im Workspace ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.3] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die To-Do-Sammlung im Workspace ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.69.2] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: der Ordnerbaum der Notizen liegt in einer eigenen Datei (Beginn der Aufteilung des Workspace). Für Nutzer ändert sich nichts.

## [0.69.1] - 2026-11-03

### Fixed
- Notizen (Desktop): Seit v0.67.0 lag der untere Rand von Seitenleiste und Notiz anfangs unter dem Fensterrand, sodass etwa der Papierkorb erst nach dem Wegschieben der oberen Leiste zu sehen war. Seitenleiste und Notiz enden jetzt immer am unteren Fensterrand und wachsen mit, während die Leiste herausrutscht.

## [0.69.0] - 2026-11-03

### Added
- Aufgaben: Unteraufgaben lassen sich am Griff links umsortieren, mit Maus, Finger oder den Pfeiltasten.
- Kanban: „Aufgabe hinzufügen“ unten in einer Spalte öffnet direkt das Aufgaben-Fenster, Spalte und Liste sind vorbelegt und der Titel ist zum Überschreiben markiert. Wird das Fenster ohne Titel geschlossen, verschwindet die leere Aufgabe wieder (auch aus dem Papierkorb).

## [0.68.18] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Filteranzeige der Aufgaben am Handy ist eine eigene Komponente; damit ist die Aufgabenansicht fertig aufgeteilt. Für Nutzer ändert sich nichts.

## [0.68.17] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: der Teilen-Dialog für Aufgabenlisten ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.16] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Schnelleingabe und der Dialog „Neue Aufgabenliste“ sind eigene Komponenten. Für Nutzer ändert sich nichts.

## [0.68.15] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Aktionen an Aufgaben (abhaken, ändern, löschen, Papierkorb) liegen in einem eigenen Baustein. Für Nutzer ändert sich nichts.

## [0.68.14] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Rückgängig (Strg+Z) bei den Aufgaben liegt in einem eigenen Baustein. Für Nutzer ändert sich nichts.

## [0.68.13] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Live-Aktualisierung der Aufgaben liegt in einem eigenen, getesteten Baustein. Für Nutzer ändert sich nichts.

## [0.68.12] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: Filtern, Sortieren und Gruppieren der Aufgabenliste sind eigene, getestete Funktionen. Für Nutzer ändert sich nichts.

## [0.68.11] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Listenansicht der Aufgaben ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.10] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Listen-Reiter der Aufgaben am Desktop sind eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.9] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Filter-Fenster der Aufgaben am Handy ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.8] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Handy-Menü der Aufgaben wird in einer eigenen Datei zusammengestellt. Für Nutzer ändert sich nichts.

## [0.68.7] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Zeile einer Aufgabe in der Listenansicht ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.6] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Kanban-Board ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.5] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: das Ziehen von Aufgaben (Maus und Finger, Kanban, Liste, Listen-Reiter) liegt in einem eigenen Baustein. Für Nutzer ändert sich nichts.

## [0.68.4] - 2026-11-03

### Changed
- Interne Umstellung des Frontends: die Hashtag-Leiste der Aufgaben ist eine eigene Komponente. Für Nutzer ändert sich nichts.

## [0.68.3] - 2026-11-03

### Changed
- Interne Umstellung des Frontends in kleinere Module (Plan in `Doku/plans/frontend-aufteilen.md`): API-Client, Kanban-Spalten und -Layout, Aufgaben-Papierkorb und das Erfassen-Sheet am Handy. Für Nutzer ändert sich nichts.

## [0.68.2] - 2026-11-03

### Changed
- Doku aufgeräumt: erledigte Schwachstellen und die alte `TODO.md` entfernt (offene Aufgaben stehen in der Aufgabenliste), Plan zum Aufteilen der großen Frontend-Dateien ergänzt. An der App selbst ändert sich nichts.

## [0.68.1] - 2026-11-03

### Sicherheit
- Pro Konto sind jetzt höchstens 20 gleichzeitige Echtzeit-Verbindungen (WebSocket, SSE und Long-Polling zusammen) offen. Kommt eine weitere dazu, wird die älteste geschlossen. So kann ein einzelnes Konto den Server nicht mit beliebig vielen offenen Verbindungen belasten; bei normaler Nutzung mit mehreren Geräten und Tabs merkt man davon nichts.

## [0.68.0] - 2026-11-03

### Sicherheit
- Nutzerverzeichnis und Mitwirkenden-Liste geben von anderen Personen nur noch Name, Benutzername, E-Mail, Profilbild und Organisation preis. Private Angaben wie Discord-/Webhook-Adressen, Alarm-E-Mail und Rolle bleiben jetzt verborgen.
- Wer mit einer Notiz, Liste oder einem geteilten Ordner geteilt wird, konnte bisher auch ohne Zugriff deren Freigabeliste abrufen. Das ist nun gesperrt (nur mit Zugriff auf das Objekt).

### Fixed
- Löschen oder Ändern eines Objekts, auf das man keinen Zugriff hat, meldet jetzt sauber „nicht gefunden“ statt eines internen Serverfehlers.

## [0.67.0] - 2026-11-03

### Added
- Notizen (Desktop): Scrollen im Hintergrund (über der Leiste mit Notizen, To-Dos und Hashtags oder am Rand neben der Notiz) schiebt diese Leiste oben heraus und rastet ein, sodass die Notiz den ganzen Bereich nutzt – wie beim Kanban. Hochscrollen dort holt sie zurück. In der Notiz und in der Ordnerleiste scrollt das Mausrad wie bisher nur deren Inhalt.
- Fokus-Modus: Die Ordnerleiste links und die Leiste oben haben einen Pin. Angepinnt bleiben sie stehen, statt wieder wegzugleiten; die Einstellung bleibt erhalten.

### Changed
- Fokus-Modus: Die obere Leiste wirft nur noch einen leichten Schatten.
- Notizen: Die Rückfrage beim Löschen eines Ordners ist kürzer.
- Kanban in „Alle Aufgaben“: Bei Spalten, die es nur in Aufgabenlisten gibt, ist „Aufgabe hinzufügen“ jetzt ausgegraut sichtbar statt einfach zu fehlen. Ein Hinweis beim Drüberfahren nennt die Listen, in denen man dort Aufgaben anlegen kann.

## [0.66.0] - 2026-11-02

### Added
- Notizen: Strg+C über mehrere markierte Punkte kopiert sie als Markdown (Einrückung, To-dos, Überschriften, Zitate, Code). In andere Programme eingefügt ist das eine saubere Liste, in eine Notiz eingefügt entstehen wieder dieselben Punkte.
- Notizen: Ein zweites Strg+A in einem Punkt markiert die ganze Notiz, etwa um sie mit Strg+C komplett als Markdown zu kopieren.

### Fixed
- Notizen: Kopieren über mehrere Punkte funktioniert auch auf Installationen ohne HTTPS.

## [0.65.0] - 2026-11-02

### Changed
- Kanban am Desktop: Auch bei nur einer Spaltenreihe schiebt der erste Mausrad-Schritt die Leiste darüber (neue Aufgabe, Hashtags, Listen) weg, und die Spalten wachsen auf Bildschirmhöhe. Zurückscrollen holt die Leiste wieder.

## [0.64.1] - 2026-11-02

### Fixed
- Zurück-Taste: Auch der Wechsel der Aufgabenliste und der Einkaufsliste ist jetzt ein eigener Schritt; Zurück führt zur vorher offenen Liste.

## [0.64.0] - 2026-11-02

### Added
- Die Zurück-Taste (Maus, Browser, Android) geht innerhalb von MindSift zurück, statt die App zu verlassen: aus einem hineingezoomten Punkt heraus, zur vorher offenen Notiz, zur vorher offenen Ansicht im Workspace, am Handy von der Notiz zur Notizliste und zur vorigen Seite. Vor geht entsprechend wieder vorwärts.

## [0.63.2] - 2026-11-02

### Fixed
- Kanban: Nach „Board auf volle Breite strecken“ waren die Spalten nur etwa halb so hoch wie der Platz, bis man das Fenster in der Größe änderte. Jetzt haben sie sofort die volle Höhe.

## [0.63.1] - 2026-11-02

### Fixed
- Notizen am Desktop: Die Knopfleiste an einem Punkt (Fokus, Auslagern, Löschen …) erscheint nur noch, während sich die Maus über dem Punkt bewegt, und verschwindet etwa eine Sekunde später. Eine ruhende Maus, auch beim Tippen, lässt sie nicht mehr über dem Text stehen. Auf der Leiste selbst bleibt sie sichtbar.

## [0.63.0] - 2026-11-02

### Added
- Kanban am Handy: Jede Spalte füllt den Bildschirm zwischen Kopfleiste und unterer Navigation, ein Wisch bringt genau eine Spalte weiter und rastet ein. Beim Ziehen einer Karte springt die Seite am oberen bzw. unteren Rand zur vorigen bzw. nächsten Spalte, sodass sich Karten in jede Spalte legen lassen.
- Desktop: Triage, Workspace, Aufgaben und Listen behalten beim Wechsel zwischen den Seiten ihre Scrollposition.

### Changed
- Kanban am Desktop mit mehreren Reihen: Beim ersten Scrollen verschwindet nur die Leiste über dem Board, die erste Reihe wächst dabei mit, bis sie den ganzen Bildschirm füllt.

## [0.62.0] - 2026-11-02

### Changed
- Kanban am Desktop: Alle Spalten sind in jeder Reihe gleich hoch, so hoch wie der sichtbare Bereich unter der Leiste (mindestens Platz für etwa drei Karten). Bricht eine Spalte in eine zweite Reihe um, wird die erste Reihe nicht mehr höher.
- Kanban mit mehreren Reihen: Ein Mausrad-Schritt springt zur nächsten bzw. vorigen Reihe. Spalten mit vielen Karten scrollen zuerst in sich; Strg + Mausrad über dem Board scrollt frei.

## [0.61.0] - 2026-11-02

### Added
- Notizen: Ein gelöschter Ordner landet als ein Eintrag im Papierkorb („Ordner · 3 Notizen“) und lässt sich mit allen Unterordnern, auch leeren, und Notizen wiederherstellen. Endgültig löschen, Papierkorb leeren und die Aufbewahrungsfrist gelten für den Ordner samt Inhalt. Ordner in geteilten Ordnern verhalten sich wie bisher.
- Notizen: Beim Löschen eines Ordners erscheint eine kurze Rückfrage direkt an der Klickstelle (Enter bestätigt, Escape bricht ab).

### Fixed
- Notizen: Leere Unterordner eines gelöschten Ordners waren endgültig verloren.

## [0.60.0] - 2026-11-02

### Changed
- Desktop: Das Fenster scrollt nicht mehr als Ganzes. Kopfleiste und Fußzeile stehen fest, nur der Bereich dazwischen scrollt; der Scrollbalken beginnt unter der Kopfleiste. Damit verschiebt sich beim Seitenwechsel nichts mehr, und der Rand neben der Kopfleiste braucht keine Sonderbehandlung.
- Triage am Desktop: Kachel und Knöpfe bleiben stehen, die Warteschlange füllt den restlichen Platz und scrollt in sich.

### Fixed
- Chrome: Die Kopfleiste scrollte seit 0.59.3 beim Scrollen mit aus dem Bild.

## [0.59.3] - 2026-11-02

### Fixed
- Chrome: Rechts neben der Seite stand seit 0.59.1 ein weißer Streifen, auf Seiten ohne Scrollbalken über die ganze Höhe. Der Streifen hat jetzt die Farben von Kopfleiste und Seite, und der Scrollbalken der Seite ist auch im dunklen Theme sichtbar.

## [0.59.2] - 2026-11-02

### Fixed
- Desktop: Rechts neben der Kopfleiste war seit 0.59.1 ein Stück in der Seitenfarbe zu sehen (der freigehaltene Platz für den Scrollbalken). Die Kopfleiste reicht dort jetzt farblich bis an den Fensterrand.

## [0.59.1] - 2026-11-02

### Fixed
- Desktop: Das Layout verschiebt sich nicht mehr um ein paar Pixel, wenn eine Seite scrollbar wird (z. B. ein breites Kanban-Board) oder beim Wechsel zwischen Seiten mit und ohne Scrollbalken. Der Platz für den Scrollbalken bleibt immer frei.
- Aufgaben: Beim Wechsel der Aufgabenliste blitzten kurz die Aufgaben der vorherigen Liste auf, besonders beim Wechsel zwischen Listen- und Kanban-Ansicht. Jetzt erscheint die neue Liste sofort mit ihren Aufgaben.

## [0.59.0] - 2026-11-02

### Added
- Aufgaben: Jede Aufgabenliste merkt sich, ob sie als Liste oder als Kanban-Board angezeigt wird, „Alle Aufgaben“ ebenso (pro Gerät).

## [0.58.0] - 2026-11-02

### Added
- Aufgaben: „Alle Aufgaben“ ist standardmäßig nach Liste gruppiert. Aufgaben ohne Liste stehen als „Ohne Liste“ ganz oben, danach die Listen in der Reihenfolge der Reiter. Unter „Gruppe“ lässt sich wie bisher anders gruppieren; einzelne Listen bleiben ungruppiert.

### Changed
- Gewählte Aufgabenliste, Listen-/Kanban-Ansicht und Gruppierung sowie die gewählte Einkaufsliste merkt sich MindSift jetzt pro Gerät, auch über einen Neustart der installierten App oder einen neuen Tab hinweg.
- Zähler an Reitern und in der Navigation stehen direkt hinter dem Wort und hängen immer nur 2 px über den letzten Buchstaben, auch bei zwei- und dreistelligen Zahlen. Sie sind überall gefüllt (am Handy schien vorher das Icon durch) und haben keinen dunklen Ring mehr.

### Fixed
- Handy: In den Aufgaben-Details waren Aufgabenliste, Personen-Suche, Hashtag und Unteraufgabe deutlich kleiner als die übrigen Felder; jetzt sind alle gleich groß (auch beim Teilen und in Gruppen), und iOS zoomt beim Antippen nicht mehr hinein. Der Knopf zur verknüpften Notiz heißt dort kurz „Notiz“, damit der Kopf einzeilig bleibt.

## [0.57.0] - 2026-11-02

### Changed
- Die Handy-Ansicht gilt jetzt bis 767 px Breite (bisher bis 639 px). Handys im Querformat, kleine Tablets im Hochformat (z. B. iPad mini) und schmale Fenster bekommen damit die Ansicht mit großen Tippzielen und unterer Navigation statt einer gedrängten Desktop-Ansicht.

### Fixed
- Desktop: Die Quick-Dump-Leiste steht genau mittig im Kopf und bleibt stehen, wenn der Verbindungsstatus wechselt (z. B. von „online“ zu „eingeschränkt“) oder der Name lang ist.

## [0.56.0] - 2026-11-02

### Added
- Hinter Firmen-Proxys, die weder WebSocket noch Server-Sent Events durchlassen, kommen Änderungen anderer jetzt per Long-Polling live an: Aufgaben und Listen aktualisieren sich ohne Tabwechsel oder Neuladen. Notizen nutzen dieselbe Verbindung. Am Profil steht dann gelb „eingeschränkt“, die Live-Pille zeigt „Live (Long-Polling)“.
- Aufgaben zeigen wie Listen und Notizen eine Live-Pille.

### Changed
- Kopfzeile von Aufgaben und Listen wie bei den Notizen: links Live-Pille und „Geteilt“, dann ein Trenner, rechts die Knöpfe. Am Handy genauso.

## [0.55.0] - 2026-11-02

### Added
- Verbindungsstatus am Profil mit drei Zuständen: grün „online“ (Live-Verbindung), gelb „eingeschränkt“ (Server erreichbar, aber keine Live-Verbindung, z. B. hinter einem Firmen-Proxy; Notizen gleichen sich langsamer ab, andere Änderungen erscheinen beim Zurückkehren in den Tab) und rot „offline“. Am Desktop steht der Status jetzt immer unter dem Namen, nicht nur ohne Verbindung.

### Fixed
- Hinter einem Firmen-Proxy stand am Profil dauerhaft „offline“, obwohl die App funktionierte.
- Notizen: Wer nach einem Wechsel in eine andere App oder ein anderes Fenster im selben Punkt weitertippte, bekam eine Konfliktmeldung gegen den eigenen Text.
- Notizen: Nach einem echten Konflikt entstand bei jedem Weitertippen eine weitere Konfliktkopie. Jetzt gibt es eine Kopie mit dem eigenen Text; der Punkt selbst zeigt nach dem Verlassen die andere Version.
- Anmeldung: Tab springt vom Benutzernamen direkt ins Passwortfeld, „Passwort vergessen?“ kommt danach.
- Handy: Seiten lassen sich nicht mehr ins Leere scrollen, wenn der Inhalt auf den Bildschirm passt (die Höhe richtet sich nach dem sichtbaren Bereich statt nach der Höhe ohne Adressleiste).

## [0.54.0] - 2026-11-02

### Added
- KI-Agenten können über MCP Unteraufgaben anlegen, abhaken, wieder öffnen, umbenennen und entfernen (`add_subtask`, `update_subtask`). Dafür reicht das Recht „Aufgaben ändern“; ist die Aufgabe mit einer Notiz verknüpft, ziehen die Checkboxen dort mit.
- Am Handy lässt sich die Liste über den Titel oben wechseln: Ein Tipp auf den Namen der offenen Aufgabenliste bzw. Liste klappt alle Listen mit ihren Zählern auf.

### Fixed
- Notizen: Beim Klick in einen Punkt wurde die Zeile ein paar Pixel höher, sodass alles darunter kurz nach unten sprang.
- Aufgaben-Details am Handy: Die Herkunfts-Badge eines API-Schlüssels ragte über den Knopf „Beobachten“. Am Handy steht die Herkunft jetzt nur noch unten; der Knopf „Beobachten“ ist so hoch wie die Knöpfe daneben.

## [0.53.0] - 2026-11-01

### Added
- Administration → Server & Isolation: Schalter „KI-Agenten (MCP) erlauben“. Ausgeschaltet ist der MCP-Endpunkt abgeschaltet, ebenso das Verbinden über claude.ai und ChatGPT; bestehende Connector-Verbindungen ruhen, API-Schlüssel funktionieren per curl weiter. In den API-Schlüssel-Einstellungen verschwindet dann der Reiter „KI-Agenten (MCP)“. Mit `MCP_ENABLED=false` bzw. `true` legt der Betreiber das fest, der Schalter ist dann gesperrt.
- KI-Agenten können über MCP Notizen anlegen und lesen. Dafür gibt es bei API-Schlüsseln und beim Verbinden über claude.ai/ChatGPT zwei neue Rechte unter „Notizen“: **Lesen** (Notizen auflisten, lesen und in der Suche finden) und **Anlegen** (neue Notizen mit Punkten und Unterpunkten, auf Wunsch in einem Ordner). Bestehende Notizen kann ein Agent nicht ändern. Beide Rechte sind standardmäßig aus und gelten nur über MCP, nicht per curl.

## [0.52.0] - 2026-11-01

### Added
- Notizen: Ein ausgelagerter Punkt lässt sich zurückholen. Am Link, der nach `/extract` stehen bleibt, gibt es den Knopf „Notiz zurückholen“: Die Punkte der Notiz kommen wieder als Unterpunkte an diese Stelle, der Link wird wieder zum Text, und die Notiz wandert in den Papierkorb. Strg+Z oder „Rückgängig“ macht das wieder rückgängig. Geht mit eigenen Notizen, die nirgends sonst verlinkt sind.

## [0.51.0] - 2026-11-01

### Added
- MindSift lässt sich in **claude.ai** (auch in der Claude-App am Handy) und **ChatGPT** als Connector verbinden, ganz ohne API-Schlüssel: Adresse `…/api/v1/mcp` eintragen, in MindSift anmelden, auswählen, was der Agent darf, und erlauben. Vorbelegt sind Lesen und Ändern für Aufgaben und Listen. Braucht `BASE_URL`; im Demo-Modus nicht verfügbar.
- Einstellungen → API-Schlüssel: Verbindungen über claude.ai & Co. stehen mit dem Kennzeichen „OAuth“ in der Liste; Rechte ändern, umbenennen und trennen wie bei Schlüsseln. Unter „KI-Agenten (MCP)“ steht die Adresse für claude.ai / ChatGPT zum Kopieren.
- `OAUTH_IDLE_DAYS` (Standard 90): Verbindungen, die so lange nicht benutzt wurden, werden getrennt; `0` = nie.

## [0.50.0] - 2026-11-01

### Added
- Globale Suche: Chips „Alle · Notizen · Aufgaben · Listen“ mit Trefferzahl unter dem Suchfeld; wechseln per Klick, `Tab`/`Shift+Tab` oder `Strg+1` bis `4`. Auf eine Art eingeschränkt, zeigt die Suche bis zu 100 Treffer.
- Große Ansicht der Suche (Knopf mit den diagonalen Pfeilen, am PC): breiteres, höheres Fenster mit bis zu 200 Treffern und Filtern je Art – Aufgaben nach Status, Aufgabenliste, Priorität und Fälligkeit (überfällig, heute, in 7 Tagen), Notizen nach Ordner, Listeneinträge nach Liste und Status. Dazu Kontext je Treffer: bei Punkten der Punkt davor und danach, bei Aufgaben Liste, Fälligkeit und Priorität, bei Listeneinträgen die Liste.

### Fixed
- Globale Suche: Aufgaben trugen vorne immer ein grünes Häkchen, auch wenn sie offen waren. Jetzt steht dort eine Checkbox mit dem echten Zustand, mit der sich Aufgaben und Listeneinträge direkt in der Suche abhaken oder wieder öffnen lassen.

## [0.49.2] - 2026-11-01

### Fixed
- Globale Suche: Offene Aufgaben stehen vor erledigten, verworfene Gedanken ganz hinten; offene Listeneinträge vor abgehakten. Bisher zählte nur, wie gut der Text passte, sodass erledigte Aufgaben offene verdrängen konnten.

## [0.49.1] - 2026-11-01

### Fixed
- Aufgaben: Nach dem Sprung zu einer Aufgabe (z. B. über das Abzeichen „Erweitert“ in einer Notiz) öffnete sich deren Detailfenster bei jedem Zurückwechseln in den Aufgaben-Reiter erneut.

## [0.49.0] - 2026-11-01

### Changed
- **Achtung:** MindSift steht ab dieser Version unter der [GNU Affero General Public License v3.0](LICENSE) (AGPLv3) statt unter The Unlicense. Nutzen, ändern und weitergeben bleibt frei, auch kommerziell; wer eine geänderte Fassung weitergibt oder als Dienst im Netz anbietet, muss deren Quellcode unter derselben Lizenz zugänglich machen. Versionen bis einschließlich 0.48.0 bleiben unter The Unlicense. „Über MindSift“ nennt die neue Lizenz und verlinkt weiterhin den Quellcode.

## [0.48.0] - 2026-11-01

### Changed
- Workspace, Hashtag-Seite: Die Fundstellen lassen sich direkt bearbeiten. Jede Notiz erscheint als feste Überschrift (Klick öffnet sie), darunter der normale Outliner mit den Punkten, die den Hashtag tragen, samt Unterpunkten. Tippen, Enter, Einrücken, Abhaken und Rückgängig wirken direkt in der Originalnotiz, auch gemeinsam mit anderen. Wer den Hashtag aus einem Punkt entfernt oder per Enter einen neuen Punkt ohne Hashtag anlegt, sieht ihn, bis der Cursor ihn verlässt. Die Rahmen um die einzelnen Notizen sind weg, die Seite sieht aus wie eine normale Notiz; Notizen laden erst beim Hineinscrollen.

## [0.47.0] - 2026-11-01

### Added
- Verlinken-Fenster in Notizen: Ab 3 Buchstaben stehen unter den passenden Notizen auch passende **Punkte aus allen Notizen** (bis zu 8, Suchbegriff markiert, mit Notiztitel). Ein Klick verlinkt direkt diesen Punkt.
- Beispieldaten (Demo und auf Wunsch bei der Einrichtung): neuer Ordner „MindSift-Hilfe“ mit kurzen Anleitungen (Erste Schritte, Notizen, Aufgaben, Listen, Tastenkürzel, Spracheingabe, Teilen, API), eine Notiz „Zoom ausprobieren“ mit zehn Ebenen, eine tiefere Küchenplanung in „Hausrenovierung 2027“ und Beispiele für verknüpfte To-dos: „Backup-Konzept“ (Häkchen als Aufgabe mit Unteraufgaben) und die als Notiz vertiefte Aufgabe „Uptime-Monitoring“.

## [0.46.0] - 2026-11-01

### Added
- Aufgaben: Mikrofon bei den Detailnotizen (rechts in der Kopfzeile). Diktierter Text wird an die Notiz angehängt und öffnet dafür das Bearbeitungsfeld; gespeichert wird wie gewohnt mit „Notiz speichern“.

## [0.45.2] - 2026-11-01

### Changed
- README und Doku auf den aktuellen Stand gebracht: Papierkörbe und Aufbewahrungsfristen, Spracheingabe pro Person, Strg+Z in den Aufgaben, kombiniertes Kanban in „Alle Aufgaben“, Markieren über mehrere Punkte, Notizen und Listen ohne Emoji, Hinweis bei neuer Version, Datenbank-Migrationen bis 16.

## [0.45.1] - 2026-11-01

### Changed
- Workspace: Ordner haben keinen Aufklapp-Pfeil mehr; das offene bzw. geschlossene Ordnersymbol zeigt den Zustand. Leere und gefüllte Ordner stehen damit bündig, Notizen in einem Ordner sind gleich weit eingerückt wie Unterordner.
- Aufgaben am PC: Die Hashtag-Zeile scrollt nicht mehr seitlich. Passen nicht alle Hashtags hinein, endet sie mit „…“; ein Klick darauf zeigt alle in mehreren Zeilen, „Weniger“ klappt sie wieder ein.

## [0.45.0] - 2026-11-01

### Added
- Notizen: Text lässt sich mit der Maus über mehrere Punkte hinweg markieren. Entf/Backspace löscht ihn wie in einem Texteditor (der Rest des ersten und des letzten Punkts wird ein Punkt, Punkte dazwischen samt Unterpunkten verschwinden), ein getipptes Zeichen ersetzt ihn, Strg+C kopiert, Strg+X schneidet aus. Strg+Z holt alles in einem Schritt zurück.
- Aufgaben: Strg+Z (Cmd+Z) macht Löschen, Verschieben (Spalten, Reihenfolge in Kanban und Liste) und Abhaken rückgängig. Nach dem Löschen erscheint unten „Aufgabe im Papierkorb · Rückgängig“, auch am Handy.
- Notizen, Aufgabenlisten und Listen lassen sich ohne Emoji anlegen: Alle Emoji-Auswähler haben „Entfernen“. Ohne Emoji steht der Titel allein; im Kopf einer Notiz zeigt ein dezentes Symbol, wo man eins wählen kann.

### Fixed
- Kanban: Eine Aufgabe, die in eine selbst angelegte Erledigt-Spalte gezogen wurde, galt nach dem Umsortieren nicht als erledigt (nur die Standard-Spalte „Erledigt“ zählte).

## [0.44.0] - 2026-11-01

### Changed
- Neue Notizen bekommen 🗒️ als Standard-Symbol (vorher 📝 bzw. 📄).
- Aufgaben-Liste: „Gruppe“ und „Sortierung“ stehen direkt über der Liste neben den Reitern „Offen / Erledigt / Papierkorb“; „Erledigte in den Papierkorb“ und „Papierkorb leeren“ sind ein Papierkorb-Symbol rechts daneben.
- Kanban am PC: Das Board ist so hoch wie das Fenster; nur noch die Spalten scrollen, die Seite nicht mehr zusätzlich (wenn alle Spalten in eine Reihe passen).
- Quick Dump: Im aufgeklappten Bereich wählen Ziel und Liste nur aus, gespeichert wird mit Enter bzw. dem Knopf. Der Hinweis „(Klick speichert sofort …)“ entfällt.
- Spracheingabe über den Browser: Ein Tippen auf das Mikrofon hört über kurze Pausen hinweg zu und endet erst nach 5 Sekunden Stille.

### Fixed
- Workspace: Shift+Klick ab einer angehefteten Notiz, die in ihrem Ordner angeklickt wurde, markierte alles ab der angehefteten Zeile ganz oben statt ab dem Ordner.
- Notizen: Ein Punkt mit Unterpunkten rückte durch den Aufklapp-Pfeil ein Stück nach rechts; jetzt stehen alle Punkte genau untereinander.
- Globale Suche: Das Eingabefeld springt beim Tippen nicht mehr hin und her (Lade-Symbol und Leeren-Knopf teilen sich einen festen Platz).

## [0.43.0] - 2026-11-01

### Added
- Papierkorb für Aufgaben: Gelöschte Aufgaben, „Erledigte leeren“ und das automatische Aufräumen erledigter Aufgaben landen im Reiter „Papierkorb“ der Aufgaben, statt sofort weg zu sein. Von dort kommen sie unverändert zurück (mit Beschreibung, Unteraufgaben, Zuweisungen) oder werden endgültig gelöscht. Wer eine Liste sieht, sieht auch ihren Papierkorb; Zurückholen und Löschen braucht Bearbeitungsrecht. Auch `delete_task` per MCP legt in den Papierkorb.
- Eigener Papierkorb für die Triage: verworfene Gedanken öffnen sich über den Papierkorb-Knopf oben in der Triage (am Handy im Menü).
- Kontoeinstellungen → Aufbewahrung: für erledigte Aufgaben (Standard 30 Tage, danach in den Papierkorb), den Papierkorb der Aufgaben (30), der Triage (14), der Notizen (30) und abgehakte Listeneinträge (7) jeweils 7, 14, 30 oder 90 Tage, ein oder zwei Jahre oder nie. In geteilten Aufgabenlisten, Listen und Notizen gilt die Einstellung der Person, der sie gehören. Was beim Update schon erledigt oder gelöscht war, zählt ab dem Update.
- Administration: „Dauerhaftes Aufbewahren erlauben“ (bzw. `RETENTION_ALLOW_NEVER`). Ausgeschaltet gibt es „nie“ nicht mehr; dort gilt dann die Voreinstellung des Bereichs.

### Changed
- Die Auswahl „Erledigte Aufgaben löschen nach …“ und ihr Erklärsatz im Reiter „Erledigt“ entfallen; die Fristen stehen gesammelt unter Aufbewahrung. „Erledigte leeren“ fragt nicht mehr nach, weil sich alles zurückholen lässt.
- **Achtung:** Der Papierkorb der Notizen und abgehakte Einträge in Einkaufs- und Checklisten werden jetzt nach der Frist automatisch geleert (Standard 30 bzw. 7 Tage ab dem Update). Wer das nicht möchte, stellt unter Aufbewahrung „nie“ ein.

## [0.42.0] - 2026-11-01

### Added
- Spracheingabe pro Person: Mit eigenem Whisper-Server wählt jede Person in den Kontoeinstellungen unter „Spracheingabe“, ob ihr Mikrofon den Whisper-Server (Standard) oder die Erkennung des Browsers nutzt. Die Wahl gilt sofort auf allen Geräten.
- `STT_ALLOW_BROWSER=false` verbietet die Spracherkennung des Browsers (Chrome und Edge schicken die Aufnahme an Google bzw. Microsoft), z. B. für den Einsatz in Firmen. Mit Whisper-Server entfällt dann die Auswahl, ohne Whisper-Server gibt es dann keine Spracheingabe.

## [0.41.0] - 2026-11-01

### Added
- Hinweis bei neuer Version: Wurde der Server aktualisiert, erscheint in der offenen App ein Fenster „Neue Version verfügbar“ mit „Jetzt aktualisieren“ (lädt die Seite neu) und „Später“. Geprüft wird beim Zurückkehren in den Tab bzw. die App, alle 15 Minuten und nach einem Neustart des Servers. So bleibt auch die installierte App am Handy nicht auf einem alten Stand.
- Nach dem Neuladen der Seite bleibt der zuletzt offene Bereich (Triage, Workspace, Aufgaben, Listen, Einstellungen) offen, statt immer zur Triage zu springen.

### Changed
- Spracheingabe mit eigenem Whisper-Server: Quick-Dump-Leiste, Erfassen-Fenster am Handy und Halte-Knopf schicken die Aufnahme schon während des Sprechens in Stücken zur Erkennung (wie das Diktat). Der Text erscheint dadurch beim Sprechen, nach dem Stoppen fehlt nur noch das letzte Stück.
- Quick Dump: Das gewählte Ziel (z. B. „Direkt als Aufgabe“ in eine bestimmte Liste) bleibt nach dem Abschicken eingestellt.
- Quick Dump: Die gewählte Liste ist nicht mehr voll in der Akzentfarbe hinterlegt, sondern umrandet, damit die Emojis darauf gut zu sehen sind.
- Emoji-Auswähler am PC: kompakter wie ein Kontextmenü (kleinere Emojis und Schrift, ohne Titelleiste, schließt per Klick daneben oder Escape), mit eigener, abgehobener Fläche. Seine Farben folgen jetzt in allen Themes dem Theme (im dunklen Theme war er bisher grau). „Icon entfernen“ steht bei Notizen als Zeile unten.
- Workspace: Der Hinweis „n markiert · in einen Ordner oder auf den Papierkorb ziehen“ beim Markieren mehrerer Notizen entfällt. Aufheben geht weiter mit Escape oder einem Klick daneben.

## [0.40.1] - 2026-11-01

### Fixed
- Notizen: Wer über eine Aufgabe (oder einen anderen Sprung auf eine bestimmte Stelle) in eine Notiz kam und dort in einem Punkt Enter drückte, landete wieder in der angesprungenen Zeile, die dabei markiert war. Weitertippen überschrieb so z. B. den Titel der verknüpften Aufgabe. Die Sprungstelle wird jetzt nur einmal beim Öffnen angesteuert.

## [0.40.0] - 2026-11-01

### Changed
- Kanban in „Alle Aufgaben“: Die Spalten aller Aufgabenlisten werden nach Namen zusammengeführt (Groß- und Kleinschreibung egal), in Reihenfolge und Farbe der ersten Liste, die eine Spalte hat. Gleich benannte Spalten erscheinen einmal, verschieden benannte getrennt, auch bei den Erledigt-Spalten.
- Beim Ziehen sind Spalten, die die Liste der Karte nicht hat, ausgegraut und nehmen die Karte nicht an. Die Pfeile auf einer Karte führen zu den Nachbarspalten ihrer eigenen Liste; Status-Auswahl und Detailansicht zeigen wie bisher nur die Spalten der eigenen Liste.

### Fixed
- Kanban in „Alle Aufgaben“: Aufgaben in eigenen Spalten einer Liste (z. B. „Review“) fehlten dort ganz, weil nur die Standardspalten angezeigt wurden. Ebenso tauchen Aufgaben, deren Spalte gelöscht wurde, jetzt in der ersten offenen Spalte auf statt nirgends.

## [0.39.0] - 2026-11-01

### Added
- Icon beim Anlegen von Aufgabenlisten, Einkaufslisten und Notizen: Statt eines Textfelds öffnet ein Klick auf das Symbol denselben Emoji-Auswähler wie bei einer geöffneten Notiz (mit Suche und zuletzt verwendeten). Escape schließt nur den Auswähler, nicht das Fenster.

### Changed
- „Als Notiz vertiefen“: Fälligkeit und Priorität stehen in der neuen Notiz direkt unter der Aufgabe, vor der Beschreibung und den Unteraufgaben statt ganz unten. Die Priorität steht auf Deutsch da („Wichtig“, „Dringend“, „Niedrig“).

### Fixed
- Kanban: Beim Ablegen flackerte die Karte kurz, bevor sie an der neuen Stelle erschien. Jetzt nimmt sie direkt den Platz der Lücke ein.
- Beispiel-Konfiguration für den Whisper-Server (`docker-compose.yml`): Das Modell bleibt mit `WHISPER__TTL=-1` geladen; das bisher angegebene `STT_MODEL_TTL` kennt speaches 0.8.3 nicht, das Modell wurde deshalb nach 5 Minuten entladen.

## [0.38.1] - 2026-11-01

### Changed
- Kanban: Beim Ziehen einer Karte öffnet sich an der Zielstelle sanft eine Lücke in Kartengröße, die übrigen Karten gleiten nach, und die Karte verlässt ihren alten Platz. Nach dem Ablegen leuchtet sie kurz an der neuen Stelle auf. Die blaue Linie, die beim Ziehen über Text und Symbole der Karten flackerte und die Ansicht zittern ließ, gibt es nicht mehr.

### Fixed
- Nach dem Umsortieren von Aufgaben (Kanban oder Liste) zeigte eine gewählte Aufgabenliste plötzlich auch Aufgaben aus anderen Listen, bis man sie neu öffnete.

## [0.38.0] - 2026-11-01

### Added
- API-Schlüssel lassen sich bearbeiten: Name und Rechte ändern (Stift-Symbol in Einstellungen → API). Der Schlüssel selbst bleibt gleich, Geräte und Agenten müssen nichts anpassen; die Herkunfts-Badges zeigen sofort den neuen Namen.

### Changed
- Quick Dump: Wird der Text mehrzeilig, rutschen die Knöpfe in eine eigene Zeile darunter, und der Text bekommt die volle Breite.
- Notizen: Die Badges „Erweitert“ und „Unteraufgabe“ stehen jetzt direkt hinter dem Text in derselben Zeile statt in einer eigenen Zeile darunter.

## [0.37.2] - 2026-11-01

### Fixed
- „Als Notiz vertiefen“ an Aufgabenzeile und Kanban-Karte legte bei einer schon verknüpften Aufgabe jedes Mal eine neue Notiz an. Jetzt öffnet der Knopf die verknüpfte Notiz und ist dafür dezent in der Akzentfarbe markiert; auch der Server legt keine zweite Notiz mehr an.
- „Alle Aufgaben“ zeigte bei jeder Aufgabe die Standard-Spalten („Wartet auf andere“) statt der Spalten ihrer Liste. Status-Auswahl, Statuspunkt und Detailansicht nutzen jetzt die Spalten der eigenen Liste, umbenannte Spalten erscheinen also auch dort.
- Spracheingabe mit eigenem Whisper-Server: Bei längeren Aufnahmen hängte Whisper manchmal schon gesagte Sätze noch einmal an. MindSift bittet den Server jetzt, Stille zu überspringen (`STT_VAD_FILTER`, Standard an), und entfernt eine wörtlich wiederholte Schlusspassage.
- Detailansicht am PC: Das Datumsfeld war zu schmal (das Kalender-Symbol lag über dem Datum), das Uhrzeitfeld unnötig breit.

## [0.37.1] - 2026-11-01

### Fixed
- Beim Herunterfahren wartet der Server, bis eine laufende Verdichtung des Notiz-Protokolls fertig ist, bevor er die Datenbank schließt. Dieselbe Lücke ließ einen Test auf dem Build-Server gelegentlich scheitern.

## [0.37.0] - 2026-11-01

### Added
- Workspace: Mehrere Notizen auf einmal verschieben oder löschen. Am PC markierst du mit Strg/Cmd+Klick einzelne Notizen und mit Shift+Klick einen Bereich; ziehst du eine markierte Notiz in einen Ordner oder auf den Papierkorb, kommen alle markierten mit. Escape hebt die Markierung auf.
- Der Papierkorb unten in der Seitenleiste nimmt gezogene Notizen an, auch einzeln und am Handy (lange drücken, dann ziehen). Der Hinweis danach bietet „Rückgängig“.

## [0.36.0] - 2026-11-01

### Added
- Aufgaben, die mit einer Notiz verknüpft sind („Erweitert“), gleichen jetzt auch den Titel ab, in beide Richtungen. Ihre Unteraufgaben sind mit eigenen Häkchen in der Notiz verknüpft (Badge „Unteraufgabe“): Haken und Text wandern hin und her, auch wenn du das Häkchen in der Notiz verschiebst. Eine neue Unteraufgabe erscheint in der Notiz unter der Aufgabe; ein neues Häkchen direkt eine Ebene unter der Aufgabe wird zur Unteraufgabe. Gelöscht wird nie automatisch: Was du auf einer Seite löschst, bleibt auf der anderen stehen.

## [0.35.0] - 2026-11-01

### Added
- Erledigte Aufgaben räumen sich auf: Standardmäßig werden sie 30 Tage nach dem Abhaken gelöscht. Im Reiter „Erledigt“ stellst du die Frist ein (7, 30, 90 Tage, ein Jahr oder nie); in geteilten Listen gilt die Einstellung des Eigentümers. Neu ist dort auch „Erledigte leeren“ zum sofortigen Löschen. Aufgaben, die vor diesem Update erledigt wurden, bekommen ihre volle Frist ab dem Update, es verschwindet also nichts sofort.

## [0.34.0] - 2026-11-01

### Changed
- Aufgaben-Detailansicht am PC in zwei Spalten: links breit Titel, Unteraufgaben und Detailnotizen (mit größerem Eingabefeld), rechts schmal alle Einstellungen (Status, Priorität, Fälligkeit, Wiederholung, Liste, Zugewiesen, Hashtags, Herkunft). Am Handy bleibt die Ansicht, wie sie war.

## [0.33.0] - 2026-11-01

### Changed
- „Als Notiz vertiefen“ bei einer Aufgabe: Die Aufgabe bleibt in ihrer Liste und wird zum ersten Häkchen der neuen Notiz, verknüpft wie eine Aufgabe aus einer Notiz („In Notiz“); Abhaken wirkt an beiden Stellen. Ein Gedanke aus der Triage wird wie bisher zur Notiz.
- Quick Dump: Die Listenzeile unter den Zielen richtet sich nach dem Ziel. Bei „Direkt als Aufgabe“ wählst du die Aufgabenliste (oder „Alle Aufgaben“), bei „Direkt auf Liste“ die Einkaufs- oder Checkliste; bei Quick Dump und Notiz gibt es keine Zeile mehr. Die zuletzt gewählte Liste bleibt je Ziel für die Sitzung gemerkt.

## [0.32.0] - 2026-11-01

### Added
- Spracheingabe auch beim Hinzufügen von Aufgaben (am PC in der Eingabezeile über der Aufgabenliste, am Handy im Fenster „Neue Aufgabe anlegen“ hinter dem +-Knopf) und von Listeneinträgen (am PC in der Zeile, am Handy im Erfassen-Fenster): ein Mikrofon direkt im Feld wie beim Quick Dump. Diktierter Text wird an das Vorhandene angehängt.

### Fixed
- Handy: Beim Anlegen einer Kanban-Spalte waren „Erledigt“ und „Hinzufügen“ rechts abgeschnitten; sie stehen jetzt unter dem Textfeld. In der Spaltenliste zeigt „Erledigt“ am Handy nur den Haken, damit der Mülleimer nicht mehr aus dem Bild rutscht.

## [0.31.0] - 2026-11-01

### Added
- Kanban: Die Farbe jeder Spalte lässt sich einstellen. In „Spalten anpassen“ öffnet der Farbpunkt vor dem Namen die Auswahl: Grau, Anthrazit, Grün, Gelb, Blau, Rot, Lila oder die Akzentfarbe des Themes. Die Farbe erscheint im Spaltenkopf, als Statuspunkt in der Listenansicht und im Detail-Fenster. Blau und Lila passen sich hellen und dunklen Themes an.

## [0.30.0] - 2026-11-01

### Added
- Aufgaben und Listen per curl und Smart Home: Ein API-Schlüssel mit Leserecht ruft z. B. mit `GET /api/v1/tasks?due=today&status=open` ab, was heute ansteht (Filter auch `overdue`, ein Datum, `status`, `taskListId`), und liest Listen. Mit Änderungsrecht hakt er Aufgaben ab, ändert oder löscht sie und pflegt Listeneinträge. Die Einstellungen zeigen dafür einen fertigen Home-Assistant-Sensor „Heute fällig“.
- Herkunfts-Badge: Was ein API-Schlüssel anlegt oder ändert, trägt dauerhaft eine Badge mit seinem Namen, vorne ein Webhook-Symbol (API) oder ein Roboter (MCP). Mouseover oder Tippen zeigt, wer wann angelegt und zuletzt geändert hat; in der Aufgaben-Detailansicht steht es unten. Die Badge gibt es jetzt auch an Listeneinträgen.
- Aufgaben in der Listenansicht zeigen ihren Status mit einem farbigen Punkt in der Farbe der Kanban-Spalte: am PC vor der Status-Auswahl, am Handy als Punkt mit Spaltenname (reine Anzeige, ändern weiter in der Detailansicht).

### Changed
- Webhooks und MCP heißen jetzt zusammen „API“: Die Einstellungs-Kategorie „Webhooks & KI-Agenten“ heißt „API“, die Schalter eines Schlüssels sind nach Aufgaben, Listen und Inbox geordnet (lesen, anlegen, ändern), und die Beispiele stehen in zwei Reitern „curl / Smart Home“ und „KI-Agenten (MCP)“. Die Rechte gelten für beide Zugänge gleich: „Aufgaben anlegen“ erlaubt jetzt auch `create_task` per MCP, „Aufgaben ändern“ auch das Einliefern von Aufgaben per Webhook. Bestehende Schlüssel behalten ihre Rechte.
- Die Badges „Webhook“ und „KI“ / „KI geändert“ sind durch die Herkunfts-Badge ersetzt. Sie verschwindet nicht mehr, wenn du einen Eintrag selbst bearbeitest.

### Fixed
- Ein per Webhook oder MCP eingelieferter Gedanke verlor seine Herkunft, wenn er in der Triage zum Listeneintrag wurde.

## [0.29.0] - 2026-11-01

### Added
- KI-Agenten (MCP) können jetzt Aufgaben löschen (`delete_task`) sowie neue Aufgabenlisten (`create_task_list`) und Listen (`create_list`) anlegen. `list_task_lists` nennt zusätzlich die Spalten des Boards, damit ein Agent eine Aufgabe in die richtige Spalte schieben kann.
- Zeichen „KI“ an Aufgaben und Listeneinträgen, die ein KI-Agent per MCP angelegt hat, und „KI geändert“ an solchen, die er zuletzt geändert hat. So siehst du auf einen Blick, was von dir stammt. Sobald du den Eintrag selbst änderst oder abhakst, verschwindet das Zeichen.

### Changed
- Einstellungen: Export und Import haben eine eigene Kategorie „Export & Import“ (Server-Backups, Backup, Markdown-Archiv, Daten importieren). Die API-Schlüssel stehen weiter unter „Webhooks & KI-Agenten“.

## [0.28.0] - 2026-10-31

### Added
- KI-Agenten anbinden (MCP): MindSift ist jetzt ein MCP-Server unter `POST /api/v1/mcp`. Claude Code, OpenAI Codex, Claude Desktop, Cursor und eigene Agenten können offene Aufgaben auslesen, abhaken, anlegen und ändern sowie Einkaufs- und Checklisten lesen, ergänzen und abhaken. Freigaben gelten wie für dich selbst; Notizen bleiben für Agenten unerreichbar.
- API-Keys haben dafür neue Berechtigungen: Aufgaben lesen / ändern, Listen lesen / ändern. Der Agent sieht nur die Werkzeuge, für die sein Key freigegeben ist. Die Einstellungen zeigen den fertigen Befehl für Claude Code, die `config.toml` für Codex und die JSON-Konfiguration für Claude Desktop und Cursor.

### Changed
- Einstellungen: Die Berechtigungen eines API-Keys und die Bereiche beim Import und Wiederherstellen (Notizen, Aufgaben, Listen, Inbox, Themes) sind jetzt Schalter wie im Rest der Einstellungen statt anklickbarer Buttons mit Haken.
- Der Einstellungsbereich heißt jetzt „Webhooks, KI-Agenten & Export“.

## [0.27.1] - 2026-10-31

### Fixed
- Notizen am Handy: Die Leiste zum Ein- und Ausrücken über der Tastatur blieb stehen, wenn man die Tastatur schloss (z. B. mit der Zurück-Taste), und verdeckte die untere Navigation. Sie erscheint jetzt nur, solange die Tastatur offen ist; ein Tipp in den Punkt holt beides zurück.

## [0.27.0] - 2026-10-31

### Changed
- Demo: Wer die Demo zum ersten Mal öffnet, sieht sie im runden Theme Fjord Nacht statt im eckigen Standard. Ein selbst gewähltes Theme bleibt erhalten; echte Installationen sind nicht betroffen.

## [0.26.1] - 2026-10-31

### Fixed
- Notizen am Handy: Ein Tipp rechts neben einen Punkt löste die unsichtbaren Knöpfe aus (In eigene Notiz umwandeln, Fokus, Löschen …). Die Knöpfe reagieren jetzt nur noch, wenn sie zu sehen sind, also beim Bearbeiten des Punkts.
- Notizen: Ein Punkt, der schon in eine eigene Notiz umgewandelt wurde (nur noch der Link, ggf. mit Hashtags), lässt sich nicht noch einmal umwandeln; der Knopf und `/extract` fehlen dort. Bisher entstand dabei eine zweite Notiz, die nur den Link enthielt.
- Hinweis nach dem Umwandeln am Handy („Öffnen“, „Rückgängig“): sitzt jetzt über der unteren Leiste statt am Bildschirmrand, Text oben (höchstens zwei Zeilen), Knöpfe darunter.

## [0.26.0] - 2026-10-31

### Added
- Verbindungsstatus im Kopf: Ist der Server nicht erreichbar, steht am Desktop unter deinem Namen klein „● offline“ mit rotem Punkt; die Seite bleibt bedienbar. Am Handy zeigt ein kleiner Punkt unten rechts am Profilbild den Status (grün online, rot offline). Das funktioniert auch, wenn nur der Server ausgefallen ist und das Gerät selbst noch Netz hat – bisher war das nur in den Listen zu sehen.

### Changed
- Screenshots im README sind jetzt kleinere WebP-Bilder (zusammen etwa 0,5 statt 2,7 MB); das Journal-Bild zeigt die aktuelle Ansicht.

## [0.25.1] - 2026-10-31

### Fixed
- Tafeln von unten am Handy (neuer Listeneintrag, neue Notiz, neue Liste, neuer Ordner …): Bei runden Ecken waren sie auch unten abgerundet und hatten einen Rahmen rundherum, sodass sie nicht sauber an der Tastatur anlagen. Jetzt sind sie wie die übrigen Tafeln nur oben rund und unten eckig; am Desktop bleibt das Fenster rundum abgerundet.

## [0.25.0] - 2026-10-31

### Changed
- Einkaufslisten am Handy: Das Eingabefeld steht nicht mehr dauerhaft über der Liste. „+“ öffnet es als Tafel von unten (wie bei Aufgaben und Triage); nach „Hinzufügen“ bleibt sie offen und leer für den nächsten Eintrag. Am Desktop bleibt das Feld wie bisher.
- Notizen am Handy: „+“ (und „Neue Notiz“ im Menü) fragt zuerst Name und Emoji ab; erst „Erstellen“ legt die Notiz an. Ein versehentlicher Tipp hinterlässt so keine leere Notiz mehr. Am Desktop entsteht die Notiz wie bisher sofort.

## [0.24.2] - 2026-10-31

### Fixed
- Triage am Handy: „Auf Liste“ (bei mehreren Listen) und „Mit Termin“ taten nichts, weil ihre Auswahl nur am Desktop eingeblendet wurde. Am Handy öffnen sie jetzt das große Auswahlfenster von unten (wie beim langen Drücken auf die Karte).

### Added
- `TODO.md` mit offenen und zurückgestellten Aufgaben im Repository.

## [0.24.1] - 2026-10-31

### Fixed
- Einkaufslisten offline: Neue Einträge ohne Verbindung meldeten „keine Verbindung zum Server“. Jetzt erscheinen sie sofort in der Liste (mit kleinem Wolken-Symbol), bleiben auch nach einem Neuladen sichtbar und werden gesendet, sobald die Verbindung zurück ist. Abhaken, Löschen oder Menge ändern, bevor sie gesendet wurden, wirkt direkt auf den wartenden Eintrag.

### Changed
- Einkaufslisten: Das Feld für neue Einträge ist jetzt als Eingabefeld erkennbar (Rahmen, Plus im Feld) und nimmt den meisten Platz ein; Menge und „Hinzufügen“ sind gleich hoch daneben bzw. am Handy darunter.

## [0.24.0] - 2026-10-31

### Added
- **E-Mail-Adresse bestätigen:** Neue Einstellung (Administration → Server & Isolation, oder `REGISTRATION_VERIFY_EMAIL=true`). Wer sich ohne Einladung registriert, bekommt einen Link per E-Mail und ist erst danach aktiv; in den Freigabe-Modi geht das Konto danach an die Admins, die auch erst dann benachrichtigt werden. Beim Anmelden vor der Bestätigung gibt es „Link erneut senden“. Unbestätigte Konten werden nach 48 Stunden gelöscht, die Adresse ist dann wieder frei. Wirkt nur mit Mail-Server und `BASE_URL`; Einladungen brauchen keine Bestätigung.

### Changed
- Einladung erzeugen: Die E-Mail-Adresse steht vorne und hat mehr Platz, „Wie oft verwendbar“ ist schmal.

## [0.23.0] - 2026-10-31

### Added
- **Einladungslinks:** Jeder Einladungscode ist auch ein Link (`/?invite=CODE`), der die Registrierung mit eingetragenem Code öffnet. In der Administration gibt es dafür „Link kopieren“ und – mit Mail-Server – „Per E-Mail“ (Einladung im MindSift-Layout mit Knopf „Konto anlegen“; einmalige Codes werden dabei an die Adresse gebunden).
- **Ein Link für mehrere Personen:** Beim Erzeugen „Wie oft verwendbar“ angeben (z. B. 20); die Liste zeigt „3 von 20 verwendet“. Auch gleichzeitige Registrierungen können einen Link nie öfter einlösen als erlaubt.
- **Registrierung mit Freigabe und nach E-Mail-Endung:** Statt „offen/geschlossen“ gibt es fünf Modi – geschlossen, mit Freigabe durch einen Admin, nur bestimmte E-Mail-Endungen, Endungen sofort und alle anderen nach Freigabe, offen. Wartende Konten stehen in der Administration unter „Wartet auf Freigabe“ (Freigeben/Ablehnen); Admins bekommen eine E-Mail, die Person nach der Freigabe ebenfalls. Bis dahin ist keine Anmeldung möglich (mit Hinweis). Das Registrierungsformular erklärt, welche Adressen erlaubt sind.
- Neue Umgebungsvariablen `REGISTRATION_MODE` und `REGISTRATION_DOMAINS`: Gesetzt gelten sie und sind in der Administration gesperrt. `ALLOW_REGISTRATION=true` entspricht `REGISTRATION_MODE=open`.

### Fixed
- `ALLOW_REGISTRATION` wurde bisher gar nicht ausgewertet; die Registrierung ließ sich in der Administration unabhängig davon ein- und ausschalten.

## [0.22.2] - 2026-10-31

### Fixed
- Spracheingabe über den Browser (ohne Whisper-Server): In Chrome auf Android wurde ein Satz mehrfach übernommen („TestTestTestTest 1 2 3“ statt „Test 1 2 3“), weil Android jeden Zwischenstand als eigenes Ergebnis liefert. Fortsetzungen ersetzen jetzt den vorherigen Stand.

### Added
- `AGENTS.md` mit Regeln für Coding-Agenten (Sprache, Prüfen, Release-Ablauf über die CI) und ein Plan für Registrierung mit Freigabe/E-Mail-Endungen und Anmeldung per OpenID Connect (`Doku/plans/`).

## [0.22.1] - 2026-10-31

### Fixed
- Push-Benachrichtigungen: Nach dem Neuinstallieren der App zählte die alte Installation als weiteres Gerät mit („2 aktiv“), bis der nächste Push sie aussortierte. Schaltet ein Gerät Push neu ein, meldet es jetzt seine alte Anmeldung mit ab. Außerdem zeigen die Einstellungen alle Geräte einzeln (mit Datum und „dieses Gerät“) und jedes lässt sich entfernen.
- Tageszusammenfassung und Neuigkeiten per E-Mail: Die Begrüßung („Guten Morgen“) richtete sich nach der Uhr beim Versand statt nach der Zeit, für die die Nachricht gedacht ist. Dadurch schlug ab mittags auch ein Test fehl, und der Build von 0.22.1 brach ab – die Version kommt erst mit diesem Fix an.

## [0.22.0] - 2026-10-31

### Added
- Kanban am Handy und Tablet: Karten lassen sich mit dem Finger verschieben – kurz gedrückt halten, bis sie sich anhebt, dann auf eine andere Karte oder Spalte ziehen und loslassen. Am Rand scrollt die Seite mit (am Handy stehen die Spalten untereinander). Ein kurzer Tipp öffnet die Aufgabe wie bisher, Wischen scrollt.
- Admin-Einstellungen: Datenbank-Backups lassen sich neben „Download“ auch löschen (mit Rückfrage). Nur für Admins; Benutzer-Backups laufen weiter über die Aufbewahrungsdauer ab. Neu dafür ist `DELETE /api/v1/admin/backups/{name}`.

### Changed
- Meldung nach dem Teilen: größer und mit dem Daumen gut erreichbar – Text oben, darunter zwei große Knöpfe **Liste** und **Aufgabe** wie in der Triage, ein kleines ✕ in der Ecke; ein Tipp daneben schließt sie.

## [0.21.0] - 2026-10-31

### Added
- Teilen aus anderen Apps: Geteiltes landet wie bisher sofort im Quick Dump. Die Meldung danach bietet ein paar Sekunden lang **→ Aufgabe** und **→ Liste** an, um es mit einem Tipp stattdessen dort abzulegen (bei nur einer beschreibbaren Liste direkt, sonst mit kurzer Listenauswahl). Wer nichts tippt, behält den gewohnten Ablauf.

## [0.20.0] - 2026-10-31

### Changed
- App-Verknüpfungen (App-Icon gedrückt halten): Statt „Capture“ und „Triage“, die nur die Startseite öffneten, gibt es jetzt **Quick Dump**, **Neue Aufgabe** und **Einkaufsliste** mit eigenen Symbolen. Jede öffnet den passenden Bereich mit dem Eingabefeld (Quick-Dump-Fenster, „Neue Aufgabe“, neuer Listeneintrag). Alte Verknüpfungen führen weiter zum Quick Dump. Neue Verknüpfungen übernimmt Android, sobald es die App aktualisiert (oder nach Neuinstallation).

## [0.19.0] - 2026-10-31

### Added
- Notizen am Handy und Tablet: Solange man in einem Punkt schreibt, sitzt direkt über der Bildschirmtastatur eine schmale Leiste mit Ausrücken, Einrücken, Nach oben und Nach unten (ersetzt Tab / Umschalt+Tab). Der Punkt nimmt seine Unterpunkte mit, bleibt beim Verschieben unter seinem Elternpunkt, und die Tastatur bleibt offen. Mit Maus oder Stift erscheint die Leiste nicht.

## [0.18.1] - 2026-10-31

### Fixed
- Workspace am Handy: Nach dem Öffnen des Journals und „Zurück“ blieb der Journal-Eintrag halb markiert, und er war kleiner beschriftet als die Ordner. Er sieht jetzt aus wie ein normaler Eintrag (gleiche Höhe und Schrift wie die Ordner); am Desktop öffnet er sich wie bisher als Bereich mit Kalender.

## [0.18.0] - 2026-10-31

### Changed
- E-Mails haben ein einheitliches Aussehen im Stil der App: Logo mittig oben, darunter eine Karte mit Begrüßung („Guten Morgen, …“ je nach Tageszeit), dem eigentlichen Inhalt und einem Knopf zur App, unten der Hinweis, warum die E-Mail kommt. Das Logo steckt in der E-Mail selbst (erscheint also auch ohne nachgeladene Bilder und ohne `BASE_URL`); jede E-Mail hat zusätzlich eine gleich aufgebaute Textfassung.
- Tageszusammenfassung: Aufgaben stehen in Abschnitten „Überfällig“, „Heute“ und „Morgen“, mit Uhrzeit und Liste darunter.
- Fälligkeits-Alarm, Neuigkeiten, Passwort zurücksetzen, Kontoänderung (mit hervorgehobenem Sicherheitshinweis), Test-Alarm und SMTP-Test nutzen dasselbe Layout; bisher kamen die meisten davon als reiner Text.

## [0.17.4] - 2026-10-31

### Fixed
- Benutzermenü: Bei runden Ecken (Theme-Einstellung) ragte der eckige Kopfbereich mit Name und Rolle oben über den Rand des Menüs hinaus.

## [0.17.3] - 2026-10-31

### Fixed
- Fälligkeits-Benachrichtigungen kamen nach jedem Verschieben im Kanban-Board erneut: Beim Verschieben wurde für alle offenen Aufgaben der betroffenen Spalten vermerkt, dass ihr Alarm noch aussteht. Jetzt bekommt nur eine Aufgabe, die von „Erledigt“ wieder geöffnet wird, ihren Alarm erneut.

## [0.17.2] - 2026-10-31

### Changed
- Workspace am Handy: Notizen, To-Dos und Hashtags wechselt man jetzt wie bei Aufgaben und Einkaufslisten über das Menü oben (Logo); die Reiterzeile entfällt dort. Ordner und Notizen in der Liste sind so hoch wie das Suchfeld (44 px) und damit leichter zu treffen.
- Aufgaben am Handy: Die Kopfleiste ist bei „Alle Aufgaben“ genauso hoch wie bei einzelnen Listen und wie bei den Einkaufslisten.

## [0.17.1] - 2026-10-31

### Changed
- Kanban maximieren: Nur noch das Board wird breiter, Listen-Reiter und „Neue Aufgabe anlegen“ behalten ihre Breite. Das Board wächst weich animiert, jede Spalte wird höchstens 380 px breit und das Board bleibt mittig (bei wenigen Spalten also schmaler als das Fenster).

- Ladebildschirm: Statt immer in Blau erscheint er in den Farben des zuletzt auf dem Gerät genutzten Themes (Hintergrund, Logo in der Akzentfarbe, Statusleiste passend); beim allerersten Besuch bleibt er blau. Neu dafür ist `boot-theme.js` (eigene Datei wegen der Content-Security-Policy); die App-Caches werden einmal erneuert.

- Journal: Vor dem Titel eines Tages steht statt des bunten Kalender-Emojis ein schlichtes Kalender-Symbol in der Textfarbe des Themes (nicht anklickbar, das Icon lässt sich im Journal ohnehin nicht ändern).

### Fixed
- App installieren am Handy: Meldet Chrome erst nach dem Öffnen der Anleitung, dass MindSift installierbar ist (z. B. kurz nach dem Entfernen der alten App), erscheint in der Anleitung jetzt ein Knopf „Jetzt installieren“ für die direkte Installation.

## [0.17.0] - 2026-10-31

### Added
- Aufgaben und Kanban: Eine Aufgabe lässt sich auf den Reiter einer anderen Aufgabenliste ziehen und landet dort wie eine neue Aufgabe. Ihren Kanban-Status behält sie, wenn die Zielliste diese Spalte hat, sonst startet sie in der ersten Spalte. Nur lesbare Listen nehmen nichts an.
- Einkaufslisten: Einträge lassen sich genauso auf den Reiter einer anderen Liste ziehen; Kategorie, Menge und Haken bleiben erhalten. Neu dafür ist `POST /api/v1/lists/{id}/items/{itemId}/move` (Bearbeitungsrecht in beiden Listen nötig).
- Aufgaben und Einkaufslisten merken sich beim Wechsel zwischen den Reitern der App die offene Liste, Aufgaben außerdem Liste oder Kanban (pro Browser-Tab, wie der Workspace).

### Changed
- Einkaufslisten: Die Verbindungsanzeige oben rechts sieht jetzt aus wie bei den Notizen (Punkt und „Live“ bzw. „Offline“) statt des alten Funk-Symbols.

### Fixed
- Push-Benachrichtigungen am Handy: In der Statusleiste erschien statt des Gehirn-Symbols nur ein einfarbiges Quadrat. Android nutzt dort nur die Transparenz des Bildes; MindSift liefert dafür jetzt ein eigenes Symbol (weißes Gehirn auf transparentem Grund). Die App-Caches werden einmal erneuert.

## [0.16.1] - 2026-10-31

### Changed
- README-Screenshots aufgeräumt: Nur noch das Titelbild ist diagonal hell/dunkel geteilt, Handy und übrige Ansichten zeigen jeweils ein Theme. Neu ist ein Raster mit den Farbfamilien Fjord, Terrakotta, Polarized und Suri (je hell/dunkel diagonal, im Kanban-Board).

### Fixed
- Einstellungen am Handy: Bei der Tageszusammenfassung ragten die Kanal-Schalter (E-Mail, Discord, Webhook, Push) rechts aus dem Bild. Am Handy stehen sie jetzt zu zweit untereinander.

## [0.16.0] - 2026-10-31

### Added
- Kanban: Neben „Spalten anpassen“ streckt ein kleiner Knopf (diagonale Pfeile) das Board auf die volle Fensterbreite; alle Spalten stehen dann nebeneinander. Die Einstellung merkt sich der Browser, am Handy gibt es den Knopf nicht.

### Fixed
- Aufgaben: Ein neuer Quick-Dump-Eintrag (z. B. per Spracheingabe über das gehaltene Plus) tauchte kurz oben in den Aufgaben auf, obwohl er in die Triage gehört. Live-Änderungen nehmen jetzt nur noch echte Aufgaben auf; eine per „Rückgängig“ zurück in die Triage geholte Aufgabe verschwindet auch sofort aus der Liste.
- Kanban: Bei runden Ecken (Theme-Einstellung) ragten die eckigen Spaltenüberschriften oben über den Spaltenrand hinaus.

## [0.15.1] - 2026-10-31

### Fixed
- Triage am Handy: Die Warteschlange lässt sich wieder zuklappen („Warteschlange ausblenden“) und fährt beim Auf- und Zuklappen weich auf bzw. zu.
- Triage auf dem Desktop: Notizen, die auf einem anderen Gerät einsortiert oder gelöscht wurden, verschwinden jetzt sofort auch hier (bisher wurde nur der Aufgaben-Tab aktualisiert). Kommt der Tab wieder in den Vordergrund, lädt er außerdem neu, falls Änderungen im Hintergrund verpasst wurden.
- Aufgaben: Ein Tipp irgendwo auf die Aufgabe öffnet sie jetzt zuverlässig, nicht nur auf den Text. Bisher schluckten die Zeile mit Datum/Tags und in Kanban die Pfeil-Leiste jeden Tipp, und am Handy konnte ein etwas längerer Tipp als Ziehen gewertet werden (Ziehen gibt es nur noch mit Maus oder Stift).

## [0.15.0] - 2026-10-31

### Changed
- Hashtag-Übersicht: Kacheln sind breiter (so viele Spalten wie mit mindestens 18rem passen), Tag-Namen und Notiztitel haben mehr Platz.
- README überarbeitet und Screenshots erneuert: jedes Bild zeigt links das helle und rechts das dunkle Theme (diagonal geteilt), neu sind Journal und Notiz am Handy. `e2e/screenshots.sh` erzeugt die Paare selbst (`SHOT_LIGHT`/`SHOT_DARK` für andere Farbfamilien) und läuft wie die Tests mit eigenem Container und Port.

## [0.14.3] - 2026-10-31

### Changed
- Slash-Menü: Befehle, deren Name mit dem Getippten beginnt, stehen oben (`/li` → zuerst `/link`), danach Aliase, dann Treffer im Namen, zuletzt in der Beschreibung.
- Link-Vorschau: Karte und Bild etwa doppelt so hoch; statt der nackten Adresse steht darunter eine kleine Link-Markierung (Domain und Pfad) in der Akzentfarbe des Themes.
- Links in normalen Punkten: Die grüne Markierungsleiste unter dem Punkt entfällt; Web-Adressen im Text sind jetzt direkt anklickbar (Satzzeichen am Ende gehören nicht zum Link).

## [0.14.2] - 2026-10-31

### Fixed
- Installierte App: Der Service Worker lieferte `manifest.json` zuerst aus dem Cache, sodass der Browser bei der Prüfung auf geänderte App-Farben noch die alte blaue Fassung sah. Das Manifest kommt jetzt immer frisch vom Server (Cache nur offline); die App-Caches werden einmal erneuert.

## [0.14.1] - 2026-10-30

### Fixed
- Benutzermenü: Der Hell/Dunkel-Schalter ragte aus dem Menü heraus und zeigte „Wie System“ nicht an, wenn sich dabei das Theme nicht änderte. Er steht jetzt in einer eigenen Zeile (Hell · Dunkel · System) und zeigt jede Auswahl sofort.
- Footer: eine gleichmäßige, kleinere Zeile („MindSift v… · Über MindSift“, rechts die Rechtstexte) in einheitlicher Schrift statt fett/Monospace gemischt, die schief wirkte.

## [0.14.0] - 2026-10-30

### Added
- Themes als Farbfamilien mit je einer hellen und dunklen Variante: Klassik, **Fjord** (neu, Gletscherblau / Nachtblau), Terrakotta, Polarized (neu: **Polarized Hell**), Suri (neu: **Suri Hell**).
- Darstellung in den Kontoeinstellungen: Tabelle Familie × Hell/Dunkel, „Hell oder dunkel: Wie System“ (wechselt innerhalb der Familie mit dem Gerät), Ecken (Wie Theme / Rund / Eckig), Rahmen an Knöpfen (mit / ohne) und eine eigene Akzentfarbe (Vorschläge oder frei wählbar). Alles gilt pro Gerät.
- Benutzermenü und Handy-Profil: kompakte Schnellwahl mit einem Farbpunkt pro Familie und Hell / Dunkel / Wie System; eigene Themes darunter.

### Changed
- Code-Farben aus `index.css` sind nur noch Rückfallwerte; die Code-Farben eines Themes gewinnen immer.

## [0.13.0] - 2026-10-30

### Added
- Neues Theme **Terrakotta Nacht**: das dunkle Gegenstück zu Terrakotta – Espresso-Braun, Creme-Schrift, glühender Terrakotta-Akzent, Salbeigrün, weiche Ecken.
- Animationen: Menüs (Benutzermenü, Drei-Punkte-Menü), Dialoge und Bottom-Sheets blenden und gleiten weich ein; am Handy schiebt sich eine Notiz von rechts herein und die Liste beim Zurück von links. Am PC bleibt der Notizwechsel sofort. Bei „Bewegung reduzieren“ im System gibt es keine Animationen.

### Removed
- Theme „Soft Slate“; wer es aktiv hatte, bekommt automatisch „Terrakotta Nacht“.

### Fixed
- Die vorhandenen Ein-/Ausblend-Animationen (`animate-in`, `fade-in`, `slide-in-from-*`) liefen nie, weil das Tailwind-Plugin fehlte (`tailwindcss-animate`).

## [0.12.2] - 2026-10-30

### Fixed
- Triage am Desktop: Bei nur einer Liste mit langem Namen ragte „Aufgabe“ rechts über die Karte hinaus; der Listenname im Knopf wird jetzt gekürzt (voller Name im Tooltip).

## [0.12.1] - 2026-10-30

### Fixed
- Workspace → To-Dos: Die Gruppierung (Ordner → Notiz) wird pro Ebene gleichmäßig abgestuft – im hellen Theme jede Ebene etwas dunkler, im dunklen etwas heller – statt zwischen grau und weiß hin und her zu springen.

## [0.12.0] - 2026-10-30

### Added
- Neues Theme **Terrakotta**: warmes Cremepapier für Notizen, sandfarbene Seitenleiste, tintendunkle Schrift, gebrannter Terrakotta-Akzent mit Salbeigrün und weiche Ecken; Code-Hervorhebung in Erdtönen.

### Removed
- Theme „High Contrast“. Wer es aktiv hatte, bekommt automatisch „MindSift Dark“.

### Changed
- Themes: Ob ein Theme hell ist (helle Code-Farben, kein Dunkelmodus), richtet sich nach seiner Hintergrundfarbe statt nur nach „Light“.
- Kopfzeile am Handy: Such-Knopf und Profilbild sind gleich große Kreise.

## [0.11.1] - 2026-10-30

### Changed
- Triage am Handy: unter der Karte zwei große Knöpfe „← Wegwerfen“ und „Aufgabe →“ (wie Wischen), darunter ein Viererblock wie im Gedrückthalten-Menü: Auf Liste, Mit Termin, Als Notiz, Später. Die Warteschlange ist am Handy zugeklappt; „Warteschlange anzeigen“ klappt sie auf und scrollt hin.

## [0.11.0] - 2026-10-30

### Added
- Fokus-Modus: Ordner und Notizen gleiten von links herein – über den Ordner-Knopf oder einen Klick auf den Titel in der Kopfleiste, auf breiten Bildschirmen auch, wenn die Maus den linken Rand berührt. Eine andere Notiz öffnet sich, ohne den Fokus-Modus zu verlassen; `Esc` schließt zuerst die Leiste.
- Fokus-Modus für Notizen: `Strg+Umschalt+F` oder „Fokus-Modus starten“ im Drei-Punkte-Menü. Nur die Notiz in angenehmer Lesebreite über dem ganzen Fenster; die Kopfleiste (Titel, Rückgängig, Teilen, Menü, „Beenden“) gleitet herein, wenn die Maus den oberen Rand berührt. `Esc` beendet ihn; am Handy über einen runden Knopf unten rechts.
- **Push-Benachrichtigungen** (Web Push) auf Handy und Desktop, auch wenn MindSift geschlossen ist: unter Kontoeinstellungen → Alarme pro Gerät einschalten und testen; „Push“ ist eine eigene Spalte für jedes Ereignis (auch fällige Aufgaben) und die Tageszusammenfassung. iPhone und iPad ab iOS 16.4, wenn MindSift zum Home-Bildschirm hinzugefügt wurde. Schlüssel per `VAPID_*` oder automatisch erzeugt. API: `/push/key`, `/push/devices`, `/push/subscribe`, `/push/unsubscribe`, `/push/test`.
- Links auf einzelne Punkte: „Link zu diesem Punkt kopieren“ in der Aktionsblase eines Punkts oder im Link-Dialog (`/link`) über „Punkt dieser Notiz wählen“. Format `[[Notiz#^id|Notiz › Auszug]]`; ein Klick öffnet die Notiz, springt zum Punkt und hebt ihn hervor. Gibt es den Punkt nicht mehr (verschoben, ausgelagert, gelöscht), öffnet sich die Notiz mit einem Hinweis. Wiki-Links stehen im Text jetzt mit ihrem Anzeigetext und sind direkt anklickbar.
- Globaler Desktop-App-Footer mit Versionsnummer, „Über MindSift“, dynamischen Rechtstexten (Impressum, Datenschutz) sowie optional konfigurierbarem Custom-Link (`LEGAL_CUSTOM_LINK_LABEL`, `LEGAL_CUSTOM_LINK_URL`).
- „Über MindSift“-Dialog und Versionsanzeige im mobilen Profil-Menü (Avatar-Menü oben rechts).
- PWA Web Share Target: Text, Links und Bilder können über den nativen Teilen-Dialog des Smartphones direkt in den MindSift-Posteingang geteilt werden (`share_target` im Manifest, Abfangen im Service Worker via IndexedDB und Übernahme beim App-Start; Fallback-Route `POST /share-target` im Server).

### Changed
- Inline-Code mit dezentem hellen Schimmer im dunklen Theme (Textfarbe mit geringer Deckkraft als Hintergrund) statt dunklem Code-Hintergrund, in hellen Themes entsprechend leicht grau.
- Installierte App: Statusleiste beim Start und Android-Navigationsleiste schwarz statt blau (die Navigationsleiste kann der Browser nur aus dem Manifest färben, nicht pro Theme); die Statusleiste folgt danach wie bisher dem Theme.
- Notizen-Seitenleiste: Die ausgewählte Notiz ist nur noch hinterlegt (ohne Rahmen); das Journal-Panel und die Monats-/Jahresauswahl im Kalender kommen ebenfalls ohne Rahmen aus.
- Code-Blöcke ohne Rahmen und Kopfleiste: oben links nur die Sprache, Kopieren als runder Symbol-Knopf unten rechts (erscheint beim Überfahren, am Handy immer). „In normalen Text umwandeln“ steht für Code-Blöcke (und nummerierte Punkte) in der Aktionsblase des Punkts.
- Code-, Audio- und Diktat-Blöcke haben unabhängig vom Theme runde Ecken; Callouts bleiben eckig.
- Inline-Code ist einfarbig (Text in Haupttextfarbe auf dem Code-Hintergrund des Themes) statt in Akzentfarbe, für bessere Lesbarkeit.
- Notizen: Enter in einem leeren eingerückten Punkt rückt ihn nur noch aus, wenn danach kein Punkt mehr auf derselben Ebene folgt; sonst entsteht wie gewohnt ein neuer Punkt darunter (auch nummerierte Listen werden dann nicht beendet).
- Workspace-Leiste: Live, Geteilt und Speicherstatus ohne Rahmen im gleichen Stil, ein senkrechter Trennstrich vor den Notiz-Knöpfen. Footer ohne Linie darüber.
- Journal: Panel und Kalender öffnen sich mit einer sanften Animation, die Journal-Ansicht blendet ein.
- Einfügen und Markdown-Import: Eine Liste direkt nach einem Absatz („Folgende Punkte:“) wird unter diesem Absatz eingerückt.
- Workspace am Desktop (ab 1024 px): Die eigene Kopfleiste der Notiz entfällt. Rückgängig, Wiederholen, Teilen und das Drei-Punkte-Menü stehen oben in der Workspace-Leiste, in fester Reihenfolge: Avatare, Live, Geteilt, Speicherstatus (nur noch als Symbol, Text als Tooltip), dann die Knöpfe. Beim Fokus-Modus stehen die Breadcrumbs über dem Titel. Am Handy und Tablet bleibt die Kopfleiste.
- Notizen-Seitenleiste: Überschrift „Notizen & Outliner“ entfernt, Suche und die Knöpfe für neuen Ordner und neue Notiz stehen in einer Zeile.
- Journal: Geöffnet ist es ein hinterlegtes Panel mit Rahmen, „Journal“ ist dessen Überschrift; ein zweiter Klick schließt es und zeigt wieder die vorherige Notiz. Ob das Journal offen war und welche Notiz offen war, bleibt beim Wechsel zwischen den Tabs erhalten (Journal-Tage öffnen sich nicht mehr als einzelne Notiz).
- Notizen: Beim Einfügen und beim Markdown-Import werden Absätze und Listen unter einer Überschrift eingerückt (H2 unter H1 eine Ebene tiefer), so lassen sich Abschnitte einklappen und fokussieren. Enter am Ende einer Überschrift legt den neuen Punkt als Unterpunkt an; `- `, `* ` oder `+ ` in einem leeren Punkt machen ihn zum normalen Aufzählungspunkt.
- CI: Tests laufen pro Code-Stand nur einmal. `main` baut ohne erneute Tests, wenn derselbe Stand schon als `dev` getestet wurde; ein Release-Tag auf denselben Commit wie `latest` baut nicht neu, sondern taggt `latest` um. Die Zuordnung steht als Label im Image (keine zusätzlichen Image-Tags in der Registry). Dockerfile: `SKIP_TESTS`, BuildKit-Caches für Go und npm.

### Fixed
- Notizen: Formatierung innerhalb von fett, kursiv oder durchgestrichen wird angezeigt, z. B. fetter Inline-Code `**`services`**` (bisher standen Backticks im Text).

## [0.10.0] - 2026-10-30

### Added
- Nummerierte Listen im Outliner: `/number` (auch `/nummer`, `/liste`) oder `1. ` am Anfang eines leeren Punkts; Enter setzt die Liste fort, Enter in einem leeren Punkt beendet sie. Eingerückte Listen zählen mit Buchstaben (a., b.), die nächste Ebene römisch (i., ii.), danach wieder mit Zahlen. Export und Import als Markdown (`1.`).
- **Journal** im Workspace: ganz oben in der Seitenleiste; eine Notiz pro Tag mit festem Datumstitel, alle Tage untereinander (heute oben, ältere laden beim Scrollen nach). Solange das Journal offen ist, zeigt ein Kalender mit Monats- und Jahresauswahl den Tag, bei dem man gerade ist; Tage mit Einträgen haben einen Punkt, ein Klick springt hin (und legt den Tag bei Bedarf an). „Teilen“ gilt dem gerade sichtbaren Tag. Am Handy klappt der Kalender über die Kopfzeile auf. Unter Darstellung pro Gerät abschaltbar. API: `GET /journal`, `POST /journal/{date}`.
- Benachrichtigungen: Der eigene Webhook ist jetzt ein vollwertiger Kanal neben E-Mail und Discord – eigene Spalte „Webhook“ für jedes Ereignis und die Tageszusammenfassung; gebündelte Nachrichten kommen als JSON (`event: "digest"` mit Liste der Ereignisse).
- Outliner: Neuer Slash-Befehl `/text` (sowie Aliase `/p`, `/paragraph`, `/bullet`, `/standard`), um beliebige Blöcke (Überschriften, Callouts, Aufgaben, Trennlinien) in Standard-Text umzuwandeln; Aufgaben-Optionen und Block-Aktionsblase bieten ebenfalls die Rückumwandlung an.
- Triage-Deck: Touch-freundliche Schnellaktions-Leiste unter der aktiven mobilen Karte (Wegwerfen, Liste, Notiz, Aufgabe) mit Daumenbedienung (≥ 44 px).

### Changed
- Schrift: MindSift liefert die Schrift Inter jetzt selbst aus (ohne externen Dienst), damit die Oberfläche auf allen Geräten gleich aussieht. Notiztitel stehen in einer feinen, dünnen Schrift und etwas größer.
- Notizen: Der Titel in der Kopfleiste erscheint erst, wenn der große Titel aus dem Bild gescrollt ist; am Handy passt die Kopfleiste in eine Zeile.
- Das Bild für `main` (`latest`) zeigt die Versionsnummer ohne `-dev`; nur `dev` und andere Zweige behalten den Zusatz.
- Outliner: Schriftgrößen für H1 (`text-xl sm:text-2xl font-bold`), H2 (`text-lg sm:text-xl font-semibold`) und H3 (`text-base font-semibold`) deutlich angehoben bei synchroner Textarea und dezentem oberen Abstand.
- Outliner: Aktions-Buttons (Zoom, Auslagern, Löschen, Text-Umwandlung) als schwebende, kontrastreiche Blase (`backdrop-blur-sm`) positioniert, wodurch der Fließtext beim Einblenden nicht mehr ruckartig umbricht.
- Outliner: Aktiver Eintrag im Slash-Befehlsmenü dezent als `bg-accent-dim text-accent` hervorgehoben statt vollflächig deckend.
- Quick Dump (Instant Capture): Platzhaltertexte gekürzt, vertikales Scrolling im einzeiligen Zustand unterbunden und Absende-Pfeil nach unten ausgerichtet.
- Zähler-Badges (`CountBadge`): Akzent-Badge über `--accent-dim` mit Rand, Muted-Badge über `--bg-panel-elevated` und `--text-muted` für hohe Lesbarkeit in allen Themes.
- Workspace: Popover-Dialoge (`FormSheet` mit Anker) öffnen zentriert unter dem Mauszeiger mit Rand-Schutz (Viewport-Clamping).

### Fixed
- Notizen: Eingefügter Text mit Zeilenumbrüchen, der in einem einzigen Punkt landet (z. B. ein Absatz), verschwand – er wird jetzt übernommen. Leerzeilen trennen eingefügte Absätze in eigene Punkte, nummerierte Markdown-Listen bleiben nummeriert (auch mit 3 oder 4 Leerzeichen Einrückung), umbrochene Zeilen gehören zum Punkt darüber.
- Kontoeinstellungen: Der eigene Webhook ließ sich zwar eintragen, aber nicht mehr einschalten (seit dem Umbau der Benachrichtigungen in 0.8.0).
- Workspace: kein doppelter Scrollbalken mehr – die Seite selbst scrollt nicht, nur die Notiz; am Handy scrollt die Notiz nicht mehr getrennt von der Seite.
- Workspace: Ein abgebrochenes Ziehen in der Seitenleiste lässt „Auf Hauptebene verschieben“ nicht mehr stehen.
- Workspace: Der Knopf zum Ein-/Ausklappen der Ordnerleiste ist im eingeklappten Zustand dezent (nur das Symbol in Akzentfarbe).
- Outliner: Slash-Befehle werden an der tatsächlichen Cursorposition im Text erkannt (`/link`, `/diktat`); `/divider`, `/image`, `/audio` und `/code` werden nur noch in leeren Blöcken angeboten; das Menü schließt bei Klick ins Leere und Blur.
- Outliner: Aufgaben-Badges und Drei-Punkte-Menü aus dem Fließtext-Container entkoppelt, um störende Zeilenumbrüche am Zeilenende zu beheben.
- Outliner: Trennlinien (`divider`) können fokussiert und per `Backspace` oder `Entf` direkt in einen leeren Textpunkt umgewandelt werden.
- Kontoeinstellungen: Der Bereich „Profil & Anmeldedaten“ nutzt die volle Breite wie die übrigen Bereiche.
- Light-Theme: Notizen stehen auf einem weißen Blatt, die Ordnerleiste ist dezent grau abgesetzt (bisher umgekehrt). Themes können das über die neuen Variablen `--bg-editor` und `--bg-sidebar` selbst festlegen.

## [0.9.0] - 2026-10-30

### Added
- Formatierungs-Kürzel im Outliner: `Strg+B` / `Cmd+B` für fett, `Strg+I` / `Cmd+I` für kursiv (mit Ein-/Ausschalten bei markiertem Text) und `Strg+K` / `Cmd+K` für Links (mit Markierung `[Text](…)` mit vorselektierter Adresse, ohne Markierung Link-Dialog).
- Code-Blöcke: Zeilennummernspalte links mit synchronem Scrollen (wächst dynamisch bei 100+ Zeilen, zählt auch leere Endzeilen mit); horizontaler Bildlauf bei langen Zeilen ohne automatischen Zeilenumbruch (`white-space: pre`).

### Fixed
- Formatierungs-Kürzel wirken nicht in schreibgeschützten Notizen.
- Light-Theme: Kontraste für Code-Blöcke (`--bg-code`), Callouts (`--bg-panel-elevated`), Zitate und Rahmen auf Notizhintergründen geschärft; VS Code Light+ Syntaxfarben für hohe Lesbarkeit optimiert.

## [0.8.0] - 2026-10-30

### Added
- Benachrichtigungen pro Ereignis und Kanal (Kontoeinstellungen → Alarme): fällige Aufgaben (sofort), Freigabe erhalten, geteilte Aufgabe erledigt, beobachtete Aufgaben – jeweils per eigener E-Mail und/oder eigenem Discord-Webhook. Alles außer fälligen Aufgaben kommt gebündelt (höchstens alle 5 Minuten eine Nachricht, `NOTIFY_DIGEST_MINUTES`), E-Mails jetzt mit HTML-Layout. Eigene Änderungen lösen nichts aus (bei beobachteten Aufgaben zuschaltbar), ein Schalter pausiert alles.
- Aufgaben beobachten: Knopf im Aufgaben-Detail; jede Änderung daran wird gemeldet. API: `POST/DELETE /tasks/{id}/watch`.
- Tageszusammenfassung zur selbst gewählten Uhrzeit: überfällige, heutige und morgige Aufgaben mit Uhrzeit, dazu die Anzahl der nächsten 7 Tage; ohne fällige Aufgaben keine Nachricht.

### Changed
- Notizkopf aufgeräumt: Live-Status, Freigabe-Pille und Online-Avatare stehen oben in der Tab-Leiste neben „Gespeichert“; im Notizkopf gibt es Knöpfe für Rückgängig (`Strg+Z`) und Wiederholen (`Strg+Y`), „Teilen“ direkt sichtbar und ein Drei-Punkte-Menü für Anheften, Zusammenführen, Markdown-Export und Löschen.
- `/diktat` in Notizen: schreibt live mit (mehrzeiliger Text über den Wellen mit Zeitanzeige `mm:ss`), bricht im Browser-Modus bei Sprechpausen nicht mehr ab und schickt im Server-Modus alle ~8 Sekunden bzw. nach kurzen Sprechpausen Abschnitte zur Erkennung vorab.

### Fixed
- In eigene Notiz umwandeln: Der Link erscheint sofort im Punkt (auch hinter Proxys ohne Live-Verbindung), ohne Konfliktkopien bei gleichzeitigem Weitertippen; die neue Notiz steht sofort in der Seitenleiste. Strg+Z oder „Rückgängig“ im Hinweis holen den Ast zurück und legen die neue Notiz in den Papierkorb.
- Notizen: Link-Vorschau-Karten erscheinen nur noch, wenn der gesamte Punkt aus einer einzigen `https`-Adresse besteht (oder über `/link` in einem leeren Punkt eingefügt wurde), nicht mehr bei Links mitten im Fließtext.
- Notizen: Das Slash-Menü (`/`) öffnet sich nur noch am Textanfang oder nach einem Leerzeichen (nicht mehr beim Einfügen von Web-Adressen mit Schrägstrichen), schließt zuverlässig mit `Esc` oder `Backspace` und scrollt bei Pfeiltasten-Navigation automatisch mit.
- Notizen: `Enter` in einem leeren Punkt auf oberster Ebene legt auch am Ende der Notiz einen neuen Punkt darunter an.
- Benachrichtigungen: Die Tageszusammenfassung schließt nun auch Aufgaben aus Aufgabenlisten ein, die über eine Gruppe freigegeben wurden.

## [0.7.0] - 2026-10-30

### Added
- Punkt in eigene Notiz umwandeln: Knopf am Punkt (Desktop) oder `/extract` bzw. `/notiz`. Der Punkt wird Titel, seine Unterpunkte der Inhalt der neuen Notiz im selben Ordner; an seiner Stelle bleibt ein `[[Link]]` (Hashtags bleiben dort). In geteilten Notizen übernimmt die neue Notiz die Freigaben.
- Notizen zusammenführen: in der Seitenleiste eine Notiz auf eine andere ziehen oder im Kopf der Notiz „Mit anderer Notiz zusammenführen…“. Die Quelle wird als Abschnitt (Überschrift mit Unterpunkten) angehängt und wandert in den Papierkorb; „Rückgängig“ im Hinweis macht beides rückgängig.
- Eigene Spracherkennung (optional): Mit `STT_URL` schickt MindSift Aufnahmen an einen selbst betriebenen Whisper-Server (OpenAI-kompatibel, z. B. speaches) statt an Google oder Microsoft. Einstellung nur per Umgebungsvariablen (`STT_*`) inklusive Grenzwerten; `docker-compose.yml` enthält den Dienst `whisper` als auskommentierten Block zum Einschalten, das Modell lädt MindSift beim ersten Start selbst. Administration → Server & Isolation zeigt den aktiven Modus und bietet eine Testaufnahme. In der Demo bleibt es bei der Browser-Erkennung.
- API: `POST /voice/transcribe`, `GET /admin/voice`; `/auth/status` meldet `voice.mode`.
- Bilder in Notizen: `/image` (auch `/bild`) in einem leeren Punkt öffnet direkt im Punkt eine Auswahl – Datei, Kamera (Handy), Hineinziehen, Einfügen mit Strg+V oder Bild-Link (der Server übernimmt eine Kopie). Fotos werden vor dem Hochladen auf höchstens 2048 px verkleinert und als WebP gespeichert, Standortdaten entfallen dabei. Klick vergrößert, darunter eine optionale Beschriftung. Esc oder ✕ macht den Punkt wieder zum leeren Punkt.
- Sprachnotizen in Notizen: `/audio` in einem leeren Punkt zeigt eine Aufnahme-Blase – grüner Knopf startet, er wird rot und links laufen Live-Wellen mit der Zeit, ein Tipp speichert die Aufnahme als Audio-Player im Punkt. Alternativ eine Audiodatei hochladen. Mit eigener Spracherkennung macht „Transkribieren“ aus der Aufnahme die (durchsuchbare) Beschriftung.
- Diktat in Notizen: `/diktat` in einem leeren Punkt hört sofort zu; der Punkt wird zu einer Fläche mit Live-Wellen und „Stopp“, ein Tipp setzt den erkannten Text in den Punkt. Nutzt die eingestellte Spracherkennung (eigener Server oder Browser) und wird ohne Spracherkennung nicht angeboten.
- Backup und Export mit Medien: Das Backup-ZIP (auch die automatischen Server-Backups pro Konto) enthält die Bilder und Sprachnotizen der eigenen Notizen, das Markdown-Archiv legt sie unter `attachments/` ab und bettet sie Obsidian-kompatibel ein. Beim Zurückspielen kommen sie wieder als Bild- und Audioblöcke. Der Obsidian-Import übernimmt jetzt auch eingebettete Bilder und Audiodateien (`![[bild.png]]`, `![](bild.png)`).
- Link-Vorschau in Notizen: Über einem Punkt mit einer Web-Adresse (https) erscheint eine kompakte Karte mit Icon, Seitenname, Titel, einer Zeile Beschreibung und kleinem Bild. Der MindSift-Server ruft die Seite ab (wie bei Bildern nur öffentliche https-Adressen) und speichert die Vorschau 7 Tage; Browser der Leser kontaktieren die Seite nicht. ✕ blendet die Vorschau für diesen Link aus (er wird zu `[Titel](Adresse)`), Darstellung → „Link-Vorschauen anzeigen“ schaltet alle ab. In der Demo aus. API: `GET /link-preview?url=`.
- Medienablage für Notizen (Grundlage für Bilder und Audio): Hochladen, Kopieren externer Bilder, Abruf nur mit Leserecht; Grenzen per `MEDIA_*`; nicht mehr verwendete Dateien werden automatisch entfernt. API: `POST /documents/{id}/media`, `POST /documents/{id}/media/fetch`, `GET /media/{id}`.
- Code-Blöcke in Notizen: Sprachauswahl (rund 50 Sprachen, bei Bedarf nachgeladen), Farben beim Tippen im Stil von VS Code Dark+/Light+ für alle Themes, „Kopieren“, Tab/Shift+Tab rückt ein und aus. `/code yaml` oder ```` ```yaml ```` legt die Sprache direkt fest.

### Changed
- **Hinweis für den Betrieb:** Bilder und Sprachnotizen liegen in `data/media/`, nicht in der Datenbank. Wer den Server sichert, sichert den ganzen Ordner `data/` (der Datenbank-Abzug der Admin-Backups enthält keine Mediendateien). Optional neu in `docker-compose.yml`: der auskommentierte Dienst `whisper`.
- Notizen auf dem Handy: fast kein Seitenrand mehr, Einrückung 14 statt 22 px pro Ebene, Zoom- und Löschknopf belegen nur noch in der aktiven Zeile Platz. Sehr tief verschachtelte Punkte behalten eine lesbare Breite, die Notiz lässt sich dann seitlich verschieben statt den Text zu quetschen.
- E-Mails zeigen einen Absendernamen: `SMTP_FROM_NAME` bzw. das neue Feld „Absender-Name“ in Administration → E-Mail (Standard „MindSift“), wenn die Absenderadresse keinen eigenen Namen enthält.
- Slash-Befehle einheitlich englisch: `/image` statt `/bild` (`/bild` findet ihn weiterhin), kürzere Beschreibungen, breiteres Menü ohne Umbrüche.
- `docker-compose.yml` enthält nur noch die Zuordnungen; alle Erklärungen zu den Variablen stehen in `.env.example`. Neu durchgereicht werden `TZ`, `TRUSTED_PROXIES`, `LOGIN_PROTECTION`, `DEMO_RESET_MINUTES` und `LEGAL_*_CONTENT`, die vorher in `.env` gesetzt wirkungslos blieben.
- Workspace-Seitenleiste wie ein Datei-Explorer: angeheftete Notizen oben, darunter Ordner und Notizen ohne Zwischenüberschriften.
- Spracheingabe in Quick Dump, im mobilen Erfassen-Sheet und beim Halten des +-Knopfs folgt der Server-Einstellung: mit eigenem Whisper-Server funktioniert sie in allen Browsern (auch Firefox), mit Live-Wellen während der Aufnahme und „Wird erkannt…“ danach. Ohne Unterstützung im Browser oder mit `STT_DISABLED=true` ist das Mikrofon ausgeblendet statt einer Fehlermeldung.

## [0.6.1] - 2026-10-29

### Fixed
- Notizen: Wer im Rhythmus tippte (kurze Pausen zwischen den Wörtern), bekam Konfliktkopien gegen sich selbst, auch in nicht geteilten Notizen. Mehrere ungesendete Änderungen an einem Punkt zählten lokal als mehrere Versionen, beim Server aber als eine.

## [0.6.0] - 2026-10-29

### Added
- Profil → „Aktive Sitzungen“: Liste der angemeldeten Geräte mit letzter Nutzung und „Abmelden“ je Gerät.
- API: `GET /auth/sessions`, `DELETE /auth/sessions/{id}`.
- Triage: Gibt es genau eine beschreibbare Liste, setzt „Auf ‹Listenname›“ den Gedanken direkt darauf, ohne Auswahl. Nur lesbar geteilte Listen werden beim Erfassen und in der Triage nicht mehr angeboten.

### Changed
- **Achtung:** Nach dem Update sind alle Benutzer einmal abgemeldet (neue Sitzungsverwaltung, die alte Sperrliste `revoked_tokens` entfällt).
- **Achtung:** `?token=` in der URL von `/webhooks/ingest` nimmt nur noch API-Keys (`mindsift_sec_…`) an.
- **Achtung:** `GET /admin/settings` liefert `smtpPass` nicht mehr; neu ist `smtpPassSet`.
- **Achtung:** `PATCH /auth/settings` verlangt für `password` und `email` das Feld `currentPassword`, sonst `403`.
- Versionsnummern folgen jetzt Semantic Versioning mit dreiteiligen Tags (`v0.6.0`); die Kopfzeile zeigt die volle Version (`v0.6.0-dev` für Entwicklungsstände). Vorabversionen wie `v1.0.0-rc.1` verschieben das Image `:stable` nicht.
- Das Mengenfeld in Listen öffnet auf dem Handy die Zahlentastatur.

### Fixed
- Große Downloads (Backups, Exporte) brachen nach 30 Sekunden ab, große Importe nach 15 Sekunden Upload (FLAW-38).
- Der Offline-Start der App funktioniert zuverlässig: Ein altes Script in der Startseite hat bei jedem Aufruf alle Caches des Service Workers gelöscht.

### Security
- Links in Notizen, Aufgaben-Notizen und Impressum öffnen nur noch `http`, `https` und `mailto`; `javascript:` und ähnliche Links erscheinen als Text. Vorher konnte ein Bearbeiter einer geteilten Aufgabenliste über einen präparierten Link Code im Browser anderer ausführen (FLAW-28).
- Sicherheits-Header für alle Antworten: Content-Security-Policy (Scripts nur von MindSift selbst, keine Einbettung in fremde Seiten), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (FLAW-29).
- Passwort und Login-E-Mail lassen sich nur noch mit dem aktuellen Passwort ändern; die bisherige Adresse bekommt eine Hinweismail, wenn SMTP eingerichtet ist (FLAW-30).
- Anmeldungen sind serverseitige Sitzungen: Jedes Gerät lässt sich einzeln abmelden, unbenutzte Sitzungen enden nach 30 Tagen, aktive werden täglich erneuert. Ein neues Passwort meldet alle anderen Geräte ab (FLAW-31).
- IDs neuer Datensätze haben 96 statt 40 Zufallsbits, Einladungscodes eigene 100 Bit (`INV-ABCDE-FGHIJ-KLMNO-PQRST`); vorhandene IDs und Codes bleiben gültig (FLAW-32).
- Registrierung und „Passwort vergessen“ sind pro Adresse begrenzt (20 bzw. 10 Anfragen in 15 Minuten), Einladungscodes lassen sich so nicht durchprobieren (FLAW-39).
- Ein Einladungscode lässt sich auch bei gleichzeitigen Registrierungen nur einmal einlösen (FLAW-40).
- Öffentliche Demo: verschickt nichts mehr (Alarme, Testalarme, SMTP-Test, Hinweismails), Server-Einstellungen sind schreibgeschützt, Passwort, E-Mail, Sitzungen und Konten der gemeinsamen Demo-Konten lassen sich nicht ändern; die Sitzungsliste zeigt nur das eigene Gerät (FLAW-33).
- Das SMTP-Passwort wird nie mehr an den Browser geschickt; leer lassen behält das gespeicherte (FLAW-34).
- `?token=` beim Webhook-Ingest nimmt nur noch API-Keys an, keine Sitzungs-Tokens (FLAW-35).
- Anfragekörper sind auf 2 MB begrenzt, Notiz-Sync auf 8 MB, Importe auf 101 MB (FLAW-36).
- Konto löschen entfernt auch die Server-Backups des Kontos (FLAW-37).

## [0.5.2] - 2026-10-29

### Fixed
- Einkaufsliste auf dem Smartphone (iOS): Der `+`-Knopf und der Menüeintrag setzen den Fokus für neue Einträge direkt in der Tipp-Geste statt verzögert nach 60 ms, sodass sich die Bildschirmtastatur auf iOS zuverlässig öffnet; Eingabefelder nutzen mobil 16 px Schriftgröße gegen automatisches Heranzoomen.

## [0.5.1] - 2026-10-29

### Fixed
- Mobiler `+`-Knopf in Triage und Aufgaben: Ein kurzes Antippen öffnet das Erfassen-Sheet wieder über das `click`-Event statt bei `pointerup`, damit der direkt folgende Browser-Klick nicht auf dem Hintergrund-Overlay landet und das Sheet sofort wieder schließt (nach langem Halten für die Sprachaufnahme wird der nachfolgende Klick ignoriert).

## [0.5] - 2026-10-29

### Added
- Automatische tägliche Server- und Benutzer-Backups (`$DATA_DIR/backups`): konsistenter SQLite-Gesamtabzug (`VACUUM INTO`, `.db.gz`) sowie ein MindSift-Backup-ZIP pro aktivem Konto; einstellbare Uhrzeit und Aufbewahrungsdauer (Standard 03:00 Uhr, 3 Tage) unter Administration → Datensicherung inkl. „Jetzt sichern“.
- Kontoeinstellungen → Server-Backups: Eigene Sicherungen herunterladen oder gezielt nach Bereichen (`notes`, `tasks`, `lists`, `inbox`, `themes`) wiederherstellen (ersetzen oder hinzufügen); auch der manuelle MindSift-Import unterstützt die Bereichsauswahl und nimmt eigene Themes mit.
- Mobil: Gedrückthalten des `+`-Knopfs startet eine Sprachaufnahme und legt das Transkript beim Loslassen direkt im Quick Dump ab (nach oben ziehen bricht ab); kurzes Tippen bzw. Tastatur/Screenreader öffnen weiterhin das Erfassen-Sheet.
- API-Key-Scopes (`webhook:triage`, `webhook:task`, `webhook:list`): Auswahl beim Anlegen, Anzeige als Badges und Webhook-Simulator für alle drei Ziele in den Kontoeinstellungen (FLAW-07).
- Demo-Modus: Automatischer Reset alle 20 Minuten (`DEMO_RESET_MINUTES`, `0` = aus) mit Live-Countdown (`✨ Demo · Reset in MM:SS`) in der Kopfzeile; Sitzungen bleiben über feste Demo-Konto-IDs erhalten. Tief verschachtelte Beispielnotiz „Hausrenovierung 2027“ (7 Ebenen) zum Ausprobieren des Zoom-Fokus.
- Zähler für offene Listeneinträge am Reiter „Listen“; die Suche in der Notiz-Seitenleiste öffnet die globale Volltextsuche (`⌘K`).

### Changed
- **Achtung:** WebSocket (`/ws`) und SSE (`/events`) akzeptieren kein `?token=` mehr in der URL, sondern kurzlebige Einmal-Tickets (`POST /auth/stream-ticket`, 60 s gültig) oder den `Authorization`-Header (FLAW-22).
- **Achtung:** Neue Passwörter müssen mindestens 8 Zeichen lang sein (Setup, Registrierung, Profil, Admin, Passwort-Reset) (FLAW-09).
- Nummerierte Datenbank-Migrationen über `schema_migrations`, die genau einmal laufen und bei Fehlern den Start abbrechen statt Fehler zu verschlucken (FLAW-13).
- Echtes ESLint (`eslint.config.js`) im Frontend- und Image-Build sowie erweiterte Frontend-Tests (FLAW-19); vereinheitlichte Zugriffsabfrage für Aufgabenlisten (FLAW-20).

### Fixed
- SQLite-Transaktionen starten mit `BEGIN IMMEDIATE` (`_txlock=immediate`), sodass parallele Schreiber auf das Lock warten statt mit `SQLITE_BUSY` zu scheitern (FLAW-23).
- Mehrstufige Datenbankänderungen (Ordner/Aufgabenlisten/Konten löschen, Freigaben, Passwort-Reset) laufen atomar in Transaktionen und melden Schreibfehler sauber zurück (FLAW-14).
- Fälligkeits-Alarme brechen nach 3 fehlgeschlagenen Zustellversuchen mit einer Warnung ab, statt jede Minute endlos weiterzusenden (FLAW-12).
- Bessere Lesbarkeit (dunkler Text) auf dem Türkis-Akzent des Themes `Polarized` sowie korrekte `rounded-full`-Darstellung runder Icon-Buttons in eckigen Themes.

### Security
- Einmal-Stream-Tickets statt langlebiger Sitzungs-Tokens in WebSocket-/SSE-URLs; `BASE_URL` schränkt CORS- und WebSocket-Origins ein; Abmelden, Passwortwechsel und Kontosperre trennen offene Live-Streams sofort (FLAW-22).
- Berechtigungsprüfung für alle Listeneintrags-Endpunkte und beim Umwandeln von Gedanken in Listeneinträge (Eigentümer oder Bearbeiter erforderlich, verhindert IDOR und Schreibzugriffe durch Leser) (FLAW-27).
- API-Keys sind strikt auf ihre Scopes (`webhook:triage`, `webhook:task`, `webhook:list`) beschränkt und können keine Live-Streams öffnen (FLAW-07).
- Schutz gegen Brute-Force beim Login (Sperre nach Fehlversuchen pro Konto+IP, Konto und IP mit `429` und `Retry-After`) sowie explizite Konfiguration vertrauenswürdiger Reverse-Proxys über `TRUSTED_PROXIES` (FLAW-09).
- `DeleteTaskList` prüft die Eigentümerschaft vor dem Entkoppeln von Aufgaben; Leser können Verknüpfungen zwischen Notiz-Blöcken und Aufgaben nicht mehr aufheben (FLAW-14).

## [0.4.1] - 2026-10-29

### Added
- Fälligkeitsdatum mit optionaler Uhrzeit (`YYYY-MM-DDTHH:MM`); Alarme berücksichtigen Uhrzeit (bzw. 09:00 Uhr bei ganztägigen Aufgaben), Vorlaufzeit (`notify_before_minutes`) und Zeitzone (`TZ`, Standard `Europe/Berlin`) (FLAW-12).
- Papierkorb für Notizen (`GET/POST/DELETE /documents/trash…`): Gelöschte Notizen und Ordner landen im Papierkorb, verschwinden aus Baum, Suche und Export und lassen sich vom Eigentümer wiederherstellen oder endgültig löschen.
- Backlinks am Ende einer Notiz (`GET /documents/{id}/backlinks`): Zeigt alle zugänglichen Notizen und Punkte, die per `[[Titel]]` auf die aktuelle Notiz verweisen, mit direktem Sprung zum Punkt.
- „Passwort vergessen?“ auf dem Anmeldebildschirm (wenn SMTP und `BASE_URL` eingerichtet sind): Einmal-Link per E-Mail (SHA-256-Hash gespeichert, 1 Stunde gültig), setzt das Passwort zurück und beendet alle bestehenden Sitzungen.
- Offline-fähige PWA: Service Worker hält die App-Shell vor, gelesene Daten werden pro Benutzer in IndexedDB zwischengespeichert und offline erfasste Gedanken sowie abgehakte Aufgaben/Listeneinträge über eine Outbox bei Rückkehr der Verbindung synchronisiert.
- Zwei neue dunkle Themes: `Polarized` (Obsidian & Türkis/Smaragd) und `Suri` (Mitternachts-Pflaume & Orchidee).

### Changed
- Aufteilung von `internal/storage/sqlite.go` und `internal/api/server.go` in domänenspezifische Dateien ohne Verhaltensänderung (FLAW-20).

### Security
- Ohne gesetztes `JWT_SECRET` (oder bei bekannten Platzhaltern) erzeugt der Server einmalig ein zufälliges 32-Byte-Geheimnis in `data/jwt.secret` (`0600`), statt ein öffentlich bekanntes Standard-Secret zu verwenden (FLAW-04).
- SSRF-Schutz für Discord- und benutzerdefinierte Alarm-Webhooks: Nur `https`, Host-Prüfung für Discord, Blockieren von Loopback/Link-Local/Cloud-Metadata bei der DNS-Auflösung; private Netze und `http` nur über expliziten Admin-Schalter (`allowPrivateWebhooks`) (FLAW-05).
- Einheitliche Authentifizierungsprüfung für Middleware und Webhook-Ingest inkl. Sperrliste, `token_version` und aktivem Konto; API-Keys dürfen keine Lese- oder Verwaltungs-Endpunkte mehr aufrufen (FLAW-07, FLAW-08).

## [0.4] - 2026-10-29

### Added
- Daten-Import mit Vorschau (`?preview=1`) und Größen-/Pfad-Limits: Wiederherstellen oder Hinzufügen von MindSift-Backups (JSON, ZIP oder Markdown-Archiv via `POST /import/mindsift`) sowie Import ganzer Obsidian-Vaults als ZIP (`POST /import/obsidian`).
- Vollständiger Datenexport auch als komprimiertes ZIP-Archiv (`GET /export?format=zip`).
- Wiederkehrende Aufgaben (`daily`, `weekly`, `monthly`, `yearly`): Beim Abschließen einer Aufgabe wird automatisch die nächste Instanz zum Folgetermin angelegt.
- Gefahrenzone in den Kontoeinstellungen: Eigene Daten (`DELETE /user/data`) oder das gesamte eigene Konto (`DELETE /user/account`) nach Passwortbestätigung löschen (der letzte Server-Admin ist vor Selbstlöschung geschützt).
- PWA-Startbildschirm (Splash Screen) und automatische Anpassung der Statusleisten-Farbe (`theme-color`) an das aktive Theme.

### Fixed
- SMTP-Versand fällt auf `AUTH LOGIN` zurück, wenn der Server `AUTH PLAIN` ablehnt (z. B. Postfix/Dovecot oder Exchange); das Port-Feld in den Admin-Einstellungen lässt sich leeren und ohne Typfehler speichern.
- Mobil: Formular-Sheets (`FormSheet`) und Emoji-Picker positionieren sich über der Bildschirmtastatur (`visualViewport`).
- Ältere Datenbanken werden beim Start nicht mehr durch den früheren Schema-Reset geleert.

## [0.3] - 2026-10-29

### Added
- Organisationen und Sichtbarkeits-Modi (`private`, `organizations`, `open`), verwaltet durch Server-Admins; bestimmt zentral, wer wen in der Benutzersuche sieht und mit wem Inhalte geteilt werden können (FLAW-10, FLAW-24).
- Aufgaben-Zuweisung (`assignees`) in geteilten Aufgabenlisten, einheitliche Benutzersuche (`UserAutocomplete`), Avatar-Stapel (`AvatarStack`) und runde Zähler-Badges (`CountBadge`).
- Eigene CSS-Themes pro Benutzer (`GET/POST /themes`, `DELETE /themes/{id}`): `.css`-Datei hochladen oder einfügen, Vorlage herunterladen und live umschalten.
- Globale Volltextsuche über Gedanken, Aufgaben, Notizen und Listeneinträge auf Basis von SQLite FTS5 mit BM25-Ranking, Berechtigungsprüfung und `⌘K`/`Ctrl+K`-Befehlspalette (FLAW-18).
- Obsidian-kompatibler Markdown-Export (`GET /export/markdown`) als gestreamtes ZIP-Archiv über alle Notizen, Ordner, Aufgabenlisten und Listen.
- Vollständige Emoji-Auswahl für Notiz-Icons (Lazy-Loading, auf dem Smartphone als Bottom-Sheet).
- Optionale Links/Texte für Impressum und Datenschutz (`LEGAL_IMPRINT_*`, `LEGAL_PRIVACY_*`, `GET /legal/{imprint|privacy}`) sowie „Über MindSift“-Dialog.
- Veröffentlichung unter [The Unlicense](LICENSE) (gemeinfrei, FLAW-21).

### Changed
- **Achtung:** Nur noch Eigentümer können Ressourcen (Aufgabenlisten, Listen, Notizen, Ordner) teilen; das alte Feld `task_lists.team_id` und die ungeschützten `/organizations`-Routen entfallen. Entfällt die Sichtbarkeit (z. B. durch Organisationswechsel), werden Freigaben, Gruppenmitgliedschaften und Zuweisungen automatisch bereinigt (FLAW-06, FLAW-10, FLAW-24).
- Demo-Modus setzt die Datenbank bei jedem Serverstart sauber zurück und befüllt sie neu.

### Fixed
- SMTP-Client mit explizitem Protokollablauf (`EHLO` mit Absender-Domain, `STARTTLS`, `AUTH`, RFC-2047-Header, `SMTP_SKIP_VERIFY` für selbstsignierte Zertifikate).
- Tailwind-Deckkraft-Modifikatoren (`bg-accent/15` usw.) funktionieren über `color-mix()` mit allen Theme-Variablen.
- Mobil- und Desktop-Verbesserungen: Stilles Nachladen von Aufgabenlisten ohne Verschlucken von Klicks, `#`-Anker in URLs werden nicht mehr als Hashtags erkannt, mehrzeilige Aufgaben-Notizen im Dialog voll scrollbar.

## [0.2.1] - 2026-10-28

### Added
- Notizen: Nach dem Umwandeln eines `/todo`-Punkts in eine erweiterte Aufgabe öffnet sich diese direkt; ein Klick auf das Badge „Erweitert“ öffnet den Aufgabendialog.

### Changed
- Container-Build taggt Release-Images (`v*`) zusätzlich als `:stable` und `:latest`, den `dev`-Branch als `:dev`.

## [0.2] - 2026-10-28

### Added
- Echtzeit-Zusammenarbeit in Notizen (`internal/collab`, `frontend/src/lib/docSync`): Server-autoritativer Operations-Log (`doc_ops`) mit Baumstruktur, Fractional-Indexing-Sortierschlüsseln, 20-Sekunden-Blocksperren (Leases), Offline-Warteschlange in IndexedDB und automatischem Transport-Fallback (WebSocket → SSE → Long-Polling → Intervall-Polling).
- Notizen und Ordner lassen sich jetzt auch mit Schreibrecht („Bearbeiten“) teilen (FLAW-17).
- Sichtbare Blocksperren mit Namen des Bearbeitenden, Anwesenheitsanzeige im Notizkopf, Konfliktkopien („Übernehmen“ / „Verwerfen“) statt Datenverlust bei gleichzeitigen Änderungen sowie benutzerbezogenes Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl+Y`) über die gesamte Notiz (FLAW-25, FLAW-26).
- Automatische Hintergrund-Verdichtung des Operations-Logs und Bereinigung gelöschter Blöcke (Tombstones) nach 30 Tagen.
- Outliner: `Backspace` am Zeilenanfang verschmilzt den Punkt mit dem vorherigen; `#Hashtags` werden direkt im Fließtext als anklickbare Chips gerendert; Klick in einen Punkt setzt den Cursor exakt an die geklickte Textstelle.
- Vitest + Testing Library im Frontend-Build sowie Playwright-End-to-End-Tests (`e2e/`) für Live-Kollaboration, Sperren und Proxy-Fallbacks.

### Removed
- **Achtung:** Altes ganzheitliches Überschreiben von Notizen (`PATCH /documents/{id}/blocks`, `DOC_BLOCKS_PATCHED`) entfernt; alle Blockänderungen laufen über `/docs/{id}/sync`.

### Security
- Echtzeit-Ereignisse (`BroadcastToAll` entfernt) und WebSocket-/SSE-Räume sind strikt auf berechtigte, angemeldete Benutzer beschränkt; `ReorderTasks` prüft Schreibrechte (IDOR behoben); SSE-Streams werden nicht mehr nach 30 s durch `WriteTimeout` getrennt; Block-Upserts prüfen die Dokumentzugehörigkeit (FLAW-01, FLAW-02, FLAW-03, FLAW-11, FLAW-15).

## [0.1] - 2026-10-27

### Added
- Erste veröffentlichte Version von MindSift als einzelner selbst gehosteter Container (Go-Backend, eingebettetes React/TypeScript/Tailwind-Frontend, SQLite im WAL-Modus).
- Schnellerfassung (Quick Dump per `C`/`/`, Spracheingabe, mehrzeilig mit `Shift+Enter`, direkte Zielwahl) und Triage-Deck (Tastaturkürzel & Smartphone-Wischgesten).
- Aufgabenverwaltung mit mehreren Listen, frei konfigurierbarem Kanban-Board, Prioritäten, Fälligkeitsdaten, Unteraufgaben mit Fortschrittsbalken, Markdown-Notizen, Filtern/Gruppierungen sowie Fälligkeits-Alarmen per E-Mail (SMTP), Discord und eigenem Webhook.
- Hierarchischer Outliner-Workspace mit Ordnerbaum, Drag & Drop ganzer Äste, Zoom-Fokus mit Breadcrumbs, Slash-Befehlen (`/todo`, `/link`, `/h1`–`/h3`, `/code`, `/callout`, `/divider`), Wiki-Links `[[Notiz]]`, `#Hashtag`-Übersicht, globalem To-Do-Rollup und `.md`-Export.
- Geteilte Listen (Einkaufs-, Pack- und Checklisten) mit `#Kategorie`-Gruppierung, Mengenangaben und Echtzeit-Abhaken.
- Benutzer-, Gruppen- und Admin-Verwaltung (Ersteinrichtungs-Assistent, Einladungscodes, Profilbilder, persönliche API-Keys & Webhook-Ingest `/api/v1/webhooks/ingest`, JSON-Datenexport) sowie CSS-Theme-Engine mit 4 Themes (`Dark`, `Light`, `High Contrast`, `Soft`) und PWA-Unterstützung.
