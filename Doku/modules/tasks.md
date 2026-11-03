# Modul: Aufgaben, Kanban & Alarme

Code: [TasksView.tsx](../../frontend/src/features/triage/TasksView.tsx), [TaskDetailModal.tsx](../../frontend/src/features/triage/TaskDetailModal.tsx), [ManageColumnsModal.tsx](../../frontend/src/features/triage/ManageColumnsModal.tsx); Backend: `handleUpdateThought`, `handleReorderTasks`, `*TaskList*`-Handler, `startAlarmTicker`.

## Datenmodell

Eine Aufgabe ist ein `thought` ([database.md](../database.md)) mit `kanbanStatus`, `priority` (`low`/`normal`/`high`/`urgent`), `dueDate` (`YYYY-MM-DD` oder mit Uhrzeit `YYYY-MM-DDTHH:MM`; die API nimmt auch `YYYY-MM-DD HH:MM` an), `notes` (Markdown), `subtasks` (`[{id, title, isCompleted}]`), `tags`, `taskListId`, `sortOrder` und `assignees` (Benutzer-IDs). Aufgaben ohne Liste sind persönlich.

## Ansichten

- **Liste** mit den Reitern Offen, Erledigt und Papierkorb; Gruppierung (z. B. nach Status oder Fälligkeit) und Sortierung stehen am PC rechts daneben, direkt über der Liste. Die Hashtag-Filter darüber bleiben einzeilig; passen nicht alle hinein, klappt „…“ sie auf mehrere Zeilen auf.
- **Kanban:** Spalten pro Liste frei konfigurierbar (Name, Farbe, „Erledigt“-Spalte). Farben in „Spalten anpassen“ über den Punkt vor dem Namen: Grau, Anthrazit (Textfarbe des Themes), Grün, Gelb, Blau, Rot, Lila, Akzentfarbe (`columns[].color` = `gray`/`slate`/`green`/`yellow`/`blue`/`red`/`purple`/`accent`; ältere Werte `emerald`/`amber` gelten als Grün/Gelb, Spalten ohne Farbe behalten die ihrer Rolle). Der Punkt erscheint im Spaltenkopf, vor dem Status in der Listenansicht und im Detail-Fenster ([ManageColumnsModal.tsx](../../frontend/src/features/triage/ManageColumnsModal.tsx), `columnDotClass`). Blau und Lila kommen aus `--color-info` / `--color-purple`; Themes können sie setzen, sonst gelten Standardwerte aus `index.css`. Standard: *Zu erledigen*, *In Bearbeitung*, *Wartet auf andere*, *Erledigt*. Eine Karte in eine „Erledigt“-Spalte zu ziehen setzt `isCompleted`; maßgeblich ist die als erledigt markierte Spalte der Liste, egal mit welcher ID (`isDoneColumn` beim Umsortieren). Am PC ist das Board so hoch wie das Fenster, wenn alle Spalten in eine Reihe passen; dann scrollen nur die Spalten.
- **„Alle Aufgaben“ als Kanban:** Die Spalten aller Listen werden nach Namen zusammengeführt (Groß/Klein egal), in Reihenfolge und Farbe der ersten Liste, die eine Spalte hat; verschieden benannte Spalten bleiben getrennt. Beim Ziehen sind Spalten, die die Liste der Karte nicht hat, ausgegraut und nehmen nichts an. Status-Auswahl, Pfeile auf der Karte und Detail-Fenster nutzen immer die Spalten der eigenen Liste.
- **Papierkorb und Aufbewahrung** ([task_trash.go](../../internal/storage/task_trash.go), [retention.go](../../internal/storage/retention.go)): Gelöschte Aufgaben, „Erledigte in den Papierkorb“ (`POST /tasks/clear-done`) und erledigte Aufgaben nach Ablauf ihrer Frist wandern in den Papierkorb der Aufgaben (Tabelle `trashed_tasks`: die ganze Zeile samt Zuweisungen als Kopie). Wer die Liste sieht, sieht ihren Papierkorb; Zurückholen und endgültig Löschen brauchen Bearbeitungsrecht. Zurückgeholt wird die Aufgabe unverändert (eine gelöschte Liste macht sie zur eigenen Aufgabe ihres Erstellers). Die Fristen stellt jede Person unter Kontoeinstellungen → Aufbewahrung ein (erledigte Aufgaben Standard 30 Tage, Papierkorb 30 Tage); in einer Liste gilt die Frist des Eigentümers. Den Zeitpunkt des Abhakens setzt ein Trigger (`thoughts.completed_at`), egal auf welchem Weg abgehakt wird; der Server räumt stündlich auf (nicht in der Demo). Ein mit einer Notiz verknüpftes Häkchen bleibt als normales Häkchen stehen.
- **Rückgängig:** `Strg+Z`/`Cmd+Z` nimmt in der Aufgabenansicht die letzten Schritte zurück (bis 20): Löschen (aus dem Papierkorb zurück), Verschieben (Spalten, Reihenfolge) und Abhaken. Nach dem Löschen bietet ein Hinweis unten „Rückgängig“, auch am Handy. In Textfeldern gilt deren eigenes Rückgängig.
- Drag & Drop sortiert in der Liste und zwischen Spalten; ein Klick öffnet das Detail-Fenster (Titel, Status, Priorität, Fälligkeit mit optionaler Uhrzeit und Schnellwahl, Liste, Hashtags, Unteraufgaben mit Fortschrittsbalken, Notizen).
- „Als Notiz vertiefen“ legt aus einer Aufgabe eine Notiz an (Titel, darunter Fälligkeit und Priorität, dann Notizen und Unteraufgaben). Die Aufgabe bleibt in ihrer Liste und wird mit dem ersten Häkchen der Notiz verknüpft (`converted_type = document_block`); ein Gedanke aus der Triage wird dagegen ganz zur Notiz. Aufgaben aus Notiz-Checkboxen (`enhanced-task`) bleiben verknüpft, „In Notiz öffnen“ springt zum Block.
- **Abgleich verknüpfter Aufgaben** ([task_doc_sync.go](../../internal/storage/task_doc_sync.go)): Haken und Titel gehen in beide Richtungen (Notiz → Aufgabe in `ReconcileDocTaskLinks` nach jeder Notiz-Änderung, Aufgabe → Notiz in `SyncTaskToDoc` nach jeder Aufgaben-Änderung). Unteraufgaben gehören zur Verknüpfung: Jede ist 1:1 mit einem Häkchen derselben Notiz verbunden (`subtasks[].blockId`, Badge „Unteraufgabe“, `DocumentBlock.subtaskOf`), auch wenn es verschoben oder anders eingerückt wird. Neue Unteraufgaben bekommen ein Häkchen direkt unter dem Haupt-Häkchen; neue Häkchen direkt eine Ebene darunter werden Unteraufgaben (tiefer eingerückte bleiben Notiz). Löschen wird nicht abgeglichen: Ein gelöschtes Häkchen löst nur die Verknüpfung, eine gelöschte Unteraufgabe lässt ihr Häkchen stehen. Ein Häkchen, das in eine andere Notiz wandert, bekommt dort eine neue ID und verliert damit die Verknüpfung. Die Sync-Antwort der Notiz liefert `taskLinks` und `subtaskLinks`, damit die Badges sofort stimmen.

## Aufgabenlisten und Freigabe

- Jede Liste hat Eigentümer, Titel, Symbol, Farbe und eigene Kanban-Spalten.
- Freigabe an Gruppen oder Benutzer über den Dialog `UnifiedShareModal` (Stufe pro Freigabe):
  - **Bearbeiter:** darf Aufgaben anlegen, ändern, abhaken, verschieben, löschen sowie Liste umbenennen und Spalten ändern.
  - **Leser:** sieht alles, kann nichts ändern. Der Server antwortet mit `403`; die Oberfläche blendet Eingaben aus und zeigt „Nur Lesen“.
  - Gruppenmitglieder mit mehreren Wegen erhalten die höchste Stufe. Nur der Eigentümer legt Freigaben an oder entfernt sie und kann die Liste löschen.
- Umsetzung: `Store.GetTaskListPermission` liefert `owner`/`editor`/`viewer`/`""`; `ensureTaskListWritable` schützt Schreibpfade.
- **Zuweisen** (nur in geteilten Listen, also mit mindestens einer Person außer dem Eigentümer): Im Detail-Fenster unter „Zugewiesen“ lassen sich eine oder mehrere Personen mit Zugriff auf die Liste zuweisen, über die einheitliche Personensuche ([ui-patterns.md](../ui-patterns.md)). Zuweisen dürfen Eigentümer und Bearbeiter. Zeilen und Kanban-Karten zeigen die Zugewiesenen als Profilbild-Stapel.
  - Gespeichert in `task_assignees`; `PATCH /thoughts/{id}` mit `assignees` ersetzt die Liste. Der Server lehnt Personen ohne Zugriff ab (`403`, `storage.ErrAssigneeNoAccess`).
  - **Zuweisungen folgen den Rechten:** `Store.PruneTaskAssignees` entfernt jede Zuweisung, deren Person die Liste nicht mehr sehen kann. Es läuft nach Entfernen einer Freigabe, Austritt aus oder Entfernen aus einer Gruppe, Löschen einer Gruppe, Löschen der Liste und Verschieben der Aufgabe in eine andere oder keine Liste; beim Löschen eines Kontos werden dessen Zuweisungen direkt gelöscht. Wer über einen zweiten Weg (z. B. direkt und über eine Gruppe) weiter Zugriff hat, bleibt zugewiesen.
- Wer sehen und zuweisen kann, hängt außerdem von der Sichtbarkeit ab: Verliert jemand sie (z. B. Wechsel der Organisation), fallen Freigabe und Zuweisungen weg ([sharing-and-permissions.md](../sharing-and-permissions.md)).
- **Aufgaben beobachten (`task_watchers`):** Im Detail-Fenster lässt sich eine Aufgabe über „Beobachten“ abonnieren (`POST /tasks/{id}/watch`, `DELETE /tasks/{id}/watch`). Jede Änderung an einer beobachteten Aufgabe wird dem Beobachter über seine konfigurierten Benachrichtigungskanäle gemeldet.

## Wiederkehrende Aufgaben

- Im Detail-Fenster unter der Fälligkeit: *Keine Wiederholung*, täglich, wöchentlich, monatlich oder jährlich (`thoughts.recurrence`, `PATCH /thoughts/{id}` mit `recurrence`). Zeilen und Kanban-Karten zeigen dann ein 🔁-Symbol.
- **Abhaken erzeugt die nächste Aufgabe** ([recurrence.go](../../internal/storage/recurrence.go)): egal ob im Detail, in der Liste, per Ziehen in „Erledigt“ im Kanban oder über die Checkbox in einer Notiz. Die erledigte Aufgabe bleibt erledigt (Historie); die neue übernimmt Titel, Tags, Priorität, Notizen, Liste, Zuweisungen und die Regel, Unteraufgaben kommen unerledigt mit, sie steht in der ersten offenen Spalte.
- **Fälligkeit:** das bisherige Datum plus ein Intervall (ohne Datum ab heute); eine Uhrzeit bleibt erhalten. Monate und Jahre behalten den Tag oder rutschen auf das Monatsende (31.1. → 28./29.2.).
- Jede Aufgabe erzeugt höchstens eine Nachfolgerin (`recurrence_spawned`): Wieder öffnen und erneut abhaken legt keine zweite an.
- Die neue Aufgabe geht per `TASK_CREATED` an alle Beteiligten, sie erscheint ohne Neuladen.
- Export/Import: im Markdown-Archiv als `🔁 every week` (Format des Obsidian-Tasks-Plugins), im JSON-Backup als Feld; beides wird beim Import wiederhergestellt.

## Alarme

Der Ticker läuft jede Minute ([architecture.md](../architecture.md)). Für offene Aufgaben mit `alarm_sent = 0` sendet er, sobald der Alarmzeitpunkt erreicht ist (Uhrzeit der Fälligkeit, ganztägig 9:00, jeweils minus `notifyBeforeMinutes`, Zeitzone `TZ`), an die Kanäle des Aufgaben-**Eigentümers**:

| Kanal | Ziel | Konfiguration |
|---|---|---|
| E-Mail | `alarmEmail` (sonst Konto-Adresse) | SMTP aus Admin-Einstellungen oder Umgebung, siehe unten |
| Discord | Webhook-URL | Benutzereinstellungen |
| Webhook | beliebige URL (JSON: `event`, `title`, `notes`, `dueDate`, `priority`, `timestamp`) | Benutzereinstellungen |

Danach wird `alarm_sent = 1` gesetzt, sobald mindestens ein Kanal erfolgreich war. Neben Fälligkeits-Alarmen (die sofort versendet werden) unterstützt MindSift granulare Benachrichtigungen für Freigaben, erledigte geteilte Aufgaben und beobachtete Aufgaben, die über `notification_queue` gebündelt nach `NOTIFY_DIGEST_MINUTES` versendet werden ([architecture.md](../architecture.md#benachrichtigungen)).

**E-Mail-Versand** ([mail.go](../../internal/api/mail.go)) führt den SMTP-Dialog Schritt für Schritt:

- Verbindung (Port 465: TLS von Anfang an), `EHLO` mit der Domain der Absenderadresse (nie `localhost`, das lehnen strenge Server ab), bei `SMTP_TLS` Pflicht-STARTTLS, Anmeldung, `MAIL FROM`, `RCPT TO`, Daten.
- Anmeldung: `AUTH PLAIN`; bietet der Server nur `LOGIN` an, direkt `AUTH LOGIN`. Lehnt er PLAIN ab und bietet auch LOGIN an, baut MindSift die Verbindung neu auf und versucht `AUTH LOGIN` (Go schließt die Verbindung nach einem gescheiterten AUTH). Scheitern beide mit `451`, nennt die Meldung beide Versuche und verweist auf das SASL-Backend des Mailservers (z. B. Dovecot-Auth), denn dann liegt der Fehler dort. Nie unverschlüsselt an fremde Hosts.
- `SMTP_FROM` darf einen Namen enthalten (`MindSift <alarm@domain>`): im Umschlag steht nur die Adresse, im Header Name und Adresse.
- Die Nachricht hat `Date` und `Message-ID`, einen nach RFC 2047 kodierten Betreff (Umlaute, Emoji) und einen Quoted-Printable-Text.
- `SMTP_SKIP_VERIFY` / Schalter „Zertifikatsprüfung deaktivieren“ akzeptiert selbstsignierte Zertifikate (Verbindung bleibt verschlüsselt).
- Fehler nennen den Schritt, an dem der Server abgelehnt hat (z. B. `SMTP-Schritt RCPT TO fehlgeschlagen: 451 …`), im Log als `smtp_step`. Test: `internal/api/mail_test.go` mit einem Fake-Server (STARTTLS, 451).

Eine neue Fälligkeit oder das Wiederöffnen einer Aufgabe setzt `alarm_sent` zurück, der Alarm kommt dann erneut. Schlagen alle Kanäle fehl, versucht der Ticker es in den nächsten Minuten erneut und gibt nach 3 erfolglosen Durchläufen auf (`alarm_failures`, Warnung im Server-Log); eine neue Fälligkeit oder das Wiederöffnen gibt wieder 3 Versuche. URLs werden geprüft.

Die Oberfläche zeigt Fälligkeiten relativ („Heute, 14:30“, „Morgen“, „Fr., 30.10.“); überfällige offene Aufgaben (mit Uhrzeit minutengenau) sind rot. Gruppieren und Sortieren nach Fälligkeit berücksichtigen die Uhrzeit, ganztägige Aufgaben stehen vor denen mit Uhrzeit am selben Tag.
