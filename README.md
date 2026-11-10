<div align="center">

# 🧠 MindSift
### *A clear head in three seconds.*

[![Self-Hosted](https://img.shields.io/badge/100%25-Self--Hosted-2563eb?style=flat-square)](#-quick-start)
[![Docker](https://img.shields.io/badge/Deployment-Single%20Container-2496ed?style=flat-square&logo=docker&logoColor=white)](#-quick-start)
[![License](https://img.shields.io/badge/License-AGPLv3-6b7280?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-v0.94.0-16a34a?style=flat-square)](CHANGELOG.md)

**Dump a thought, sort it later, turn it into a task, a note or a shopping list, alone or together.**
Self-hosted, one container, one SQLite file, your server.

### [▶ Try the live demo](https://demo.mindsift.app) &nbsp;·&nbsp; [🌐 Website](https://mindsift.app/en/) &nbsp;·&nbsp; [🚀 Quick start](#-quick-start)

<sub>Demo login: <code>admin</code> / <code>admin</code> (or <code>user</code> / <code>user</code> in a second window to see live collaboration). It resets every 20 minutes, so break whatever you like.</sub>

<p align="center">
  <img src="screenshots/Triage_desktop.webp" alt="MindSift triage on the desktop, light theme on the left, dark on the right" width="85%" />
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

## 🧪 Tested before every release

Every release runs through **over 350 frontend tests** and **almost 300 backend tests** before an image is published, and a release with a single failing test never ships. On top of that, **seven browser test runs with over 120 checks** cover what is hard to unit-test: two people editing the same note at once, offline and back online, sharing, locks and conflict copies, copy & paste as Markdown in Chromium and Firefox, and connections behind proxies that block WebSockets. They run before every change to these areas ([e2e/](e2e/README.md)). And every tagged release (`:stable`) is **scanned for known vulnerabilities with Trivy** before it is published ([security scan](#%EF%B8%8F-security-scan)).

All of this to keep your data safe and make sure everything runs smoothly for you.

---

## 💡 The idea

Most notes and task apps demand structure at the wrong moment. When a thought pops up, you don't want to pick a folder or fill in fields. MindSift separates **capturing** from **organizing**:

1. **Dump:** type into the bar, hit `Enter`, done. Or hold the `+` on your phone and just talk.
2. **Sort (triage):** later, go through the pile card by card: discard, make it a task, turn it into a note or a list item. One key or one swipe each.
3. **Go deeper:** loose ideas grow into tasks with subtasks, linked outliner notes or lists you share with your family or team.

The [website](https://mindsift.app/en/) shows all of this with little interactive demos. Even better: [click around in the real thing](https://demo.mindsift.app).

---

## ✨ What's inside

### ⚡ Quick dump & triage
Capture from anywhere: the input bar (`C` or `/`), voice input (in the browser or through your own Whisper server, so nothing leaves your network), the share menu of your phone, or the API. Then sort it in the triage deck with the keyboard (`H`/`L`, arrows) or by swiping.

<p align="center">
  <img src="screenshots/Mobile_Triage.webp" alt="MindSift triage on the phone, light theme" width="280px" />
  &nbsp;&nbsp;
  <img src="screenshots/Mobile_Workspace.webp" alt="MindSift note on the phone, dark theme" width="280px" />
</p>

### ✅ Tasks, kanban & calendar
List, board and calendar view (month or week, with a column of unscheduled tasks to drag onto a day) with your own columns, priorities, due dates, subtasks, recurring tasks, drag & drop and undo. Share task lists, mention people with @, watch tasks or mute a busy shared list, and get alarms and a daily summary by email, push, Discord or webhook.

<p align="center">
  <img src="screenshots/aufgaben_desktop.webp" alt="MindSift tasks and kanban board" width="90%" />
</p>

<p align="center">
  <img src="screenshots/calendar_desktop.webp" alt="MindSift tasks in the calendar view: a month with tasks on their days, repeating tasks shown ahead, unscheduled tasks on the right" width="90%" />
</p>

### 📝 Outliner notes, together, live
Every thought is a bullet: indent, collapse, zoom in, drag whole branches. Wiki links (even to single bullets, and they survive renaming or moving a note), hashtags, slash commands, code blocks, images, voice notes, live dictation, link previews and hidden values (`/secret` for an IP or a token: stored encrypted, shown only on a tap, never to API keys or AI agents). Several people write in the same note at the same time, without overwriting each other, and it keeps working offline and behind strict proxies. Share a note by public link for a quick look from outside: read only, optionally with a password, always expiring and out of search engines.

<p align="center">
  <img src="screenshots/workspace_desktop.webp" alt="MindSift workspace: two people editing the same note" width="90%" />
</p>

Drawings right in a note (`/canvas`): shapes, arrows that dock to them, text and freehand, edited full screen; AI agents can draw flowcharts and mind maps from Mermaid. Focus mode hides everything but the note, with the bar and the folders pinned if you like.

<p align="center">
  <img src="screenshots/Focus_desktop.webp" alt="MindSift focus mode with pinned bar and sidebar, a note with a network plan drawing" width="90%" />
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

### 🎨 Looks & app
Five colour families, each light and dark, your own accent colour, round or square corners, plus a theme manager for your own CSS. Installable as an app (PWA) on phone and desktop, starts offline, with push notifications. Speaks English, German, Spanish, French and Italian, mails and notifications included.

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
MindSift is an **MCP server**: Claude, ChatGPT, Codex, Cursor and your own agents can read and manage your tasks, lists and notes. claude.ai and ChatGPT connect via OAuth, no key needed. A REST API with scoped keys covers Home Assistant sensors, curl scripts and webhooks. Whatever a key creates or changes carries a badge with its name, so you always know what the robot did.

```bash
claude mcp add --transport http mindsift https://your-server/api/v1/mcp --header "X-API-Key: mindsift_sec_…"
```

### 🏢 Users & admin
Guided first-time setup, invite codes and links, registration modes (closed, approval, email domains, open), organizations (a person can be in several) that decide who may share with whom, people search that can be switched off, a user manager role that looks after accounts without touching the server settings, groups, sharing as editor or read-only, automatic backups and restore.

👉 **The full feature tour lives on the [website](https://mindsift.app/en/). Or just [open the demo](https://demo.mindsift.app) and poke around.**

---

## 🚀 Quick start

MindSift is a single container with web server, API, database and frontend.

**Install script:**

```bash
curl -fsSL https://raw.githubusercontent.com/mindsift-app/mindsift/main/install.sh | bash
```

It creates a folder, downloads `docker-compose.yml` and `.env.example`, generates a `JWT_SECRET`, takes over the server's time zone and starts the container. Two optional questions, both "no" when you just press Enter:

* **Your own speech recognition (Whisper)?** Adds the speaches container with the model you pick (large-v3-turbo or small) and connects MindSift to it; the model downloads by itself on the first start.
* **Behind a reverse proxy?** Asks for the public address (`BASE_URL`) and the Docker network of your proxy, if it has one.

These additions go into `docker-compose.override.yml`, so `docker-compose.yml` can be replaced on updates. Running the script again updates `docker-compose.yml` and keeps your `.env`.

**Or Docker Compose by hand:**

```yaml
services:
  mindsift:
    image: ghcr.io/mindsift-app/mindsift:stable   # :stable = tagged releases, :latest = every release
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    environment:
      - JWT_SECRET=put-a-long-random-value-here
      - BASE_URL=https://mindsift.example.com
```

Open `http://localhost:8080` and a wizard creates the admin account. Do that right after the first start, so nobody else grabs it.

All settings are explained in [`.env.example`](.env.example). Optional voice recognition: uncomment the `whisper` block in [`docker-compose.yml`](docker-compose.yml) and set `STT_URL=http://whisper:8000` (or let the install script do it).

**Which speech model?** The two the install script offers (large-v3-turbo, small) are OpenAI's multilingual Whisper models and work well in German, English, Spanish, French and Italian. Any Whisper model in CTranslate2 format runs too, for example one fine-tuned for a single language: [list of compatible models on Hugging Face](https://huggingface.co/models?pipeline_tag=automatic-speech-recognition&library=ctranslate2&sort=downloads) (the same list speaches uses), add a language to the search, e.g. [German](https://huggingface.co/models?pipeline_tag=automatic-speech-recognition&library=ctranslate2&sort=downloads&search=german). Everyone picks the language they speak under Account settings → Voice input: automatic detection (the default, also good for sentences that mix languages), the app language, or any of Whisper's ~100 languages. Put the model's name into `STT_MODEL` in `.env` (e.g. `Systran/faster-whisper-small`) and run `docker compose up -d`; MindSift downloads it by itself. Larger models recognize better but need more RAM and time.

---

## ⚙️ Running it

The most important settings (all of them, with explanations, are in [`.env.example`](.env.example)):

| Variable | Default | What for |
|---|---|---|
| `JWT_SECRET` | generated (`/data/jwt.secret`) | Signing key for sign-in tokens; better set your own long random value |
| `SECRETS_KEY` | generated (`/data/secrets.key`) | Key for hidden values in notes (`/secret`); set your own to keep it apart from the database. Never change it once values are stored |
| `BASE_URL` | `http://localhost:8080` | Public URL; needed for password reset mails, OAuth for claude.ai/ChatGPT and links in mails |
| `DEFAULT_LANGUAGE` | `de` (demo: `en`) | Default language (`de`, `en`, `es`, `fr`, `it`) until an admin or the setup wizard picks one; everyone can choose their own |
| `TZ` | `Europe/Berlin` | Time zone for due dates and alarms |
| `REGISTRATION_MODE` | admin UI decides | `closed`, `approval`, `domain`, `domain+approval` or `open` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | empty | Mail for alarms, invites and password reset (also in the admin UI) |
| `TRUSTED_PROXIES` | `private` | Whose `X-Forwarded-For` to trust, see [reverse proxy](Doku/reverse-proxy.md) |
| `MCP_ENABLED` | admin UI decides | `false` switches off the endpoint for AI agents |
| `STT_*` | empty | Your own Whisper server for voice input, see [architecture](Doku/architecture.md#speech-recognition) |
| `MINDA_DEMO` | `false` | Demo accounts `admin/admin` and `user/user` with sample data. **Never on a public server with real data!** |

* **Reverse proxy:** pass through WebSocket upgrades and unbuffered SSE if you can. If not, MindSift falls back to long polling by itself. Examples for nginx, Traefik, Caddy and Cloudflare: [Doku/reverse-proxy.md](Doku/reverse-proxy.md).
* **Backups:** switch on daily backups in the admin settings: the whole database for you, plus one ZIP per person under `data/backups/` that everyone can download or restore in their account settings (kept 3 days by default, adjustable). Every one of these ZIPs also holds the person's notes, tasks and lists as an Obsidian vault in plain Markdown, so the data stays readable even without MindSift. Copy that folder somewhere else too.
* **Updates:** `docker compose pull && docker compose up -d`. The database schema updates itself; open apps offer to reload. From v0.87.3 the container runs as uid 1000 and takes over `data/` on the first start by itself; with `user:` in the compose file, give `data/` to that user first (`chown -R 1000:1000 data`).
* **Image tags:** `:stable` = the latest tagged release (default in `docker-compose.yml` and the install script), `:vX.Y.Z` = one tagged release, `:latest` = every release from `main`, `:dev` = development.
* **What changed:** [CHANGELOG.md](CHANGELOG.md).

---

## 📈 Performance

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

## 🛡️ Security scan

The image is scanned with [Trivy](https://trivy.dev) for known vulnerabilities, leaked secrets and misconfigurations:

* **every tagged release** (`:stable`, `:vx.y.z`) before it is published, and every build that changes the base image, the Go version or the Go modules: a known high or critical vulnerability that already has a fix, or a leaked secret, stops the release;
* **the published `:stable` and `:latest` every week**, because new vulnerabilities become known after a release.

Last manual scan: **v0.83.8, 2026-11-06, Trivy 0.76.0**.

| Part of the image | Critical | High | Medium | Low | Unrated |
|---|---|---|---|---|---|
| Alpine 3.24.4 (base system) | 0 | 0 | 0 | 0 | 0 |
| `/app/mindsift` (Go 1.27.3 binary) | 0 | 0 | 0 | 0 | 1 |

* **No secrets and no misconfigurations** were found.
* **Not as root:** since v0.87.3 MindSift runs as the user `mindsift` (uid 1000). The image starts as root only long enough to hand `data/` to that user (once, for installations from before), then drops the rights. Trivy's misconfiguration check therefore still notes a missing `USER` line; that is intended.
* **The one unrated entry** (GO-2026-5932) concerns the `openpgp` package of `golang.org/x/crypto`, which MindSift does not use (it only uses `bcrypt` from that module). [govulncheck](https://go.dev/blog/govulncheck), which follows the code that is actually called, reports **0 vulnerabilities** that affect MindSift.

Check it yourself:

```bash
docker run --rm aquasec/trivy:0.76.0 image ghcr.io/mindsift-app/mindsift:stable
```

---

## 🔒 Your data is yours

No telemetry, no third-party services, fonts and icons ship with the app. The server only connects out for what you use: notifications (SMTP, Discord, your webhook, the browsers' push services), link previews (switchable per device) and your own Whisper server. Everything lives in one SQLite file, media next to it in `data/media/`. Export the whole workspace as an Obsidian-compatible Markdown archive, or your data as a backup ZIP (with that Markdown vault inside), whenever you want. If MindSift ever stops working for you, open the `Obsidian` folder of any backup in Obsidian or a text editor and you have everything.

---

## 🛠 Development

Go 1.27 and Node 22.

```bash
go vet ./... && go test ./...      # backend
cd frontend && npm ci
npm run dev                        # Vite dev server
npx tsc --noEmit && npm run test:run
cd .. && e2e/run.sh                # browser tests (Playwright) against a fresh image
e2e/screenshots.sh                 # recreate the screenshots in this README
```

The multi-stage `Dockerfile` builds the frontend, embeds it into the Go binary and runs all checks. **Stack:** Go (chi, gorilla/websocket, modernc SQLite) · React 18, TypeScript, Vite, Tailwind.

Technical documentation: [Doku/](Doku/README.md) (architecture, database, REST and realtime API, collaboration, permissions, themes). Known weak spots: [Doku/flaws.md](Doku/flaws.md).

---

## 📄 License

MindSift is free software under the [GNU Affero General Public License v3.0](LICENSE): use it, change it, pass it on, even commercially. If you hand out a changed version or run it as a service on the net, its source has to be available under the same license. No warranty.

<div align="center">

**[▶ Try the demo](https://demo.mindsift.app)** · **[🌐 mindsift.app](https://mindsift.app/en/)**

<sub>Built for clarity, speed and owning your own stuff. With love, stolen ideas and a robot.</sub>

</div>
