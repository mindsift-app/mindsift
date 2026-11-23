import i18n from '../i18n';
import { askChoice } from '../components/askConfirm';
import { unloadHeld } from './leaveGuard';

// The desktop app's shell asks the page before an action of its own would unload it: "Instanz wechseln…"
// from the tray or Ctrl+Shift+O, F5/Ctrl+R, the window's close button, "Beenden" in the tray
// (desktop/internal/shell/guard.go). It fires mindsift:desktop-shell-action with the action's name and a
// reply function: "go" runs the action, "wait" means the person is asked (the shell then waits for the
// answer), "stay" drops it. Without an answer the shell runs the action after a second, so an unknown
// action is answered like any other and a page without this listener (an older server) loses nothing but
// the question. Like beforeunload in the browser, only a recording the page cannot keep holds (holdUnload).
export const SHELL_ACTION_EVENT = 'mindsift:desktop-shell-action';

export type ShellAnswer = 'go' | 'wait' | 'stay';

// The question per action: [message, button] in common:leaveGuard; a new shell action gets its line here
const QUESTIONS: Record<string, [string, string]> = {
  switch: ['message', 'leave'],
  reload: ['reloadMessage', 'reload'],
  close: ['closeMessage', 'close'],
  quit: ['quitMessage', 'quit'],
};

/** Answers one request of the shell (the event's detail: {action, reply}). */
export function answerShellAction(e: Event): void {
  const detail = (e as CustomEvent<unknown>).detail as { action?: unknown; reply?: unknown } | null | undefined;
  if (!detail || typeof detail.reply !== 'function') return;
  const reply = detail.reply as (answer: ShellAnswer) => void;
  if (!unloadHeld()) {
    reply('go');
    return;
  }
  reply('wait');
  // A question still open is replaced (askChoice); the shell has dropped its request by then
  const [message, confirm] = QUESTIONS[typeof detail.action === 'string' ? detail.action : ''] ?? QUESTIONS.switch;
  void askChoice({
    message: i18n.t(`common:leaveGuard.${message}`),
    confirmLabel: i18n.t(`common:leaveGuard.${confirm}`),
    altLabel: i18n.t('common:leaveGuard.stay'),
  }).then((answer) => reply(answer === 'confirm' ? 'go' : 'stay'));
}

/** Listens for the shell's requests on every page (main.tsx). Returns the removal. */
export function installShellActionGuard(target: Window = window): () => void {
  target.addEventListener(SHELL_ACTION_EVENT, answerShellAction);
  return () => target.removeEventListener(SHELL_ACTION_EVENT, answerShellAction);
}
