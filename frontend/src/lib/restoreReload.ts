// After a restore the server closes its data and opens the restored ones (internal/api/fullrestore.go):
// the app waits until /health answers with another boot id, then reloads the page.
import { api } from './api';

const POLL_MS = 1000;
// Opening a large restored database can take a while (migrations); after this the page reloads anyway
const GIVE_UP_MS = 10 * 60_000;

export async function waitForReopen(previousBoot: string | null, reload: () => void = () => window.location.reload()): Promise<void> {
  const until = Date.now() + GIVE_UP_MS;
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const boot = await api.serverBoot();
    if (boot && boot !== previousBoot) break;
  }
  reload();
}
