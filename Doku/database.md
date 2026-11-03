# Datenbank

SQLite-Datei `mindsift.db` (Standard: `$DATA_DIR/mindsift.db`), geöffnet mit `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=10000` und höchstens 8 Verbindungen. Das Schema entsteht in `Store.migrate()` ([sqlite.go](../internal/storage/sqlite.go)): zuerst `CREATE TABLE IF NOT EXISTS`, danach eine Liste idempotenter `ALTER TABLE`/`CREATE`-Anweisungen für ältere Datenbanken. IDs sind Text mit Präfix (`usr_…`, `th_…`, `tkl_…`, `lst_…`, `tls_…`, `blk_…`, `doc_…`) und 96 Zufallsbits in Hex; ältere Datensätze haben kürzere IDs (40 Bit).


## Tabellen

### Benutzer und Zugang
| Tabelle | Zweck | Wichtige Spalten |
|---|---|---|
| `users` | Konten | `email` (eindeutig), `username`, `password_hash`, `display_name`, `role` (`admin`/`member`), `is_active`, `token_version`, `alarm_channels` (kommagetrennt), `alarm_email`, `discord_webhook_url`, `custom_webhook_url`, `notify_before_minutes`, `avatar_url`, `organization_id` (leer = keine Organisation), `notification_settings` (JSON der Kanäle und Ereignisse), `last_daily_summary` (Datum des letzten Versands), Aufbewahrungsfristen in Tagen (`done_retention_days` 30, `task_trash_days` 30, `triage_trash_days` 14, `note_trash_days` 30, `list_done_days` 7; 0 = nie), `voice_input` (`''` = Whisper-Server, `browser`) |
| `user_invites` | Einladungscodes | `code`, `email`, `role`, `organization_id`, `expires_at`, `used_by` |
| `media` | Bilder und Audio in Notizen (Migration 5); Datei unter `$DATA_DIR/media/<doc_id>/<id>.<ext>` | `id`, `doc_id`, `owner_id`, `kind` (`image`/`audio`), `mime`, `size`, `source_url` (kopiertes externes Bild), `created_at` |
| `link_previews` | Zwischengespeicherte Link-Vorschauen (Migration 6) | `key` (Hash der URL), `url`, `title`, `description`, `site_name`, `image`/`icon` (BLOB, mit `*_mime`), `ok`, `fetched_at` |
| `notification_queue` | Wartende Benachrichtigungen bis zum gebündelten Versand (Migration 7) | `user_id`, `kind` (`shared`/`taskDone`/`watched`), `payload` (JSON), `created_at`, `attempts` |
| `task_watchers` | Beobachtete Aufgaben (Migration 7) | `task_id`, `user_id`, `created_at` |
| `push_subscriptions` | Geräte mit Web-Push (Migration 9) | `user_id`, `endpoint` (eindeutig), `p256dh`, `auth`, `device`, `created_at` |
| `push_keys` | VAPID-Schlüsselpaar, falls nicht per Umgebung gesetzt (Migration 9) | eine Zeile: `public_key`, `private_key` |
| `journal_days` | Journal: welche Notiz zu welchem Tag gehört (Migration 8) | `user_id`, `day` (`JJJJ-MM-TT`), `doc_id`; Primärschlüssel `(user_id, day)` |
| `sessions` | Angemeldete Geräte (Migration 4, ersetzt `revoked_tokens`) | `id` (= `jti` des Tokens), `user_id`, `created_at`, `last_used_at` (höchstens alle 5 Minuten aktualisiert), `user_agent`, `ip`, `revoked_at` (leer = aktiv) |
| `user_themes` | Eigene CSS-Themes eines Benutzers | `user_id` (FK, `ON DELETE CASCADE`), `name`, `css_content` |
| `api_keys` | Webhook-/API-Schlüssel und OAuth-Verbindungen | `name`, `key_prefix`, `key_hash` (SHA-256), `scopes` (`webhook:triage`, `webhook:task`, `webhook:list`, `tasks:read`, `tasks:write`, `lists:read`, `lists:write`), `last_used_at`, `kind` (`key`/`oauth`, Migration 17), `oauth_client_id` |
| `oauth_clients` | Selbst registrierte OAuth-Clients (Migration 17); ohne Verbindung nach 24 Stunden gelöscht | `id` (`client_id`), `name`, `redirect_uris` (JSON), `created_at` |
| `oauth_codes` | Einmal-Codes der Zustimmung, 10 Minuten (Migration 17) | `code_hash` (SHA-256), `client_id`, `key_id` → `api_keys`, `redirect_uri`, `code_challenge`, `expires_at` |
| `oauth_tokens` | Zugangs- und Refresh-Tokens (Migration 17) | `token_hash` (SHA-256), `kind` (`access`/`refresh`), `key_id` → `api_keys` (löscht mit), `expires_at`, `replaced_at` (Refresh ersetzt) |
| `system_settings` | Schlüssel/Wert für Instanz-Einstellungen | `sharing_mode`, `allow_registration`, `instance_name`, `smtp_*` |

### Gedanken und Aufgaben
| Tabelle | Zweck | Wichtige Spalten |
|---|---|---|
| `password_reset_tokens` | Links aus „Passwort vergessen?“ | `token_hash` (SHA-256), `user_id`, `created_at`, `expires_at` (1 h), `used_at` |
| `thoughts` | Gedanken **und** Aufgaben in einer Tabelle | `status` (`inbox`/`kept`/`converted`/`discarded`), `converted_type` (`task`/`document`/`list_item`/`document_block`), `converted_ref_id`, `priority`, `is_completed`, `due_date` (`YYYY-MM-DD` ganztägig oder `YYYY-MM-DDTHH:MM`, Zeitzone des Servers), `task_list_id`, `kanban_status`, `notes`, `subtasks` (JSON), `tags` (JSON), `alarm_sent`, `alarm_failures` (erfolglose Alarm-Durchläufe, ab 3 aufgegeben), `recurrence` (`daily`/`weekly`/`monthly`/`yearly`/leer), `recurrence_spawned`, `sort_order`, `source` (`manual`, `voice`, `webhook` …), `completed_at` (per Trigger beim Abhaken gesetzt, beim Öffnen geleert), Herkunft (`created_via`, `created_key_id`, `changed_via`, `changed_key_id`, `changed_at`) |
| `trashed_tasks` | Papierkorb der Aufgaben | `id` (der Aufgabe), `user_id`, `task_list_id`, `owner_id` (wessen Frist gilt), `content`, `is_completed`, `data` (die ganze `thoughts`-Zeile als JSON), `assignees` (JSON), `trashed_at`, `trashed_by` |
| `task_assignees` | Zuweisungen von Aufgaben | `task_id` (FK `thoughts`, `ON DELETE CASCADE`), `user_id`, `created_at`; nur Personen mit Zugriff auf die Liste, bereinigt durch `PruneTaskAssignees` |
| `task_lists` | Aufgabenlisten | `user_id` (Eigentümer), `title`, `icon`, `color`, `columns` (JSON, Kanban-Spalten) |
| `task_list_shares` | Freigaben von Aufgabenlisten | `target_type` (`team`/`user`), `target_id`, **`permission`** (`editor`/`viewer`, Standard `editor`) |

Eine Aufgabe ist ein `thought` mit `status='kept'` oder `status='converted' AND converted_type='task'`. Aufgaben, die aus einem Notiz-Block entstehen, tragen `converted_type='document_block'` und `converted_ref_id='<docId>:<blockId>'`.

### Workspace
| Tabelle | Zweck |
|---|---|
| `documents` | Notizen: `title`, `icon`, `folder_path`, `tags` (JSON), `is_archived` (1 = im Papierkorb), `archived_at`, `archived_by` (wer gelöscht hat), `markdown_cache`, `shared_folder_id`, `sub_folder_path`, `head_seq` (letzte Log-Position), `title_version`, `log_floor` (bis hierhin ist das Log verdichtet), Altspalten `content`, `blocks_json` |
| `blocks` | Outliner-Blöcke als Baum: `document_id`, `parent_id` (`''` = oberste Ebene), `order_key` (Sortierschlüssel unter Geschwistern), `type`, `content`, `checked`, `collapsed`, `lang`, `version` (Textversion), `conflict_of`/`conflict_author` (Konfliktkopien), `updated_by`, `deleted` (Grabstein) und `deleted_at` (Zeitpunkt des Löschens, für das Aufräumen). `level`/`position` sind Altspalten und werden nicht mehr gepflegt; Ebene und Reihenfolge berechnet der Server beim Lesen aus dem Baum. |
| `doc_ops` | Änderungs-Log je Notiz: `seq` (fortlaufend pro Notiz), `op_id`, `user_id`, `client_id`, `kind`, `block_id`, `payload` (Effekt als JSON), `created_at`. Abspielen aller Einträge ab einem Snapshot ergibt den Stand. Wird verdichtet (siehe unten). |
| `doc_op_results` | Ergebnis je Client-Operation (`op_id` eindeutig) für idempotente Wiederholungen; wird nach 90 Tagen gelöscht |
| `block_tags` | `#Hashtags` je Block (`tag`, `document_id`, `block_id`) |
| `tag_pages` | Freitext-Notiz je Benutzer und Tag |
| `doc_pins` | Favoriten je Benutzer |
| `doc_shares`, `doc_team_shares` | Notiz-Freigaben an Benutzer bzw. Gruppen (`permission`: `read` = Leser, `write` = Bearbeiter) |
| `workspace_folders` | Explizit angelegte Ordnerpfade |
| `workspace_shared_folders` | Geteilte Ordner (Entität mit Eigentümer) |
| `workspace_folder_shares` | Freigaben geteilter Ordner |
| `workspace_folder_mounts` | Persönlicher Einhängepfad je Empfänger und geteiltem Ordner |
| `doc_user_folders` | Persönliche Ablage einer geteilten Einzelnotiz je Empfänger |

Blocktypen: `h1`, `h2`, `h3`, `paragraph`, `text`, `todo`, `bullet`, `code`, `callout`, `divider`, `table`, `progress`.

### Listen
| Tabelle | Zweck |
|---|---|
| `lists` | Geteilte Listen: `title`, `icon`, `list_type` (`shopping`/`checklist`/`vacation`) |
| `list_shares` | Freigaben: `target_type`, `target_id`, `role` (`editor`/`viewer`) |
| `list_items` | Einträge: `content`, `category`, `quantity`, `is_completed`, `completed_by(_name)`, `created_by` (leer bei alten Einträgen), `sort_order` |

### Gruppen
| Tabelle | Zweck |
|---|---|
| `teams` | Gruppen der Benutzer: `name`, `description`, `org_id` (Organisation des Erstellers) |
| `team_members` | `team_id`, `user_id`, `role` (`admin`/`member`) |
| `organizations` | Vom Server-Admin angelegt: `name`. Mitglieder über `users.organization_id` (höchstens eine pro Benutzer) |

## Beziehungen

```
users 1─n thoughts            thoughts n─1 task_lists (task_list_id, lose)
users 1─n task_lists          task_lists 1─n task_list_shares ─(team|user)→ teams/users
users 1─n documents 1─n blocks 1─n block_tags
documents n─n users           via doc_shares / doc_team_shares (nur Lesen)
workspace_shared_folders 1─n workspace_folder_shares / workspace_folder_mounts
users 1─n lists 1─n list_items;  lists 1─n list_shares
teams 1─n team_members n─1 users
```

`thoughts.task_list_id` ist keine Fremdschlüsselbeziehung; beim Löschen einer Liste setzt der Code die Verweise auf `''`.

## Migrationen und Aufräumarbeiten beim Start

- Spalten/Tabellen/Indizes werden nachgezogen (`ALTER TABLE … ADD COLUMN`, Fehler werden ignoriert).
- Veraltete Tabellen werden gelöscht: `spaces`, `space_members`, `space_team_shares`, `document_crdt_state`, `document_crdt_updates`, `document_blocks`, `doc_block_tags`, `revoked_tokens`.
- `users.username` wird aus dem E-Mail-Präfix aufgefüllt.
- Notiz-Synchronisation (`migrateDocSync`): neue Spalten an `blocks` (inkl. `deleted_at`; vorhandene Grabsteine erhalten den Migrationszeitpunkt) und `documents` (`head_seq`, `title_version`, `log_floor`), Tabellen `doc_ops` und `doc_op_results`. Blöcke im alten flachen Format (nur `level`/`position`) werden einmalig in den Baum umgewandelt.
- Standardwerte in `system_settings` (`INSERT OR IGNORE`): `sharing_mode=organizations`, `allow_registration=false`, `instance_name=MindSift`, SMTP leer.
- **Migrationen:** [migrations.go](../internal/storage/migrations.go) führt nummerierte Schritte (3 „Basis-Schema v0.4.1“, 4 „Sitzungen“, 5 „Medien“, 6 „Link-Vorschauen“, 7 „Benachrichtigungen“, 8 „Journal“, 9 „Web-Push“, 10 „Registrierung und Einladungslinks“, 11 „E-Mail-Bestätigung“, 12 „Markierung für Einträge von KI-Agenten“, 13 „Herkunft von Einträgen (API-Schlüssel)“, 14 „Erledigte Aufgaben aufräumen“, 15 „Spracheingabe pro Person“, 16 „Aufbewahrung und Papierkorb für Aufgaben“, 17 „OAuth für den MCP-Zugang“) genau einmal aus und vermerkt sie in `schema_migrations` (`id`, `name`, `applied_at`); `PRAGMA user_version` zeigt die höchste angewandte Nummer. Schritt 3 (`migrateBaseline`) baut das Basisschema auf und bringt ältere Datenbanken auf diesen Stand; Spalten werden nur angelegt, wenn sie fehlen. Schlägt ein Schritt fehl, bricht der Start mit der Fehlermeldung ab, statt mit halbem Schema weiterzulaufen. Neue Änderungen kommen als neuer Schritt ans Ende, alte Schritte werden nie verändert. Daten werden beim Start nie gelöscht; nur der Demo-Modus leert die Datenbank.

## Sicherung

Die gesamte Instanz besteht aus der Datei `mindsift.db` (plus `-wal`/`-shm` im laufenden Betrieb). Konsistent sichern per `sqlite3 mindsift.db ".backup 'backup.db'"` oder durch Stoppen des Containers und Kopieren des `data/`-Verzeichnisses. Benutzerexport: `GET /api/v1/export` (JSON mit Gedanken, Notizen, Listen, Aufgabenlisten).

## Verdichtung des Notiz-Logs

`Store.CompactDocs` läuft beim Start und danach alle 6 Stunden (`startCompaction` in `internal/api/docsync.go`):

| Was | Aufbewahrung | Folge |
|---|---|---|
| `doc_ops` geteilter Notizen | 30 Tage | ältere Einträge werden gelöscht, `documents.log_floor` merkt sich die Grenze |
| `doc_ops` privater Notizen | 7 Tage | wie oben |
| Grabsteine in `blocks` | 30 Tage nach `deleted_at` | endgültig gelöscht; das ist selbst ein Log-Eintrag `purge`, geöffnete Editoren übernehmen ihn ohne Neuladen. Ein Grabstein bleibt, solange ein jüngerer gelöschter Unterblock auf ihn zeigt. |
| `doc_op_results` | 90 Tage | gelöscht |

Ein Client, dessen `lastSeq` unter `log_floor` liegt (z. B. Gerät wochenlang offline), bekommt von `/sync` `resync: true` und lädt den Snapshot neu; seine noch nicht gesendeten Änderungen bleiben in der Warteschlange und werden danach angewendet. Text für einen inzwischen endgültig gelöschten Block wird als neuer Block am Ende der Notiz angelegt, ein neuer Block unter einem endgültig gelöschten Elternblock landet auf der obersten Ebene.
