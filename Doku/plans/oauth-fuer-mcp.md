# Plan: OAuth für den MCP-Zugang (Entwurf)

Stand 2026-11-01, **umgesetzt in v0.51.0**. Ziel: MindSift lässt sich in **claude.ai**, der Claude-App am Handy und **ChatGPT im Browser** als Connector eintragen. Diese Clients können keinen `X-API-Key`-Header setzen, sondern verlangen den OAuth-Ablauf aus der MCP-Spezifikation (Autorisierung, Stand 2025-06-18). MindSift wird dafür selbst zum OAuth-Server für seinen eigenen MCP-Endpunkt.

Nicht Teil dieses Plans: Anmelden **bei** MindSift über fremde Anbieter (OIDC), siehe [registrierung-und-login.md](registrierung-und-login.md), Abschnitt 4.

## Heute

- MCP-Endpunkt `POST /api/v1/mcp`, Anmeldung über `authMiddleware`: API-Schlüssel (`mindsift_sec_…`) als `X-API-Key` oder `Authorization: Bearer`, alternativ eine Sitzung.
- Ein Schlüssel hat Rechte (`tasks:read`, `lists:write` …), `mcpToolAllowed` zeigt nur die erlaubten Werkzeuge, Änderungen bekommen die Herkunft `mcp` mit dem Namen des Schlüssels.
- Die Sitzung liegt im Frontend im `localStorage`, nicht in einem Cookie. Der Server sieht beim reinen Aufruf einer Seite also nicht, wer angemeldet ist.

## So sieht es für Nutzer aus

1. In claude.ai: *Einstellungen → Connectors → Eigenen Connector hinzufügen*, Adresse `https://<instanz>/api/v1/mcp`.
2. Der Browser öffnet MindSift. Wer nicht angemeldet ist, meldet sich wie gewohnt an.
3. Eine Zustimmungsseite: **„Claude möchte auf dein MindSift zugreifen“**, darunter die Rechte als Häkchen (Aufgaben lesen, Aufgaben ändern, Listen lesen, Listen ändern, in die Inbox schreiben), vorbelegt mit dem, was der Client anfragt. Knöpfe **Erlauben** / **Ablehnen**.
4. Zurück in claude.ai sind die Werkzeuge da.
5. In *Einstellungen → API-Schlüssel* steht der Zugang als eigener Eintrag „Claude (OAuth)“ mit Rechten, „zuletzt benutzt“ und **Widerrufen**. Rechte ändern geht dort wie bei jedem Schlüssel.

Was der Agent anlegt, trägt wie heute das Abzeichen mit dem Namen des Eintrags.

## Grundidee: ein OAuth-Zugang ist ein API-Schlüssel

Die Zustimmung legt einen normalen Eintrag in `api_keys` an (neue Spalte `kind = 'oauth'`, dazu `oauth_client_id`). Ein Schlüssel-Geheimnis zum Abtippen gibt es dafür nicht: `key_hash` bekommt einen zufälligen Wert, den niemand kennt. Die Tokens hängen an diesem Eintrag.

Damit bleiben Rechteprüfung (`mcpToolAllowed`, `apiKeyRouteDenied`), Herkunft (`origin`), „zuletzt benutzt“, Umbenennen, Rechte ändern und Widerrufen unverändert. Wird der Eintrag gelöscht, fallen die Tokens per Fremdschlüssel mit.

## Endpunkte

Alle ohne Anmeldung erreichbar, außer der Zustimmung.

| Endpunkt | Zweck |
|---|---|
| `GET /.well-known/oauth-protected-resource` (auch mit Pfad-Anhang `/api/v1/mcp`) | Beschreibung der Ressource (RFC 9728): `resource`, `authorization_servers`, `scopes_supported` |
| `GET /.well-known/oauth-authorization-server` | Beschreibung des OAuth-Servers (RFC 8414): Endpunkte, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported`, `token_endpoint_auth_methods_supported: ["none"]` |
| `POST /oauth/register` | Dynamische Client-Registrierung (RFC 7591), wie sie claude.ai und ChatGPT benutzen |
| `GET /oauth/authorize` | Liefert die App aus (wie jede Seite); die App zeigt die Zustimmung |
| `GET /api/v1/oauth/authorize` | Prüft die Parameter und liefert Client-Name, Rücksprungadresse und angefragte Rechte für die Zustimmungsseite (angemeldet) |
| `POST /api/v1/oauth/authorize` | Erlauben oder Ablehnen; gibt die Rücksprung-URL mit `code` und `state` (bzw. `error=access_denied`) zurück, die App leitet weiter (angemeldet) |
| `POST /oauth/token` | `authorization_code` gegen Tokens tauschen, `refresh_token` erneuern |
| `POST /oauth/revoke` | Token widerrufen (RFC 7009), optional, schadet nicht |

Am MCP-Endpunkt antwortet MindSift ohne gültiges Token mit `401` und
`WWW-Authenticate: Bearer resource_metadata="https://<instanz>/.well-known/oauth-protected-resource"`. Daran erkennen die Clients, dass sie den Ablauf starten müssen. Heute fehlt dieser Header.

Kein eigenes CORS für diese Endpunkte: claude.ai und ChatGPT rufen sie vom Server aus auf. Browser-Clients wie der MCP Inspector erreichen ohnehin auch den MCP-Endpunkt nicht, solange `BASE_URL` die erlaubten Ursprünge festlegt.

## Ablauf im Detail

**Registrierung:** Der Client schickt `client_name` und `redirect_uris`. MindSift speichert ihn in `oauth_clients` und gibt eine `client_id` zurück. Es gibt nur öffentliche Clients (kein Client-Geheimnis); die Sicherheit kommt aus PKCE und den festen Rücksprungadressen.
- Rücksprungadressen nur `https://…` oder `http://localhost`/`127.0.0.1` (Desktop-Clients), keine Fragmente.
- Bremse pro IP wie beim Login. Clients, die 24 Stunden nach der Registrierung noch keine Zustimmung bekommen haben, werden beim Aufräumen gelöscht.

**Zustimmung:** `response_type=code`, `client_id`, `redirect_uri` (muss exakt registriert sein), `code_challenge` mit `code_challenge_method=S256` (Pflicht), `state`, `scope` (optional), `resource` (RFC 8707, falls angegeben gleich `<BASE_URL>/api/v1/mcp`).
- Passen `client_id` oder `redirect_uri` nicht, zeigt die App einen Fehler und leitet **nicht** weiter. Alle anderen Fehler gehen als `error=…` an die Rücksprungadresse.
- Bei **Erlauben** legt MindSift den Eintrag in `api_keys` an (Name = `client_name` + „ (OAuth)“, Rechte = gewählte Häkchen). Hat dieselbe Person demselben Client schon zugestimmt, wird der vorhandene Eintrag weiterverwendet, und die Rechte werden aktualisiert, damit keine Doppelten entstehen.
- Der Code ist 10 Minuten gültig, nur einmal verwendbar und wird nur als Hash gespeichert.

**Token:** Der Tausch prüft Code, `client_id`, `redirect_uri` und `code_verifier`. Ergebnis:
- `access_token` `mindsift_oat_…`, 1 Stunde gültig
- `refresh_token` `mindsift_ort_…`, 90 Tage gültig, wird bei jeder Erneuerung ausgetauscht. Wird ein bereits ersetzter Refresh-Token noch einmal benutzt, verfallen alle Tokens dieses Eintrags (Schutz bei Diebstahl).
- `scope` mit den tatsächlich erteilten Rechten

**Nutzung:** `authenticateToken` erkennt `mindsift_oat_` und liefert Nutzer und `apiKeyAuth` des zugehörigen Eintrags. Ab da läuft alles wie bei einem Schlüssel. OAuth-Tokens gelten **nur für den MCP-Endpunkt** (dafür wurden sie ausgestellt), nicht für die REST-Endpunkte.

## Rechte (Scopes)

Die vorhandenen Rechte werden unverändert als OAuth-Scopes verwendet (`tasks:read`, `tasks:write`, `lists:read`, `lists:write`, `webhook:triage`; die schmalen `webhook:task`/`webhook:list` erscheinen auf der Zustimmungsseite nicht). Fragt ein Client kein `scope` an (claude.ai tut das meist nicht), sind auf der Zustimmungsseite **Lesen und Ändern für Aufgaben und Listen** vorbelegt; Inbox bleibt aus. Notizen bleiben wie heute unerreichbar.

## Datenbank

```sql
ALTER TABLE api_keys ADD COLUMN kind TEXT NOT NULL DEFAULT 'key';   -- key | oauth
ALTER TABLE api_keys ADD COLUMN oauth_client_id TEXT NOT NULL DEFAULT '';

CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,               -- client_id
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,       -- JSON-Array
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- access | refresh
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  replaced_at TEXT NOT NULL DEFAULT ''  -- refresh: wann ausgetauscht (Wiederverwendung erkennen)
);
```

Abgelaufene Codes und Tokens räumt der vorhandene Aufräum-Lauf weg. Als Migration über `schema_migrations`.

## Voraussetzungen und Grenzen

- **`BASE_URL` muss gesetzt sein.** Sie ist `issuer` und Ressource; aus dem `Host`-Header gebaut wäre sie fälschbar. Ohne `BASE_URL` ist OAuth aus: kein `WWW-Authenticate`-Hinweis, und die Endpunkte antworten mit 404. Die Einstellungen sagen dann „OAuth braucht `BASE_URL`“.
- **Reverse-Proxy:** `/.well-known/` und `/oauth/` müssen bei MindSift ankommen. Mit der Beispielkonfiguration in [reverse-proxy.md](../reverse-proxy.md) (`location /`) ist das so; dort ergänze ich einen Hinweis.
- **Demo-Modus:** OAuth aus (Demo-Daten werden zurückgesetzt, Einträge wären sinnlos).
- **CSP:** Die Zustimmungsseite leitet per `window.location` weiter, nicht per Formular, also kein `form-action` nötig.
- **Kein eigener Admin-Schalter** für OAuth. Ein Schalter für den ganzen MCP-Zugang ist eine eigene Aufgabe; ist MCP aus, ist auch OAuth aus.
- **Unbenutzte Zugänge verfallen:** Ein OAuth-Eintrag, der 90 Tage nicht benutzt wurde, wird beim Aufräumen gelöscht (samt Tokens). Einstellbar mit `OAUTH_IDLE_DAYS` (Standard `90`, `0` = nie).

## Oberfläche

- Neue Ansicht **Zustimmung** (`/oauth/authorize`), Handy-tauglich: Logo, Client-Name, Rücksprung-Domain gut sichtbar („Weiterleitung zu claude.ai“), Rechte-Häkchen mit den vorhandenen Bezeichnungen aus `ApiKeysPanel`, Erlauben/Ablehnen (44 px). Nicht angemeldet → Anmeldung, danach zurück zur Zustimmung (Parameter bleiben erhalten).
- **API-Schlüssel-Liste:** OAuth-Einträge mit Kennzeichen „OAuth“ und Client-Name; „Schlüssel anzeigen/kopieren“ entfällt bei ihnen.
- **Hilfe-Text** in `ApiKeysPanel` ersetzen: statt „claude.ai … wird noch nicht unterstützt“ eine kurze Anleitung „In claude.ai als Connector eintragen: `<BASE_URL>/api/v1/mcp`“ mit Kopier-Knopf.

## Tests

- Go: kompletter Ablauf (registrieren → zustimmen → Code tauschen → MCP aufrufen → erneuern), falsche `redirect_uri`, falscher `code_verifier`, Code doppelt benutzt, abgelaufene Tokens, Refresh-Wiederverwendung, Widerruf des Eintrags, OAuth-Token an REST-Endpunkt (abgelehnt), ohne `BASE_URL` (aus), Demo (aus). Ablaufzeiten mit übergebener Zeit, Tests unter mehreren `TZ`.
- Frontend: Zustimmungsseite (Vorbelegung der Rechte, Ablehnen).
- Von Hand: Verbindung aus claude.ai gegen die `dev`-Instanz bzw. mit dem MCP Inspector.

## Doku und Release

- `Doku/api/rest.md` (Abschnitt MCP, neue OAuth-Endpunkte), `Doku/architecture.md`, `README.md` (Funktionsliste), `Doku/reverse-proxy.md`.
- Neue Funktion → Minor-Version, CHANGELOG „Added: MindSift lässt sich in claude.ai und ChatGPT als Connector verbinden“.
- Die Website erwähnt evtl. „claude.ai noch nicht unterstützt“; das melde ich, statt es zu ändern.

## Reihenfolge und Aufwand (grob)

1. Datenbank, Token-Speicher, `authenticateToken` für `mindsift_oat_`, `WWW-Authenticate` – klein.
2. Metadaten, Registrierung, Token-Endpunkt mit PKCE und Refresh – mittel.
3. Zustimmungsseite und API-Schlüssel-Liste – mittel.
4. Tests, Doku, Ausprobieren mit claude.ai – klein bis mittel.

Keine neue Go-Abhängigkeit nötig: Für den Server-Teil reicht die Standardbibliothek (SHA-256 für PKCE, `crypto/rand`), `golang.org/x/oauth2` ist eine Client-Bibliothek und hilft hier kaum.

## Entscheidungen (2026-11-01)

- Ohne `scope` sind Lesen und Ändern für Aufgaben und Listen vorbelegt.
- Kein OAuth-Schalter; MCP insgesamt abschaltbar kommt separat.
- Refresh-Token 90 Tage, bei jeder Erneuerung neu.
- Unbenutzte OAuth-Einträge verfallen nach 90 Tagen, `OAUTH_IDLE_DAYS`.
