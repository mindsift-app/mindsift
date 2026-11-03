# Modul: Workspace (Outliner-Notizen)

Code: [WorkspaceView.tsx](../../frontend/src/features/workspace/WorkspaceView.tsx) (Explorer, Tags, To-Do-Rollup), [DocumentEditor.tsx](../../frontend/src/features/workspace/DocumentEditor.tsx), [OutlinerTree.tsx](../../frontend/src/features/workspace/OutlinerTree.tsx), [OutlinerBlock.tsx](../../frontend/src/features/workspace/OutlinerBlock.tsx), [CodeBlockEditor.tsx](../../frontend/src/features/workspace/CodeBlockEditor.tsx), [LinkModal.tsx](../../frontend/src/features/workspace/LinkModal.tsx); Backend: Dokument-, Ordner- und Tag-Handler, Sync-Handler in `internal/api/docsync.go`, `internal/collab`, `internal/storage/docsync.go`.

## Datenhaltung

- Eine Notiz ist ein Datensatz in `documents` plus ein Baum von Blöcken in `blocks` (`parent_id`, Sortierschlüssel `order_key`). Jede Änderung läuft über `internal/collab` und wird im Log `doc_ops` festgehalten. Ebene und Position für die Oberfläche berechnet der Server beim Lesen. Das Log und gelöschte Blöcke werden regelmäßig verdichtet ([database.md](../database.md#verdichtung-des-notiz-logs)). Alles liegt in SQLite; es gibt keine Dateien auf der Platte.
- Bei jeder Änderung wird `documents.markdown_cache` neu erzeugt; `block_tags` wird aus `#Hashtags` der Blöcke neu aufgebaut.
- **Hashtag-Regel:** `#wort` zählt nur am Textanfang oder nach Leerzeichen bzw. `(`. Anker in Links (`example.com/blog#ueberschrift`) und Wörter wie `C#` sind keine Tags. Gleiche Regel im Server (`domain.ExtractTags`) und im Browser (`lib/hashtags.ts`). Beim ersten Start nach der Umstellung entfernt `migrateAnchorTags` einmalig gespeicherte Tags, die nur aus Ankern stammten.
- Der Export als `.md` erfolgt im Browser (Button im Editor, Blob-Download).
- Blocktypen: Überschriften `h1`–`h3`, `paragraph`/`text`, `bullet`, `todo`, `code`, `callout`, `divider`, `table`, `progress`.

## Editor

- **Outliner:** `Enter` neuer Block, `Tab`/`Shift+Tab` ein-/ausrücken, `Shift+Enter` weicher Umbruch, Blöcke ein-/ausklappen.
- **Zoom (Hoisting):** Klick auf den Bullet fokussiert den Ast; die Breadcrumb-Leiste führt zurück.
- **Drag & Drop** verschiebt Blöcke samt Unterästen; auf einen anderen Block gezogen, wird der Block zum Unterpunkt.
- **Slash-Befehle:** `/todo`, `/link`, `/h1`, `/h2`, `/h3`, `/code` (mit Syntax-Highlighting im VS-Code-Stil), `/callout`, `/divider`, `/extract` (Ast als eigene Notiz auslagern), `/image` (Bilder einfügen/hochladen, Aliase `/bild`, `/foto`), `/audio` (Sprachnotiz/Audiodatei, Alias `/sprachnotiz`), `/diktat` (Spracheingabe mit Live-Mitschreiben, Alias `/dictate`) (Liste in `OutlinerBlock.tsx`). Das Menü öffnet sich nur am Textanfang oder nach einem Leerzeichen und schließt mit `Esc` oder `Backspace`.
- **Link-Vorschau:** Besteht ein Bulletpoint ausschließlich aus einer einzelnen `https`-Adresse (oder wurde über `/link` in einem leeren Punkt eingefügt), zeigt MindSift darüber eine interaktive Vorschaukarte (`LinkPreviewCard`, serverseitig via `/link-preview`). ✕ blendet die Karte aus und wandelt die Adresse synchronisiert in `[Titel](url)` um.
- **Ast auslagern (`/extract`):** Wandelt den aktuellen Punkt samt Unterpunkten in eine eigenständige Notiz im selben Ordner um. Der Server legt die Notiz an und liefert den Link zurück; der Editor ersetzt den Ast lokal über die Sync-Engine als eigene Operation (Strg+Z nimmt die Auslagerung zurück und legt die neue Notiz via `POST /documents/{id}/extract/undo` in den Papierkorb).
- **Notiz zurückholen:** Besteht ein Punkt nur aus einem Link auf eine Notiz (wie nach `/extract`), zeigt seine Knopfleiste „Notiz zurückholen“. `POST /documents/{id}/inline` liefert die Punkte der verlinkten Notiz und legt sie in den Papierkorb; der Editor setzt den Titel (mit den Hashtags des Links) wieder als Text ein und fügt die Punkte als Unterpunkte ein, vor eventuell schon vorhandenen. Strg+Z oder „Rückgängig“ stellt den Link wieder her und holt die Notiz aus dem Papierkorb. Nur mit eigenen Notizen, und nicht, solange andere Notizen sie noch verlinken.
- **Notizen zusammenführen (Merge):** Per Drag & Drop einer Notiz auf eine andere in der Seitenleiste oder über das Drei-Punkte-Menü im Notizkopf („Mit anderer Notiz zusammenführen…“). Die eigene Quellnotiz wird als `h2`-Abschnitt angehängt und in den Papierkorb verschoben; der Hinweis bietet vollständiges Rückgängigmachen (`POST /documents/{id}/merge/undo`).
- **Rückverweise:** Unter jeder Notiz listet „Verlinkt auf diese Notiz (n)“ alle Notizen mit `[[Titel]]` (auch `[[Titel|Text]]`, `[[Titel#Abschnitt]]`, Groß-/Kleinschreibung egal) samt Fundstelle; ein Klick springt direkt zum Bullet. Ohne Rückverweise bleibt der Bereich unsichtbar, eingeklappt merkt er sich im Browser ([BacklinksSection.tsx](../../frontend/src/features/workspace/BacklinksSection.tsx), `GET /documents/{id}/backlinks`).
- **Links:** `[[Notiztitel]]`, Markdown-Links `[Titel](url)` und reine URLs werden als Token dargestellt; `LinkModal` hilft beim Verknüpfen von Notizen.
- **Einfügen:** Mehrzeiliger Text wird anhand von Markdown-Präfixen und Einrückung in Blöcke zerlegt; Überschriften gruppieren darunterliegenden Text und Code.
- **Speichern:** Jede Notiz hat im Browser eine `DocSyncEngine` ([lib/docSync/](../../frontend/src/lib/docSync/)). Der Editor meldet jede Änderung der Block-Liste; die Engine übersetzt sie in Operationen, speichert sie zuerst in IndexedDB und sendet sie dann gesammelt (300 ms) an `POST /docs/{id}/sync`. Beim Öffnen zeigt sie sofort den gespeicherten Stand, auch offline.
- **Abgleich bei geteilten oder mehrfach geöffneten Notizen**, nach Verfügbarkeit:
  1. **Push** über WebSocket oder SSE: Der Server meldet `DOC_SEQ`, die Engine gleicht sofort ab (im Test 0,2–0,3 s).
  2. **Long-Polling** (`/docs/{id}/changes`), wenn ein Proxy WebSocket und SSE blockiert oder SSE puffert: ebenso schnell.
  3. **Abfrage alle 3 s**, wenn auch Long-Polling dreimal scheitert (bei `online` wird Long-Polling erneut versucht).

  Solange 1. oder 2. läuft, gleicht die Engine zusätzlich alle 7 s ab, wenn sie Sperren hält (Verlängerung), sonst alle 30 s zur Sicherheit. Ein Fokuswechsel meldet die Sperre sofort an. Der Editor zeigt den Weg an („Live“, „Live (Long-Polling)“, „Abgleich alle 3 s“).
- **Private Notizen**, die nur einmal geöffnet sind, gleichen alle 30 s ab, außerdem sofort bei Rückkehr ins Netz oder in den Tab. Beim Verlassen sendet die Engine Ausstehendes mit `keepalive` und gibt ihre Sperren frei.
- **Textkonflikte:** Jede Textänderung trägt die Version, die der Nutzer beim Tippen vor sich hatte. Hat jemand anderes den Bullet inzwischen geändert oder gesperrt, legt der Server eine Konfliktkopie an; es wird nie still überschrieben.
- **Sperren:** Der Bullet mit dem Cursor, verlassene Bullets für 20 s und neu angelegte Bullets werden gehalten. Bullets, die jemand anderes hält, zeigen ein Schloss mit Namen und sind schreibgeschützt; Enter darin legt einen neuen Bullet darunter an. Löschen, Zusammenführen, Ein-/Ausrücken und Ziehen werden bei gesperrten Bullets nicht ausgeführt (Hinweis unten im Editor).
- **Präsenz:** Im Kopf der Notiz steht, wer sie gerade sonst noch geöffnet hat.
- **Konfliktkopien** sind farbig markiert („Konflikt – Version von …“) mit „Übernehmen“ (Text ersetzt den ursprünglichen Punkt bzw. den Titel, die Kopie verschwindet) und „Verwerfen“.
- **Rückgängig:** `Strg+Z`/`Cmd+Z` nimmt die eigene letzte Änderung zurück, `Strg+Umschalt+Z` oder `Strg+Y` wiederholt (auch im Titel und über das Kontextmenü/mobile Tastaturen). Tippen im selben Punkt bis 1 s Pause ist ein Schritt; bis zu 200 Schritte je Tab. Hat jemand anderes den Punkt inzwischen geändert oder hält ihn gesperrt, wird der Schritt mit Hinweis übersprungen.
- `PUT /documents/{id}` ändert nur noch Symbol, Anheften und Ordner (Titel wird ins Log übernommen); Inhalte laufen ausschließlich über die Engine. Das To-Do-Rollup hakt per einzelner Operation über denselben Sync-Endpunkt ab.
- **Notiz-Icon (Emoji-Picker):** Vollständiger Emoji-Katalog mit Kategoriereitern, Suche, Verlauf zuletzt verwendeter Symbole (`localStorage`) und Farben aus dem Theme. Am PC kompakt wie ein Kontextmenü auf eigener Fläche, ohne Titelleiste; auf Mobilgeräten (< 640 px) als Bottom-Sheet mit touch-freundlichen Zielen (≥ 44 px) und `text-base`-Suchfeld (verhindert iOS-Zoom). Derselbe Auswähler dient beim Anlegen von Notizen, Aufgabenlisten und Listen (`EmojiIconButton`). „Entfernen“ lässt das Icon ganz weg; ohne Icon steht nur der Titel. Neue Notizen starten mit 🗒️.
- **Markieren über mehrere Punkte** ([OutlinerTree.tsx](../../frontend/src/features/workspace/OutlinerTree.tsx)): Mit der Maus von einem Punkt in einen anderen ziehen markiert Text über Punktgrenzen (CSS Highlight API, sonst eingefärbte Zeilen). Entf/Backspace löscht wie ein Texteditor (Rest des ersten und letzten Punkts werden ein Punkt, Punkte dazwischen samt Unterpunkten gehen, Unterpunkte des letzten wandern unter den ersten) in einem Schritt (`onReplaceRange`, ein `Strg+Z` holt alles zurück); ein Zeichen ersetzt die Markierung, `Strg+C`/`Strg+X` kopieren bzw. schneiden aus.

## Explorer, Tags, To-Dos

- Ordnerbaum mit Favoriten (`doc_pins`), Verschieben per Drag & Drop (`/documents/{id}/move`, `/folders/move`). Ordner zeigen ihren Zustand am offenen bzw. geschlossenen Ordnersymbol (kein Pfeil).
- **Mehrere Notizen** (PC): Strg/Cmd+Klick markiert einzeln, Shift+Klick einen Bereich in der angezeigten Reihenfolge (eine angeheftete Notiz steht zweimal im Baum; der Bereich beginnt an der Stelle, die angeklickt wurde); ein normaler Klick, Escape oder ein Klick ins Leere hebt die Markierung auf. Wer eine markierte Notiz zieht, nimmt alle markierten mit, in einen Ordner oder auf den Papierkorb (Zusammenführen gibt es dabei nicht).
- **Auf den Papierkorb ziehen** (auch eine einzelne Notiz, am Handy per langem Drücken wie beim Verschieben in Ordner) verschiebt in den Papierkorb; der Hinweis bietet „Rückgängig“.
- **Tags:** Alle `#Hashtags` werden aggregiert (`/workspace/tags`). Eine Tag-Seite trägt eine eigene Freitext-Notiz (`tag_pages`) und zeigt darunter jede Notiz mit Fundstellen als feste Überschrift und darunter den echten Outliner der Punkte mit dem Hashtag samt Unterpunkten (`DocumentEditor` mit `variant="tag"`, je Notiz eine eigene Sync-Verbindung, erst beim Hineinscrollen geladen). Bearbeiten wirkt direkt in der Notiz; ein Punkt ohne Hashtag (entfernt oder neu per Enter) bleibt sichtbar, solange der Cursor darin steht, und verschwindet, sobald er ihn verlässt. Die Reihenfolge der Notizen bleibt, solange die Seite offen ist.
- **To-Do-Rollup:** Die Ansicht „To-Dos“ sammelt alle `todo`-Blöcke aller Notizen, filterbar nach Ordner. Abhaken im Rollup ändert den Block in der Notiz.
- **Enhanced Tasks:** Ein `todo`-Block lässt sich als verknüpfte Aufgabe führen (`/documents/{id}/blocks/{blockId}/enhanced-task`); Erledigt-Status bleibt zwischen Notiz und Aufgabenansicht synchron.

## Papierkorb

- Löschen (einzeln oder mit dem Ordner) verschiebt eigene Notizen in den Papierkorb (`is_archived = 1`). Wer eine geteilte Notiz löscht, die ihm nicht gehört, verlässt nur die Freigabe.
- Notizen im Papierkorb fehlen im Baum, in Suche, Export und Statistik und sind für alle Empfänger unsichtbar (`DocRole` = keine Rolle). Eigentümer und Löschende sehen sie schreibgeschützt mit Hinweisleiste und „Wiederherstellen“; Umbenennen, Verschieben und Teilen werden abgelehnt.
- Eintrag „Papierkorb“ mit Zähler unten in der Ordnerleiste und im mobilen Menü. Die Liste zeigt Ordner und Löschzeitpunkt; „Endgültig löschen“ und „Papierkorb leeren“ brauchen einen zweiten Tipp.
- Wiederherstellen legt einen inzwischen gelöschten Ordner neu an; existiert ein geteilter Ordner nicht mehr, landet die Notiz auf der Hauptebene. Freigaben bleiben erhalten. Nach der Frist der Eigentümerin bzw. des Eigentümers (Kontoeinstellungen → Aufbewahrung, Standard 30 Tage ab dem Löschen) löscht der Server die Notiz endgültig ([retention.go](../../internal/storage/retention.go)).

## Freigabe

- Einzelne Notizen und ganze **geteilte Ordner** lassen sich an Benutzer oder Gruppen freigeben – wahlweise mit der Rolle **Bearbeiter** (`write`) oder **Leser** (`read`) ([sharing-and-permissions.md](../sharing-and-permissions.md)). Bearbeiter ändern Inhalt und Struktur über die Sync-Engine; Leser sehen Änderungen live.
- Empfänger ordnen geteilte Notizen und Ordner in ihrem eigenen Baum ein (`doc_user_folders`, `workspace_folder_mounts`), ohne dass der Eigentümer etwas davon merkt.
- Änderungen erreichen offene Fenster über den Weckruf `DOC_SEQ` und anschließenden Sync; Notizlisten über `DOC_UPDATED` ([websocket.md](../api/websocket.md)).

## Grenzen

- Keine gleichzeitige Bearbeitung im selben einzelnen Bullet (Sperren pro Bullet und Konfliktkopie statt Zeichen-für-Zeichen-Zusammenführung), keine Cursor-Anzeige fremder Eingaben, keine Versionshistorie.
- Keine Virtualisierung langer Dokumente; sehr große Notizen können auf Mobilgeräten träge werden *(nicht gemessen)*.
- ~~Suche (`/search`) erfasst nur Titel und Inhalt eigener Notizen~~: Mit der globalen FTS5-Suche (`Cmd+K` / `Ctrl+K` / `/`) werden sowohl Titel als auch Block-Inhalte aller zugänglichen Notizen (eigene und freigegebene) durchsucht.

## Export als Markdown-Archiv

Kontoeinstellungen → Export & Import → „Markdown-Archiv herunterladen“ (`GET /export/markdown`, Code: [export_markdown.go](../../internal/storage/export_markdown.go)).

- Ordner und Notizen so, wie der Nutzer sie sieht (eigene Ordner, eingehängte geteilte Ordner, mit ihm geteilte Notizen); leere Ordner bleiben erhalten.
- Jede Notiz: YAML-Frontmatter (`title`, `icon`, `tags`, `created_at`, `updated_at`) und Markdown, das Obsidian direkt darstellt: Überschriften, Trenner, Hinweisboxen (`> [!note]`) und Codeblöcke der obersten Ebene als echte Blöcke, ihre Kinder rücken eine Ebene nach vorn; alles andere als Liste mit einem Tab pro Ebene, To-dos als `- [ ]`.
- Dateinamen werden für alle Betriebssysteme bereinigt (keine `/ \ : * ? " < > |`, nie `.`/`..`); doppelte Titel bekommen „ (2)“.
- Das ZIP wird beim Lesen der Daten direkt in die Antwort geschrieben, ohne temporäre Dateien.

## Import

Kontoeinstellungen → Export & Import → „Daten importieren“, mit **zwei getrennten Wegen** (Code: [import_markdown.go](../../internal/storage/import_markdown.go), [ImportCard.tsx](../../frontend/src/features/settings/ImportCard.tsx)):

| Weg | Endpunkt | Dateien | Ergebnis |
|---|---|---|---|
| MindSift-Daten | `POST /import/mindsift` | Backup-ZIP oder JSON (`/export`) oder Markdown-Archiv (`/export/markdown`), das Format wird erkannt | Notizen in ihre Ordner, Aufgabenlisten mit Unteraufgaben, Fälligkeit, Priorität und Notizen, Listen mit Menge, Kategorie und Erledigt-Status, beim JSON-Backup auch die Gedanken der Triage. Fremde, nur mit dem Exporteur geteilte Inhalte im JSON werden übersprungen. |
| Obsidian-Vault | `POST /import/obsidian` | ZIP eines Vaults | Alles in einen neuen Ordner mit dem Namen des Vaults, Unterordner bleiben. Checkboxen bleiben Checkboxen, Frontmatter-Tags werden zu `#Hashtags`, Callouts zu Hinweisboxen, Wikilinks bleiben `[[…]]`. Versteckte Ordner (`.obsidian`, `.trash`) werden ignoriert, Anhänge übersprungen. |

- **Vorschau:** Die Oberfläche lädt die Datei zuerst mit `?preview=1` hoch. Der Server liest und prüft alles und meldet, was angelegt würde (inkl. übersprungener Dateien mit Grund), schreibt aber nichts. Erst „Jetzt importieren“ legt an.
- **Hinzufügen oder Wiederherstellen** (nur MindSift-Daten): „Hinzufügen“ legt nur neu an, Bestehendes bleibt unverändert. „Wiederherstellen“ (`?mode=restore`, in der Oberfläche nur nach bestätigtem Warnhinweis) löscht vorher alle eigenen Notizen, Ordner, Aufgaben, Gedanken und Listen – erst nachdem die Datei vollständig gelesen und geprüft ist, eine kaputte Datei löscht also nichts. Mit dem Nutzer geteilte Inhalte anderer bleiben. Ein Obsidian-Import fügt immer hinzu.
- **Markdown → Notiz:** Listen behalten ihre Verschachtelung (Tabs oder Leerzeichen), Inhalte unter einer Überschrift werden darunter eingerückt (Gegenstück zum Export), Absätze werden zu Punkten, Codeblöcke zu Codeblöcken.
- **Grenzen:** Upload max. 100 MB, eine Notiz max. 10 MB, entpackt zusammen max. 500 MB, höchstens 20 000 Dateien. Pfade mit `..` oder absolute Pfade werden entschärft und bleiben im Zielordner.
- Bricht ein Import wegen eines Fehlers ab, bleibt das bis dahin Angelegte erhalten; die Meldung nennt das Element, an dem es scheiterte.

