<div align="center">

# 🧠 MindSift
### *Notes, tasks and a clear head, self-hosted.*

[![Self-Hosted](https://img.shields.io/badge/100%25-Self--Hosted-2563eb?style=flat-square)](#quick-start)
[![Docker](https://img.shields.io/badge/Deployment-Single%20Container-2496ed?style=flat-square&logo=docker&logoColor=white)](#quick-start)
[![License](https://img.shields.io/badge/License-AGPLv3-6b7280?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-v0.94.0-16a34a?style=flat-square)](CHANGELOG.md)

**Nested notes you write together, tasks with a board and a calendar, shared lists, and an inbox for everything that has no place yet.**
One container, one SQLite file, your server.

### [Try the live demo](https://demo.mindsift.app) &nbsp;·&nbsp; [Website](https://mindsift.app/en/) &nbsp;·&nbsp; [Quick start](#quick-start)

<sub>Demo login: <code>admin</code> / <code>admin</code> (or <code>user</code> / <code>user</code> in a second window to see live collaboration). It resets every 20 minutes, so break whatever you like.</sub>

<p align="center">
  <img src="screenshots/workspace_desktop.webp" alt="MindSift workspace: two people editing the same note" width="90%" />
</p>

</div>

---

> ### 👋 Hey, before you scroll
>
> Yes, this was coded with a *lot* of AI help. No, that doesn't make it slop. I've put many, many evenings into it: deciding what goes in and what doesn't, testing every screen on my phone on the bus, ripping things out again and nitpicking pixels until it felt right. The robot typed, I argued with it.
>
> Credit where it's due: none of this came out of thin air. The idea is a remix of every outliner, kanban board and shopping list app I've ever loved (and a few I rage-quit), and the code stands on the shoulders of thousands of open-source developers whose work taught the models how to write it. So really, this is a big thank-you note with a login screen. 🙏
>
> It's free, and it stays free. Use it, fork it, host it for your family. If something's broken, open an issue. If you like it, a ⭐ makes my day. And if you hate it… please don't. Just close the tab. 😅

---

## What it is

MindSift is an outliner and a task manager in one self-hosted app, made for more than one person:

* **Notes** are trees of bullets that several people edit at the same time and that keep working offline, with drawings, code blocks and links between notes.
* **Tasks** live in lists, on a kanban board and in a calendar. A to-do inside a note can be a full task there as well, and both stay in sync.
* **Lists** for shopping and packing change on everyone's phone the moment you tick something off.
* **An inbox** takes whatever comes to mind in one line. You sort it later, card by card.

---

## What's inside

### 📝 Outliner notes, together, live
Every thought is a bullet: indent, collapse, zoom in, drag whole branches. Wiki links (even to single bullets, and they survive renaming or moving a note), hashtags, slash commands, code blocks, tables, images, voice notes, live dictation, link previews and hidden values (`/secret` for an IP or a token: stored encrypted, shown only on a tap, never to API keys or AI agents). Several people write in the same note at the same time, without overwriting each other, and it keeps working offline and behind strict proxies. Share a note by public link for a quick look from outside: read only, optionally with a password, always expiring and out of search engines.

Drawings right in a note (`/canvas`): shapes, arrows that dock to them, text and freehand, edited full screen; AI agents can draw flowcharts and mind maps from Mermaid. Focus mode hides everything but the note, with the bar and the folders pinned if you like.

<p align="center">
  <img src="screenshots/Focus_desktop.webp" alt="MindSift focus mode with pinned bar and sidebar, a note with a network plan drawing" width="90%" />
</p>

### ✅ Tasks, kanban & calendar
List, board and calendar view (month or week, with a column of unscheduled tasks to drag onto a day) with your own columns, priorities, due dates, subtasks, recurring tasks, drag & drop and undo. Share task lists, mention people with @, watch tasks or mute a busy shared list, and get alarms and a daily summary by email, push, Discord or webhook.

Notes and tasks belong together: a to-do in a note can be kept as a full task with a due date, a column and an alarm, and its checkmark, title and subtasks stay the same in both places. The other way round, "Expand as a note" gives a task a note of its own, and the "To-dos" tab collects the open checkboxes of all your notes.

<p align="center">
  <img src="screenshots/aufgaben_desktop.webp" alt="MindSift tasks and kanban board" width="90%" />
</p>

<p align="center">
  <img src="screenshots/calendar_desktop.webp" alt="MindSift tasks in the calendar view: a month with tasks on their days, repeating tasks shown ahead, unscheduled tasks on the right" width="90%" />
</p>

### 📅 Journal
One note per day, all days below each other, with a calendar to jump around (a dot marks the days you wrote on) and a "Today" button. Every day is an ordinary note: share it, search it, link to it, write in focus mode. Days you leave empty disappear again by themselves. Don't need it? Switch it off per device.

<p align="center">
  <img src="screenshots/journal_desktop.webp" alt="MindSift journal with calendar" width="90%" />
</p>

### 🛒 Shared lists
Shopping, packing and checklists with categories by hashtag (`oat milk #fridge`) and quantities. Tick something off at the supermarket and it's gone on everyone's phone right away.

<p align="center">
  <img src="screenshots/Listen_desktop.webp" alt="MindSift shared lists" width="90%" />
</p>

### ⚡ Quick capture & triage
When a thought pops up, you don't want to pick a folder or fill in fields. So capture comes first: the input bar (`C` or `/`), voice input (in the browser or through your own Whisper server, so nothing leaves your network), the share menu of your phone, or the API. Everything lands in an inbox, and the Tinder-style triage empties it later, one card at a time: with a key (`H`/`L`, arrows) or a swipe, a card is discarded or becomes a task, a note or a list item.

<p align="center">
  <img src="screenshots/Triage_desktop.webp" alt="MindSift triage on the desktop, light theme on the left, dark on the right" width="85%" />
</p>

### 🎨 Looks & app
Five colour families, each light and dark, your own accent colour, round or square corners, plus a theme manager for your own CSS. Installable as an app (PWA) on phone and desktop, starts offline, with push notifications. Speaks English, German, Spanish, French and Italian, mails and notifications included.

<p align="center">
  <img src="screenshots/Mobile_Workspace.webp" alt="MindSift note on the phone, dark theme" width="280px" />
  &nbsp;&nbsp;
  <img src="screenshots/Mobile_Triage.webp" alt="MindSift triage on the phone, light theme" width="280px" />
</p>

<table>
  <tr>
    <td align="center"><img src="screenshots/Theme_fjord.webp" alt="Fjord colour family, light on the left, dark on the right" /><br /><sub><b>Fjord</b></sub></td>
    <td align="center"><img src="screenshots/Theme_terracotta.webp" alt="Terracotta colour family, light on the left, dark on the right" /><br /><sub><b>Terracotta</b></sub></td>
  </tr>
  <tr>
    <td align="center"><img src="screenshots/Theme_polarized.webp" alt="Polarized colour family, light on the left, dark on the right" /><br /><sub><b>Polarized</b></sub></td>
    <td align="center"><img src="screenshots/Theme_suri.webp" alt="Suri colour family, light on the left, dark on the right" /><br /><sub><b>Suri</b></sub></td>
  </tr>
</table>

### 🤖 AI agents, API & smart home
MindSift is an **MCP server**: Claude, ChatGPT, Codex, Cursor and your own agents can read and manage your tasks, lists and notes. claude.ai and ChatGPT connect via OAuth, no key needed. A REST API with scoped keys covers Home Assistant sensors, curl scripts and webhooks. Whatever a key creates or changes carries a badge with its name, so you can always tell what an agent did.

```bash
claude mcp add --transport http mindsift https://your-server/api/v1/mcp --header "X-API-Key: mindsift_sec_…"
```

### 🏢 Users & admin
Guided first-time setup, invite codes and links, registration modes (closed, approval, email domains, open), organizations (a person can be in several) that decide who may share with whom, people search that can be switched off, a user manager role that looks after accounts without touching the server settings, groups, sharing as editor or read-only, automatic backups and restore.

**The full feature tour lives on the [website](https://mindsift.app/en/). Or just [open the demo](https://demo.mindsift.app) and poke around.**

---

## How it compares

MindSift sits between a notes app and a task manager. If one of these fits you better, use it; they are good.

* **[Obsidian](https://obsidian.md):** your notes are Markdown files on your own disk, with native apps and a huge plugin ecosystem. It is an app, not a server: there is no web version, and writing in the same note at the same time is not built in. MindSift is a server with a web app; it keeps notes in a database and hands them out as Markdown (an Obsidian vault) whenever you ask.
* **[Logseq](https://logseq.com):** the closest relative on the notes side, an open-source, local-first outliner with backlinks, queries, a graph view and plugins. It goes much deeper there than MindSift. MindSift's outliner is simpler, but it runs on your server, is shared with other people and comes with tasks, lists and alarms.
* **[Vikunja](https://vikunja.io):** the more complete self-hosted task manager, with Gantt and table views, CalDAV, sign-in through OIDC and a choice of databases. It has no notes. MindSift's tasks cover list, board and calendar and are tied to notes, with fewer integrations.
* **[Joplin](https://joplinapp.org):** a mature notes app with native apps on every platform, end-to-end encryption and a web clipper, synchronised through its own server or a cloud drive. A note is one Markdown document rather than an outline, and two people do not write in it at the same moment. MindSift has none of those three strengths; it has live collaboration and tasks.

If something here is out of date or unfair, please open an issue.

---

## Not (yet) in MindSift

What people ask a self-hosted app for first, and what MindSift does not have today:

* **Single sign-on (OIDC/SSO)** through Authentik, Authelia or Keycloak. MindSift only has its own accounts.
* **Two-factor sign-in and passkeys.** Two-factor is planned.
* **PostgreSQL or MySQL.** SQLite, on purpose (see [design decisions](#design-decisions)).
* **CalDAV or an iCal feed.** The calendar exists inside MindSift only.
* **Native apps.** It is a PWA: installable, offline, with push notifications, but not in the app stores.
* **End-to-end encryption.** The server reads your data, because search, sharing and AI agents need it to; only hidden values (`/secret`) are encrypted in the database. Protect the server and its disk.
* **Prometheus metrics.** A health endpoint says that the server answers, nothing more.
* **Backups to S3 or WebDAV.** Backups go to `data/backups/`; copying them elsewhere is up to you.
* **A Helm chart.** Docker Compose only.

More ideas and the known weak spots: [Doku/flaws.md](Doku/flaws.md).

---

## Quick start

MindSift is a single container with web server, API, database and frontend. The image runs on amd64 and arm64: ordinary servers and PCs, a Raspberry Pi with a 64-bit system, Apple Silicon, ARM cloud servers.

**Docker Compose:**

```yaml
services:
  mindsift:
    image: ghcr.io/mindsift-app/mindsift:stable   # the latest tagged release
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      - JWT_SECRET=put-a-long-random-value-here
      - BASE_URL=https://mindsift.example.com
```

Open `http://localhost:8080` and a wizard creates the admin account. Do that right after the first start, so nobody else grabs it.

**Or the install script** ([read it first](install.sh)):

```bash
curl -fsSL https://raw.githubusercontent.com/mindsift-app/mindsift/main/install.sh | bash
```

It creates a folder, downloads `docker-compose.yml` and `.env.example`, generates a `JWT_SECRET`, takes over the server's time zone and starts the container. Two optional questions, both "no" when you just press Enter:

* **Your own speech recognition (Whisper)?** Adds the speaches container with the model you pick (large-v3-turbo or small) and connects MindSift to it; the model downloads by itself on the first start.
* **Behind a reverse proxy?** Asks for the public address (`BASE_URL`) and the Docker network of your proxy, if it has one.

These additions go into `docker-compose.override.yml`, so `docker-compose.yml` can be replaced on updates. Running the script again updates `docker-compose.yml` and keeps your `.env`.

All settings are explained in [`.env.example`](.env.example). Optional voice recognition: uncomment the `whisper` block in [`docker-compose.yml`](docker-compose.yml) and set `STT_URL=http://whisper:8000` (or let the install script do it). Any Whisper model in CTranslate2 format works; which one to pick is in the [docs](Doku/architecture.md#speech-recognition).

**Without a container:** the [releases](https://github.com/mindsift-app/mindsift/releases) also carry the server as a single file for Linux (amd64 and arm64), with the frontend inside. Unpack it and start `./mindsift`: it listens on port 8080 and keeps everything in `./data`. `PORT` and `DATA_DIR` change that; the other settings work as in the container.


---

## Running it

The most important settings (all of them, with explanations, are in [`.env.example`](.env.example)):

| Variable | Default | What for |
|---|---|---|
| `JWT_SECRET` | generated (`/data/jwt.secret`) | Signing key for sign-in tokens; better set your own long random value |
| `SECRETS_KEY` | generated (`/data/secrets.key`) | Key for hidden values in notes (`/secret`); set your own to keep it apart from the database. Never change it once values are stored |
| `BASE_URL` | `http://localhost:8080` | Public URL; needed for password reset mails, OAuth for claude.ai/ChatGPT and links in mails |
| `DEFAULT_LANGUAGE` | `de` (demo: `en`) | Language (`de`, `en`, `es`, `fr`, `it`) where the browser's is none of these, see "Language" below; the setup wizard and the admin UI can change it |
| `TZ` | `Europe/Berlin` | Time zone for due dates and alarms |
| `REGISTRATION_MODE` | admin UI decides | `closed`, `approval`, `domain`, `domain+approval` or `open` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | empty | Mail for alarms, invites and password reset (also in the admin UI) |
| `TRUSTED_PROXIES` | `private` | Whose `X-Forwarded-For` to trust, see [reverse proxy](Doku/reverse-proxy.md) |
| `MCP_ENABLED` | admin UI decides | `false` switches off the endpoint for AI agents |
| `STT_*` | empty | Your own Whisper server for voice input, see [architecture](Doku/architecture.md#speech-recognition) |
| `MINDSIFT_DEMO` | `false` | Demo accounts `admin/admin` and `user/user` with sample data. **Never on a public server with real data!** |

* **Language:** the app follows the browser's language when that is English, German, Spanish, French or Italian, and everyone can pick their own in the settings. `DEFAULT_LANGUAGE` only decides the rest. Unset, it is German, because that is where the project started; for an English instance set `DEFAULT_LANGUAGE=en` or choose it in the setup wizard.
* **Reverse proxy:** pass through WebSocket upgrades and unbuffered SSE if you can. If not, MindSift falls back to long polling by itself. Examples for nginx, Traefik, Caddy and Cloudflare: [Doku/reverse-proxy.md](Doku/reverse-proxy.md).
* **Backups:** switch on daily backups in the admin settings: the whole database for you, plus one ZIP per person under `data/backups/` that everyone can download or restore in their account settings (kept 3 days by default, adjustable). Every one of these ZIPs also holds the person's notes, tasks and lists as an Obsidian vault in plain Markdown, so the data stays readable even without MindSift. Copy that folder somewhere else too.
* **Updates:** `docker compose pull && docker compose up -d`. The database schema updates itself; open apps offer to reload. From v0.87.3 the container runs as uid 1000 and takes over `data/` on the first start by itself; with `user:` in the compose file, give `data/` to that user first (`chown -R 1000:1000 data`).
* **Health check:** the container checks `/api/v1/health` every 30 s, so `docker ps`, Portainer and Dockge show whether it is healthy and other services can wait for it (`depends_on: condition: service_healthy`). Podman ignores the check in the image; `docker-compose.yml` therefore repeats it as `healthcheck:`, copy that block into your own compose file.
* **File permissions:** MindSift creates everything in `data/` for itself only (files 0600, folders 0700), so other accounts on the host cannot read the database, keys or backups. The container also closes files from older versions on its first start (once, only when something there is still open); without the container, `chmod -R go-rwx data` does it.
* **Image tags:** `:stable` = the latest tagged release (default in `docker-compose.yml` and the install script), `:vX.Y.Z` = one tagged release, `:latest` = every release from `main`, `:dev` = development. "Stable" is the name of the tag, not a 1.0: the project is 0.x, and a minor version can still change the API or data formats. The changelog marks those changes with **Attention**.
* **What changed:** [CHANGELOG.md](CHANGELOG.md).

---

## How it is built and checked

MindSift is written with a lot of AI help (see the note at the top). One person decides what goes in and tries it on real devices. What keeps the code honest is that it gets checked:

* **Tests:** more than 430 frontend tests and more than 340 backend tests run before every push and again in the build of every release. If one fails, no image is published.
* **Browser tests:** seven runs with over 120 checks cover what is hard to unit-test: two people editing the same note at once, offline and back online, sharing, locks and conflict copies, copy & paste as Markdown in Chromium and Firefox, and connections behind proxies that block WebSockets ([e2e/](e2e/README.md)). They run before every release and before every change to these areas.
* **Static checks:** TypeScript, ESLint, gofmt, `go vet` and staticcheck, in the same run as the tests.
* **Security:** the whole code base was reviewed for security in November 2026 and the findings are fixed ([Security](#security)). Every tagged release is scanned with Trivy before it is published ([Security scan](#security-scan)).
* **Weak spots are written down:** [Doku/flaws.md](Doku/flaws.md).

History starts at v0.70.0, when the project moved from a private repository. The [changelog](CHANGELOG.md) and its [archive](CHANGELOG-archive.md) go back to 0.1.

---

## Design decisions

MindSift builds a few things itself that other projects take from a library, and leaves out a few that are standard elsewhere. The short version (the long one, with what each decision costs, is in [Doku/architecture.md](Doku/architecture.md#design-decisions)):

* **One process, one SQLite file:** nothing to run besides the container, and a backup is a file copy. No cluster, no PostgreSQL.
* **Own note sync instead of Yjs or Automerge:** the server has to understand a note (rights, search, backlinks, Markdown), and sync has to survive proxies that cut WebSockets, where Yjs did not hold up. Every change is a plain HTTP request against an operations log. The price: two people cannot type in the same bullet at once.
* **Own OAuth and MCP server:** claude.ai and ChatGPT only connect through OAuth issued by the MCP server itself (discovery, dynamic client registration, PKCE), and MCP over HTTP is four JSON-RPC methods.
* **Own drawing layout:** agents hand in Mermaid, and the server turns it into drawings you can keep editing.
* **Two chunks:** the sign-in page needs about 170 kB compressed, the app itself about 370 kB more after signing in. The service worker loads every part when it installs, so the installed app is complete offline once it has been opened.
* **Few dependencies:** eight direct Go modules and a handful of npm packages at runtime.
* **Grown rather than designed:** a session is a signed token plus a database row plus a version counter. A random session ID would do the same with less; it works and is tested, so it stays for now.

---

## Performance

MindSift is load-tested on the public demo, a deliberately small server with **1 CPU core and 1 GB RAM**. Simulated people sign in, open notes and type in them, work with tasks and lists and search, all at the same time:

| People working at once | Typical answer (median) | Slowest 5 % | Errors |
|---|---|---|---|
| 200, about 10 per note | ~0.25 s | ~1 s | 0 % |
| 300, about 10 per note | ~3 s | ~6–9 s | under 1 % |
| 200, all in the **same** note | ~3 s for an edit | ~7.5 s | 0 % |

* **Around 200 people working at the same moment** run smoothly on that single core. That is far more than are usually active at once on an instance of a few hundred accounts.
* **Above that, the CPU is the limit**, and everything slows down evenly instead of failing. More cores or a faster CPU help directly.
* **Many people in one note:** changes to the same note are applied one after another so that nobody's edits get lost. Hundreds typing in a single note at once therefore wait for each other; opening the note stays fast.
* **It recovers by itself:** even after 1,200 people at once the server answers normally again as soon as the load drops, without a restart.
* **Search** was the most expensive request in these runs and has become about four times faster on the server since (v0.83.4).

All data lives in one SQLite file, so a single server is the intended setup; there is no cluster mode.

---

## Security

MindSift is meant to be reachable from the internet behind a reverse proxy, and the whole code base was reviewed for security in November 2026 (v0.94.0); its findings are fixed (see the [CHANGELOG](CHANGELOG.md)). What protects your data:

* **Sign-in:** passwords are hashed with bcrypt. Every login is a server-side session tied to a signed token; sessions are listed under Profile → Active sessions, can be ended one by one, end after 30 days without use and end with any password change. Repeated failures lock the account for that address after 3 tries, the account after 20 and the address after 30, each for 15 minutes; registration, "forgot password", the password asked before deleting data and the passwords of public links are limited the same way. A failed sign-in takes as long whether the account exists or not.
* **Secrets never in plain text:** API keys, OAuth tokens, password-reset and e-mail-confirmation links and the tokens of public links are stored only as SHA-256 hashes. Hidden values in notes are encrypted with AES-256-GCM under a key kept apart from the database (`SECRETS_KEY`). Well-known placeholder values for `JWT_SECRET` are refused and a random one is generated instead.
* **Rights checked on every request:** notes, folders, lists and task lists resolve the caller's role (owner, editor, viewer) on each call. API keys and MCP connections reach only what their scopes allow, OAuth tokens only the MCP endpoint. Public links are read-only, live at most 14 days, can carry a password and hide names, hidden values and links to other notes.
* **Addresses stay private:** others see names, usernames and profile pictures, never e-mail addresses. A new login address only counts once its owner clicks the link mailed to it, and mail alarms and test mails go only to that confirmed address, so the server cannot be used to mail strangers.
* **Browser hardening:** HSTS over https, a strict Content Security Policy (scripts only from MindSift itself, no embedding in other sites), links in notes limited to http(s) and mailto, uploads recognised by their content (no SVG, no scripts), media and previews served with a sandboxing policy. Profile pictures are uploaded, never loaded from other servers.
* **Nothing reaches into your network:** every address the server contacts (webhooks, Discord, push services, link previews, image copies) is checked at connection time against localhost, link-local, cloud-metadata and private ranges, after DNS and after redirects (never from https down to http); private ranges only with an explicit admin switch. `X-Forwarded-*` headers only count from trusted proxies.
* **Limits everywhere:** request bodies capped per endpoint, realtime connections capped per account, import archives checked for size and file count before anything is written.
* **Quiet logs and errors:** tokens of public links and typed sign-in names stay out of the log; unexpected errors tell clients and AI agents nothing about the database or files. Everything in `data/` is readable by MindSift only.
* **Supply chain:** the image runs as an unprivileged user, every release is scanned with Trivy (below), and `govulncheck` and `npm audit` report no vulnerability reachable from the code (November 2026).

Found something? Please follow [SECURITY.md](SECURITY.md).

---

## Security scan

[![Weekly Security Scan](https://github.com/mindsift-app/mindsift/actions/workflows/security-scan.yaml/badge.svg)](https://github.com/mindsift-app/mindsift/actions/workflows/security-scan.yaml)

The image is scanned with [Trivy](https://trivy.dev) for known vulnerabilities, leaked secrets and misconfigurations:

* **every tagged release** (`:stable`, `:vX.Y.Z`) before it is published, and every build that changes the base image, the Go version or the Go modules: a known high or critical vulnerability that already has a fix, or a leaked secret, stops the release;
* **the published `:stable` and `:latest` every week**, because new vulnerabilities become known after a release. The badge shows the last weekly run, and its log has the result.

Two things you will notice when you scan the image yourself:

* **Not as root:** since v0.87.3 MindSift runs as the user `mindsift` (uid 1000). The image starts as root only long enough to hand `data/` to that user (once, for installations from before), then drops the rights. Trivy's misconfiguration check therefore still notes a missing `USER` line; that is intended.
* **Entries for code MindSift does not call:** Trivy lists everything known about a module, used or not, for example the `openpgp` package of `golang.org/x/crypto`, of which MindSift only uses `bcrypt`. [govulncheck](https://go.dev/blog/govulncheck), which follows the code that is actually called, reports no vulnerability that affects MindSift (November 2026).

```bash
docker run --rm aquasec/trivy image ghcr.io/mindsift-app/mindsift:stable
```

---

## Your data is yours

No telemetry, no third-party services, fonts and icons ship with the app. The server only connects out for what you use: notifications (SMTP, Discord, your webhook, the browsers' push services), link previews (switchable per device) and your own Whisper server. Everything lives in one SQLite file, media next to it in `data/media/`. Export the whole workspace as an Obsidian-compatible Markdown archive, or your data as a backup ZIP (with that Markdown vault inside), whenever you want. If MindSift ever stops working for you, open the `Obsidian` folder of any backup in Obsidian or a text editor and you have everything.

---

## Development

Go 1.27 and Node 22.

```bash
go vet ./... && go test ./...      # backend
cd frontend && npm ci
npm run dev                        # Vite dev server
npx tsc --noEmit && npm run test:run
cd .. && ci/local-checks.sh        # all checks at once in containers (podman), with gofmt and staticcheck
e2e/run.sh                         # browser tests (Playwright) against a fresh image
e2e/screenshots.sh                 # recreate the screenshots in this README
```

The multi-stage `Dockerfile` builds the frontend, embeds it into the Go binary and runs all checks. **Stack:** Go (chi, gorilla/websocket, modernc SQLite) · React 18, TypeScript, Vite, Tailwind.

Technical documentation: [Doku/](Doku/README.md) (architecture, database, REST and realtime API, collaboration, permissions, themes). Known weak spots: [Doku/flaws.md](Doku/flaws.md).

---

## License

MindSift is free software under the [GNU Affero General Public License v3.0](LICENSE): use it, change it, pass it on, even commercially. If you hand out a changed version or run it as a service on the net, its source has to be available under the same license. No warranty.

<div align="center">

**[Try the demo](https://demo.mindsift.app)** · **[mindsift.app](https://mindsift.app/en/)**

<sub>Built for clarity, speed and owning your own stuff. With love, stolen ideas and a robot.</sub>

</div>
