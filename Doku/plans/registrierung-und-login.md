# Plan: Registrierung und Anmeldung (Entwurf)

Stand 2026-10-31. **Umgesetzt in v0.23.0:** Abschnitte 1 (Registrierungsmodus und Freigabe), 2 (Umgebungsvariablen) und 3 (Einladungslinks, per E-Mail einladen, mehrfach verwendbare Links). E-Mail-Bestätigung per Link in v0.24.0. OpenID Connect ist zurückgestellt (kein Bedarf), vermerkt in der Aufgabenliste „Mindsift“. Ziel: ein Zwischending zwischen „jeder darf sich registrieren“ und „für jede Person einen Einladungscode erzeugen“, dazu bequemere Anmeldung.

## Heute

- `ALLOW_REGISTRATION` bzw. Admin-Schalter „offene Registrierung“: jeder kann ein Konto anlegen.
- Sonst nur mit Einladungscode (optional an eine E-Mail-Adresse und eine Organisation gebunden, einmal verwendbar, mit Ablaufdatum).
- Anmeldung nur mit E-Mail/Benutzername und Passwort (dazu API-Keys für Webhooks).

## 1. Registrierungsmodus statt Ja/Nein

Ein Modus ersetzt den Schalter „offene Registrierung“:

| Modus | Verhalten |
|---|---|
| `closed` | Nur mit Einladungscode (wie heute ohne offene Registrierung). |
| `approval` | Jeder kann sich registrieren, das Konto ist aber **gesperrt, bis ein Admin es freigibt**. |
| `domain` | Registrierung nur mit E-Mail-Adressen bestimmter Endungen (z. B. `@firma.de, @familie-dach.de`), sofort aktiv. |
| `domain+approval` | Erlaubte Endungen sofort aktiv, alle anderen warten auf Freigabe. |
| `open` | Jeder, sofort aktiv (wie heute). |

Einladungscodes funktionieren in jedem Modus und überspringen Freigabe und Endungsprüfung.

**Freigabe durch Admin**
- Neue Konten im Modus `approval` werden mit `is_active = 0` und einem Status „wartet auf Freigabe“ angelegt (eigenes Feld, damit „gesperrt“ und „wartet“ unterscheidbar bleiben).
- Die Person sieht nach der Registrierung: „Dein Konto wird geprüft. Du bekommst eine E-Mail, sobald es freigeschaltet ist.“ Anmelden geht bis dahin nicht (gleiche Meldung).
- Admins bekommen eine Benachrichtigung über die vorhandenen Kanäle (E-Mail/Push, neues Ereignis „Registrierung wartet“) und sehen in der Benutzerverwaltung oben eine Liste **„Wartet auf Freigabe“** mit Freigeben / Ablehnen. Ablehnen löscht das Konto.
- Bei Freigabe geht eine E-Mail im bekannten Layout an die Person („Dein Konto ist freigeschaltet“ mit Knopf zur App).
- Ohne SMTP funktioniert alles, nur ohne E-Mails.

**E-Mail-Endungen**
- Liste von Domains, Vergleich ohne Groß-/Kleinschreibung auf den Teil nach `@` (keine Subdomains, außer ausdrücklich `*.firma.de`).
- Optional: **E-Mail-Adresse bestätigen** per Link (wie Passwort vergessen, gleiche Token-Technik), bevor das Konto aktiv wird. Sonst kann jeder `chef@firma.de` eintippen. Bei `domain` sollte die Bestätigung Pflicht sein, wenn SMTP eingerichtet ist.

**Missbrauch**
- Gleiche Bremse wie beim Login (Anfragen pro IP), dazu höchstens N wartende Registrierungen gleichzeitig (z. B. 50), danach „gerade keine Registrierung möglich“.
- In der Demo bleibt Registrierung aus.

## 2. Einstellungen: Admin-Oberfläche oder Umgebungsvariablen

Damit die Admin-Einstellungen nicht überladen werden:

- **Admin-Oberfläche:** nur der Modus (Auswahlfeld) und darunter, je nach Modus, das Feld für die erlaubten Endungen. Die Liste „Wartet auf Freigabe“ steht in der Benutzerverwaltung, nicht in den Einstellungen.
- **Umgebungsvariablen** (gewinnen, wenn gesetzt; das Feld in der Oberfläche ist dann gesperrt mit Hinweis „über die Umgebung festgelegt“ – so wie heute bei SMTP):

  ```env
  REGISTRATION_MODE=domain+approval      # closed | approval | domain | domain+approval | open
  REGISTRATION_DOMAINS=firma.de,familie-dach.de
  REGISTRATION_VERIFY_EMAIL=true          # Bestätigungslink vor Aktivierung
  ```
- `ALLOW_REGISTRATION=true` bleibt als Alias für `REGISTRATION_MODE=open` erhalten.

## 3. Einladungen bequemer

Heute: Der Admin erzeugt einen Code (optional an eine E-Mail-Adresse und Organisation gebunden, Rolle, Gültigkeit 1–365 Tage, **einmal** verwendbar) und gibt ihn weiter; die Person wählt auf der Anmeldeseite „Einladungscode“ und tippt ihn ab.

**Einladungslink**
- Jeder Code ist auch als Link nutzbar: `https://<instanz>/?invite=<CODE>`. Der Link öffnet direkt die Registrierung mit eingetragenem Code; ist er an eine Adresse gebunden, steht die E-Mail schon fest.
- Die App entfernt den Code nach dem Öffnen aus der Adresszeile (wie beim Passwort-Link).
- In der Admin-Liste neben jedem Code: **Link kopieren** und – mit SMTP – **per E-Mail einladen** (Adresse eingeben → E-Mail im MindSift-Layout mit Knopf „Konto anlegen“, wer eingeladen hat, Gültigkeit). Beim Einladen per E-Mail wird der Code automatisch an diese Adresse gebunden.
- Den Link baut die Admin-Oberfläche aus der aktuellen Adresse; nur die E-Mail braucht `BASE_URL`.

**Mehrere Personen mit einem Code**
- Neues Feld **„Wie oft verwendbar“** (Standard 1, z. B. 20) – ein Link für eine ganze Gruppe, Klasse oder Familie. In der Liste steht „3 von 20 verwendet“, Widerrufen beendet ihn sofort.
- Mehrfach-Codes können nicht an eine einzelne E-Mail gebunden werden, wohl aber an eine Organisation und an die erlaubten E-Mail-Endungen (Abschnitt 1).
- Technisch: Spalten `max_uses` und `use_count` an `user_invites`; das bestehende „Code reservieren → Konto anlegen → als benutzt markieren“ zählt dann hoch statt abzuschließen (weiter ohne Doppelverwendung bei gleichzeitigen Registrierungen).

## 4. Anmelden mit anderen Konten (zurückgestellt)

### OpenID Connect (statt „nur Google“)

Ein allgemeiner OIDC-Login deckt Google, Microsoft, Apple und vor allem **selbst gehostete Anbieter** ab: Authentik, Keycloak, Authelia – und **Gitea/Forgejo selbst** kann OIDC-Anbieter sein. Für ein Homelab ist das meist nützlicher als Google.

- Konfiguration nur per Umgebung (Geheimnisse gehören nicht in die Datenbank-Oberfläche):
  ```env
  OIDC_ISSUER=https://git.example.org/      # oder https://accounts.google.com
  OIDC_CLIENT_ID=…
  OIDC_CLIENT_SECRET=…
  OIDC_BUTTON_LABEL=Mit Gitea anmelden
  OIDC_ALLOWED_DOMAINS=firma.de             # optional, sonst gilt der Registrierungsmodus
  OIDC_AUTO_CREATE=true                     # neues Konto beim ersten Login anlegen (Modus/Freigabe gelten)
  ```
- Ablauf: Authorization Code Flow mit PKCE, `state` und `nonce`; Rückkehr auf `BASE_URL/api/v1/auth/oidc/callback`. Konten werden über `iss`+`sub` verknüpft (neue Tabelle), nicht nur über die E-Mail.
- Besteht schon ein Konto mit derselben, vom Anbieter **bestätigten** E-Mail, wird es nach Passwortabfrage verknüpft (kein stilles Übernehmen fremder Konten).
- Danach normale MindSift-Sitzung (wie heute), Abmelden bleibt lokal.
- Passwort-Login bleibt daneben möglich; optional `PASSWORD_LOGIN=false`, wenn nur noch OIDC gewünscht ist (Admin-Notzugang beachten).

Eine Anmeldung über den Mailserver (SMTP-Prüfung wie in Gitea) ist bewusst nicht vorgesehen: Das Mailpasswort liefe durch MindSift, und große Anbieter erlauben es meist nicht mehr.

## Reihenfolge und Aufwand (grob)

1. Einladungslink (Link kopieren, per E-Mail einladen) und mehrfach verwendbare Codes – klein bis mittel, sofort nützlich. (Mehrere Einzel-Codes auf einmal erzeugen ist damit überflüssig und entfällt.)
2. Registrierungsmodus mit Freigabe und Endungen, Umgebungsvariablen, Admin-Liste „Wartet auf Freigabe“, E-Mails – mittel.
3. E-Mail-Bestätigung per Link – klein (Technik wie Passwort vergessen).
4. OIDC-Login – mittel (Bibliothek `coreos/go-oidc` + `golang.org/x/oauth2`, neue Tabelle für verknüpfte Konten, Knopf auf der Anmeldeseite).

## Entschieden

- Ein abgelehnter Antrag wird gelöscht; dieselbe Adresse kann sich erneut registrieren (Knopf „Ablehnen“ unter „Wartet auf Freigabe“).
- Neue Konten werden nicht anhand der E-Mail-Endung automatisch einer Organisation zugeordnet; das macht der Admin.
- Admins bekommen bei jeder wartenden Registrierung eine E-Mail (mit SMTP), dazu den Zähler in der Benutzerverwaltung; mehr Benachrichtigung kommt nicht dazu.

## Offene Fragen

- Welcher OIDC-Anbieter zuerst: Gitea, Google, Authentik …?
