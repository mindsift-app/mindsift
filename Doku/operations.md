# Running MindSift

Details for administrators that the README only touches: the install script, the first admin, language, backups, updates, rolling back and restoring, health checks, monitoring, file permissions and image tags. Every environment variable is in [`.env.example`](../.env.example) and in the configuration table of [architecture.md](architecture.md#configuration).

## Install script

[`install.sh`](../install.sh) creates a folder, downloads `docker-compose.yml` and `.env.example`, generates `JWT_SECRET` and `SECRETS_KEY` and starts the container. It does not take over the host's time zone: the setup wizard asks for it, and Administration → Server (or `TZ` in `.env`) changes it later.

- On a new install it asks for the admin account (`ADMIN_USER`, `ADMIN_PASSWORD`; Enter means `admin` with a generated password, shown once); without a terminal it skips that and shows the setup code the wizard asks for. `ADMIN_PASSWORD` is only needed on the first start: once the container answers, the script removes it from `.env` again.
- Two optional questions (Enter means no): your own speech recognition (adds a Whisper container with large-v3-turbo or small), and a reverse proxy (asks for `BASE_URL` and the proxy's Docker network). These additions go into `docker-compose.override.yml`.
- Running the script again updates `docker-compose.yml` and keeps `.env` and the override.
- The container is named `mindsift` (`container_name` in `docker-compose.yml`). A second installation on the same host, or another container of that name, makes `docker compose up` fail with a name conflict: change the name in a `docker-compose.override.yml` (`services: mindsift: container_name: mindsift-2`) or remove the line; `docker compose logs mindsift` in the folder works with any name. The script does not check this.

For voice recognition by hand, follow the comments on the `whisper` block in [`docker-compose.yml`](../docker-compose.yml); which model to pick is in [architecture.md](architecture.md#speech-recognition).

## Without a container

The [releases](https://github.com/mindsift-app/mindsift/releases) carry the server as a single file for Linux (amd64 and arm64), frontend included. Unpack it and start `./mindsift`: it listens on port 8080 and keeps everything in `./data` (`PORT` and `DATA_DIR` change that). The other settings work as in the container; the time zone is not taken from the system but from `TZ` or the administration (UTC until one is set).

## First admin

Without `ADMIN_USER` and `ADMIN_PASSWORD`, a setup wizard creates the admin account. It asks for a one-time setup code that MindSift writes to its log on start (`docker logs mindsift | grep 'Setup code'`, which needs `container_name: mindsift` as in [`docker-compose.yml`](../docker-compose.yml); in the compose folder `docker compose logs mindsift` works with any container name), so only someone who can read the server's log becomes its admin; a restart makes a new code, and it stops working once the admin exists.

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

## Rolling back

Before an update changes the database schema, MindSift saves a compressed copy of the database as `data/backups/system/pre-migration-<migration>-<date>-<time>.db.gz` and logs where; the last three are kept, each for at most 90 days (the newest too: the copies still hold accounts deleted since, and the daily backups cover anything later). Without the copy (a full disk, for example) it does not migrate and stops ([database.md](database.md#migrations-and-startup-cleanup)).

- **From the release after v0.95.0 on**, an older image refuses to start on a database a newer one has changed and logs both versions' migration numbers. Start the newer image again, or go back as below.
- **v0.95.0 and earlier do not check this.** They start on the newer database without a word, and accounts that signed in on the newer version cannot sign in there any more: since the release after v0.95.0, passwords are stored in a newer form at the next sign-in, which older versions cannot read. Going back to v0.95.0 or earlier therefore always means restoring the copy from before the update; it predates the new password form, so sign-ins work again.

To go back (the files in `data/` belong to the container's user, uid 1000, and only it can read them: run the commands as root, for example with `sudo`, or with rootless Podman inside `podman unshare`; the container hands the restored file back to its user on the next start):

1. Stop the container (`docker compose down`).
2. Unpack the copy from before the update over the database: `gunzip -c data/backups/system/pre-migration-….db.gz > data/mindsift.db`.
3. Delete `data/mindsift.db-wal` and `data/mindsift.db-shm` if they exist. A leftover WAL file belongs to the newer database and would be applied to the restored one on the next start.
4. Pin the older image (`image: ghcr.io/mindsift-app/mindsift:vX.Y.Z`) and start it.

Whatever was written after the update is not in that copy.

## Restoring a whole server

The daily backups hold the whole database as `data/backups/system/mindsift-db-<date>-<time>.db.gz` ([what else they contain](architecture.md#background-job-backups)). To put one back:

1. Stop the container. Never replace the database while MindSift runs.
2. Unpack the snapshot over the database (as root, see above): `gunzip -c data/backups/system/mindsift-db-….db.gz > data/mindsift.db`.
3. Delete `data/mindsift.db-wal` and `data/mindsift.db-shm` if they exist (see above).
4. Keep the keys that belong to the data: `SECRETS_KEY` or `data/secrets.key` (without it, hidden values and authenticator codes cannot be read) and `JWT_SECRET` or `data/jwt.secret` (otherwise everyone is signed out). Images and audio are not in the database dump but in `data/media/`; on a new machine copy the whole `data/` folder.
5. Start the same version that wrote the snapshot, or a newer one. The container hands `data/` to its user (uid 1000) on start; without the container, keep the files owned by the user that runs MindSift and readable for it only.

People restore their own data from their personal backups in the account settings, without stopping the server.

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
