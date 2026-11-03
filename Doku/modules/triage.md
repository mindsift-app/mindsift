# Modul: Schnellerfassung & Triage

Ziel: Gedanken in Sekunden festhalten und später in Ruhe sortieren. Code: [InstantCaptureBar.tsx](../../frontend/src/features/capture/InstantCaptureBar.tsx), [TriageDeck.tsx](../../frontend/src/features/triage/TriageDeck.tsx), Backend `handleCaptureInbox`, `handleTriageAction` und `Store.UpdateThoughtTriage`.

## Erfassung

- Die Eingabeleiste sitzt im Header; `C` oder `/` fokussiert sie (außer beim Tippen in einem Feld).
- Ziel (`target`): **Posteingang** (`inbox`, Standard), **Direkt-Aufgabe** (`task`, mit Aufgabenliste), **Listeneintrag** (`list_item`, mit Zielliste) oder **Direkt-Notiz** (`document`). Im aufgeklappten Bereich wählen Ziel und Liste nur aus; gespeichert wird mit Enter bzw. dem Knopf. Ziel und Liste bleiben nach dem Abschicken eingestellt (je Browser-Tab).
- Mehrzeilige Eingabe wird unterstützt. Spracheingabe nutzt `useVoiceInput` (Whisper-Server oder Spracherkennung des Browsers, je nach Kontoeinstellung): Mit Whisper geht die Aufnahme schon beim Sprechen in Stücken zur Erkennung (`chunked`), die Browser-Erkennung endet nach 5 s Stille. Quelle `voice` fügt den Tag `#diktat` an.
- Quelle `webhook` (per API-Key/Webhook) fügt den Tag `#webhook` an. Hashtags im Text werden als Tags extrahiert (`domain.ExtractTags`).
- Per API: `POST /inbox` und `POST /webhooks/ingest` (siehe [rest.md](../api/rest.md)).

## Triage-Deck

Der Posteingang (`status = inbox`) wird Karte für Karte abgearbeitet.

| Aktion | Desktop | Mobil | Ergebnis |
|---|---|---|---|
| Verwerfen | `H` oder `←` | Wischen links | `status = discarded` (Papierkorb) |
| Zur Aufgabe | `L` oder `→` | Wischen rechts | `kept`/`converted` als Aufgabe |
| Aufgabe mit Termin | `T` | Aktionsmenü | wie oben, mit Fälligkeit |
| In Notiz wandeln | `D` | Aktionsmenü | neues Dokument, Gedanke wird `converted` (`document`) |
| Später | Leertaste | Aktionsmenü | Karte ans Stapelende |
| Menü schließen | `Esc` | – | – |

Die Umwandlung in eine Notiz übernimmt Titel, Erledigt-Status, Notizen, Unteraufgaben sowie Fälligkeit und Priorität als eingerückte Blöcke. Eine Umwandlung in einen Listeneintrag legt einen Eintrag in der gewählten Liste an und benachrichtigt deren Teilnehmer.

## Zustände eines Gedankens

```
inbox ──keep──▶ kept ──convert──▶ converted (task | document | list_item)
  │                │
  └─discard─▶ discarded ──restore──▶ inbox        (Papierkorb leeren: DELETE /thoughts/discarded/purge)
```

Verworfene Gedanken liegen im eigenen **Papierkorb der Triage** ([TriageTrash.tsx](../../frontend/src/features/triage/TriageTrash.tsx)): Knopf oben in der Triage, am Handy im Menü. Dort lassen sie sich zurückholen, einzeln oder alle endgültig löschen. Nach der Frist aus Kontoeinstellungen → Aufbewahrung (Standard 14 Tage, gezählt ab dem Verwerfen, `triaged_at`) löscht der Server sie.

Ein Gedanke mit `status = kept` zählt bereits als Aufgabe und erscheint in der Aufgabenansicht.
