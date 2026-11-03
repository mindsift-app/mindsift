# 🛡️ Reverse-Proxy & WebServer-Konfigurationshandbuch

Dieses Dokument beschreibt die empfohlene Konfiguration von Reverse-Proxies und Ingress-Controllern für MindSift. MindSift nutzt eine **hybride Realtime-Architektur** bestehend aus bidirektionalen **WebSockets** und einem automatischen **Server-Sent Events (SSE) Fallback**, um selbst in restriktivsten Firmennetzwerken, hinter strikten Firewalls oder bei Deep-Packet-Inspection unterbrechungsfreie Live-Synchronisation zu gewährleisten.

---

## ⚡ Wichtige Anforderungen auf einen Blick

| Protokoll | Standard-Port | Benötigte Header & Einstellungen | Zweck |
| :--- | :--- | :--- | :--- |
| **WebSockets** | 443 (WSS) / 80 (WS) | `Upgrade $http_upgrade`<br>`Connection "Upgrade"`<br>`proxy_read_timeout 3600s` | Bidirektionale Live-Updates (Aufgaben, Listen, Notizen) |
| **Server-Sent Events (SSE)** | 443 (HTTPS) / 80 (HTTP) | `X-Accel-Buffering: no`<br>`proxy_buffering off`<br>`proxy_cache off` | Fallback bei blockiertem WebSocket-Upgrade |
| **REST API & Uploads** | 443 (HTTPS) / 80 (HTTP) | `client_max_body_size 64M` | Notizen, Import/Export (JSON) |
| **Client-IP** | – | `X-Real-IP` / `X-Forwarded-For` | Login-Sperre nach Fehlversuchen trifft den richtigen Absender |
| **OAuth (MCP)** | 443 (HTTPS) | `/.well-known/oauth-*` und `/oauth/*` an MindSift durchreichen (mit `location /` automatisch), `BASE_URL` gesetzt | claude.ai und ChatGPT als Connector |

### Client-IP und `TRUSTED_PROXIES`

MindSift sperrt Anmeldungen nach Fehlversuchen auch pro IP-Adresse. Hinter einem Proxy kommt jede Verbindung vom Proxy; die echte Adresse steht in `X-Forwarded-For` bzw. `X-Real-IP`. MindSift glaubt diesen Kopfzeilen nur, wenn die Verbindung von einem vertrauenswürdigen Proxy kommt, sonst könnte jeder, der den Port direkt erreicht, eine beliebige Adresse vortäuschen.

| `TRUSTED_PROXIES` | Wirkung |
|---|---|
| `private` (Standard) | Proxys aus localhost, Docker- und Heimnetzen (`10.x`, `172.16–31.x`, `192.168.x`, `fd…`, `100.64.x`). Passt für Proxy im selben Docker-Netz oder auf demselben Host – nichts einzustellen. |
| `private,198.51.100.0/24` | zusätzlich eigene Bereiche, z. B. ein externer Proxy-Server oder die [IP-Bereiche von Cloudflare](https://www.cloudflare.com/ips/) |
| `all` | Kopfzeilen immer glauben (früheres Verhalten) – Notausgang, wenn die Erkennung Probleme macht |
| `none` | Kopfzeilen nie glauben |

Schickt ein vertrauenswürdiger Proxy gar keine Client-IP mit, steht einmal eine Warnung im Log, und für diese Anfragen gilt nur noch die Sperre pro Konto. Die ganze Login-Sperre lässt sich mit `LOGIN_PROTECTION=false` abschalten.

---

## 1. Nginx

Eine typische `nginx.conf` bzw. Site-Konfiguration unter `/etc/nginx/sites-available/mindsift`:

```nginx
# Map für sauberes Connection-Handling bei WebSocket-Upgrades
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name mindsift.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mindsift.example.com;

    ssl_certificate /etc/letsencrypt/live/mindsift.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mindsift.example.com/privkey.pem;

    # Maximale Payload-Größe für große Notizen und Exporte
    client_max_body_size 64M;

    # MindSift Frontend & REST API
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 1. WebSocket Endpunkte (/api/v1/ws)
    location /api/v1/ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Upgrade-Header zwingend erforderlich
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Verhindert vorzeitigen Verbindungsabbruch durch Proxy-Inaktivitäts-Timeout
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # 2. Server-Sent Events Fallback (/api/v1/events & /api/v1/sync/)
    location ~ ^/api/v1/(events|sync/) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Pufferung zwingend deaktivieren für sofortiges Event-Streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header X-Accel-Buffering no;

        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400s;
    }
}
```

---

## 2. Traefik (Docker Compose / Ingress)

Bei Verwendung von Traefik Version 2/3 müssen keine expliziten WebSocket-Upgrades deklariert werden, da Traefik diese transparent durchleitet. Für Server-Sent Events und Timeouts empfehlen sich Middleware-Definitionen:

```yaml
version: '3.8'

services:
  mindsift:
    image: ghcr.io/mindsift-app/mindsift:latest
    restart: unless-stopped
    environment:
      - PORT=8080
      - DB_PATH=/app/data/mindsift.db
    volumes:
      - ./data:/app/data
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.mindsift.rule=Host(`mindsift.example.com`)"
      - "traefik.http.routers.mindsift.entrypoints=websecure"
      - "traefik.http.routers.mindsift.tls.certresolver=letsencrypt"
      - "traefik.http.services.mindsift.loadbalancer.server.port=8080"

      # Verhindert Pufferung und hält persistente SSE-Streams am Leben
      - "traefik.http.middlewares.mindsift-buffering.buffering.maxRequestBodyBytes=67108864"
      - "traefik.http.routers.mindsift.middlewares=mindsift-buffering"
```

---

## 3. Caddy Server (Caddyfile)

Caddy unterstützt WebSockets und HTTP/2 Server-Sent Events von Haus aus vollständig ("out-of-the-box"):

```caddyfile
mindsift.example.com {
    encode gzip zstd

    # Event-Stream (SSE) ohne Pufferung weiterleiten
    reverse_proxy 127.0.0.1:8080 {
        # Streaming für SSE optimieren
        flush_interval -1
    }
}
```

---

## 4. Cloudflare Proxy (Orange Cloud)

Wird MindSift hinter dem Cloudflare CDN betrieben:
1. **WebSockets aktivieren:**
   - Navigiere in das Cloudflare Dashboard: **Network** > **WebSockets** > Schalter auf **ON** stellen.
2. **Cloudflare Rocket Loader / Auto Minify:**
   - Deaktiviere "Rocket Loader" für MindSift, da asynchrone Skripteingriffe den Start der Single-Page-App stören können.
3. **Cloudflare WAF / Bot Fight Mode:**
   - Stelle sicher, dass `GET /api/v1/events` und `GET /api/v1/ws*` nicht von "Challenge"-Seiten blockiert werden.
4. **Client-IP:** Cloudflare liefert die Besucheradresse in `CF-Connecting-IP`/`X-Forwarded-For`. Spricht Cloudflare MindSift direkt an (ohne eigenen Proxy dazwischen), die Cloudflare-Bereiche in `TRUSTED_PROXIES` ergänzen.
5. **SSE-Unterstützung:**
   - Cloudflare unterstützt Server-Sent Events nativ über HTTP/2 und HTTP/3. Dank der vom MindSift-Backend gesetzten Header `X-Accel-Buffering: no` und `Cache-Control: no-cache` streamt Cloudflare Echtzeit-Events verzögerungsfrei an die Clients.

---

## 5. Apache 2.4 (`mod_proxy_wstunnel`)

Unter Debian/Ubuntu:
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel headers
sudo systemctl restart apache2
```

VirtualHost-Konfiguration (`/etc/apache2/sites-available/mindsift.conf`):

```apache
<VirtualHost *:443>
    ServerName mindsift.example.com
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/mindsift.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/mindsift.example.com/privkey.pem

    # 1. WebSocket Tunneling
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)           ws://127.0.0.1:8080/$1 [P,L]
    RewriteCond %{HTTP:Upgrade} !=websocket [NC]
    RewriteRule /(.*)           http://127.0.0.1:8080/$1 [P,L]

    # 2. SSE Response Flushing
    <Location "/api/v1/events">
        ProxyPass "http://127.0.0.1:8080/api/v1/events" flushpackets=on
        ProxyPassReverse "http://127.0.0.1:8080/api/v1/events"
    </Location>

    ProxyPass / http://127.0.0.1:8080/
    ProxyPassReverse / http://127.0.0.1:8080/
</VirtualHost>
```

---

## Wenn der Proxy nicht angepasst werden kann

MindSift funktioniert auch hinter Proxys, die WebSocket blocken, Streams puffern oder nur kurze Anfragen erlauben. Die Notiz-Synchronisation wählt automatisch den besten verfügbaren Weg (WebSocket → SSE → Long-Polling → Abfrage alle 3 s); der Editor zeigt ihn an. Long-Polling-Anfragen dauern höchstens 25 s und bleiben damit unter üblichen Proxy-Grenzen. Details: [api/websocket.md](api/websocket.md).

## 🔍 Diagnose & Verifikation

Mit den folgenden Befehlen lässt sich die Erreichbarkeit und Streaming-Funktion prüfen:

### 1. Server-Sent Events Test (Standard-HTTPS)
```bash
curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer <DEIN_TOKEN>" https://mindsift.example.com/api/v1/events
```
*Erwartete Ausgabe:*
```text
: connected (transport: sse, id: sse_...)
data: {"event":"SSE_CONNECTED","payload":{"sseId":"sse_...","transport":"sse"},"timestamp":"..."}
: ping
```

### 2. WebSocket Handshake Test
```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: mindsift.example.com" \
  -H "Origin: https://mindsift.example.com" \
  -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Authorization: Bearer <DEIN_TOKEN>" \
  https://mindsift.example.com/api/v1/ws
```
*Erwartete Antwort:* `101 Switching Protocols`

---

## 🧭 Verwandte Dokumente
- 🔌 [WebSocket & Live-Protokoll](api/websocket.md)
- 🏗️ [Gesamtarchitektur](architecture.md)
- 🚨 [Bekannte Schwachstellen & Flaws](flaws.md)
