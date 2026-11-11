# 🛡️ Reverse Proxy & Web Server Configuration Guide

This document describes the recommended configuration of reverse proxies and ingress controllers for MindSift. MindSift uses a **hybrid real-time architecture** consisting of bidirectional **WebSockets** and an automatic **Server-Sent Events (SSE) fallback** to ensure uninterrupted live synchronization even in the most restrictive corporate networks, behind strict firewalls, or with deep packet inspection.

---

## ⚡ Key Requirements at a Glance

| Protocol | Default Port | Required Headers & Settings | Purpose |
| :--- | :--- | :--- | :--- |
| **WebSockets** | 443 (WSS) / 80 (WS) | `Upgrade $http_upgrade`<br>`Connection "Upgrade"`<br>`proxy_read_timeout 3600s` | Bidirectional live updates (tasks, lists, notes) |
| **Server-Sent Events (SSE)** | 443 (HTTPS) / 80 (HTTP) | `X-Accel-Buffering: no`<br>`proxy_buffering off`<br>`proxy_cache off` | Fallback when WebSocket upgrade is blocked |
| **REST API & Uploads** | 443 (HTTPS) / 80 (HTTP) | `client_max_body_size 64M` | Notes, import/export (JSON) |
| **Client IP** | – | `X-Real-IP` / `X-Forwarded-For` | Login lockouts after failed attempts target the correct sender |
| **OAuth (MCP)** | 443 (HTTPS) | Pass `/.well-known/oauth-*` and `/oauth/*` through to MindSift (automatic with `location /`), `BASE_URL` set | claude.ai and ChatGPT as connectors |

### Client IP and `TRUSTED_PROXIES`

MindSift also locks logins after failed attempts on a per-IP address basis. Behind a proxy, every connection originates from the proxy; the real address is contained in `X-Forwarded-For` or `X-Real-IP`. MindSift only trusts these headers if the connection comes from a trusted proxy, otherwise anyone who directly reaches the port could spoof an arbitrary address.

| `TRUSTED_PROXIES` | Effect |
|---|---|
| `private` (default) | Proxies from localhost, Docker, and private/home networks (`10.x`, `172.16–31.x`, `192.168.x`, `fd…`, `100.64.x`). Suitable for a proxy in the same Docker network or on the same host — nothing to configure. |
| `private,198.51.100.0/24` | Additional custom ranges, e.g., an external proxy server or [Cloudflare IP ranges](https://www.cloudflare.com/ips/) |
| `all` | Always trust headers (former behavior) — escape hatch if detection causes issues |
| `none` | Never trust headers |

If a trusted proxy does not send any client IP, a warning is logged once, and only account-level lockout applies to these requests. The entire login lockout mechanism can be disabled with `LOGIN_PROTECTION=false`.

**Without a reverse proxy, set `TRUSTED_PROXIES=none`.** When MindSift's port is published directly (e.g. `ports: "8080:8080"` with nobody in front), Docker may hand connections over through its userland proxy, so every visitor appears to come from the bridge address (`172.17.0.1`). That address is private and therefore trusted by default, and any visitor could then choose their own address via `X-Forwarded-For` and slip past the per-address lockouts. The per-account lockout still applies.

The same trust decides about `X-Forwarded-Proto` and `X-Forwarded-Host`: MindSift only uses them (for the page's own address in link previews, for HSTS and, without `BASE_URL`, for links in invitation mails) when they come from a trusted proxy. Set `BASE_URL` whenever MindSift sends mail; links to people who are not signed in are only ever built from it.

### HTTPS and HSTS

When a visitor comes over https (directly, through a trusted proxy that sends `X-Forwarded-Proto: https`, or `BASE_URL` starts with `https://`), MindSift sends `Strict-Transport-Security: max-age=31536000`. Browsers then use https only for a year. It deliberately leaves out `includeSubDomains`, so other services under the same domain are not affected. If your proxy sets its own HSTS header, keep one of the two; there is nothing else to configure. Redirect plain http to https in the proxy (all examples below do or can).

---

## 1. Nginx

A typical `nginx.conf` or site configuration under `/etc/nginx/sites-available/mindsift`:

```nginx
# Map for clean connection handling during WebSocket upgrades
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

    # Maximum payload size for large notes and exports
    client_max_body_size 64M;

    # MindSift frontend & REST API
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 1. WebSocket endpoints (/api/v1/ws)
    location /api/v1/ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Upgrade header strictly required
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Prevents premature disconnection due to proxy inactivity timeout
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # 2. Server-Sent Events fallback (/api/v1/events & /api/v1/sync/)
    location ~ ^/api/v1/(events|sync/) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Disabling buffering is mandatory for immediate event streaming
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

When using Traefik version 2/3, no explicit WebSocket upgrades need to be declared, as Traefik passes them through transparently. For Server-Sent Events and timeouts, middleware definitions are recommended:

```yaml
version: '3.8'

services:
  mindsift:
    image: ghcr.io/mindsift-app/mindsift:stable
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

      # Prevents buffering and keeps persistent SSE streams alive
      - "traefik.http.middlewares.mindsift-buffering.buffering.maxRequestBodyBytes=67108864"
      - "traefik.http.routers.mindsift.middlewares=mindsift-buffering"
```

---

## 3. Caddy Server (Caddyfile)

Caddy supports WebSockets and HTTP/2 Server-Sent Events fully out of the box:

```caddyfile
mindsift.example.com {
    encode gzip zstd

    # Forward event stream (SSE) without buffering
    reverse_proxy 127.0.0.1:8080 {
        # Optimize streaming for SSE
        flush_interval -1
    }
}
```

---

## 4. Cloudflare Proxy (Orange Cloud)

When running MindSift behind the Cloudflare CDN:
1. **Enable WebSockets:**
   - Navigate to the Cloudflare Dashboard: **Network** > **WebSockets** > toggle switch to **ON**.
2. **Cloudflare Rocket Loader / Auto Minify:**
   - Disable "Rocket Loader" for MindSift, as asynchronous script injections can interfere with single-page app initialization.
3. **Cloudflare WAF / Bot Fight Mode:**
   - Ensure that `GET /api/v1/events` and `GET /api/v1/ws*` are not blocked by challenge pages.
4. **Client IP:** Cloudflare provides the visitor's IP address in `CF-Connecting-IP`/`X-Forwarded-For`. If Cloudflare communicates directly with MindSift (without an intermediary proxy of your own), add Cloudflare IP ranges to `TRUSTED_PROXIES`.
5. **SSE Support:**
   - Cloudflare natively supports Server-Sent Events over HTTP/2 and HTTP/3. Thanks to the `X-Accel-Buffering: no` and `Cache-Control: no-cache` headers set by the MindSift backend, Cloudflare streams real-time events to clients without delay.

---

## 5. Apache 2.4 (`mod_proxy_wstunnel`)

On Debian/Ubuntu:
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel headers
sudo systemctl restart apache2
```

VirtualHost configuration (`/etc/apache2/sites-available/mindsift.conf`):

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

## When the Proxy Cannot Be Adjusted

MindSift also works behind proxies that block WebSockets, buffer streams, or only allow short requests. Note synchronization automatically selects the best available transport (WebSocket → SSE → long polling → polling every 3 s); the editor displays the active transport. Long polling requests last at most 25 s, staying within typical proxy timeout limits. Details: [api/websocket.md](api/websocket.md).

A few requests can take longer than a minute: restoring a server backup, "Back up now" on a server with many accounts, deleting a large account, a test mail through a mail server that does not answer. MindSift gives them up to 5 minutes. A proxy that cuts answers earlier (Nginx: `proxy_read_timeout`, 60 s by default) answers them with an error of its own, while the server still finishes the work.

## 🔍 Diagnostics & Verification

The following commands can be used to verify connectivity and streaming functionality:

### 1. Server-Sent Events Test (Standard HTTPS)
```bash
curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer <YOUR_TOKEN>" https://mindsift.example.com/api/v1/events
```
*Expected output:*
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
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  https://mindsift.example.com/api/v1/ws
```
*Expected response:* `101 Switching Protocols`

---

## 🧭 Related Documents
- 🔌 [WebSocket & Live Protocol](api/websocket.md)
- 🏗️ [Overall Architecture](architecture.md)
- 🚨 [Known Vulnerabilities & Flaws](flaws.md)
