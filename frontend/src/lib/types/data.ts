// Data: backups, taking over a server's account, import results, sections of a restore, how long things are kept.

import i18n from '../../i18n';

/** One file of a server backup listing. */
export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
  /** A full backup (database and media): a folder, downloaded as one tar archive of size bytes */
  full?: boolean;
  /** Its pictures and recordings */
  media?: number;
  /** "pre-restore": written right before a restore */
  reason?: string;
}

/** Desktop app: where the backups go; defaultDir is backups/ in the instance's folder, custom: chosen. */
export interface BackupLocation {
  // dir: where the backups go; with a chosen folder MindSift's subfolder in it (MindSift-Backups/<instance>)
  dir: string;
  defaultDir: string;
  custom: boolean;
  // chosen: the folder picked in the setup or the administration ('' = the default)
  chosen?: string;
  // chosenMissing: the chosen folder does not exist now (drive not mounted): backup runs are skipped
  chosenMissing?: boolean;
  // dirShown, chosenShown: dir and chosen as the person knows them, for showing only (under Flatpak dir and
  // chosen are paths of the document portal, /run/user/…/doc/…); what is sent back stays dir/chosen
  dirShown?: string;
  chosenShown?: string;
}

/** Desktop app: one account of a server's database snapshot, with what it owns. */
export interface SnapshotAccount {
  id: string;
  displayName: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  notes: number;
  tasks: number;
  lists: number;
  inbox: number;
}

export interface SnapshotStaged {
  token: string;
  accounts: SnapshotAccount[];
}

/** Preview or result of taking an account of a snapshot over. */
export interface SnapshotTakeOver extends ImportSummary {
  account: SnapshotAccount;
  settings: boolean;
  // Settings left out because they would not pass the account settings' checks (e.g. an alarm webhook)
  settingsSkipped?: SnapshotSkippedSetting[];
  // The account's pictures and recordings found in the backup, and those it lacks (a database snapshot alone has none)
  media?: number;
  mediaMissing?: number;
}

export type SnapshotSkippedSetting =
  | 'discordWebhookUrl'
  | 'customWebhookUrl'
  | 'language'
  | 'voiceInput'
  | 'voiceLanguage'
  | 'retention'
  | 'notifyBeforeMinutes';

/** Parts of the own data a backup can be restored for. */
export type DataSection = 'notes' | 'tasks' | 'lists' | 'inbox' | 'themes';
const dataSection = (id: DataSection) => ({
  id,
  get label() {
    return i18n.t(`common:dataSections.${id}`);
  },
});

export const DATA_SECTIONS: { id: DataSection; readonly label: string }[] = [
  dataSection('notes'),
  dataSection('tasks'),
  dataSection('lists'),
  dataSection('inbox'),
  dataSection('themes'),
];

/** Delays in days per area (Kontoeinstellungen → Aufbewahrung); 0 = keep for good. */
export interface Retention {
  doneTasks: number;
  taskTrash: number;
  triageTrash: number;
  noteTrash: number;
  listDone: number;
}

// Result of an import preview (applied = false) or of the import itself
export interface ImportSummary {
  folders: number;
  notes: number;
  taskLists: number;
  tasks: number;
  lists: number;
  listItems: number;
  inbox: number;
  themes?: number;
  skipped: { path: string; reason: string }[];
  applied: boolean;
}

// Backups of an account an admin or user manager deleted, kept until removeAt
export interface DeletedAccountBackups {
  userId: string;
  displayName: string;
  email: string;
  deletedAt: string;
  removeAt: string;
  files: BackupFile[];
}
