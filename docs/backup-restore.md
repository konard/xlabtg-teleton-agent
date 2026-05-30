# Backup, Restore & Migration-Rollback Runbook

Teleton Agent stores **critical, irreplaceable data** on disk: your TON wallet
credentials, vector memory, task history, pipeline configuration and per-plugin
state. This runbook documents how to back it up, restore it, and roll back a
broken upgrade.

> **TL;DR**
>
> ```bash
> npm run backup                                   # create an archive
> npm run restore -- --file <archive.tar.gz>       # restore it (stop the agent first)
> ```

---

## What gets backed up

Everything lives under **`TELETON_HOME`** (default: `~/.teleton`). A backup
captures:

| Data                         | Path (relative to `TELETON_HOME`) | Why it matters                       |
| ---------------------------- | --------------------------------- | ------------------------------------ |
| Wallet credentials           | `wallet.json`                     | Encrypted TON mnemonic               |
| Main database                | `memory.db`                       | Vector memory, tasks, knowledge      |
| Deals ledger                 | `deals.db`                        | Trade/deal history                   |
| Per-plugin databases         | `plugins/data/*.db`               | Plugin state                         |
| Telegram sessions            | `telegram_session.txt`, `gramjs_bot_session.txt` | Keeps you logged in   |
| Update offset                | `telegram-offset.json`            | Avoids reprocessing messages         |
| Configuration               | `config.yaml`                     | Your full agent configuration        |
| Agent workspace              | `workspace/`                      | SOUL.md, MEMORY.md, downloads, etc.  |

Regenerable data — downloaded ML models (`models/`), cached binaries (`bin/`),
temp files — is **intentionally excluded** to keep archives small.

### Archive format

A backup is a real **`.tar.gz`** (readable with the system `tar`) named:

```
teleton-backup-YYYY-MM-DD-HHMMSS.tar.gz
```

It contains a `manifest.json` recording the format version, creation time, the
teleton version, the SQLite schema version, and a **SHA-256 checksum for every
file**. SQLite databases are captured as a **consistent snapshot** (any
write-ahead-log contents are folded in and an `integrity_check` is run), so a
backup taken while the agent is running is always restorable.

---

## 1. Manual backup

```bash
# Using the npm script (build first if running from source)
npm run backup

# Or the CLI directly
teleton backup

# Or the shell wrapper
bin/backup.sh

# Write the archive somewhere specific
teleton backup --out /mnt/backups/teleton
```

By default archives land in `~/.teleton/backups/`. Each run prints the path,
file count, size and schema version.

---

## 2. Manual restore

> **Stop the agent before restoring.** Restoring over a running agent can
> corrupt live databases.

```bash
# Restore a specific archive
npm run restore -- --file ~/.teleton/backups/teleton-backup-2026-05-30-101500.tar.gz

# Or the CLI / wrapper
teleton restore --file <archive.tar.gz>
bin/restore.sh --file <archive.tar.gz>

# Omit --file to restore the most recent archive in ~/.teleton/backups
teleton restore
```

What restore does, in order:

1. **Verifies** the archive — every file's SHA-256 must match the manifest, or
   the restore aborts before touching anything.
2. **Checks compatibility** — refuses to restore a backup whose schema is
   *newer* than the installed binary (a downgrade would lose data). Override
   with `--force` only if you know what you are doing.
3. **Creates a safety backup** of the current state (also under `backups/`), so
   a mistaken restore is itself reversible.
4. **Writes** the files back into `TELETON_HOME`.

Restore prompts for confirmation; pass `--yes` to skip it (for scripts).
After restoring, restart the agent — any pending forward migrations run
automatically on the next start.

---

## 3. Upgrade procedure with rollback path

Teleton creates a **pre-upgrade backup automatically** the first time a new
binary starts against an older database schema. If that backup fails, **startup
aborts** — the agent never migrates data it cannot recover.

Recommended upgrade flow:

```bash
# 1. Take an explicit backup (belt and suspenders)
teleton backup

# 2. Stop the agent, install the new version, then start it
teleton start
#    → on first start, a `*-pre-upgrade.tar.gz` is created before migrations run
```

### Rolling back a broken upgrade

If a new version misbehaves after migrating:

```bash
# 1. Stop the agent
# 2. Re-install the previous teleton version (its schema matches the backup)
# 3. Restore the pre-upgrade backup
teleton restore --file ~/.teleton/backups/teleton-backup-<stamp>-pre-upgrade.tar.gz
# 4. Start the old version
teleton start
```

Because migrations only move forward, you must downgrade the **binary** to the
version that produced the backup before restoring its schema.

---

## 4. Automating backups

### cron (Linux/macOS)

Daily backup at 03:00, keeping the 14 most recent archives:

```cron
0 3 * * * /usr/bin/env teleton backup >> "$HOME/.teleton/backups/backup.log" 2>&1 && \
  ls -1t "$HOME/.teleton/backups"/teleton-backup-*.tar.gz | tail -n +15 | xargs -r rm -f
```

### systemd timer (Linux)

`~/.config/systemd/user/teleton-backup.service`:

```ini
[Unit]
Description=Teleton Agent backup

[Service]
Type=oneshot
ExecStart=/usr/bin/env teleton backup
```

`~/.config/systemd/user/teleton-backup.timer`:

```ini
[Unit]
Description=Daily Teleton Agent backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now teleton-backup.timer
```

### Off-host copies

`backups/` lives on the same disk as your data. For real disaster recovery,
sync archives to remote storage, e.g.:

```bash
rclone copy ~/.teleton/backups remote:teleton-backups
```

---

## 5. Verifying a backup

You can inspect any archive without restoring it — it is a standard `tar.gz`:

```bash
tar -tzf teleton-backup-2026-05-30-101500.tar.gz   # list contents
tar -xzf teleton-backup-2026-05-30-101500.tar.gz -O manifest.json | jq .
```

`teleton restore` always re-verifies every checksum against the manifest before
writing anything, so a corrupted archive fails loudly instead of silently
restoring bad data.

---

## Quick reference

| Action                         | Command                                              |
| ------------------------------ | ---------------------------------------------------- |
| Create a backup                | `npm run backup` / `teleton backup`                  |
| Backup to a custom dir         | `teleton backup --out <dir>`                         |
| Restore a specific archive     | `npm run restore -- --file <archive.tar.gz>`         |
| Restore the latest archive     | `teleton restore`                                    |
| Restore without prompt         | `teleton restore --file <archive> --yes`             |
| Force restore (skip schema check) | `teleton restore --file <archive> --force`        |
| Inspect an archive             | `tar -tzf <archive.tar.gz>`                           |
