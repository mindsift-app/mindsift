# Plan: MCP-Berechtigungen in drei Stufen (Entwurf)

Stand 2026-11-03. Ziel: Ein API-Schlüssel bekommt pro Bereich (Aufgaben, Listen, Notizen, Inbox) dieselben drei Stufen, und über MCP lässt sich alles, was die Stufe erlaubt, auch wirklich tun. Heute fehlen vor allem: Notizen ändern und löschen, Listeneinträge löschen, die Inbox lesen und bearbeiten.

## Die drei Stufen

| Stufe | Darf | Darf nicht |
|---|---|---|
| **Lesen** | auflisten, lesen, suchen | irgendetwas ändern |
| **Anlegen** | neue Einträge erstellen (Aufgabe, Listeneintrag, Notiz, Inbox) | Bestehendes ändern oder löschen |
| **Ändern** | Bestehendes bearbeiten **und löschen** | – (mächtigste Stufe) |

Die Stufen sind technisch unabhängige Rechte (wie heute). In der Oberfläche schaltet „Ändern“ „Lesen“ automatisch mit ein, weil man zum Ändern die IDs aus dem Lesen braucht; „Anlegen“ bleibt allein wählbar (Webhooks, Smart Home: nur reinwerfen).

## Rechte (Scopes)

Bestehende IDs bleiben, damit vorhandene Schlüssel weiter funktionieren. Neu sind nur die markierten.

| Bereich | Lesen | Anlegen | Ändern |
|---|---|---|---|
| Aufgaben | `tasks:read` | `webhook:task` | `tasks:write` |
| Listen | `lists:read` | `webhook:list` | `lists:write` (künftig inkl. Löschen) |
| Notizen | `notes:read` | `notes:create` | **`notes:write`** (neu) |
| Inbox | **`inbox:read`** (neu) | `webhook:triage` | **`inbox:write`** (neu) |

Hinweis zu `tasks:write` und `lists:write`: Sie erlauben heute auch das Anlegen. Das bleibt so (wer ändern darf, darf auch anlegen); „Anlegen“ ist die schmalere Stufe für Schlüssel, die nur Neues reinwerfen sollen.

## Neue und geänderte MCP-Werkzeuge

**Notizen** (`notes:write`)
- `get_note` liefert zusätzlich die Punkte mit ihren IDs (bisher nur Markdown), damit einzelne Punkte gezielt geändert werden können.
- `update_note`: Titel, Icon, Ordner ändern.
- `add_note_bullet`: neuer Punkt nach einem bestehenden (oder am Ende), mit Ebene, Typ (Text, To-do, Überschrift) und Text.
- `update_note_bullet`: Text eines Punkts ändern, To-do abhaken/öffnen.
- `delete_note_bullet`: Punkt (mit seinen Unterpunkten) entfernen.
- `delete_note`: Notiz in den Papierkorb (wiederherstellbar).

Alle Änderungen an Punkten laufen über dieselben Operationen wie der Editor (Notiz-Synchronisation, `internal/collab`): Wer die Notiz gerade offen hat, sieht sie live, und gleichzeitiges Tippen erzeugt keinen Konflikt mit dem ganzen Text. Ganze Notizen per Markdown zu ersetzen ist bewusst **nicht** vorgesehen (würde parallele Änderungen überschreiben).

**Listen** (`lists:write`)
- `delete_list_item`: Eintrag löschen.

**Inbox** (`inbox:read` / `inbox:write`)
- `list_inbox` (Lesen): offene Inbox-Einträge mit Text, Priorität, Fälligkeit, Hashtags; durchsuchbar.
- `convert_inbox_item` (Ändern): in eine Aufgabe (mit Aufgabenliste), eine Notiz oder einen Listeneintrag umwandeln – wie die Triage.
- `discard_inbox_item` (Ändern): verwerfen (landet im Papierkorb der Triage, wiederherstellbar).
- `search` findet Inbox-Einträge mit `inbox:read`.

## Oberfläche

Kontoeinstellungen → API: statt der heutigen Liste von Schaltern ein Raster **Bereich × Stufe** (4 Zeilen, 3 Spalten) mit kurzer Erklärung der Stufen. Die Chips an bestehenden Schlüsseln zeigen die Stufen je Bereich. Am Handy untereinander.

## Umsetzung

1. Backend: Scopes `notes:write`, `inbox:read`, `inbox:write` (`storage/apikeys.go`), Prüfung in `mcpToolAllowed`, neue Werkzeuge in `internal/api/mcp.go` mit Tests (je Werkzeug: erlaubt mit Recht, abgelehnt ohne; Notiz-Änderung erscheint im offenen Editor).
2. Frontend: Raster in `ApiKeysPanel`, Bezeichnungen in `lib/apiScopes.ts`.
3. Doku: `Doku/api/` (MCP-Werkzeuge, Rechte), Hilfe-Text.

Aufwand: mittel (Backend ~2/3, davon das meiste bei den Notiz-Werkzeugen).

## Offene Fragen

- Inbox: Gibt es neben Umwandeln und Verwerfen ein „als verarbeitet markieren“ ohne Umwandlung (z. B. „Später“ = ans Ende schieben)?
- Listen: Gelöschte Listeneinträge sind endgültig weg (Listen haben keinen Papierkorb für einzelne Einträge). Reicht das, oder sollen sie über MCP nur abgehakt statt gelöscht werden können?
