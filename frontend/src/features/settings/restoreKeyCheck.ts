import { ApiError } from '../../lib/api/client';
import { askConfirm } from '../../components/askConfirm';

// Starts a restore; when the server answers that the backup's encrypted values do not open with the key the
// restored instance will use (409 secrets_key_mismatch, internal/api/fullrestore.go), its question is asked
// and the restore runs again with acceptKeyMismatch. false: the admin cancelled.
export async function restoreWithKeyCheck(run: (acceptKeyMismatch: boolean) => Promise<unknown>, confirmLabel: string): Promise<boolean> {
  try {
    await run(false);
    return true;
  } catch (err) {
    if (!(err instanceof ApiError && err.code === 'secrets_key_mismatch')) throw err;
    if (!(await askConfirm({ message: err.message, confirmLabel, danger: true }))) return false;
    await run(true);
    return true;
  }
}
