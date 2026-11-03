# Modul: Geteilte Listen

Einkaufs-, Pack- und Checklisten für gemeinsames Arbeiten. Code: [SharedListsView.tsx](../../frontend/src/features/lists/SharedListsView.tsx); Backend: `*List*`-Handler in [server.go](../../internal/api/server.go), `Store.CreateList` und Verwandte.

## Datenmodell

- `lists`: Eigentümer, `title`, `icon`, `list_type` (`shopping`, `checklist`, `vacation`).
- `list_items`: `content`, `category`, `quantity`, `is_completed`, `completed_by(_name)`, `created_by`, `sort_order`.
- `list_shares`: Ziel (Benutzer oder Gruppe) und Rolle `editor` oder `viewer`.

## Funktionen

- **Kategorien per Hashtag:** `Hafermilch #Kühlregal` landet in der Kategorie „Kühlregal“. Kategorien werden alphabetisch als Abschnitte angezeigt; die Eingabe schlägt vorhandene Hashtags vor.
- **Menge:** Feld `quantity` (z. B. `2x`, `500g`).
- **Drag & Drop** ordnet Einträge um; in eine andere Kategorie gezogen, wird der Hashtag im Text angepasst (`items/reorder` mit `category` und `content`).
- **Abhaken** speichert, wer und wann; Erledigte stehen in einem eigenen Bereich und lassen sich per „Erledigte entfernen“ löschen (`clear-completed`). Nach der Frist des Listen-Eigentümers (Kontoeinstellungen → Aufbewahrung, Standard 7 Tage) löscht der Server abgehakte Einträge von selbst ([retention.go](../../internal/storage/retention.go)).
- **Freigabe** über den Dialog `UnifiedShareModal` (Bearbeiten oder Nur Lesen). Ein Leser sieht Änderungen live, ändert aber nichts.
- **Live-Sync:** Ereignisse `ITEM_*` und `LIST_*` im Raum der Liste ([websocket.md](../api/websocket.md)). Abhaken erscheint bei allen Beteiligten sofort.
- **Wer hat's hinzugefügt:** In geteilten Listen zeigt jeder Eintrag ein kleines Profilbild der Person, die ihn angelegt hat (`createdBy`, `createdByName`). Einträge von vor dieser Funktion haben keinen Autor und zeigen nichts.
- **Tabs** zeigen offene Einträge als runden Zähler und die Personen mit Zugriff als Profilbild-Stapel ([ui-patterns.md](../ui-patterns.md)); die API liefert sie je Liste als `members`.
- Aus der Triage lassen sich Gedanken direkt als Eintrag in eine Liste übernehmen.
