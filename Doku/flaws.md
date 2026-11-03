# Schwachstellen, Risiken & Ideen

Stand: laufend gegen den Branch `dev` geprüft. Vollständig behobene Einträge werden hier entfernt; ihre Geschichte steht in den Commits und im `CHANGELOG`. Offene und nur teilweise behobene bleiben stehen. Die Nummern (ab FLAW-28, davor FLAW-01–27) zählen weiter, damit Verweise in Commits eindeutig bleiben. Jeder Eintrag ist gegen den Quellcode geprüft; die Fundstellen sind angegeben.

Schweregrade: **Hoch** (Kontoübernahme oder Datenabfluss möglich), **Mittel** (Schutz greift nicht oder Fehlfunktion unter realistischen Bedingungen), **Niedrig** (Härtung, Datenschutz, Wartbarkeit).

---

## Übersicht

| ID | Bereich | Kurzbeschreibung | Schwere |
|---|---|---|---|
| FLAW-31 | Auth | Sitzungs-Token im `localStorage` (keine HttpOnly-Cookies) | Teilweise behoben |
| FLAW-34 | Admin | SMTP-Passwort im Klartext in DB und Backups | Teilweise behoben |

---

## Details

### FLAW-31: Langlebige Sitzung im `localStorage`
- **Status: Teilweise behoben.** Serverseitige Sitzungen (`sessions`, [sessions.go](../internal/api/sessions.go)): Jedes Token gehört zu einer Sitzung, die einzeln beendet werden kann und nach 30 Tagen ohne Nutzung endet; das Token wird täglich über `X-Session-Token` erneuert. Profil → „Aktive Sitzungen“ zeigt Gerät, IP und letzte Nutzung mit Einzel-Abmelden.
- **Rest:** Das Token liegt weiter im `localStorage` (jedes Script im App-Kontext könnte es lesen); HttpOnly-Cookies mit CSRF-Schutz sind bewusst zurückgestellt, weil CSP und die Link-Prüfung (ehemals FLAW-28/29) den bekannten Weg schließen. Bei Bedarf: kurzlebiges Zugriffs-Token + HttpOnly-Cookie.

### FLAW-34: SMTP-Passwort im Klartext
- **Status: Teilweise behoben.** `GET`/`PUT /admin/settings` liefern `smtpPass` immer leer und nur `smtpPassSet`; ein leeres Feld behält das gespeicherte Passwort, ohne SMTP-Benutzer wird es entfernt ([handlers_admin.go](../internal/api/handlers_admin.go)).
- **Rest:** In der Datenbank und ihren Abzügen steht es weiter im Klartext (der Server braucht es zum Anmelden). Wer das nicht will, setzt `SMTP_HOST`/`SMTP_PASS` per Umgebung und lässt die Felder im Admin-UI leer.

---

## Ideen für Funktionen

### Erfassen
- **Teilen-Ziel der App** (`share_target` im Manifest): Links und Texte aus anderen Apps auf dem Handy direkt in die Inbox teilen.
- **Natürliche Zeitangaben** beim Erfassen: „Zahnarzt morgen 14 Uhr“ setzt die Fälligkeit mit Uhrzeit.
- **Mail an die Inbox:** eine persönliche Adresse, deren Mails als Gedanken landen.

### Aufgaben & Erinnerungen
- **Web-Push-Benachrichtigungen** für Alarme direkt auf Handy und Desktop, ohne Discord oder E-Mail.
- **Alarme auch für Zugewiesene**, nicht nur für den Eigentümer der Aufgabe.
- **Zeitzone pro Benutzer** statt einer Server-Zeitzone für alle.
- **Kalenderansicht und iCal-Abo** der fälligen Aufgaben (z. B. in Google-/Apple-Kalender).
- **Flexiblere Wiederholungen:** „jeden 2. Dienstag“, „am letzten Werktag“, „3 Tage nach Erledigen“.

### Notizen
- **Versionsverlauf ansehen und zurückholen:** das Operations-Log (`doc_ops`) ist vorhanden, eine Ansicht fehlt.
- **Vorlagen und Tagesnotiz** (z. B. „Wochenrückblick“, „Heute“).
- **Öffentlicher Lese-Link** für einzelne Notizen, mit Ablaufdatum.
- **Verlinkungs-Graph** auf Basis der Backlinks.

### Listen
- **Sortierung nach Laden:** Kategorien in der Reihenfolge des eigenen Supermarkts.
- **Häufige Einträge vorschlagen** beim Tippen (aus erledigten Einträgen).

### Konto & Sicherheit
- **Zwei-Faktor-Anmeldung** (TOTP) oder **Passkeys**.
- **Anmeldung über OIDC** (Authelia, Authentik, Keycloak) für Homelab-Setups.
- **Admin-Protokoll:** wer hat wann Konten, Rollen und Einstellungen geändert.

### Betrieb
- **Backups an ein externes Ziel** (WebDAV, S3, SFTP), damit sie eine kaputte Platte überleben.
- **`/metrics` für Prometheus** und ein Healthcheck, der auch die Datenbank prüft.
- **Update-Hinweis** in der Admin-Oberfläche, wenn ein neues Release-Image verfügbar ist.
