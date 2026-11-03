<div align="center">

# 🧠 MindSift
### *Der Kopf frei in drei Sekunden.*

[![Self-Hosted](https://img.shields.io/badge/100%25-Self--Hosted-2563eb?style=flat-square)](#)
[![Docker](https://img.shields.io/badge/Deployment-Single%20Container-2496ed?style=flat-square&logo=docker&logoColor=white)](#-schnellstart)
[![SQLite](https://img.shields.io/badge/Daten-SQLite-003b57?style=flat-square&logo=sqlite&logoColor=white)](#-deine-daten-gehören-dir)
[![Version](https://img.shields.io/badge/Version-v0.74.1-16a34a?style=flat-square)](CHANGELOG.md)

**MindSift** ist eine selbst gehostete Schaltstelle für spontane Gedanken, Aufgaben mit Kanban-Board, hierarchische Outliner-Notizen, die mehrere Personen gleichzeitig bearbeiten können, und gemeinsame Listen. Alles läuft als ein einzelner Container mit eingebetteter SQLite-Datenbank, auf deinem eigenen Server.

<p align="center">
  <img src="screenshots/Triage_desktop.webp" alt="MindSift Triage am Desktop, links hell, rechts dunkel" width="85%" />
</p>

<sub>Links das helle, rechts das dunkle Theme.</sub>

[Live-Demo](https://demo.mindsift.app) • [Philosophie](#-die-philosophie) • [Funktionen](#-funktionen) • [Schnellstart](#-schnellstart) • [Betrieb](#-betrieb--konfiguration) • [Entwicklung](#-entwicklung) • [Dokumentation](#-dokumentation)

</div>

---

## 💡 Die Philosophie

Die meisten Notiz- und Aufgaben-Apps verlangen Struktur im falschen Moment: Wenn dir ein Gedanke kommt, willst du keinen Ordner suchen und keine Felder ausfüllen. MindSift trennt deshalb **Erfassen** und **Organisieren**:

1. **Abladen:** In die Eingabeleiste tippen, `Enter`, fertig. Wer will, weist den Gedanken gleich einer Aufgabe, Liste oder Notiz zu.
2. **Sichten (Triage):** Später gehst du den Stapel Karte für Karte durch: verwerfen, zur Aufgabe machen, in eine Notiz oder Liste verwandeln.
3. **Vertiefen:** Aus losen Ideen werden Aufgaben mit Unteraufgaben, vernetzte Outliner-Notizen oder geteilte Listen für Familie und Team.

---

## ✨ Funktionen

### ⚡ Schnellerfassung & Triage

* Eingabeleiste im Kopf der App, jederzeit mit `C` oder `/` fokussierbar; auch per Spracheingabe: über den Browser oder datenschutzfreundlich über einen eigenen Whisper-Container (optional in `docker-compose.yml`, siehe [Architektur](Doku/architecture.md#spracherkennung)); auf Smartphones auch per Gedrückthalten des `+`-Knopfs (Hold-to-Record mit Pegel-Wellen).
* Ziel beim Erfassen wählbar: Posteingang, Aufgabe (mit Aufgabenliste), Listeneintrag oder Notiz; die Wahl bleibt für die nächsten Einträge stehen. Mit eigenem Whisper-Server erscheint der Text schon beim Sprechen; jede Person wählt selbst, ob ihr Mikrofon Whisper oder die Erkennung des Browsers nutzt.
* **Triage-Deck:** `H`/`←` verwerfen, `L`/`→` zur Aufgabe, `T` Aufgabe mit Termin, `D` in Notiz verwandeln, Leertaste = später. Auf dem Smartphone per Wischgeste oder über große Knöpfe unter der Karte; die Warteschlange klappt bei Bedarf auf.
* **Teilen aus anderen Apps:** Als installierte App erscheint MindSift im Teilen-Menü des Smartphones; geteilte Texte und Links landen im Posteingang und lassen sich direkt danach mit einem Tipp zur Aufgabe oder auf eine Liste schicken.
* Papierkörbe mit Wiederherstellen für verworfene Gedanken, gelöschte Aufgaben und Notizen; unter Kontoeinstellungen → Aufbewahrung legt jede Person fest, nach wie vielen Tagen Erledigtes und Gelöschtes aufgeräumt wird.

<p align="center">
  <img src="screenshots/Mobile_Triage.webp" alt="MindSift Triage am Smartphone, helles Theme" width="280px" />
  &nbsp;&nbsp;
  <img src="screenshots/Mobile_Workspace.webp" alt="MindSift Notiz am Smartphone, dunkles Theme" width="280px" />
</p>

### ✅ Aufgaben & Kanban

* Listen- und Kanban-Ansicht, Spalten pro Aufgabenliste frei konfigurierbar (Name, Farbe, Erledigt-Spalte). „Alle Aufgaben“ führt die Spalten aller Listen nach Namen zu einem Board zusammen.
* Prioritäten, Fälligkeitsdatum, Hashtags, Unteraufgaben mit Fortschrittsbalken, Markdown-Notizen.
* Filter, Gruppierung und Sortierung; Drag & Drop in Liste und Board, auch auf den Reiter einer anderen Aufgabenliste. `Strg+Z` nimmt Löschen, Verschieben und Abhaken zurück.
* **Papierkorb und Aufbewahrung:** Gelöschte und aufgeräumte Aufgaben lassen sich aus dem Papierkorb zurückholen; erledigte Aufgaben wandern nach einer selbst gewählten Frist (Standard 30 Tage) dorthin.
* **Aufgabenlisten teilen** mit Benutzern oder Gruppen, wahlweise als **Bearbeiter** oder **nur lesend**.
* **Aufgaben beobachten:** Beliebige Aufgaben per Klick abonnieren, um über alle Änderungen informiert zu werden.
* **Wiederholungen:** Wiederkehrende Aufgaben (täglich, wöchentlich, monatlich, jährlich) mit automatischer Folgeaufgabe beim Abhaken.
* **Tageszusammenfassung:** Tägliche Übersicht fälliger Aufgaben zur selbst gewählten Uhrzeit per E-Mail, Discord, eigenem Webhook oder Push.
* **Push-Benachrichtigungen** auf Handy und Desktop (auch bei geschlossener App; iPhone/iPad als Home-Bildschirm-App), als eigener Kanal je Ereignis.
* **Alarme & Benachrichtigungen:** Fälligkeits-Alarme sofort, alle übrigen Ereignisse (Freigaben, erledigte geteilte Aufgaben, beobachtete Aufgaben) gebündelt; pro Ereignis wählbar über E-Mail, Discord, eigenen Webhook und Push.

<p align="center">
  <img src="screenshots/aufgaben_desktop.webp" alt="MindSift Aufgaben und Kanban-Board" width="90%" />
</p>

### 📝 Workspace: Outliner-Notizen

* Jeder Gedanke ein Bullet: `Enter`, `Tab`/`Shift+Tab`, Ein-/Ausklappen, Drag & Drop ganzer Äste; am Handy eine Leiste über der Tastatur zum Ein-/Ausrücken und Verschieben. Text lässt sich mit der Maus über mehrere Punkte markieren und wie in einem Texteditor löschen, ersetzen oder kopieren.
* **Zoom-Fokus** per Klick auf den Bullet, Breadcrumbs zum Zurücknavigieren; **Fokus-Modus** (`Strg+Umschalt+F`) zeigt nur die Notiz in Lesebreite, Ordner gleiten bei Bedarf von links herein, Ordnerleiste und obere Leiste lassen sich anpinnen. Am Desktop schiebt Scrollen im Hintergrund (neben der Notiz) die Leiste mit Notizen, To-Dos und Hashtags nach oben heraus.
* **Journal:** eine Notiz pro Tag, alle Tage untereinander (heute oben, ältere laden beim Scrollen nach), mit Kalender zum Springen; einzelne Tage lassen sich teilen. Pro Gerät abschaltbar.
* Blocktypen und Slash-Befehle: `/todo`, `/number` (nummerierte Liste: 1., a., i.), `/link`, `/h1`–`/h3`, `/code` (mit Syntax-Hervorhebung), `/callout`, `/divider`, `/extract`, `/image`, `/audio`, `/diktat`.
* **Bilder & Audio in Notizen:** `/image` (Datei, Kamera, Zwischenablage oder Link), `/audio` (Sprachnotiz oder Datei-Upload) und `/diktat` (Live-Transkription).
* **Link-Vorschau:** Vorschaukarte (Titel, Beschreibung, Bild) für Punkte, die nur aus einer Web-Adresse bestehen, z. B. über `/link`; die Seite ruft der Server ab, nicht dein Browser. Pro Gerät abschaltbar.
* **Ast auslagern & Notizen zusammenführen:** Bulletpoints samt Unterbaum in eigenständige Notizen auslagern (`/extract`) oder Notizen per Drag & Drop bzw. Menü zusammenführen (jeweils mit vollständiger Rückgängig-Funktion).
* Wiki-Links `[[Notiz]]`, auch auf **einzelne Punkte** (`[[Notiz#^id|Text]]`, kopierbar an jedem Punkt), Links und `#Hashtags`; Tag-Seiten bündeln alle Fundstellen.
* **Globale Suche** (`Strg+K`) über Notizen, einzelne Punkte, Aufgaben und Listen: Filter nach Art per Klick oder `Tab`, Aufgaben und Einträge direkt abhaken; die große Ansicht filtert zusätzlich nach Status, Liste, Priorität, Fälligkeit oder Ordner und zeigt den Zusammenhang jedes Treffers.
* Ordner, Favoriten, **To-Do-Rollup** über alle Notizen und Export einer Notiz als `.md`. Mehrere Notizen mit `Strg`/`Shift`+Klick markieren und gemeinsam in einen Ordner oder auf den Papierkorb ziehen. Notizen und Listen bekommen ein Emoji als Symbol, oder keins.
* **Aufgaben aus Notizen:** Ein Häkchen lässt sich zur Aufgabe erweitern (und eine Aufgabe zur Notiz vertiefen); Haken, Titel und Unteraufgaben bleiben in beide Richtungen abgeglichen.
* Eingefügtes Markdown wird zur Gliederung: Überschriften werden zu Abschnitten mit eingerücktem Inhalt, Listen (auch nummeriert) behalten ihre Ebenen, Absätze werden eigene Punkte. Kürzel beim Tippen: `- `, `1. `, `[] `, `# `, `Strg+B`/`I`/`K`. `Strg+Z` / `Strg+Umschalt+Z` nimmt eigene Änderungen zurück bzw. stellt sie wieder her.
* **Teilen:** Notizen und ganze Ordner lassen sich Benutzern oder Gruppen als **Bearbeiter** oder **Leser** freigeben. Empfänger sortieren sie in ihren eigenen Baum ein.

#### 🤝 Gemeinsam bearbeiten

* **Live:** Mehrere Personen schreiben gleichzeitig in derselben Notiz; Änderungen erscheinen bei den anderen in Bruchteilen einer Sekunde. Die Leiste über der Notiz zeigt, wer gerade mitliest.
* **Kein Überschreiben:** Wer in einem Bullet schreibt, hält ihn kurz für sich; andere sehen ein Schloss mit Namen und arbeiten in den übrigen Bullets weiter. Kommt es doch zu einem Konflikt (z. B. nach Offline-Arbeit), bleibt der zweite Text als markierte Kopie mit „Übernehmen“/„Verwerfen“ erhalten.
* **Offline-fest:** Jede Eingabe wird zuerst im Browser gesichert und später übertragen, auch nach Neuladen oder Tagen ohne Netz.
* **Hinter strengen Proxys:** WebSocket → SSE → Long-Polling → Abfrage alle 3 s; MindSift wählt automatisch, was durchkommt. Der aktive Weg steht in der Leiste über der Notiz („Live“, „Abgleich alle 3 s“).

Technik dahinter: [Doku/modules/collaboration.md](Doku/modules/collaboration.md).

<p align="center">
  <img src="screenshots/workspace_desktop.webp" alt="MindSift Workspace: zwei Personen in derselben Notiz" width="90%" />
</p>

<p align="center">
  <img src="screenshots/journal_desktop.webp" alt="MindSift Journal mit Kalender" width="90%" />
</p>

### 🛒 Geteilte Listen

* Einkaufs-, Pack- und Checklisten mit Kategorien per Hashtag (`Hafermilch #Kühlregal`), Mengenangaben und Drag & Drop zwischen Kategorien oder in eine andere Liste. Abgehakte Einträge verschwinden nach einer wählbaren Frist (Standard 7 Tage) von selbst.
* Freigabe an Benutzer und Gruppen (Bearbeiter oder Leser); abgehakte Einträge erscheinen bei allen in Echtzeit.

<p align="center">
  <img src="screenshots/Listen_desktop.webp" alt="MindSift Geteilte Listen" width="90%" />
</p>

### 🏢 Benutzer, Gruppen, Administration

* Geführte Ersteinrichtung, Rollen *Admin* und *Mitglied*. Einladungen als Code oder Link (auch für mehrere Personen, auf Wunsch per E-Mail verschickt). Registrierung ohne Einladung wahlweise geschlossen, mit Freigabe durch einen Admin, nur für bestimmte E-Mail-Endungen oder offen, auf Wunsch mit Bestätigung der E-Mail-Adresse per Link – auch fest per Umgebungsvariable.
* Gruppen mit Gruppen-Admins für Freigaben.
* Admin-Bereich: Benutzer, Einladungen, Instanzname, SMTP, Freigabe-Modus, Sicherungen, Spracherkennung, ob „dauerhaft aufbewahren“ erlaubt ist.

### 🎨 Darstellung & App

* **Fünf Farbfamilien** mit je einer hellen und dunklen Variante: Klassik, Fjord, Terrakotta, Polarized, Suri. Hell/Dunkel auf Wunsch „Wie System“, dazu eine eigene Akzentfarbe, Ecken rund oder eckig und Knöpfe mit oder ohne Rahmen (pro Gerät). Für eigene Themes gibt es einen Theme-Manager (eine CSS-Datei).
* **Installierbar als App (PWA)** auf Smartphone und Desktop. Nach einem Server-Update meldet die offene App „Neue Version verfügbar“ und lädt auf Wunsch neu; beim Neuladen bleibt der zuletzt offene Bereich offen. Sie startet auch ohne Netz mit dem zuletzt geladenen Stand; offline erfasste Gedanken und abgehakte Aufgaben oder Listeneinträge werden nachgereicht, sobald die Verbindung wieder da ist.

<table>
  <tr>
    <td align="center"><img src="screenshots/Theme_fjord.webp" alt="Farbfamilie Fjord, links hell, rechts dunkel" /><br /><sub><b>Fjord</b></sub></td>
    <td align="center"><img src="screenshots/Theme_terracotta.webp" alt="Farbfamilie Terrakotta, links hell, rechts dunkel" /><br /><sub><b>Terrakotta</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="screenshots/Theme_polarized.webp" alt="Farbfamilie Polarized, links hell, rechts dunkel" /><br /><sub><b>Polarized</b></sub></td>
    <td align="center"><img src="screenshots/Theme_suri.webp" alt="Farbfamilie Suri, links hell, rechts dunkel" /><br /><sub><b>Suri</b></sub></td>
  </tr>
</table>

### 🔌 Integrationen

* **API mit Schlüsseln:** Pro Schlüssel schaltbare Rechte (Aufgaben und Listen lesen, anlegen, ändern; Inbox füllen), gleich für beide Zugänge. Notizen und Einstellungen bleiben außen vor.
  * **curl / Smart Home:** z. B. `GET /api/v1/tasks?due=today&status=open` für einen Home-Assistant-Sensor „Heute fällig“, abhaken per `PATCH`, Gedanken, Aufgaben und Listeneinträge einliefern per `POST /api/v1/webhooks/ingest`.
  * **KI-Agenten (MCP):** MindSift ist ein MCP-Server (`POST /api/v1/mcp`, Streamable HTTP). Claude Code, OpenAI Codex, Claude Desktop, Cursor und eigene Agenten lesen, legen an, ändern, haken ab und löschen Aufgaben, legen Aufgabenlisten und Listen an und führen Einkaufs- und Checklisten. `claude mcp add --transport http mindsift https://…/api/v1/mcp --header "X-API-Key: mindsift_sec_…"`. **claude.ai und ChatGPT** verbinden sich ohne Schlüssel per OAuth: Adresse als Connector eintragen, in MindSift anmelden und die Rechte wählen (braucht `BASE_URL`).
  * **Herkunft:** Was ein Schlüssel anlegt oder ändert, trägt dauerhaft eine Badge mit seinem Namen; Mouseover oder Tippen zeigt, wer wann angelegt und geändert hat.
* **Ausgehend:** eigener Webhook als Benachrichtigungskanal (JSON per POST), Discord, E-Mail, Push.
* Persönliche API-Keys, Datenexport als JSON, Markdown-Archiv (Obsidian-kompatibel).

---

## 🚀 Schnellstart

MindSift läuft als einzelner Container mit Webserver, API, Datenbank und Frontend.

### Option 1: Installationsskript

```bash
curl -fsSL https://raw.githubusercontent.com/mindsift-app/mindsift/main/install.sh | bash
```

Das Skript legt ein Verzeichnis an, lädt `docker-compose.yml` und `.env.example`, erzeugt ein `JWT_SECRET` und startet den Container.

### Option 2: Docker Compose

```bash
mkdir -p mindsift && cd mindsift
curl -fsSL https://raw.githubusercontent.com/mindsift-app/mindsift/main/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/mindsift-app/mindsift/main/.env.example -o .env
# In .env: JWT_SECRET durch einen langen Zufallswert ersetzen!
docker compose up -d
```

Alle Einstellungen stehen mit Erklärung in `.env`. Optional kommt eine eigene Spracherkennung dazu: Block `whisper` in `docker-compose.yml` einkommentieren und `STT_URL=http://whisper:8000` setzen (Anleitung in der Datei).

Minimal:

```yaml
services:
  mindsift:
    image: ghcr.io/mindsift-app/mindsift:latest   # :latest = Stand von main (jede Version), :dev = Entwicklungsstand
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      - JWT_SECRET=hier-ein-langer-zufaelliger-wert
      - BASE_URL=https://mindsift.example.com
```

### Ersteinrichtung

Rufe `http://localhost:8080` auf. Beim ersten Start führt ein Assistent durch das Anlegen des Administrator-Kontos.

> ⚠️ **`JWT_SECRET`:** Ohne Angabe (oder mit einem der Platzhalter aus den Beispielen) erzeugt der Server beim ersten Start einen Zufallswert und speichert ihn als `jwt.secret` im Datenverzeichnis. Für Produktion lieber selbst einen langen Zufallswert setzen. Rufe die Instanz außerdem direkt nach dem Start auf, damit kein Fremder das erste Konto anlegt.

---

## ⚙️ Betrieb & Konfiguration

| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | `8080` | HTTP-Port |
| `DATA_DIR` | `/data` (Container) | Ablage der Datenbank `mindsift.db` |
| `JWT_SECRET` | zufällig erzeugt (`/data/jwt.secret`) | Signaturschlüssel der Anmelde-Tokens; Platzhalter werden ignoriert |
| `BASE_URL` | `http://localhost:8080` | Öffentliche URL. Nur wenn gesetzt (und SMTP eingerichtet ist), gibt es „Passwort vergessen?“ – die Links in den Mails werden ausschließlich daraus gebaut |
| `TRUSTED_PROXIES` | `private` | Wessen `X-Forwarded-For`/`X-Real-IP` geglaubt wird: `private` (Proxy im Docker-/Heimnetz), `all` (immer, früheres Verhalten), `none` oder eigene CIDR-Bereiche ([Doku/reverse-proxy.md](Doku/reverse-proxy.md#client-ip-und-trusted_proxies)) |
| `DEFAULT_LANGUAGE` | `de` | Standardsprache des Servers (Login-Bildschirm, neue Konten, Browser in anderen Sprachen), solange der Admin keine in Administration → Server & Isolation gewählt hat. Jede Person kann unter Kontoeinstellungen → Sprache selbst umstellen |
| `MCP_ENABLED` | leer (Admin-UI entscheidet) | `false` schaltet den MCP-Endpunkt für KI-Agenten ab, damit auch die Connector-Anmeldung (OAuth) für claude.ai und ChatGPT; `true` lässt ihn fest an. API-Schlüssel funktionieren per curl weiter |
| `OAUTH_IDLE_DAYS` | `90` | Verbindungen von claude.ai, ChatGPT & Co. (OAuth), die so viele Tage nicht benutzt wurden, werden getrennt. `0` = nie. OAuth selbst gibt es nur mit `BASE_URL` |
| `LOGIN_PROTECTION` | `true` | Sperre nach Fehlversuchen: 3 pro Konto und Adresse, 20 pro Konto, 30 pro Adresse, jeweils 15 Minuten. `false` schaltet sie ab |
| `TZ` | `Europe/Berlin` | Zeitzone für Fälligkeiten und Alarme (ganztägige Aufgaben melden sich um 9:00) |
| `REGISTRATION_MODE` | leer (Admin-UI entscheidet) | Registrierung ohne Einladung: `closed`, `approval` (Admin gibt frei), `domain` (nur erlaubte E-Mail-Endungen), `domain+approval` (Endungen sofort, andere nach Freigabe), `open`. Gesetzt ist es im Admin-UI gesperrt |
| `REGISTRATION_DOMAINS` | leer | Erlaubte E-Mail-Endungen für die `domain`-Modi, z. B. `firma.de, *.firma.de`; gesetzt im Admin-UI gesperrt |
| `REGISTRATION_VERIFY_EMAIL` | leer (Admin-UI entscheidet) | `true`: Wer sich ohne Einladung registriert, bestätigt zuerst seine E-Mail-Adresse per Link (braucht SMTP und `BASE_URL`); unbestätigte Konten werden nach 48 Stunden gelöscht |
| `ALLOW_REGISTRATION` | `false` | `true` = wie `REGISTRATION_MODE=open` (gesperrt); `false` lässt die Wahl dem Admin-UI |
| `LOG_LEVEL` / `DEBUG` | `info` / `false` | Logging |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TLS` | leer | E-Mail-Alarme (auch im Admin-UI) |
| `SMTP_FROM_NAME` | `MindSift` | Anzeigename des Absenders bei E-Mails |
| `SMTP_SKIP_VERIFY` | `false` | Zertifikatsprüfung für interne Mailserver abschalten |
| `NOTIFY_DIGEST_MINUTES` | `5` | Bündelungsintervall für Benachrichtigungen in Minuten |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | automatisch | Schlüssel für Push-Benachrichtigungen; ohne Angabe einmal erzeugt und in der Datenbank gespeichert. `VAPID_SUBJECT` (Kontakt für die Push-Dienste, `mailto:` oder `https://`) sonst aus `BASE_URL` |
| `MEDIA_*` | diverse | Grenzen für Bilder und Audio in Notizen (`MEDIA_MAX_IMAGE_MB=15`, `MEDIA_MAX_AUDIO_MB=50`, `MEDIA_QUOTA_MB=0`) |
| `STT_*` | diverse | Optionale eigene Spracherkennung per Whisper (`STT_URL`, `STT_MODEL`, `STT_LANGUAGE`, `STT_ALLOW_BROWSER` …; siehe [Doku/architecture.md](Doku/architecture.md#spracherkennung)) |
| `RETENTION_ALLOW_NEVER` | leer (Admin-UI entscheidet) | `false`: Bei den Aufbewahrungsfristen gibt es „nie“ nicht (Erledigtes und Gelöschtes wird immer irgendwann aufgeräumt); `true` erlaubt es fest |
| `LEGAL_IMPRINT_URL`, `LEGAL_PRIVACY_URL` | leer | Impressum/Datenschutz als externer Link (nur `http(s)`) |
| `LEGAL_IMPRINT_CONTENT`, `LEGAL_PRIVACY_CONTENT` (oder `…_CONTENT_FILE` mit Dateipfad) | leer | Impressum/Datenschutz als Markdown, angezeigt in einem Lesefenster. Ohne URL und Text bleibt der Link unsichtbar. |
| `LEGAL_CUSTOM_LINK_LABEL`, `LEGAL_CUSTOM_LINK_URL` | leer | Zusätzlicher Link im Footer (z. B. Statusseite), nur `https` |
| `MINDA_DEMO` | `false` | Legt Demo-Konten `admin/admin` (mit Beispieldaten) und `user/user` an; eine Notiz und zwei Listen sind zwischen beiden geteilt, um das gemeinsame Bearbeiten auszuprobieren. **Nie auf öffentlichen Servern!** |
| `DEMO_RESET_MINUTES` | `20` | Nur im Demo-Modus: setzt die Datenbank in diesem Abstand auf die Beispieldaten zurück (`0` = nie). Angemeldete bleiben angemeldet, die App zeigt einen Countdown und lädt danach neu. |

* **Reverse-Proxy:** Am besten WebSocket-Upgrade und ungepufferte SSE-Streams durchreichen. Blockiert ein Proxy beides, funktioniert MindSift trotzdem über Long-Polling bzw. regelmäßige Abfragen, nur etwas träger. Beispiele für Nginx, Traefik, Caddy und Cloudflare: [Doku/reverse-proxy.md](Doku/reverse-proxy.md).
* **Datensicherung:** In den Admin-Einstellungen lassen sich automatische tägliche Backups einschalten (ganze Datenbank plus ein Backup je Benutzer unter `data/backups/`, Standard 3 Tage aufbewahrt). Benutzer laden ihre Server-Backups herunter oder spielen sie ganz oder für einzelne Bereiche wieder ein. Der Ordner liegt neben der Datenbank: zusätzlich woanders sichern. Manuell geht weiterhin `sqlite3 mindsift.db ".backup 'backup.db'"`.
* **Updates:** Neues Image ziehen und Container neu starten (`docker compose pull && docker compose up -d`). Das Schema wird beim Start automatisch angepasst. Die laufende Version steht im Kopf der App unter dem Namen; offene Apps bieten danach selbst das Neuladen an.
* **Image-Tags:** `:dev` = Stand des Branches `dev`, `:latest` = Stand von `main` (jede neue Version landet dort). Ein Git-Tag wie `v1.2.0` erzeugt zusätzlich `:v1.2.0` und `:stable`; Vorabversionen wie `v1.0.0-rc.1` verschieben `:stable` nicht.
* **Versionen & Änderungen:** [Semantic Versioning](https://semver.org/spec/v2.0.0.html), was sich geändert hat, steht in der [CHANGELOG.md](CHANGELOG.md).

---

## 🛠 Entwicklung

Voraussetzungen: Go 1.23, Node 22.

```bash
# Backend: Vet und Tests
go vet ./... && go test ./...

# Frontend
cd frontend
npm ci
npm run dev                # Vite-Entwicklungsserver
npx tsc --noEmit           # Typprüfung
npm run test:run           # Komponententests (Vitest, jsdom)
npm run build              # Produktions-Build
cd ..
e2e/run.sh                 # Browser-Tests (Playwright, zwei Benutzer) gegen ein frisch gebautes Image
e2e/screenshots.sh         # Screenshots dieser README neu erzeugen (Demo-Daten, hell/dunkel diagonal)
```

Für das Binary wird das gebaute Frontend nach `cmd/server/dist` kopiert (`go:embed`); das mehrstufige `Dockerfile` erledigt das und führt Typprüfung, Frontend-Tests, Go-Vet und Go-Tests beim Image-Build aus.

**Stack:** Go (chi, gorilla/websocket, JWT, modernc SQLite, webpush-go) · React 18, TypeScript, Vite, Tailwind.

---

## 📚 Dokumentation

Die technische Doku liegt unter [Doku/](Doku/README.md): Architektur, Datenbank, REST- und Echtzeit-API, Module (inkl. gemeinsamem Bearbeiten), Freigaben und Berechtigungen, Reverse-Proxy, Themes. Bekannte Schwachstellen und offene Punkte stehen in [Doku/flaws.md](Doku/flaws.md).

---

## 🔒 Deine Daten gehören dir

* Selbst gehostet, keine Telemetrie, keine Fremddienste, Schrift und Icons werden mitgeliefert. Ausgehende Verbindungen baut nur der Server auf, und nur für das, was du nutzt: Benachrichtigungen (SMTP, Discord, eigener Webhook, die Push-Dienste der Browser), Link-Vorschauen (die verlinkte Seite wird einmal abgerufen, pro Gerät abschaltbar) und optional dein eigener Whisper-Server.
* Alle Inhalte liegen in einer einzigen SQLite-Datei; Bilder und Sprachnotizen liegen daneben in `data/media/`. Der ganze Workspace lässt sich als Obsidian-kompatibles Markdown-Archiv (ZIP, mit `attachments/`) exportieren, alle Daten eines Benutzers als Backup-ZIP (JSON plus Mediendateien).

---

## 📄 Lizenz

MindSift ist freie Software unter der [GNU Affero General Public License v3.0](LICENSE) (AGPLv3): Du darfst den Code nutzen, ändern und weitergeben, auch kommerziell. Wer eine geänderte Fassung weitergibt oder als Dienst im Netz anbietet, muss deren Quellcode unter derselben Lizenz zugänglich machen. Es gibt keine Gewährleistung.

<div align="center">
<sub>Gebaut für Klarheit, Geschwindigkeit und digitale Souveränität.</sub>
</div>
