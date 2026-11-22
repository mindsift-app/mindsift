# Running MindSift

Details for administrators that the README only touches: the install script, the first admin, language, backups, updates, rolling back and restoring, health checks, monitoring, file permissions, network storage and rootless Podman, and image tags. Every environment variable is in [`.env.example`](../.env.example) and in the configuration table of [architecture.md](architecture.md#configuration).

## Install script

[`install.sh`](../install.sh) creates a folder, downloads `docker-compose.yml` and `.env.example`, generates `JWT_SECRET` and `SECRETS_KEY` and starts the container. It does not take over the host's time zone: the setup wizard asks for it, and Administration → Instance (or `TZ` in `.env`) changes it later.

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

### Update hint

Release images look for a newer release once a day: a few minutes after the start (later if the last answer is less than a day old; it is kept in the database), then every 24 hours with a random delay of up to an hour. The server asks `https://api.github.com/repos/mindsift-app/mindsift/releases/latest` without signing in, with `MindSift/<version>` as User-Agent and nothing about the instance; it sends the ETag of the last answer back, so an unchanged release costs GitHub nothing. After an error it waits six hours, after a rate limit at least until GitHub takes requests again; it never retries at once. Pre-releases and drafts do not count. The request goes through the same guarded client as webhooks and link previews: no internal addresses, and with `HTTPS_PROXY` set through that proxy after the same check ([security.md](security.md#nothing-reaches-into-your-network)).

When the release is newer than the running version, admins get a small card at the bottom right (after the tour offer, never together with it) with a link to the release page; "Später" or × puts it aside for that release, on every device of that admin, and a newer release shows it again. Members see nothing. *Administration → Instance* shows the installed and the latest version and the update command, but there is no update button.

`UPDATE_CHECK=false` switches it off completely: no request goes out. The demo (`MINDSIFT_DEMO`) and builds without a release version (local builds, `:dev`, anything with `-dev`) never ask either. The version comes from the image build (`APP_VERSION`, compiled into the binary).

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

The daily backups are full backups: `data/backups/system/mindsift-full-<date>-<time>/` holds the database and every picture and recording ([details](architecture.md#background-job-backups)). An admin restores one under Administration → Data → "Wiederherstellen": MindSift backs up the current state first, swaps database and media and reopens itself; nothing needs to be stopped. For a move to a new server, download a backup there (one `.tar` file), set up the new server, sign in as admin and upload it under "Backup hochladen"; it is sent in chunks (reverse proxies with a body limit of at least a few MB are fine) and resumes after an interruption. Copy `SECRETS_KEY` or `data/secrets.key` to the new server as well, before its first start or before the restore: the backup does not contain the key, and without it hidden values, authenticator codes, public links and the SMTP password cannot be read.

By hand, without the app (an older database dump `mindsift-db-….db.gz`, or a server that does not start):

1. Stop the container. Never replace the database while MindSift runs.
2. Unpack the snapshot over the database (as root, see above): `gunzip -c data/backups/system/mindsift-full-…/mindsift.db.gz > data/mindsift.db` (or `…/mindsift-db-….db.gz` of an older dump). For a full backup, also replace `data/media` with its `media/` folder (`cp -a`).
3. Delete `data/mindsift.db-wal` and `data/mindsift.db-shm` if they exist (see above).
4. Keep the keys that belong to the data: `SECRETS_KEY` or `data/secrets.key` (without it, hidden values, authenticator codes, the copy of public links and the SMTP password of the administration cannot be read) and `JWT_SECRET` or `data/jwt.secret` (otherwise everyone is signed out). If the key is missing or wrong, MindSift still starts but logs a warning that begins with `THE SECRETS KEY DOES NOT MATCH THE DATA`; stop it, put the old key back and start again. An older database dump has no images and audio; they are in `data/media/`.
5. Start the same version that wrote the snapshot, or a newer one. The container hands `data/` to its user (uid 1000) on start; without the container, keep the files owned by the user that runs MindSift and readable for it only.

People restore their own data from their personal backups in the account settings, without stopping the server. A personal backup holds hidden values (`/hidden`) as references only, never their values (they are sealed with the server's key): restored on the same server they come back as long as their notes still exist, otherwise the notes keep a placeholder and the restore summary lists them. A snapshot of the whole database keeps them.

## Locked out? / Command line

The server binary has a small command line for what the administration cannot do when nobody can sign in. In the container it is on the `PATH` as `mindsift`; run it next to the running server with `docker exec` (or `podman exec`), the container name as in [`docker-compose.yml`](../docker-compose.yml). Without the container, call the release binary as `./mindsift <command>` with the same `DATA_DIR` or `DATABASE_URL` as the server.

```bash
docker exec mindsift mindsift help                         # the commands
docker exec mindsift mindsift users                        # list the accounts (--json for scripts)
docker exec mindsift mindsift reset-password anna          # new one-time password, signs out every session
docker exec mindsift mindsift reset-password anna --disable-2fa   # also removes app codes, passkeys, recovery codes
docker exec mindsift mindsift reset-password anna --must-change   # an own password at the next sign-in, before anything else
docker exec mindsift mindsift reset-password anna --revoke-keys   # also removes API keys, AI connections (MCP) and the calendar subscription
docker exec mindsift mindsift make-admin anna              # admin role (--revoke takes it away)
docker exec mindsift mindsift users create bert --email bert@example.com [--admin]
docker exec mindsift mindsift users delete bert            # shows what would go; add --yes to delete
docker exec mindsift mindsift check --backup               # full backup to backups/system, then integrity check
docker exec mindsift mindsift audit                        # audit log, newest first (--limit 1–500, default 50; --json)
```

- **Names:** `<name>` is the username, the email address or the account's ID, exactly (not the looser matching of the sign-in).
- **Passwords:** `users create` without a password and `reset-password` print a one-time password once (20 characters). Hand it over safely. With `--must-change` the person has to choose an own password right after signing in with it, before the app shows anything else (as "Bei der nächsten Anmeldung ändern" in the administration); without it they should set one in the account settings. API keys, AI connections and the calendar subscription keep working either way unless `--revoke-keys` removes them (for an account that may have been taken over; the subscription's address then answers 404 and the person can switch on a new one); the flags combine, and none of them is on by default. For scripts, `users create` reads a password from `--password-file <path>` or `--password-stdin` (`docker exec -i … --password-stdin < file`), checked by the rules of the administration.
- **Rules as in the administration:** usernames and addresses must be valid and free; deleting takes the same steps as in the administration (shared notes and lists disappear for the others, other people's tasks in the account's task lists stay theirs, the account's backups are kept for the retention period). The last active administrator can be neither deleted nor demoted. The first account of an empty server must be an administrator; the setup wizard then asks its other questions after the first sign-in, as with `ADMIN_USER`.
- **While the server runs:** the command opens the same database the same way (WAL, busy timeout) and changes it in short transactions. Sign-ins are checked against the database on every request, so a new password, a deleted account or another role count at once; old sign-ins of the account are refused. Within a few seconds the server also ends the account's live connections, lifts the lock of the sign-in protection after a new password, mails the owner after `--disable-2fa` (as the reset in the administration does; only with mail set up, and only while the server runs: a change made while it is stopped is not mailed later) and writes the change to its log (`Changed on the command line … by=cli`). Every change also lands in the audit log (Administration → Protokoll, `mindsift audit`), with "Kommandozeile" as actor; rows stay for a year.
- **Versions:** the command never migrates the database. Run it with the binary of the running version (`docker exec` into its container does that); a binary that is older or newer than the database stops with a message instead of changing anything.
- **Demo mode:** with `MINDSIFT_DEMO` the commands only read (`users`, `check`, `audit`); changes are refused.
- **As which user:** `docker exec` runs as root; the `mindsift` command switches to the owner of the data folder (uid 1000) first, so a backup or database files it creates stay usable for the server.
- **Exit codes and `--json`:** every command takes `--json` and prints one JSON object (or, for `users`, an array); errors as `{"error": …, "code": …}`. Exit codes: `0` done, `1` failed or `check` found problems, `2` invalid input, `3` account not found, `4` refused (name or address taken, last administrator, demo mode).

Without a command, or with `serve`, the binary starts the server as before.

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

## Network storage and rootless Podman

Started as root (the default), the container hands `data/` to its user (uid 1000) and then runs as that user. Where it may not change owners, it says so in the log and carries on as long as uid 1000 can write to the folder; if it cannot, the container stops with a line that starts with `MindSift: ERROR` and says what to do. Started with `user:`, it only warns when the folder is not writable for that user.

- **Keep the database on a local disk.** SQLite runs in WAL mode, which needs file locks and shared memory (`mindsift.db-shm`) that network filesystems often do not provide reliably. Do not put `data/` (at least `mindsift.db`) on SMB/CIFS; NFS works at best with working locks (NFSv4) and is at your own risk. Backups can go to network storage: copy `data/backups/` there with a cron job or the NAS's own sync.
- **NFS with `root_squash`** (the default of most NAS): root in the container becomes `nobody` on the NAS and may not change owners. Give the folder to uid 1000 on the NAS (`chown -R 1000:1000 <folder>`), or run the container as the uid and gid that own the folder (`user: "1026:100"` in `docker-compose.override.yml`, for example), or export the share with `no_root_squash`.
- **SMB/CIFS** knows no Unix owners; the mount options decide them (`uid=1000,gid=1000`). Not for the database, see above.
- **Rootless Podman:** root in the container is your own user on the host, and uid 1000 in the container is one of your sub-uids, so the files in `data/` show up with a large uid on the host and your user cannot read them directly. Use `podman unshare` for work on them (`podman unshare ls -l data`, `podman unshare cp …`, or `podman unshare chown -R 1000:1000 data` after copying files in). On SELinux hosts (Fedora, RHEL) mount the folder with `:Z` (`./data:/data:Z`), otherwise the container may not read it.

## Image tags

- `:stable`: the latest tagged release (default in `docker-compose.yml` and the install script)
- `:vX.Y.Z`: one release
- `:latest`: every build of `main`
- `:dev`: development

The project is 0.x: a minor version can still change the API or data formats, and the [changelog](../CHANGELOG.md) marks those changes with **Attention**.
