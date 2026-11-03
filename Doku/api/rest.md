# REST-API

Basis: `/api/v1`. Antworten sind JSON; Fehler haben die Form `{"error": "Text"}`. Authentifizierung über `Authorization: Bearer <JWT>`. **API-Schlüssel** (`Bearer mindsift_sec_…` bzw. Header `X-API-Key`) haben Rechte (Scopes), die für REST und [MCP](#mcp-für-ki-agenten-post-apiv1mcp) gleich gelten, siehe [API-Schlüssel](#api-schlüssel-rechte-und-herkunft). Alles andere, auch Notizen, Einstellungen und Live-Streams, antwortet einem Schlüssel mit `403`. Zeitstempel sind ISO-8601 (UTC). Anfragekörper sind auf 2 MB begrenzt (Notiz-Sync 8 MB, Importe 101 MB). Im Demo-Modus antworten Endpunkte, die etwas verschicken, Server-Einstellungen ändern oder die gemeinsamen Demo-Konten verändern würden, mit `403` „In der Demo deaktiviert“. Quelle der Wahrheit sind die Routen in [server.go](../../internal/api/server.go).

## Öffentlich

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/health` | Lebenszeichen |
| GET | `/auth/status` | `needsSetup`, `allowRegistration`, `instanceName`, `demoMode`, `sharingMode`, `legal` (`imprintUrl`, `hasImprintContent`, `privacyUrl`, `hasPrivacyContent`, `customLinkLabel`, `customLinkUrl`), `voice` (`mode` = `server`/`browser`/`off`, `maxSeconds`, `browserAllowed`), `mcpEnabled`, `mcpConnectorUrl` |
| GET | `/legal/{imprint\|privacy}` | Hinterlegter Markdown-Text (`content`), ohne Anmeldung; `404`, wenn keiner gesetzt ist |
| POST | `/share-target` | PWA Web Share Target Fallback: Weiterleitung auf `/` (`303 See Other`), falls Service Worker noch inaktiv |
| POST | `/auth/setup` | Erstes Administratorkonto (`email`, `password`, `displayName`, `instanceName`, `allowRegistration`, `sharingMode`, `seedSampleData`); nur solange es keine Konten gibt |
| POST | `/auth/verify-email` | Link aus der Bestätigungs-E-Mail (`token`): schaltet das Konto frei oder reicht es an die Freigabe weiter (`{"verified","pending","message"}`) |
| POST | `/auth/resend-verification` | Bestätigungslink erneut schicken (`email`); antwortet immer gleich, höchstens alle 2 Minuten pro Konto |
| POST | `/auth/register` | Registrierung (`email`, `password`, `displayName`, `inviteCode`); mit Code immer, sonst je nach Registrierungsmodus. `201` mit Token oder `202 {"pending":true,"verify","message"}`, wenn erst die E-Mail-Adresse bestätigt (`verify`) und/oder ein Admin freigeben muss (Login bis dahin `403`); `429` nach 20 Versuchen pro Adresse in 15 Minuten oder bei mehr als 50 wartenden Konten |
| POST | `/auth/login` | Anmeldung (`login`/`email`/`username`, `password`) → `{token, user}` |
| POST | `/auth/forgot-password` | `{email}` → immer `{ok: true}`; Mail mit Link nur, wenn das Konto existiert. `503`, wenn SMTP oder `BASE_URL` fehlen; `429` nach 10 Anfragen pro Adresse in 15 Minuten |
| POST | `/auth/reset-password` | `{token, password}` (mind. 8 Zeichen) → neues Passwort, alle Sitzungen beendet; `400` bei ungültigem oder abgelaufenem Link |
| POST | `/auth/quickstart` | Immer `403` (Gastzugang deaktiviert) |
| POST | `/webhooks/ingest` | Einliefern per Webhook, Key als `X-API-Key` (empfohlen), Bearer oder `?token=` (in der URL nur API-Keys, keine Sitzungs-Tokens). Body: `title`/`content`/`text`/`message`, `priority`, `source`, `tags`, `dueDate`; `target` (oder `type`): `triage` (Standard, Inbox), `task` (optional `taskListId`), `list_item` (`listId`, `category`, `quantity`). Klartext-Body wird als Inhalt genommen. `403` ohne passenden Scope oder ohne Schreibrecht auf die Liste |
| GET | `/ws`, `/ws/spaces/{id}`, `/ws/lists/{id}` | WebSocket, siehe [websocket.md](websocket.md); `?ticket=` oder `Authorization`-Header |
| GET | `/events` | SSE-Fallback; `?ticket=` oder `Authorization`-Header |

## Konto und Allgemeines (angemeldet)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/auth/me` | Benutzer und Kennzahlen |
| POST | `/events/rooms` | SSE-Raum beitreten/verlassen (`sseId`, `room`, `action`); nur eigene `sseId`, nur Räume mit Lesezugriff |
| POST | `/events/poll` | Long-Polling-Verbindung öffnen (`rooms` optional) → `{pollId}`; nur mit Sitzung |
| GET | `/events/poll/{pollId}?wait=25` | Gepufferte Ereignisse abholen, wartet bis zu `wait` s → `{events}`; `404` = abgelaufen |
| POST | `/auth/stream-ticket` | Einmal-Ticket (60 s) für WebSocket/SSE |
| POST | `/voice/transcribe` | Nur im Server-Modus der Spracherkennung: `multipart/form-data` mit `file` (Aufnahme, z. B. WebM/Opus oder MP4/AAC) → `{text}`. `404` ohne `STT_URL`, `413` zu groß, `429` Stundenlimit, `503` ausgelastet, `502` Whisper-Fehler (Details im Log) |
| POST | `/auth/logout` | Sitzung dieses Geräts beenden |
| GET | `/auth/sessions` | Angemeldete Geräte: `[{id, createdAt, lastUsedAt, userAgent, ip, current}]` |
| DELETE | `/auth/sessions/{id}` | Ein Gerät abmelden; `404` bei fremder oder unbekannter Sitzung |
| POST | `/auth/revoke-all` | Alle Sitzungen beenden (`token_version` +1) |
| PATCH | `/auth/settings` | `displayName`, `email`, `password`, `avatarUrl`, `alarmChannels`, `alarmEmail`, `discordWebhookUrl`, `customWebhookUrl`, `notifyBeforeMinutes`, `retention` (`doneTasks`, `taskTrash`, `triageTrash`, `noteTrash`, `listDone`: Tage aus 7, 14, 30, 90, 365, 730 oder 0 = nie; immer alle fünf, `400` bei anderen Werten oder bei 0, wenn der Server „nie“ abgeschaltet hat), `voiceInput` (`""` = Whisper-Server, `browser`), `doneRetentionDays` (älteres Einzelfeld für `retention.doneTasks`). `GET /auth/me` liefert dazu `retention` und `retentionNeverAllowed`. `notificationSettings` (`paused`, `includeOwnWatched`, `events.{due,shared,taskDone,watched}.{email,discord}`, `dailySummary.{enabled,time,email,discord}`) für Benachrichtigungen. Neue `email` oder `password` nur mit `currentPassword` (`403` bei falschem, `429` bei Login-Sperre); nach neuem Passwort sind andere Geräte abgemeldet, das neue Token kommt im Header `X-Session-Token` |
| POST | `/auth/alarms/test` | Test-Alarm (`channel`: `email`/`discord`/`webhook`, optional `target`) |
| GET | `/users/directory`, `/collaborators` | Personen, die man sehen und mit denen man teilen kann (je nach `sharingMode`, [sharing-and-permissions.md](../sharing-and-permissions.md)). Nur die öffentliche Sicht je Person: `id`, `email`, `username`, `displayName`, `avatarUrl`, `organizationId` – keine privaten Angaben (Webhooks, Alarm-E-Mail, Rolle) |
| GET | `/stats` | Zähler fürs Dashboard (u. a. `inboxCount`, `tasksOpenCount`, `listItemsOpenCount` = offene Einträge aller sichtbaren Listen) |
| GET | `/search?q=` | Globale FTS5-Suche in zugänglichen Notizen (Titel & Blöcke), Aufgaben und Listen → `{thoughts, documents, listItems, hits, counts}`. Offene Aufgaben und Listeneinträge vor erledigten. Optional: `type` (`document`/`thought`/`list_item`), `limit` (Treffer je Art, Standard 40, höchstens 200), für Aufgaben `taskStatus` (`open`/`done`), `taskListId` (`personal` = ohne Liste), `priority`, `due` (`today`/`overdue`/`week`), für Notizen `folder` (samt Unterordnern), für Listen `listId`, `itemStatus` (`open`/`done`). Treffer in Punkten tragen `before`/`after` (Text der Nachbarpunkte); `counts` = Treffer je Art in dieser Antwort |
| GET | `/export` | Datenexport als JSON; mit `?format=zip` dieselben Daten als `mindsift-backup.json` in einer ZIP (so lädt die Oberfläche das Backup) |
| GET | `/export/markdown` | Obsidian-kompatibles ZIP (`mindsift-vault-DATUM.zip`), direkt gestreamt: Notizen als `.md` mit YAML-Frontmatter in der Ordnerstruktur des Nutzers (inkl. geteilter), `Aufgaben/<Liste>.md` im Format des Tasks-Plugins (`📅`, `⏫`/`🔺`), `Listen/<Liste>.md` |
| GET/POST | `/themes` | Eigene CSS-Themes; anlegen oder mit `id` ändern (`name`, `css`, max. 200 KB) |
| DELETE | `/themes/{id}` | Eigenes Theme löschen |
| POST | `/import/mindsift`, `/import/obsidian` | Import (Multipart-Feld `file`, max. 100 MB): MindSift-JSON/-Archiv bzw. Obsidian-Vault-ZIP; `?preview=1` liefert nur die Zusammenfassung (`folders`, `notes`, `taskLists`, `tasks`, `lists`, `listItems`, `inbox`, `skipped`) |
| — | `/import/mindsift?mode=restore` | Wiederherstellen: löscht vor dem Import alle eigenen Notizen, Ordner, Aufgaben, Gedanken und Listen (erst nachdem die Datei vollständig gelesen und geprüft ist) |
| DELETE | `/user/data` | Alle eigenen Daten löschen, Konto bleibt (`{"password"}` nötig) |
| DELETE | `/user/account` | Eigenes Konto mit allen Daten löschen (`{"password"}` nötig); `403` für den letzten Server-Admin. `/auth/me` liefert dafür `isLastAdmin` |
| GET | `/backups`, `/backups/{name}` | Eigene automatische Server-Backups auflisten bzw. herunterladen |
| POST | `/backups/{name}/restore` | Server-Backup einspielen: `mode=merge` oder `restore` (gewählte Bereiche vorher leeren), `sections=notes,tasks,lists,inbox,themes`, `preview=1` |
| GET/POST | `/keys` | API-Keys auflisten bzw. anlegen (Klartext nur bei Erstellung); `POST` mit `name` und `scopes` (`webhook:triage`, `webhook:task`, `webhook:list`, `tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `notes:read`, `notes:create`; Standard `["webhook:triage"]`) |
| POST | `/mcp` | MCP-Endpunkt für KI-Agenten, siehe unten |
| PATCH | `/keys/{id}` | Name (`name`) und/oder Rechte (`scopes`) ändern; der Schlüssel selbst bleibt gleich |
| DELETE | `/keys/{id}` | API-Key löschen |

### Globale Suche (`GET /api/v1/search?q=`)

Führt eine Volltextsuche über SQLite FTS5 mit BM25-Relevanz-Ranking aus.
- Durchsucht Aufgaben/Gedanken (Inhalt, Notizen, Unteraufgaben), Notizen (Titel sowie Inhalte aktiver Blöcke) und Listeneinträge.
- Beachtet strikt alle Zugriffsregeln: Nur eigene Gedanken/Aufgaben und solche in zugänglichen Aufgabenlisten; nur eigene und geteilte Notizen (direkt, über Gruppen oder freigegebene Ordner); nur eigene und geteilte Listen.
- Titel-Treffer werden höher gewichtet als Treffer im Fließtext.
- Liefert rückwärtskompatible Collections (`thoughts`, `documents`, `listItems`) sowie strukturierte `hits` mit Snippet und `<mark>`-Hervorhebung:
  ```json
  {
    "thoughts": [...],
    "documents": [...],
    "listItems": [...],
    "hits": [
      {
        "type": "document",
        "id": "blk_123",
        "title": "Projektplanung",
        "snippet": "... wichtige Notiz zum <mark>Release</mark> ...",
        "docId": "doc_abc",
        "blockId": "blk_123"
      }
    ]
  }
  ```

### MCP für KI-Agenten (`POST /api/v1/mcp`)

MindSift ist ein [MCP](https://modelcontextprotocol.io)-Server (Streamable HTTP, zustandslos, nur JSON-RPC 2.0 per `POST`; kein Server-Stream, `GET` antwortet `405`, Batches werden abgelehnt). Anmeldung wie überall per `X-API-Key` oder `Authorization: Bearer`; eine Sitzung darf alles, ein API-Key nur die Werkzeuge seiner Scopes, und `tools/list` zeigt ihm nur diese. Protokollversionen `2025-06-18`, `2025-03-26`, `2024-11-05`. Unterstützte Methoden: `initialize`, `ping`, `tools/list`, `tools/call`; Benachrichtigungen antworten `202`. Fehler eines Werkzeugs kommen als `isError`-Ergebnis zurück, damit der Agent sie lesen kann; Ergebnisse stehen als `structuredContent` (Listen als `{items}`) und als JSON-Text.

Betreiber können MCP abschalten (`MCP_ENABLED=false` oder Schalter in der Administration, Feld `mcpEnabled` in `/admin/settings`). Dann antwortet der Endpunkt mit `404`, OAuth ist ebenfalls aus, und `GET /auth/status` liefert `mcpEnabled: false`.

| Werkzeug | Scope | Zweck |
|---|---|---|
| `list_task_lists` | `tasks:read` | Aufgabenlisten mit `permission`, offenen Aufgaben und Board-Spalten (`columns`: gültige Werte für `kanbanStatus`) |
| `create_task_list` | `tasks:write` | Eigene Aufgabenliste mit den Standardspalten anlegen (`title`, `icon`) |
| `list_tasks` | `tasks:read` | Aufgaben (`taskListId`, `status` open/done/all, `dueBefore` JJJJ-MM-TT, `limit`); fällige zuerst |
| `get_task` | `tasks:read` | Eine Aufgabe |
| `create_task` | `tasks:write` | Aufgabe anlegen (`content`, `taskListId`, `priority`, `dueDate`, `notes`); Quelle `agent` |
| `update_task` | `tasks:write` | Felder ändern (`content`, `isCompleted`, `dueDate`, `priority`, `notes`, `kanbanStatus`, `taskListId`, `tags`) |
| `complete_task` | `tasks:write` | Abhaken (`completed` false = wieder öffnen) |
| `add_subtask` | `tasks:write` | Unteraufgabe anhängen (`taskId`, `title`) |
| `update_subtask` | `tasks:write` | Unteraufgabe abhaken (`completed`), umbenennen (`title`) oder entfernen (`delete`) |
| `delete_task` | `tasks:write` | Aufgabe löschen (z. B. versehentlich angelegte); sie kommt in den Papierkorb der Aufgaben |
| `list_lists` | `lists:read` | Geteilte Listen mit offenen Einträgen |
| `create_list` | `lists:write` | Liste anlegen (`title`, `icon`, `listType` shopping/checklist/vacation) |
| `get_list` | `lists:read` | Liste mit Einträgen |
| `add_list_item` | `lists:write` | Eintrag hinzufügen (`listId`, `content`, `category`, `quantity`) |
| `check_list_item` | `lists:write` | Eintrag abhaken (`completed` false = zurück) |
| `update_list_item` | `lists:write` | Text, Kategorie, Menge ändern |
| `list_notes` | `notes:read` | Notizen ohne Inhalt, zuletzt geänderte zuerst (`folder` samt Unterordnern, `query` im Titel, `limit`) |
| `get_note` | `notes:read` | Eine Notiz; `content` sind die Punkte als eingerückte Markdown-Liste (Tab je Ebene, `- [ ]` für To-dos, Bilder und Aufnahmen als Platzhalter) |
| `create_note` | `notes:create` | Neue Notiz (`title`, `content` als Markdown wie beim Import, `folderPath`, `icon`); in geteilte Ordner nur mit Schreibrecht. Bestehende Notizen ändert kein Werkzeug |
| `search` | ein Lese-Scope | Volltextsuche in Aufgaben, Listeneinträgen und Notizen (nur die Teile der eigenen Scopes); Notizen als `notes` mit `noteId`, `title`, `snippet` |
| `capture_to_inbox` | `webhook:triage` | Gedanken in die Inbox |

Was ein Agent anlegt oder ändert, bekommt eine dauerhafte Herkunft (`origin`, siehe [API-Schlüssel](#api-schlüssel-rechte-und-herkunft)). `create_task` geht auch mit `webhook:task`, `add_list_item` auch mit `webhook:list`.

Freigaben gelten wie für die Person selbst: Leser-Listen lassen sich nicht ändern, fremde Listen sind unsichtbar. Einrichtung z. B. in Claude Code: `claude mcp add --transport http mindsift https://mindsift.example.com/api/v1/mcp --header "X-API-Key: mindsift_sec_…"`; die Einstellungen zeigen die Varianten für Codex (`config.toml`) und JSON-Konfigurationen (Claude Desktop, Cursor). claude.ai und ChatGPT verbinden sich per OAuth (nächster Abschnitt).

### OAuth für claude.ai und ChatGPT

Clients, die keinen `X-API-Key` setzen können, verbinden sich per OAuth 2.1 nach der MCP-Spezifikation (Autorisierung, Stand 2025-06-18). In claude.ai wird dafür nur `<BASE_URL>/api/v1/mcp` als eigener Connector eingetragen; den Rest erledigt der Client. Voraussetzung ist `BASE_URL` (Issuer und Ressource); ohne `BASE_URL`, im Demo-Modus und bei abgeschaltetem MCP antworten alle Endpunkte mit `404`. `GET /auth/status` liefert die Adresse als `mcpConnectorUrl` (leer, wenn OAuth aus ist).

| Methode | Pfad (ohne `/api/v1`) | Zweck |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource` (auch mit Anhang `/api/v1/mcp`) | Ressourcen-Beschreibung (RFC 9728): `resource`, `authorization_servers`, `scopes_supported` |
| GET | `/.well-known/oauth-authorization-server` | Server-Beschreibung (RFC 8414) |
| POST | `/oauth/register` | Dynamische Client-Registrierung (RFC 7591), JSON `client_name`, `redirect_uris` (nur `https://` oder `http://localhost`/`127.0.0.1`, höchstens 10). Alle Clients sind öffentlich (`token_endpoint_auth_method: none`); 20 Registrierungen pro Adresse und Viertelstunde |
| GET | `/oauth/authorize` | Zustimmungsseite in der App (Anmeldung, Rechte wählen, Erlauben/Ablehnen). Pflicht: `response_type=code`, `client_id`, `redirect_uri` (exakt registriert), `code_challenge` mit `code_challenge_method=S256`; optional `state`, `scope` (Leerzeichen-getrennte Rechte), `resource`. Die Antwort an den Client trägt `code`, `state` und `iss` bzw. `error` |
| POST | `/oauth/token` | Formular: `grant_type=authorization_code` (`code`, `client_id`, `redirect_uri`, `code_verifier`) oder `refresh_token` (`refresh_token`, `client_id`). Fehler als `{"error":"invalid_grant",…}` |
| POST | `/oauth/revoke` | Token widerrufen (RFC 7009); ein Refresh-Token beendet alle Tokens der Verbindung |

Die Zustimmungsseite nutzt `GET`/`POST /api/v1/oauth/authorize` (nur mit Anmeldung, nicht mit Schlüsseln).

- **Rechte:** dieselben wie bei Schlüsseln, angeboten werden `tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `notes:read`, `notes:create` und `webhook:triage`. Fragt der Client nichts Bestimmtes an, sind Lesen und Ändern für Aufgaben und Listen vorbelegt.
- **Verbindung = Eintrag unter `/keys`** mit `kind: "oauth"` und dem Namen „<Client> (OAuth)“. Rechte ändern, umbenennen und löschen wie bei jedem Schlüssel; Herkunft (`origin`) mit diesem Namen. Erneutes Zustimmen desselben Clients verwendet den Eintrag weiter.
- **Tokens:** Code 10 Minuten und einmal gültig, Zugangs-Token (`mindsift_oat_…`) 1 Stunde, Refresh-Token (`mindsift_ort_…`) 90 Tage und bei jeder Erneuerung neu. Wird ein bereits ersetzter Refresh-Token noch einmal benutzt, enden alle Tokens der Verbindung. Zugangs-Tokens gelten nur für `POST /mcp`, nicht für REST oder Webhooks.
- **Verfall:** Eine Verbindung, die `OAUTH_IDLE_DAYS` (Standard 90, `0` = nie) nicht benutzt wurde, wird gelöscht.
- Ohne gültiges Token antwortet `/mcp` mit `401` und `WWW-Authenticate: Bearer resource_metadata="…"`.

### API-Schlüssel: Rechte und Herkunft

Ein Schlüssel darf nur diese Endpunkte und braucht dafür eines der genannten Rechte:

| Recht (Scope) | Bedeutung | REST | MCP-Werkzeuge |
|---|---|---|---|
| `webhook:triage` | Inbox füllen | `POST /inbox`, `POST /webhooks/ingest` (Ziel `triage`) | `capture_to_inbox` |
| `tasks:read` | Aufgaben lesen | `GET /task-lists`, `GET /tasks` | `list_task_lists`, `list_tasks`, `get_task`, `search` |
| `webhook:task` | Aufgaben anlegen | `POST /inbox` bzw. `/webhooks/ingest` mit Ziel `task` | `create_task` |
| `tasks:write` | Aufgaben ändern (schließt Anlegen ein) | dazu `PATCH`/`DELETE /thoughts/{id}` | dazu `update_task`, `complete_task`, `delete_task`, `create_task_list` |
| `lists:read` | Listen lesen | `GET /lists`, `GET /lists/{id}` | `list_lists`, `get_list`, `search` |
| `webhook:list` | Listeneinträge hinzufügen | `POST /lists/{id}/items`, `/webhooks/ingest` mit Ziel `list_item` | `add_list_item` |
| `lists:write` | Listen ändern (schließt Hinzufügen ein) | dazu `PATCH`/`PUT /lists/{id}/items/{itemId}` | dazu `check_list_item`, `update_list_item`, `create_list` |
| `notes:read` | Notizen lesen | – | `list_notes`, `get_note`, `search` |
| `notes:create` | Notizen anlegen | – | `create_note` |

Notizen gibt es nur über MCP; per REST bleiben sie für Schlüssel gesperrt. Notizen tragen keine Herkunft (`origin`).

Die Ids `webhook:…` stammen aus der Zeit, als Schlüssel nur einliefern konnten, und bleiben für bestehende Schlüssel gleich.

`GET /tasks` filtert für Skripte und Smart Home: `status=open|done|all` (Standard alle), `due=today`, `due=overdue` (nur offene) oder `due=JJJJ-MM-TT` (fällig bis einschließlich); Tage zählen in der Zeitzone des Servers (`TZ`). Ohne Parameter bleibt die Antwort wie bisher.

**Herkunft:** Was ein Schlüssel anlegt oder ändert, trägt an Aufgabe, Gedanke oder Listeneintrag das Feld `origin`: `createdVia`/`createdKey` (angelegt) und `changedVia`/`changedKey`/`changedAt` (zuletzt per Schlüssel geändert), mit `api` oder `mcp` als Zugang und dem Namen des Schlüssels (gelöscht: „Gelöschter Schlüssel“). Die Herkunft bleibt dauerhaft, auch wenn die Person den Eintrag danach selbst bearbeitet, und geht beim Umwandeln in der Triage mit (auch in einen Listeneintrag). Eine MCP-Anfrage aus einer Anmeldung heraus zählt als `mcp` ohne Schlüssel.

## Gedanken, Triage, Aufgaben

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/inbox` | Schnellerfassung. Body: `content`, `priority`, `source`, `dueDate`, `target` (`inbox`/`task`/`list_item`/`document`), `targetListId`, `taskListId` (snake_case-Varianten werden akzeptiert) |
| GET | `/thoughts?status=` | Gedanken (`inbox`, `kept`, `converted`, `discarded`, `all`) |
| GET/PATCH/DELETE | `/thoughts/{id}` | Einzelabruf; Teiländerung (`content`, `isCompleted`, `dueDate`, `priority`, `taskListId`, `kanbanStatus`, `notes`, `subtasks`, `tags`, `assignees`, `recurrence` = `daily`/`weekly`/`monthly`/`yearly`/leer); Löschen: eine Aufgabe kommt in den Papierkorb der Aufgaben, ein Gedanke aus Posteingang oder Triage-Papierkorb ist endgültig weg. `assignees` ersetzt die Zuweisungen; nur Personen mit Zugriff auf die Liste, sonst `403` |
| DELETE | `/thoughts/discarded/purge` | Papierkorb der Triage (verworfene Gedanken) leeren |
| GET | `/triage/deck` | Posteingang (max. 100) |
| PATCH | `/triage/{id}` | `action`: `keep`/`discard`/`restore`; mit `convertTo`: `task`/`document`/`list_item` |
| GET | `/tasks?taskListId=&status=&due=` | Aufgaben (optional einer Liste; Filter siehe [API-Schlüssel](#api-schlüssel-rechte-und-herkunft)) |
| POST | `/tasks/clear-done` | Erledigte Aufgaben in den Papierkorb der Aufgaben (`taskListId`, leer = alle bearbeitbaren) → `{deleted}` |
| GET | `/tasks/trash?taskListId=` | Papierkorb der Aufgaben (einer Liste, sonst alle sichtbaren): `id`, `content`, `taskListId`, `isCompleted`, `trashedAt`, `trashedBy` (Name, leer = automatisch), `canEdit` |
| POST | `/tasks/trash/{id}/restore` | Aufgabe unverändert zurückholen (mit Zuweisungen; eine gelöschte Liste macht sie zur eigenen Aufgabe ihres Erstellers) → Aufgabe |
| DELETE | `/tasks/trash/{id}` | Endgültig löschen (Bearbeitungsrecht auf die Liste, sonst `403`) |
| POST | `/tasks/trash/empty` | Papierkorb leeren (`taskListId`, leer = alle bearbeitbaren) → `{deleted}` |
| POST | `/tasks/reorder`, `/task-lists/{id}/tasks/reorder` | Reihenfolge/Spalte ändern (`items[{id, sortOrder, kanbanStatus}]`) |
| POST | `/tasks/{id}/unlink` | Verknüpfung zu Notiz-Block lösen |
| POST/DELETE | `/tasks/{id}/watch` | Aufgabe beobachten bzw. nicht mehr → `{watching}`; `404` ohne Zugriff. Aufgaben-Antworten tragen `isWatching` |

## Aufgabenlisten

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST | `/task-lists` | Listen (`permission` je Liste: `owner`/`editor`/`viewer`); anlegen (`title`, `icon`, `color`, `teamId`; `icon: ""` = ohne Symbol, fehlt es: 📋) |
| PUT/DELETE | `/task-lists/{id}` | Ändern (`title`, `icon`, `color`, `teamId`, `columns`) – nicht für Leser; Löschen nur Eigentümer |
| GET | `/task-lists/{id}/shares` | Freigaben |
| POST | `/task-lists/{id}/shares` | Nur Eigentümer. Body: `targetType` (`team`/`user`), `targetId`, `permission` (`editor`/`viewer`, Standard `editor`). Erneutes Senden für dasselbe Ziel ändert die Stufe |
| DELETE | `/task-lists/{id}/shares/{shareId}` | Nur Eigentümer |

Schreibzugriffe von Lesern auf Listen oder deren Aufgaben liefern `403` („Keine Schreibrechte für diese Aufgabenliste (nur Lesen)“).

## Workspace

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST/DELETE | `/folders` | Ordnerliste, anlegen (`path`), löschen; ein eigener Ordner kommt mit Unterordnern und Notizen als ein Eintrag in den Papierkorb |
| POST | `/folders/trash/{id}/restore` | Ordner aus dem Papierkorb wiederherstellen (mit allen Unterordnern, auch leeren, und Notizen) → `restoredDocIds` |
| DELETE | `/folders/trash/{id}` | Ordner im Papierkorb samt Notizen endgültig löschen |
| POST | `/folders/move` | `sourcePath`, `targetParentPath` |
| GET/POST | `/workspace/folders/shared` | Geteilte Ordner; anlegen (`name`, `mountPath`) |
| GET/DELETE | `/workspace/folders/shared/{id}` | Abruf; Löschen |
| PUT | `/workspace/folders/shared/{id}/mount` | Eigenen Einhängepfad ändern (`mountPath`) |
| GET/POST | `/workspace/folders/shared/{id}/shares` | Freigaben geteilter Ordner (`permission`: `read`/`write`) |
| DELETE | `/workspace/folders/shared/{id}/shares/{shareId}` | Freigabe eines geteilten Ordners entfernen |
| GET | `/workspace/tags`, `/workspace/tags/{tag}` | Tag-Übersicht und -Details |
| PUT | `/workspace/tags/{tag}/note` | Tag-Seite speichern (`content`) |
| GET/POST | `/documents` | Notizen auflisten; anlegen (`title`, `icon`, `folderPath`, `blocks`, `tags`, `isPinned`; `icon: ""` = ohne Symbol, fehlt es: 🗒️) |
| GET/PUT/DELETE | `/documents/{id}` | Abruf; Ändern von `title`, `icon`, `folderPath`, `isPinned` (Blöcke → `400`, sie laufen über `/docs/{id}/sync`); Löschen = in den Papierkorb (Eigentümer) bzw. Freigabe verlassen (andere) |
| GET/DELETE | `/documents/trash` | Papierkorb auflisten (`id`, `kind` `note`/`folder`, `title`, `icon`, `folderPath`, `deletedAt`, `isOwner`, bei Ordnern `noteCount`; Notizen eines gelöschten Ordners stecken in dessen Eintrag) bzw. leeren (Notizen und Ordner) |
| GET | `/documents/{id}/backlinks` | Notizen mit `[[Titel]]`-Link auf diese Notiz (nur sichtbare, ohne Papierkorb): `docId`, `title`, `icon`, `folderPath`, bis zu 5 `blocks` (`id`, `content`), `more` |
| POST | `/documents/{id}/restore` | Aus dem Papierkorb zurückholen (fehlender Ordner wird neu angelegt) |
| DELETE | `/documents/{id}/permanent` | Notiz im Papierkorb endgültig löschen |
| PUT | `/documents/{id}/move` | Ordner wechseln (`folderPath`) |
| POST | `/documents/{id}/blocks/{blockId}/enhanced-task` | Aus einem Block eine verknüpfte Aufgabe machen (`content`, `checked`) |
| GET/POST | `/documents/{id}/shares` | Notiz-Freigaben (`userId`/`email`/`teamId`, `permission`: `read`/`write`) |
| DELETE | `/documents/{id}/shares/{userId}` | Notiz-Freigabe entfernen |
| POST | `/documents/{id}/extract` | `{blockId, clientId}`: legt aus den Unterpunkten des Punkts eine eigene Notiz an (Titel = Text ohne Hashtags, gleicher Ordner, Freigaben übernommen, fremder Besitzer bekommt Schreibrecht) → `{document, link}`. Die Ursprungsnotiz ändert der Server nicht; der Editor ersetzt den Ast selbst durch `link` (normale eigene Änderung, Strg+Z möglich). Schreibrecht nötig; `409`, wenn jemand anderes im Ast schreibt; `400`, wenn der Punkt nur noch ein Link auf eine Notiz ist (ggf. mit Hashtags) |
| GET | `/push/key` | `{enabled, publicKey}` – öffentlicher VAPID-Schlüssel für `pushManager.subscribe` (in der Demo `enabled: false`) |
| GET | `/push/devices` | Eigene Geräte mit Push → `{devices: [{id, endpoint, device, createdAt}]}` |
| POST | `/push/subscribe` | `{endpoint, keys: {p256dh, auth}, device}` – Gerät anmelden (nur `https`-Endpunkte) |
| POST | `/push/unsubscribe` | `{endpoint}` – Gerät abmelden |
| POST | `/push/test` | Test-Benachrichtigung an alle eigenen Geräte → `{devices}`; `400` ohne Gerät |
| GET | `/journal` | Tage des eigenen Journals, neueste zuerst → `{days: [{date, docId, empty}]}` (`empty`: Notiz noch ohne Text; Tage im Papierkorb fehlen) |
| POST | `/journal/{date}` | Notiz des Tages (`JJJJ-MM-TT`) öffnen; gibt es noch keine, wird sie angelegt (Titel z. B. „Freitag, 30. Oktober 2026“, Icon 📅) → Dokument, `201` bei Neuanlage. Die Journal-Notizen sind normale Notizen (Teilen, Suche, Sync) |
| POST | `/documents/{id}/extract/undo` | Legt die ausgelagerte Notiz `{id}` wieder in den Papierkorb (nur ihr Ersteller) |
| POST | `/documents/{id}/inline` | `{blockId}`: Gegenstück zu `extract` für einen Punkt, der nur aus `[[Notiz]]` (ggf. mit Hashtags) besteht → `{sourceId, content, blocks}`: Text für den Punkt (Titel plus Hashtags) und die Punkte der Notiz mit neuen IDs (`level` 0 = direkt unter dem Punkt). Die verlinkte Notiz kommt in den Papierkorb; rückgängig mit `POST /documents/{sourceId}/restore`. Die Ursprungsnotiz ändert der Editor selbst. `400` kein Link-Punkt, `404` Notiz nicht gefunden, `403` fremde Notiz, `409` noch aus anderen Notizen verlinkt |
| POST | `/documents/{id}/merge` | `{sourceId}`: hängt die (eigene) Quellnotiz als Überschrift mit Unterpunkten an diese Notiz an, Quelle in den Papierkorb → `{targetId, sourceId, sourceTitle, headingId}` |
| POST | `/documents/{id}/merge/undo` | `{sourceId, headingId}`: Abschnitt wieder entfernen, Quelle wiederherstellen |
| POST | `/documents/{id}/media` | Bild oder Audio zu einer Notiz hochladen (`multipart/form-data`, Feld `file`; Schreibrecht nötig) → `{id, kind, mime, size, url}`. `415` falsches Format, `413` zu groß oder Kontingent voll |
| POST | `/documents/{id}/media/fetch` | Externes Bild kopieren: `{url}` (nur https, keine internen Adressen; nicht in der Demo) → wie oben |
| GET | `/media/{id}` | Datei abrufen (Leserecht auf eine Notiz, die sie zeigt), mit Range-Anfragen; sonst `404` |
| GET | `/link-preview?url=https://…` | Vorschau einer Web-Seite (`title`, `description`, `siteName`, `hasImage`, `hasIcon`, `ok`, `key`), vom Server geholt und 7 Tage zwischengespeichert; `422` ohne https, `403` in der Demo, `429` zu viele Abrufe |
| GET | `/link-preview/{key}/image` bzw. `/icon` | Bild bzw. Icon einer Vorschau |

Der Inhalt einer Notiz (Blöcke) wird ausschließlich über `POST /docs/{id}/sync` geändert. `POST /documents` nimmt beim Anlegen weiterhin eine Start-Blockliste an; sie wird intern in Operationen umgerechnet.

## Gemeinsames Bearbeiten von Notizen

Konzept und Regeln: [modules/collaboration.md](../modules/collaboration.md). Zugriff über die Rolle `owner`/`editor`/`viewer` (`Store.DocRole`); ohne Rolle `404`.

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/docs/{id}/snapshot` | Kompletter Blockbaum inkl. Grabsteinen, `title`, `titleVersion`, `headSeq`, `role`, `shared` |
| POST | `/docs/{id}/sync` | Ein Rundlauf: eigene Operationen senden, Leases halten/abgeben, Log ab `lastSeq` abholen |
| GET | `/docs/{id}/changes?since=N&wait=S` | Long-Polling: antwortet sofort, wenn `headSeq > N`, sonst bei der nächsten Änderung (auch Leases/Präsenz) oder nach höchstens 25 s. Antwort `{headSeq, changed}`; Daten holt der Client danach per `/sync` |
| POST | `/docs/{id}/leave` | Sitzung beenden, alle Leases des Clients freigeben (`{clientId}`) |

`/sync`-Anfrage:

```json
{
  "clientId": "tab-7f3…",
  "lastSeq": 412,
  "ops": [
    { "opId": "c1a…", "kind": "set_content", "blockId": "b9…", "baseVersion": 7, "content": "Milch und Brot" },
    { "opId": "c1b…", "kind": "insert", "blockId": "bA…", "parentId": "b2…", "orderKey": "a0V", "type": "bullet", "content": "" }
  ],
  "leases": { "hold": ["b9…", "bA…"], "release": [] }
}
```

- Operationsarten: `insert`, `set_content`, `set_props` (`patch`: `type`, `checked`, `collapsed`, `lang`, `clearConflict`), `move`, `delete`, `restore` (`ids`), `set_title` (`baseVersion`, `title`).
- `leases.hold` ist die vollständige Liste der Blöcke, die der Client halten will; alle anderen Leases des Clients werden freigegeben. Neu eingefügte Blöcke und Konfliktkopien bekommt der Autor automatisch.
- Höchstens 500 Operationen pro Anfrage. Leser dürfen keine Operationen senden (`403`), aber abfragen.
- `skipLog: true` liefert kein Log zurück; gedacht für einzelne Änderungen ohne geöffneten Editor (z. B. Abhaken in der To-Do-Übersicht).

Antwort: `results` (je Operation `status` `applied`/`conflict`/`rejected`, ggf. `conflictBlockId`, `version`, `seq`), `ops` (Log-Einträge `{seq, opId, userId, clientId, effect}` ab `lastSeq`, höchstens 1000; `hasMore` bei mehr), `headSeq`, `resync` (Snapshot neu laden: der Client ist dem Server voraus, oder sein `lastSeq` liegt vor der verdichteten Grenze `log_floor`; die gesendeten Operationen werden trotzdem angewendet), `role`, `shared`, `sessions`, `presence`, `leases` (`granted`, `denied`, `others`).

Wiederholte Operationen (gleiche `opId`) werden nicht erneut angewendet; die Antwort enthält das gespeicherte Ergebnis.

## Geteilte Listen

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST | `/lists` | Listen; anlegen (`title`, `icon`, `listType`; `icon: ""` = ohne Symbol, fehlt es: 🛒) |
| GET/DELETE | `/lists/{id}` | Abruf mit Einträgen; Löschen |
| GET/POST | `/lists/{id}/shares` | Freigaben abrufen bzw. anlegen (`targetType`, `targetId`, `role`: `editor`/`viewer`) |
| DELETE | `/lists/{id}/shares/{shareId}` | Freigabe entfernen |
| POST | `/lists/{id}/items` | Eintrag (`content`, `category`, `quantity`) |
| PATCH | `/lists/{id}/items/{itemId}` | Abhaken (`isCompleted`) |
| PUT | `/lists/{id}/items/{itemId}` | Ändern (`content`, `category`, `quantity`) |
| DELETE | `/lists/{id}/items/{itemId}` | Löschen |
| POST | `/lists/{id}/items/{itemId}/move` | In eine andere Liste verschieben (`targetListId`); Bearbeitungsrecht in beiden Listen nötig, der Eintrag landet oben |
| POST/PUT | `/lists/{id}/items/reorder` | Reihenfolge/Kategorie (`items[{id, sortOrder, category, content}]`) |
| POST | `/lists/{id}/clear-completed` | Erledigte entfernen |

## Gruppen

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST | `/teams` | Eigene Gruppen; anlegen (`name`, `description`) – Ersteller wird Gruppen-Admin, die Gruppe gehört zu seiner Organisation; im Modus `private` gesperrt |
| PUT/DELETE | `/teams/{id}` | Nur Gruppen-Admin |
| POST | `/teams/{id}/members` | Mitglied hinzufügen (`userId` oder `email`, `role`); nur sichtbare Personen, sonst `404` |
| PUT/DELETE | `/teams/{id}/members/{userId}` | Rolle ändern (`admin`/`member`); entfernen |

## Administration (`role = admin`)

| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST | `/admin/users` | Benutzer auflisten, anlegen (`email`, `password`, `displayName`, `role`, optional `organizationId`) |
| PUT | `/admin/users/{id}/organization` | Organisation setzen (`organizationId`, leer = keine); entzieht Freigaben, Gruppen und Zuweisungen der alten |
| GET/POST | `/admin/organizations` | Organisationen mit `memberCount`; anlegen (`name`) |
| PUT/DELETE | `/admin/organizations/{id}` | Umbenennen (`name`); löschen (Mitglieder sind danach ohne Organisation) |
| PATCH/DELETE | `/admin/users/{id}` | `displayName`, `email`, `role`, `isActive`, `discordWebhookUrl`; löschen (bei wartenden Konten = ablehnen). `GET /admin/users` markiert wartende Konten mit `pendingApproval` |
| POST | `/admin/users/{id}/approve` | Wartendes Konto freigeben; die Person bekommt eine E-Mail (`409`, wenn es nicht wartet) |
| PUT | `/admin/users/{id}/password` | Passwort zurücksetzen |
| GET/POST | `/admin/invites` | Einladungen auflisten bzw. anlegen (`email`, `role`, `organizationId`, `validDays`, `maxUses` 1–1000; mehrfach verwendbare nicht an eine E-Mail gebunden). Antwort mit `maxUses`/`useCount`. Als Link: `/?invite=<CODE>` öffnet die Registrierung mit eingetragenem Code |
| POST | `/admin/invites/{id}/send` | Einladung per E-Mail (`email`); bindet einmalige Codes an diese Adresse; braucht SMTP |
| DELETE | `/admin/invites/{id}` | Einladung widerrufen/löschen |
| GET/PUT | `/admin/settings` | `instanceName`, `allowRegistration`, `sharingMode` (`private`/`organizations`/`open`), SMTP-Felder; ein Moduswechsel bereinigt Freigaben. `smtpPass` kommt nie zurück (`smtpPassSet` zeigt, ob eines gespeichert ist); leer = unverändert |
| GET | `/admin/settings/sharing-impact?mode=` | Probelauf: wie viele Freigaben und Gruppen-Mitgliedschaften ein Wechsel entfernen würde (`affected`) |
| POST | `/admin/smtp/test` | Testmail (`toEmail`) |
| GET | `/admin/voice` | Aktive Spracherkennung (`mode`: `server`/`browser`/`off`), Einstellungen aus `STT_*` ohne Schlüssel, Grenzen und im Server-Modus ein frischer Zustand (`status.reachable`, `status.modelReady`) |
| GET/POST | `/admin/backups` | Datenbank-Abzüge auflisten bzw. sofort sichern (Abzug + alle Benutzer-Backups) |
| GET | `/admin/backups/{name}` | Datenbank-Abzug herunterladen |
| DELETE | `/admin/backups/{name}` | Datenbank-Abzug löschen (gibt die verbleibende Liste zurück; nicht in der Demo) |

## Beispiele

```bash
# Gedanken per API-Key erfassen
curl -X POST https://mindsift.example.com/api/v1/webhooks/ingest \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" \
  -d '{"title":"Milch kaufen #einkauf","priority":"high","dueDate":"2026-11-01"}'

# Was heute ansteht (Recht tasks:read), z. B. für einen Home-Assistant-Sensor
curl "https://mindsift.example.com/api/v1/tasks?due=today&status=open" -H "X-API-Key: mindsift_sec_…"

# Aufgabe abhaken (Recht tasks:write)
curl -X PATCH https://mindsift.example.com/api/v1/thoughts/th_… \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" -d '{"isCompleted":true}'

# Einkaufsliste per API-Key ergänzen (Recht webhook:list oder lists:write)
curl -X POST https://mindsift.example.com/api/v1/webhooks/ingest \
  -H "X-API-Key: mindsift_sec_…" -H "Content-Type: application/json" \
  -d '{"target":"list_item","listId":"lst_…","content":"Hafermilch","quantity":"2"}'

# Aufgabenliste nur lesend freigeben
curl -X POST https://mindsift.example.com/api/v1/task-lists/tkl_…/shares \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"targetType":"user","targetId":"usr_…","permission":"viewer"}'
```
