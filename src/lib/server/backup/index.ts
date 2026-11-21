import { getDB } from "#lib/server/db.ts";
import { defaultFilesRoot } from "#lib/server/files/store.ts";
import { readBackupConfig, startBackupScheduler } from "./backup";

let stop: (() => void) | null = null;

/**
 * Starts the daily database backup and the hourly file mirroring unless `HAUSWART_BACKUP_DIR` is
 * set empty. Called once from the init hook.
 */
export function registerBackups(): void {
  if (stop) return;
  const config = readBackupConfig();
  if (!config) return;
  const stopScheduler = startBackupScheduler(getDB, config, {
    filesRoot: defaultFilesRoot(),
  });
  stop = () => {
    stopScheduler();
    stop = null;
  };
}
