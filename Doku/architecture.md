# Architektur

## Überblick

```
Browser (React SPA, PWA-Manifest)
   │  REST /api/v1/*           Authorization: Bearer <JWT | mindsift_sec_…>
   │  WebSocket /api/v1/ws     Fallback: SSE /api/v1/events, dann Long-Polling /api/v1/events/poll
   ▼
Go-Server (chi)  ── internal/api   Handler, Middleware, Alarm-Ticker
   │                internal/ws    Hub (Räume, Benutzer-Kanäle, SSE, Long-Polling)
   │                internal/auth  JWT, bcrypt, API-Key-Hash
   ▼                internal/config
SQLite (modernc.org/sqlite, WAL)  ── internal/storage
```

Das Frontend liegt per `go:embed` im Binary ([cmd/server/main.go](../cmd/server/main.go)). Unbekannte Pfade liefern `index.html` (SPA-Routing); `index.html`, `sw.js` und `manifest.json` werden mit `no-store` ausgeliefert.

## Stack

| Schicht | Technik |
|---|---|
| Backend | Go 1.23, `go-chi/chi` v5, `go-chi/cors`, `gorilla/websocket`, `golang-jwt/jwt` v5, `x/crypto/bcrypt` |
| Datenbank | SQLite über `modernc.org/sqlite` (reines Go, kein CGO), WAL, `foreign_keys=ON` |
| Frontend | React 18, TypeScript, Vite 5, Tailwind 3, framer-motion (Triage-Karten), lucide-react, prismjs (Code-Blöcke) |
| Auslieferung | Mehrstufiges Dockerfile (Node 22 → Go 1.23 → Alpine 3.21), Image `ghcr.io/mindsift-app/mindsift` |

## Verzeichnisse

| Pfad | Inhalt |
|---|---|
| `cmd/server/` | `main.go`, eingebettetes `dist/` |
| `internal/api/` | `server.go` (Server, Router mit allen Routen, Middleware, JSON-Helfer); Handler nach Bereich in `handlers_*.go` (`auth`, `account`, `thoughts`, `documents`, `folders`, `lists`, `tasklists`, `teams`, `admin`, `integrations`), `realtime.go` (WebSocket/SSE/Long-Polling), `alarms.go` (Ticker und Versand), `docsync.go`, `mail.go`, `netguard.go`, `password_reset.go` |
| `internal/storage/` | `sqlite.go` (Store, Schema, Migrationen); Datenlogik nach Bereich: `users.go`, `apikeys.go`, `thoughts.go` (inkl. Alarme), `tasklists.go`, `documents.go`, `folders.go`, `tags.go`, `lists.go`, `teams.go`, `system.go` (Einstellungen, Statistik, Export), dazu `visibility.go`, `docsync.go`, `search.go`, `trash.go`, `backlinks.go`, `recurrence.go` u. a. |
| `internal/domain/` | Strukturen (`models.go`), ID-Erzeugung, Tag-Extraktion |
| `internal/ws/` | `hub.go` |
| `internal/collab/` | Kern der Notiz-Synchronisation ohne Datenbank: Blockbaum, Operationen und Konfliktregeln, Sortierschlüssel, Leases, Long-Poll-Benachrichtigung |
| `internal/auth/` | Tokens und Passwörter |
| `internal/config/` | Umgebungsvariablen |
| `frontend/src/app/` | Rahmen der App um `App.tsx`: Kopfleiste und Seiten-Reiter (`AppHeader.tsx`), Handy-Navigation, Profilmenüs, Quick-Dump-Sheet, Installations-Angebot; Hooks für Sitzung und Zähler (`useSessionBootstrap`), Scroll-Position je Seite, Tastenkürzel der Suche |
| `frontend/src/features/` | `triage`, `workspace`, `lists`, `teams`, `settings` (Bereiche in `settings/user/` und `settings/admin/`), `capture`, `auth`, `help`. Jede große Ansicht ist ein Rahmen aus Teilkomponenten und Hooks; reine Logik liegt in eigenen Modulen mit Tests (z. B. `triage/taskListing.ts`, `workspace/workspaceListing.ts`, `lists/listItems.ts`) |
| `frontend/src/lib/` | `api/` (API-Client: `client.ts` mit Token und `request()`, REST-Aufrufe je Bereich in `auth.ts`, `tasks.ts`, `workspace.ts`, `lists.ts`, `teams.ts`, `admin.ts`, `data.ts`, zusammengesetzt in `rest.ts` als `api`; `realtime.ts` mit Transport-Umschaltung WS/SSE/Long-Polling), `types.ts`, `markdown.tsx`, `theme.ts` |
| `frontend/src/lib/docSync/` | Notiz-Synchronisation im Browser: Portierung von `internal/collab` (`model.ts`, `orderKey.ts`), Vergleich Editor-Liste → Operationen (`diff.ts`), `engine.ts`, IndexedDB (`persist.ts`), HTTP (`transport.ts`) |
| `e2e/` | Browser-Tests mit Playwright gegen einen echten Server (`e2e/run.sh`); Sicherheitsnetz für Umbauten: `e2e/refshots.sh` (Referenz-Screenshots und Abläufe `drag`, `ws`, `lists`) |
| `frontend/src/themes/` | CSS pro Theme |

## Start und Laufzeit

1. `config.Load()` liest die Umgebung (siehe unten).
2. `storage.NewStore()` öffnet SQLite (`busy_timeout`, WAL, max. 8 Verbindungen) und führt `migrate()` aus.
3. SMTP-Werte aus der Umgebung werden in `system_settings` übernommen, sofern dort noch nichts steht.
4. Mit Demo-Flag legt `EnsureDemoAccounts` die Konten `admin/admin` und `user/user` an.
5. `api.NewServer` startet den **Alarm-Ticker** (jede Minute), die **Verdichtung des Notiz-Logs** (beim Start, dann alle 6 Stunden), die **Aufbewahrungsfristen** (2 Minuten nach dem Start, dann stündlich; nicht in der Demo) und baut den Router. Server-Timeouts: Lesen 15 s, Schreiben 30 s, Leerlauf 60 s. Beim Beenden wird sauber heruntergefahren.

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `8080` | HTTP-Port |
| `DATA_DIR` | `./data` (Container: `/data`) | Verzeichnis der Datenbank |
| `DATABASE_URL` | leer | `sqlite:///pfad/datei.db` oder Pfad; ohne Angabe `DATA_DIR/mindsift.db`. Postgres-URLs werden **nicht** unterstützt (siehe Hinweis) |
| `JWT_SECRET` | zufällig erzeugt, gespeichert in `$DATA_DIR/jwt.secret` | Signaturschlüssel der Tokens; bekannte Platzhalter werden ignoriert |
| `TRUSTED_PROXIES` | `private` | Proxys, deren `X-Forwarded-For`/`X-Real-IP` geglaubt wird (`private`, `all`, `none`, CIDR-Liste); `internal/api/clientip.go` |
| `LOGIN_PROTECTION` | `true` | Login-Sperre nach Fehlversuchen und Limits für Registrierung und „Passwort vergessen“ (`internal/api/loginguard.go`), `false` = aus |
| `BASE_URL` | `http://localhost:<PORT>` | Basis-URL der Instanz; explizit gesetzt Voraussetzung für das Passwort-Zurücksetzen per Mail |
| `TZ` | `Europe/Berlin` | Zeitzone für Fälligkeiten und Alarme; die Zeitzonendaten sind ins Binary eingebettet (`time/tzdata`) |
| `REGISTRATION_MODE`, `REGISTRATION_DOMAINS` | leer | Registrierung ohne Einladung (`closed`, `approval`, `domain`, `domain+approval`, `open`) und erlaubte E-Mail-Endungen. Gesetzt gewinnen sie über `system_settings` und sind im Admin-UI gesperrt (`registrationPolicy` in `internal/api/registration.go`). Wartende Konten: `is_active = 0` plus Zeile in `pending_registrations` (Migration 10) |
| `REGISTRATION_VERIFY_EMAIL` | leer | E-Mail-Bestätigung neuer Konten ohne Einladung (nur mit SMTP und `BASE_URL`). Token wie beim Passwort-Link nur als SHA-256 in `email_verifications` (Migration 11), 48 Stunden gültig; danach löscht die Verdichtung das unbestätigte Konto. Bei Freigabe-Modi erfahren Admins erst nach der Bestätigung davon |
| `ALLOW_REGISTRATION` | `false` | `true` = `REGISTRATION_MODE=open`; `false` (Standard der Vorlagen) lässt die Wahl dem Admin-UI |
| `LOG_LEVEL` / `DEBUG` | `info` / `false` | `debug`, `info`, `warn`, `error`; `DEBUG=true` erzwingt `debug` |
| `MINDA_DEMO` (auch `MINDSIFT_DEMO`, `DEMO_MODE`) | `false` | Demo-Konten anlegen. Die Demo verschickt nichts (keine Alarme, Test- oder Hinweismails, Webhooks), Server-Einstellungen sind schreibgeschützt, Passwort, E-Mail und Konten der gemeinsam genutzten Demo-Konten lassen sich nicht ändern (`notInDemo` in `internal/api/demo.go`). Wer auf einem Gerät noch kein Theme gewählt hat, sieht die Demo in Fjord Nacht (rund) statt im eckigen Standard (`DEMO_THEME` in `lib/theme.ts`) |
| `DEMO_RESET_MINUTES` | `20` | Demo-Modus: periodischer Reset auf die Beispieldaten (`0` = aus). Feste IDs der Demo-Konten (`usr_demo_admin`, `usr_demo_user`) halten Sitzungen gültig; laufende Anfragen sperren den Reset (`internal/api/demo.go`, Streams ausgenommen); danach `DEMO_RESET` an alle Verbindungen, `/auth/status` liefert `demoNextReset`/`demoResetInSeconds`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS` | leer / `587` / `true` | Mailversand, auch im Admin-UI einstellbar |
| `SMTP_FROM_NAME` | `MindSift` | Anzeigename des Absenders, wenn `SMTP_FROM` nur eine Adresse ist (`From: "MindSift" <adresse>`, der SMTP-Umschlag bleibt die reine Adresse); ein Name in `SMTP_FROM` hat Vorrang |
| `SMTP_SKIP_VERIFY` | `false` | Zertifikat des Mailservers nicht prüfen (nur interne Server mit selbstsigniertem Zertifikat) |
| `NOTIFY_DIGEST_MINUTES` | `5` | Benachrichtigungen (Freigaben, beobachtete Aufgaben …) werden gesammelt und höchstens alle so viele Minuten gebündelt verschickt |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | – | Schlüsselpaar für Web-Push; ohne Angabe einmal erzeugt und in `push_keys` gespeichert |
| `VAPID_SUBJECT` | `BASE_URL` (wenn https) | Kontakt für die Push-Dienste (`mailto:` oder `https://`) |
| `MEDIA_MAX_IMAGE_MB`, `MEDIA_MAX_AUDIO_MB` | `15` / `50` | Größtes Bild bzw. größte Audiodatei in Notizen in MB |
| `MEDIA_QUOTA_MB` | `0` | Speicherplatz für Medien pro Benutzer in MB (`0` = unbegrenzt) |
| `MEDIA_DEMO_MAX_MB` | `3` | Nur im Demo-Modus: maximale Dateigröße für Medien-Uploads in MB |
| `MCP_ENABLED` | leer | `false` schaltet `/api/v1/mcp` ab (antwortet `404`, auch ohne Anmeldung) und damit OAuth; `true` lässt es fest an. Leer: Schalter „KI-Agenten (MCP) erlauben“ in Administration → Server & Isolation (Standard: an) |
| `RETENTION_ALLOW_NEVER` | leer | `false` verbietet „nie“ bei den Aufbewahrungsfristen (Kontoeinstellungen → Aufbewahrung); wer „nie“ gewählt hatte, bekommt die Voreinstellung des Bereichs. `true` erlaubt es fest. Leer: Schalter in Administration → Server & Isolation (Standard: erlaubt) |
| `STT_URL` | leer | Eigene Spracherkennung: Basis-URL eines OpenAI-kompatiblen Whisper-Servers (z. B. `http://whisper:8000`, speaches). Gesetzt = Server-Modus, sonst Spracherkennung des Browsers; in der Demo immer Browser |
| `STT_MODEL`, `STT_LANGUAGE`, `STT_API_KEY` | `deepdml/faster-whisper-large-v3-turbo-ct2` / `de` / leer | Modell, Sprache (`auto` = erkennen), Schlüssel falls der Whisper-Server einen verlangt |
| `STT_DISABLED` | `false` | `true` blendet die Spracheingabe überall aus |
| `STT_ALLOW_BROWSER` | `true` | `false` verbietet die Spracherkennung des Browsers (Chrome/Edge schicken die Aufnahme an Google/Microsoft). Mit Whisper-Server entfällt dann die Auswahl „Whisper-Server / Browser“ in den Kontoeinstellungen; ohne Whisper-Server (und in der Demo) gibt es dann keine Spracheingabe. Mit `true` wählt jede Person selbst, Standard ist der Whisper-Server. |
| `STT_MAX_SECONDS`, `STT_MAX_UPLOAD_MB` | `600` / `25` | Längste Aufnahme (stoppt im Browser), größte Aufnahme |
| `STT_MAX_PARALLEL`, `STT_PER_USER_PER_HOUR`, `STT_TIMEOUT_SECONDS` | `1` / `60` / `120` | Gleichzeitige Erkennungen (weitere warten), Erkennungen pro Person und Stunde, Höchstdauer inkl. Warten |
| `STT_VAD_FILTER` | `true` | Bittet den Whisper-Server, Stille zu überspringen (`vad_filter`, speaches); weniger erfundene Wiederholungen. `false`, falls ein Server das Feld ablehnt. Unabhängig davon entfernt MindSift eine wörtlich wiederholte Schlusspassage. |
| `LEGAL_IMPRINT_URL`, `LEGAL_PRIVACY_URL` | leer | Impressum/Datenschutz als externer Link (nur `http(s)`) |
| `LEGAL_IMPRINT_CONTENT`, `LEGAL_PRIVACY_CONTENT` | leer | Impressum/Datenschutz als Markdown, angezeigt in einem Lesefenster |
| `LEGAL_IMPRINT_CONTENT_FILE`, `LEGAL_PRIVACY_CONTENT_FILE` | leer | Pfad zu einer Datei im Container mit Markdown-Inhalt für Impressum bzw. Datenschutz. Ohne URL und Text bleibt der Link unsichtbar. |
| `LEGAL_CUSTOM_LINK_LABEL`, `LEGAL_CUSTOM_LINK_URL` | leer | Eigener Link im globalen Desktop-Footer (nur `https://`, sonst ignoriert) |

Hinweis: `DATABASE_URL` mit `postgres…` führt dazu, dass der Standardpfad in `DATA_DIR` genutzt wird; Postgres ist nicht implementiert.

## Authentifizierung

- **Login** mit E-Mail, Benutzername (aus dem E-Mail-Präfix) oder `login`. Passwörter: bcrypt (`DefaultCost`).
- **Login-Sperre:** Fehlversuche zählen im Speicher in drei Töpfen: Konto + Adresse (3), Konto (20), Adresse (30), je innerhalb von 15 Minuten; ist einer voll, gibt es 15 Minuten lang `429` mit `Retry-After`. Unbekannte Namen zählen wie Konten (kein Erraten, welche existieren). Erfolg leert die Kontotöpfe, ein Passwort-Reset (Mail oder Admin) hebt die Sperre auf. Die Client-Adresse kommt nur von vertrauenswürdigen Proxys (`TRUSTED_PROXIES`). Dieselben Töpfe begrenzen pro Adresse Registrierungen (20) und „Passwort vergessen“ (10) je 15 Minuten; hier zählt jede Anfrage.
- **Einladungscodes:** `INV-` plus 100 Zufallsbits in Base32. Die Registrierung beansprucht den Code, bevor das Konto entsteht (kein doppeltes Einlösen).
- **JWT und Sitzungen:** HS256, Claims `userId`, `email`, `displayName`, `tokenVersion`, `jti`. Jede Anmeldung legt eine Zeile in `sessions` an (Gerät, IP, letzte Nutzung); `jti` ist deren ID. Gültig ist ein Token nur, wenn die Sitzung aktiv ist (nicht beendet, höchstens 30 Tage unbenutzt), das Konto aktiv ist und `tokenVersion` mit `users.token_version` übereinstimmt. Ist das Token älter als 24 Stunden, schickt der Server im Header `X-Session-Token` ein neues für dieselbe Sitzung; das Frontend übernimmt es (`request()` in `lib/api/client.ts`). Aktive Geräte bleiben so angemeldet, unbenutzte fallen nach 30 Tagen heraus (`internal/api/sessions.go`). Neue Passwörter brauchen mindestens 8 Zeichen (`auth.ValidatePassword`). `token_version` wird bei Passwortänderung, Rollenwechsel, Deaktivierung und „Alle Sitzungen beenden“ erhöht.
- **Logout** beendet die Sitzung des Geräts; `GET /auth/sessions` listet die Geräte, `DELETE /auth/sessions/{id}` meldet eines ab. Passwort und Login-E-Mail ändern sich nur mit dem aktuellen Passwort (`currentPassword`, falsche Eingaben zählen für die Login-Sperre); ein neues Passwort meldet alle anderen Geräte ab, dieses Gerät erhält per `X-Session-Token` ein neues Token. Ist SMTP eingerichtet, geht eine Hinweismail an die bisherige Adresse.
- **API-Keys:** `mindsift_sec_<hex>`, gespeichert als SHA-256, nur das Präfix bleibt sichtbar. Der Key gilt als Bearer-Token oder in `X-API-Key`. Scopes `webhook:*` liefern Daten an (`POST /inbox`, `POST /webhooks/ingest`), die Agenten-Scopes `tasks:read`, `tasks:write`, `lists:read`, `lists:write` gelten nur am MCP-Endpunkt (`POST /mcp`, `internal/api/mcp.go`); jedes Werkzeug prüft seinen Scope, `tools/list` zeigt nur erlaubte. Alle anderen Endpunkte antworten für Keys mit `403`. Notizen erreichen Keys nur über MCP (`notes:read`: auflisten, lesen, suchen; `notes:create`: neue anlegen, Inhalt als Markdown über `MarkdownToBlocks`; `notes:write`: Punkte ändern über die Operationen der Notiz-Synchronisation, `internal/api/mcp_write.go`, ein von jemandem bearbeiteter Punkt bleibt unberührt), nie per REST. Ebenso nur über MCP: `inbox:read` (offene Inbox-Einträge) und `inbox:write` (umwandeln oder verwerfen über `UpdateThoughtTriage`, nur für Einträge mit Status `inbox`).
- **OAuth für MCP** (`internal/api/oauth.go`, `internal/storage/oauth.go`): MindSift ist mit `BASE_URL` sein eigener OAuth-Server für `/api/v1/mcp` (Discovery nach RFC 9728/8414, dynamische Registrierung, Code-Flow mit PKCE S256, rotierende Refresh-Tokens), damit sich claude.ai und ChatGPT verbinden können. Die Zustimmungsseite ist Teil der App (`/oauth/authorize`, `OAuthConsentView`), weil die Anmeldung im `localStorage` liegt. Eine Zustimmung wird ein Eintrag in `api_keys` (`kind = 'oauth'`); Tokens (`mindsift_oat_`/`mindsift_ort_`) hängen daran und gelten nur am MCP-Endpunkt, Rechte und Herkunft laufen wie bei Schlüsseln. Abgelaufene Tokens und unbenutzte Verbindungen (`OAUTH_IDLE_DAYS`) räumt der stündliche Aufräum-Lauf weg. Im Demo-Modus aus, ebenso wenn MCP abgeschaltet ist (`MCP_ENABLED` bzw. Admin-Schalter).
- **Passwort vergessen:** nur wenn SMTP und `BASE_URL` gesetzt sind (nicht im Demo-Modus; `passwordReset` in `/auth/status`). `POST /auth/forgot-password` antwortet immer gleich und verschickt die Mail im Hintergrund, höchstens alle 2 Minuten pro Konto. Der Link `BASE_URL/?resetToken=…` gilt eine Stunde und einmal; gespeichert wird nur der SHA-256-Hash (`password_reset_tokens`). `POST /auth/reset-password` setzt das Passwort, entwertet alle offenen Links des Kontos und erhöht `token_version` (alle Sitzungen enden). Die App entfernt den Token sofort aus der Adresszeile.
- **Registrierung:** nur mit Einladungscode oder wenn `allow_registration` aktiv ist. Das erste Konto entsteht über `/auth/setup` und wird Administrator.

## Medien in Notizen

Bilder und Audio liegen in `$DATA_DIR/media/<docId>/<id>.<ext>`, beschrieben in der Tabelle `media` (Migration 5, `internal/storage/media.go`). Ein Block verweist über seinen Inhalt darauf, z. B. Typ `image` mit `![Beschriftung](media:med_…)`; damit laufen Verweise ohne Änderung am Sync-Modell durch Synchronisation, Rückgängig und Konflikte. Hochladen (`POST /documents/{id}/media`) braucht Schreibrecht auf die Notiz, Lesen (`GET /media/{id}`) Leserecht auf die Notiz der Datei oder auf eine Notiz, deren Blöcke sie zeigen (kopierte Blöcke). Das Format wird am Inhalt erkannt (JPEG, PNG, GIF, WebP; WebM, Ogg, MP3, WAV, M4A), SVG und alles andere wird abgelehnt; Antworten tragen eine eigene CSP mit `sandbox`. Externe Bilder kopiert der Server einmal (`POST /documents/{id}/media/fetch`, nur https und öffentliche Adressen wie bei Webhooks, nicht in der Demo). Grenzen: `MEDIA_MAX_IMAGE_MB`, `MEDIA_MAX_AUDIO_MB`, `MEDIA_QUOTA_MB`, in der Demo `MEDIA_DEMO_MAX_MB`. Backup-ZIP (`media/<id><ext>`) und Markdown-Archiv (`attachments/`, Einbettung `![Beschriftung](../attachments/…)` relativ zur Notiz) enthalten die Dateien der eigenen Notizen; beim Import bekommen sie neue IDs. Der Obsidian-Import übernimmt Bilder und Audio, die eine Notiz allein in einem Punkt einbettet (`![[datei.png]]` oder `![](pfad/datei.png)`); andere Dateien erscheinen in der Vorschau als übersprungen. Die Verdichtung (alle 6 Stunden) löscht Dateien, die kein Block mehr erwähnt (auch keine gelöschten im Papierkorb oder Protokoll), frühestens einen Tag nach dem Hochladen. Der Demo-Reset leert `media/`.

## Notizen umbauen

`internal/storage/restructure.go`: **Ast auslagern** liest den Ast und legt die neue Notiz an (Titel eindeutig, gleiche direkte und Gruppen-Freigaben, Besitzer der Ursprungsnotiz bekommt Schreibrecht). Den Ast in der Ursprungsnotiz ersetzt der Editor selbst durch `[[Titel]]` (Hashtags bleiben am Link) – als eigene Änderung über die Sync-Engine, damit sie nicht mit ungesendeten Eingaben kollidiert und Strg+Z sie zurücknimmt; dabei legt `/extract/undo` die neue Notiz in den Papierkorb. **Zusammenführen** hängt die Quelle als `h2`-Überschrift mit ihren Punkten als Unterpunkte an die Zielnotiz an (ebenfalls über Operationen, offene Editoren folgen live) und legt die Quelle in den Papierkorb; „Rückgängig“ löscht die Überschrift samt Unterpunkten und stellt die Quelle wieder her. Die Aktion läuft im Namen des Editor-Clients (`clientId`), damit dessen eigene Block-Sperren nicht stören. Bilder und Aufnahmen funktionieren weiter, weil der Zugriff über die Notizen läuft, die sie zeigen.

## Benachrichtigungen

`internal/api/notify.go`, `internal/storage/notifications.go` (Migration 7). Jede Person wählt pro Ereignisart die Kanäle – eigene E-Mail (Alarm-Adresse, sonst Konto-Adresse) eigener Discord-Webhook, eigener Webhook (`customWebhookUrl`, JSON per POST) und Web-Push an die eigenen Geräte (`internal/api/push.go`, Migration 9, Tabelle `push_subscriptions`; Geräte, die der Push-Dienst nicht mehr kennt (404/410), werden entfernt) –, gespeichert als JSON in `users.notification_settings` (`GET /auth/me`, `PATCH /auth/settings` → `notificationSettings`). Ereignisse: `due` (Fälligkeits-Alarm, sofort über den Alarm-Ticker), `shared` (Notiz, Ordner, Aufgabenliste oder Liste geteilt; bei Gruppen alle Mitglieder), `taskDone` (Aufgabe einer geteilten Liste erledigt), `watched` (jede Änderung an einer beobachteten Aufgabe, `task_watchers`, `POST/DELETE /tasks/{id}/watch`). Alles außer `due` landet in `notification_queue`; ein Job im Minutentakt schickt je Person eine gebündelte Nachricht, sobald das älteste Ereignis `NOTIFY_DIGEST_MINUTES` (Standard 5) alt ist (E-Mail als Text + HTML, Discord als ein Embed mit höchstens 10 Zeilen, eigener Webhook als JSON `{"event":"digest","heading","items":[{"kind","title","text"}],"link","timestamp"}`; fällige Aufgaben gehen dort als `{"event":"task_due",…}` einzeln raus), nach 3 Fehlversuchen wird verworfen. Eigene Änderungen benachrichtigen nie den Handelnden, außer bei beobachteten Aufgaben mit `includeOwnWatched`. `paused` stoppt alles, auch Alarme. **Tageszusammenfassung:** zur gewählten Uhrzeit (Server-Zeitzone, innerhalb von 30 Minuten, einmal pro Tag) überfällige, heutige und morgige offene Aufgaben samt Anzahl der folgenden 7 Tage; nichts fällig → keine Nachricht. Im Demo-Modus laufen die Jobs nicht.

## Link-Vorschau

Punkte mit einer reinen https-Adresse zeigen darüber eine Karte (`LinkPreviewCard`, `lib/linkPreview.ts`). `GET /link-preview?url=` holt die Seite serverseitig mit demselben Schutz wie Webhooks (nur https, keine internen Adressen, Weiterleitungen geprüft), liest `og:*`/`twitter:*`, `<title>`, `description` und das Icon aus dem `<head>` (höchstens 1 MB HTML, Bild 2 MB, Icon 100 KB, kein SVG) und speichert alles in `link_previews` (Migration 6): Erfolg 7 Tage, nichts Brauchbares 1 Tag, nach 30 Tagen gelöscht. Bilder kommen über `GET /link-preview/{key}/image|icon` mit Login. Pro Adresse höchstens 300 Abrufe in 15 Minuten (Antworten aus dem Cache zählen nicht). Ausblenden einer Karte macht aus der Adresse `[Titel](url)` (ein benannter Link hat keine Karte), damit synchronisiert die Wahl mit der Notiz; „Link-Vorschauen anzeigen“ unter Darstellung gilt pro Gerät. Im Demo-Modus aus.

## Spracherkennung

Der Admin richtet sie über Umgebungsvariablen ein (`STT_*`, siehe oben); Administration → Server & Isolation zeigt den aktiven Modus, den Zustand des Whisper-Servers und bietet eine Testaufnahme. Mit Whisper-Server wählt jede Person unter Kontoeinstellungen → Spracheingabe zwischen Whisper (Standard) und der Erkennung des Browsers (`users.voice_input`), sofern `STT_ALLOW_BROWSER` das nicht verbietet; `/auth/status` meldet dazu `voice.browserAllowed`, die App wendet die Wahl in `lib/voice.ts` an. Alle Mikrofon-Knöpfe (Quick-Dump-Leiste, mobiles Erfassen-Sheet, Halten des +-Knopfs) nutzen denselben Hook `useVoiceInput` (`frontend/src/lib/voice.ts`, `useVoiceInput.ts`): `server` nimmt auf und zeigt „Wird erkannt…“ (Quick Dump, Erfassen-Sheet und Halte-Knopf schicken die Aufnahme schon beim Sprechen in Stücken, wie das Diktat), `browser` liefert Text schon beim Sprechen und endet nach 5 s Stille, `off` oder ein Browser ohne die nötige Funktion blendet das Mikrofon aus. Im Server-Modus zeigen Wellen den echten Mikrofonpegel (`VoiceWave`), die Aufnahme endet spätestens nach `STT_MAX_SECONDS`. Der Browser nimmt per `MediaRecorder` auf (WebM/Opus, in Safari MP4/AAC) und schickt die Aufnahme an `POST /voice/transcribe`; MindSift reicht sie an `STT_URL/v1/audio/transcriptions` weiter (`model`, `language`) und gibt nur den Text zurück. Nichts wird gespeichert oder protokolliert außer Fehlern (`internal/api/voice.go`). Beim Start wartet MindSift auf den Whisper-Server und stößt den Download des Modells an, falls es fehlt (`POST /v1/models/<id>` bei speaches).

`docker-compose.yml` enthält den Dienst `whisper` (speaches 0.8.3, CPU) als auskommentierten Block: Rauten entfernen, `STT_URL=http://whisper:8000` in `.env` setzen, `docker compose up -d`; das Modell liegt in `./whisper` (Ordner gehört UID 1000). Gemessen auf einem Desktop mit 16 Kernen (int8) für einen Satz von 4 s: `Systran/faster-whisper-small` 1,6 s, `deepdml/faster-whisper-large-v3-turbo-ct2` 8 s bei besserer Erkennung (RAM ca. 1 bzw. 2 GB). Auf geteilten vCPUs ist mit dem Mehrfachen zu rechnen.

## Hintergrundjob: Alarme

`startAlarmTicker` prüft jede Minute alle offenen, noch nicht gemeldeten Aufgaben mit Fälligkeit. Ist der Alarmzeitpunkt erreicht (Fälligkeit mit Uhrzeit bzw. 9:00 bei ganztägigen Aufgaben, minus Vorlaufzeit des Benutzers, Zeitzone `TZ`), sendet er über die Kanäle des Benutzers (`email`, `discord`, `webhook`) und setzt `alarm_sent`, sobald mindestens ein Kanal erfolgreich war. Nach 3 Durchläufen ohne Erfolg gibt er auf (`alarm_failures`). Details und Einschränkungen: [modules/tasks.md](modules/tasks.md).

## Hintergrundjob: Verdichtung der Notiz-Synchronisation

`startCompaction` räumt beim Start und dann alle 6 Stunden auf: abgelaufene Leases und Sitzungen im Speicher, Log-Einträge älter als 30 Tage (private Notizen: 7 Tage), Grabsteine älter als 30 Tage und Idempotenz-Ergebnisse älter als 90 Tage. Details: [database.md](database.md#verdichtung-des-notiz-logs).

## Build

```
Stage 1  node:22-alpine   tsc, vitest, vite build            → frontend/dist
Stage 2  golang:1.23      go vet, go test, go build          → /app/mindsift (dist wird eingebettet)
Stage 3  alpine:3.21      nur Binary, ca-certificates, tzdata
```

**Image-Tags (CI):** Push auf `dev` → `:dev`; Push/Merge auf `main` → `:latest`; Git-Tag `v*` (z. B. `v1.2.0`) → `:v1.2.0` und `:stable`; Vorabversionen (`v1.2.0-rc.1`) nur `:v1.2.0-rc.1`, `:stable` bleibt. Andere Branches bauen nicht.

**Versionierung:** Ab v0.6.0 nach [Semantic Versioning](https://semver.org/spec/v2.0.0.html): `MAJOR.MINOR.PATCH`, Tags dreiteilig mit `v` (`v0.6.0`, `v1.0.0-rc.1`). Solange die Hauptversion 0 ist, erhöhen inkompatible Änderungen (API, Datenformate, Konfiguration) die mittlere Stelle, Fehlerbehebungen die letzte. Jede Änderung, die Benutzer oder Betreiber betrifft, kommt in [CHANGELOG.md](../CHANGELOG.md) unter „Unreleased“ (Format [Keep a Changelog](https://keepachangelog.com/de/1.1.0/)); beim Release wird der Abschnitt zur Version mit Datum, `frontend/package.json` bekommt die Versionsnummer.

Die angezeigte Version (Kopf der App) setzt der Build-Parameter `APP_VERSION`: Die CI übergibt bei Git-Tags den Tag-Namen (`v0.6.0`), sonst zeigt die App die Version aus `frontend/package.json` mit `-dev` (`v0.6.0-dev`). Umgesetzt in `frontend/vite.config.ts` und `frontend/src/version.ts`.

Die Tests laufen beim Image-Build (Frontend: `npm run test:run`, Backend: `go test -v ./...`); ein Fehler bricht den Build ab. Frontend-Tests liegen unter `frontend/src/**/__tests__/` (Vitest + jsdom + Testing Library, Setup in `frontend/src/test/setup.ts`).

## Hintergrundjob: Backups

[backups.go](../internal/api/backups.go) / [backup.go](../internal/storage/backup.go): Ist „Automatische Backups“ in den Admin-Einstellungen an, läuft einmal täglich zur eingestellten Uhrzeit (`backup_time`, Zeitzone `TZ`; nach einem Neustart wird ein verpasster Lauf am selben Tag nachgeholt):
- `backups/system/mindsift-db-JJJJ-MM-TT-HHMM.db.gz`: Abzug der ganzen Datenbank per `VACUUM INTO` (stimmig, auch während geschrieben wird), gzip.
- `backups/users/<id>/mindsift-backup-….zip`: dasselbe ZIP wie „Backup herunterladen“ für jedes aktive Konto, mit den Bildern und Aufnahmen der eigenen Notizen unter `media/`.
- **Achtung:** Der Datenbank-Abzug enthält keine Mediendateien. Wer den Server sichert, sichert den ganzen Ordner `data/` (Datenbank, `media/`, `backups/`).
- Danach werden Dateien älter als `backup_retention_days` (Standard 3) gelöscht. Dateien entstehen über `.part` und Umbenennen, halbe Backups tauchen nie in der Liste auf. Die API liefert nur Dateien mit genau diesem Namensmuster aus.
- Im Demo-Modus läuft kein Zeitplan. Zurückspielen eines Datenbank-Abzugs: Container stoppen, `mindsift.db` durch die entpackte Datei ersetzen, starten. Benutzer spielen ihre eigenen Backups in den Kontoeinstellungen ein, auch nur für einzelne Bereiche (Notizen, Aufgaben, Listen, Inbox, Themes).

## Hintergrundjob: Aufbewahrung

[retention.go](../internal/storage/retention.go), gestartet in `internal/api/done_cleanup.go`: Jede Person wählt unter Kontoeinstellungen → Aufbewahrung je Bereich 7, 14, 30, 90, 365 oder 730 Tage oder nie. Stündlich wandern erledigte Aufgaben nach Ablauf in den Papierkorb der Aufgaben (`trashed_tasks`); der Papierkorb der Aufgaben, der Triage (verworfene Gedanken), der Notizen und abgehakte Listeneinträge werden nach Ablauf endgültig geleert. In geteilten Aufgabenlisten, Listen und Notizen gilt die Frist des Eigentümers. Was beim Einführen schon erledigt oder gelöscht war, zählt ab diesem Zeitpunkt (`system_settings.retention_since`). Mit `RETENTION_ALLOW_NEVER=false` (oder dem Schalter „Dauerhaftes Aufbewahren erlauben“ in Administration → Server & Isolation) gibt es „nie“ nicht; gespeichertes „nie“ gilt dann als Voreinstellung des Bereichs.

## Offline (PWA)

- **Service Worker** ([public/sw.js](../frontend/public/sw.js)): Seitenaufrufe Network-First mit der zuletzt geladenen `index.html` als Rückfall, Bundles unter `/assets/` (Hash im Namen) aus dem Cache, Icons und Manifest Stale-While-Revalidate. API-Anfragen fasst er nie an. Alte Caches verschwinden beim Aktivieren einer neuen `VERSION`, Bundles sind auf 80 Einträge begrenzt.
- **Lese-Cache** ([lib/offline.ts](../frontend/src/lib/offline.ts)): Jede erfolgreiche GET-Antwort landet pro Benutzer in IndexedDB (`mindsift-offline`). Ohne Verbindung liefert `request()` die letzte bekannte Antwort; so startet die App offline angemeldet und zeigt Gedanken, Aufgaben und Listen. Ausgenommen: Streams, Long-Polling, Notiz-Sync (eigener Speicher, [modules/collaboration.md](modules/collaboration.md)), Export, Suche. Abmelden leert Cache und Warteschlange.
- **Warteschlange (Outbox):** Offline erfasste Gedanken (`POST /inbox`) und abgehakte Aufgaben bzw. Listeneinträge (`PATCH`) werden in `localStorage` gesammelt, wiederholtes Umschalten zählt nur mit dem Endstand. Gesendet wird in Reihenfolge beim `online`-Ereignis, beim Start und alle 30 s, solange etwas wartet; vom Server abgelehnte Einträge (4xx) entfallen. Andere Änderungen brauchen weiterhin eine Verbindung.
- **Neue Version:** Jeder Build legt `version.json` (Version und Build-Kennung) neben `index.html`, nie gecacht. Die App vergleicht sie mit ihrer eigenen Kennung beim Zurückkehren in Tab oder App, alle 15 Minuten und nach einem Neustart des Servers (Echtzeit-Verbindung wieder da) und zeigt dann „Neue Version verfügbar“ mit „Jetzt aktualisieren“ ([lib/useUpdateCheck.ts](../frontend/src/lib/useUpdateCheck.ts)).
- **Zustand pro Tab:** Der offene Bereich (Triage, Workspace, Aufgaben …), die offene Notiz und die gewählte Liste stehen in `sessionStorage` ([lib/viewSession.ts](../frontend/src/lib/viewSession.ts)) und bleiben beim Neuladen erhalten.
- **Hinweis:** Ein Banner über der unteren Navigation zeigt „Offline“ und die Zahl wartender Änderungen bzw. „Synchronisiere…“.
- **Verbindungsstatus im Kopf** ([lib/useConnectionState.ts](../frontend/src/lib/useConnectionState.ts)): Maßgeblich ist die app-weite Echtzeit-Verbindung, nicht `navigator.onLine`; so fällt auch ein ausgefallener Server auf. WebSocket oder SSE: **online**. Nur Long-Polling (Proxy, der SSE puffert): **eingeschränkt**, Änderungen kommen leicht verzögert. Fehlt jede Verbindung länger als 4 s (Start, kurze Reconnects überbrückt), fragt die App `/api/v1/health` (danach alle 15 s): Antwortet der Server, gilt ebenfalls **eingeschränkt**, sonst **offline**. Ohne Gerätenetz sofort offline. Anzeige als Punkt grün/gelb/rot: Desktop mit Text unter dem Namen, Handy am Profilbild.

## App-Icons, PWA & Social-Preview (Open Graph)

MindSift verwendet plattformübergreifend ein einheitliches App-Icon-Design, das exakt dem Icon im Kopfbereich der mobilen App entspricht:
- **Design & Geometrie:** Sanft abgerundetes Quadrat (`rx=108` auf 512x512 Canvas bzw. `rounded-xl`), Primärblau (`--accent-primary: #2563eb`) als Hintergrund und zentriertes Lucide Brain Icon in reinem Weiß (`--text-on-accent: #ffffff`).

### Asset-Matrix (`frontend/public/`)

| Datei | Zweck & Zielplattform | Besonderheit |
|---|---|---|
| `icon.svg` | Modernes Standard-Icon & SVG-Favicon | Vektor-Original mit abgerundeten Ecken |
| `icon-192x192.png`, `icon-512x512.png` | PWA-Installation (`purpose: "any"`), Desktop Linux/Windows | Erforderlich für Chromium unter Linux (erzeugt sonst kein `.desktop`-Icon) |
| `icon-maskable-192x192.png`, `icon-maskable-512x512.png`, `icon-maskable.svg` | Android Adaptive Icons (`purpose: "maskable"`) | Full-Bleed Hintergrund (`#2563eb`) ohne transparente Ecken, Brain im 80%-Sicherheitsbereich |
| `apple-touch-icon.png` (180x180) | iOS Safari („Zum Home-Bildschirm“) | Opaker Hintergrund verhindert schwarze Ränder beim automatischen Apple-Squircle-Maskieren |
| `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png` | Browser-Tabs, Lesezeichen, Chronik | Multi-Resolution-ICO (16/32/48) für alle Desktop-Browser |
| `og-image.png` (1200x630), `og-image-square.png` (512x512) | Link-Vorschau in WhatsApp, Discord, Telegram, X/Twitter | Dunkler `#0b0f19`-Hintergrund mit Icon & Claim; Datei-Größe < 120 KB (WhatsApp-Limit < 300 KB) |

### Dynamische OpenGraph-URL-Injektion

Messenger-Crawler (insbesondere WhatsApp) werten relative Bild-URLs in `og:image` oft nicht korrekt aus. Der Go-SPA-Handler in [`internal/api/server.go`](../internal/api/server.go) ersetzt beim Ausliefern von `index.html` automatisch relative Pfade (`/og-image.png`, `og:url`) durch die absolute Server-Origin (`scheme://host`), ermittelt über `X-Forwarded-Proto` und `X-Forwarded-Host` bzw. `req.Host`.
