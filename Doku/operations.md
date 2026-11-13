# Running MindSift

Details for administrators that the README only touches: the install script, the first admin, language, backups, updates, health checks, monitoring, file permissions and image tags. Every environment variable is in [`.env.example`](../.env.example) and in the configuration table of [architecture.md](architecture.md#configuration); rolling back an update is described in the [README](../README.md#running-it).

## Install script

[`install.sh`](../install.sh) creates a folder, downloads `docker-compose.yml` and `.env.example`, generates `JWT_SECRET` and `SECRETS_KEY`, takes over the server's time zone and starts the container.

- On a new install it asks for the admin account (`ADMIN_USER`, `ADMIN_PASSWORD`; Enter means `admin` with a generated password, shown once); without a terminal it skips that and shows the setup code the wizard asks for.
- Two optional questions (Enter means no): your own speech recognition (adds a Whisper container with large-v3-turbo or small), and a reverse proxy (asks for `BASE_URL` and the proxy's Docker network). These additions go into `docker-compose.override.yml`.
- Running the script again updates `docker-compose.yml` and keeps `.env` and the override.

For voice recognition by hand, follow the comments on the `whisper` block in [`docker-compose.yml`](../docker-compose.yml); which model to pick is in [architecture.md](architecture.md#speech-recognition).

## Without a container

The [releases](https://github.com/mindsift-app/mindsift/releases) carry the server as a single file for Linux (amd64 and arm64), frontend included. Unpack it and start `./mindsift`: it listens on port 8080 and keeps everything in `./data` (`PORT` and `DATA_DIR` change that). The other settings work as in the container; the time zone is not taken from the system but from `TZ` or the administration (UTC until one is set).

## First admin

Without `ADMIN_USER` and `ADMIN_PASSWORD`, a setup wizard creates the admin account. It asks for a one-time setup code that MindSift writes to its log on start (`docker logs mindsift | grep 'Setup code'`), so only someone who can read the server's log becomes its admin; a restart makes a new code, and it stops working once the admin exists.

With `ADMIN_USER` (username) and `ADMIN_PASSWORD` (at least 8 characters), the admin exists before the server accepts connections; after signing in, the wizard asks only the remaining settings.

- For a Docker secret, `ADMIN_PASSWORD_FILE` names a file with the password instead.
- They act only while the database has no account and can be removed afterwards.
- If they are unusable (one missing, password too short, invalid name or email), MindSift does not start and says why in the log.
- Without `ADMIN_EMAIL` the wizard asks for an address, confirmed by a mailed link; until then there is no "forgot password" for this account.

Both ways of the wizard also offer to set up the mail server (when `SMTP_HOST` is not set) and end with a summary of what is still open (mail server, `BASE_URL`) and where the backups are.

## Language

The app uses the browser's language if it is one of the five, and everyone can pick their own in the settings. `DEFAULT_LANGUAGE` covers the rest; unset, it is German (where the project started), so for an English instance set `en` or pick it in the setup wizard. API clients without `Accept-Language` (scripts, curl) get errors in the configured default language, else in English. More in [i18n.md](i18n.md).

## Backups

The setup wizard offers daily backups (preselected: 03:00 server time, kept 3 days); change them later in the admin settings. Each run saves the whole database plus one ZIP per person under `data/backups/`, which people download or restore in their account settings. Copy that folder somewhere else too. What exactly a backup contains: [architecture.md](architecture.md#background-job-backups).

## Updates

`docker compose pull && docker compose up -d`. The database schema updates itself; open apps offer to reload. Since v0.87.3 the container runs as uid 1000 and takes over `data/` by itself; with `user:` in the compose file, run `chown -R 1000:1000 data` first.

## Health check

The image checks `/api/v1/health` every 30 s, shown in `docker ps`, Portainer and Dockge and usable with `depends_on: condition: service_healthy`. Podman ignores checks in images; copy the `healthcheck:` block of `docker-compose.yml` instead.

## Monitoring

`/api/v1/health?db=1` also asks the database and answers `503` when it does not respond (the container's own check stays without it).

With `METRICS_TOKEN` set (at least 16 characters, sent as bearer token; also `METRICS_TOKEN_FILE`), `/metrics` serves Prometheus metrics: API requests and their duration by route, mails sent and failed, backup runs and the time of the last good one, accounts and active accounts, the database's connections and file size, memory and goroutines. No label holds a name, address or id. Scrape it with the token:

```yaml
scrape_configs:
  - job_name: mindsift
    authorization: { credentials: "<METRICS_TOKEN>" }
    static_configs: [{ targets: ["mindsift:8080"] }]
```

How the exporter is built: [architecture.md](architecture.md#monitoring).

## File permissions

Everything in `data/` is readable by MindSift only (files 0600, folders 0700). The container tightens files from older versions once on its first start; without the container, run `chmod -R go-rwx data`.

## Image tags

- `:stable`: the latest tagged release (default in `docker-compose.yml` and the install script)
- `:vX.Y.Z`: one release
- `:latest`: every build of `main`
- `:dev`: development

The project is 0.x: a minor version can still change the API or data formats, and the [changelog](../CHANGELOG.md) marks those changes with **Attention**.
