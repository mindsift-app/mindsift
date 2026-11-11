// Automatic backups: the server's defaults and limits (internal/storage/backup.go). The setup wizard
// starts with them, the admin settings fall back to them.
export const DEFAULT_BACKUP_TIME = '03:00';
export const DEFAULT_BACKUP_RETENTION_DAYS = 3;
export const MAX_BACKUP_RETENTION_DAYS = 365;

export const validBackupRetentionDays = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_BACKUP_RETENTION_DAYS;
