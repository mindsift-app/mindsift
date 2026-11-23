// Notifications: channels and events, the daily summary, push devices, the notification center, realtime messages.

export interface NotificationChannelRouting {
  email: boolean;
  discord: boolean;
  webhook: boolean;
  push: boolean;
  /** A notification of the operating system, shown by the desktop app's local instances (capability desktopNotify) */
  desktop: boolean;
}

export interface NotificationEvents {
  due: NotificationChannelRouting;
  shared: NotificationChannelRouting;
  assigned: NotificationChannelRouting;
  mentioned: NotificationChannelRouting;
  taskCreated: NotificationChannelRouting;
  taskDone: NotificationChannelRouting;
  watched: NotificationChannelRouting;
}

export interface DailySummarySettings {
  enabled: boolean;
  time: string;
  email: boolean;
  discord: boolean;
  webhook: boolean;
  push: boolean;
  desktop: boolean;
}

/** A browser or installed app that receives web push */
export interface PushDevice {
  id: number;
  endpoint: string;
  device: string;
  createdAt: string;
}

export interface NotificationSettings {
  paused: boolean;
  includeOwnWatched: boolean;
  events: NotificationEvents;
  dailySummary: DailySummarySettings;
}

// An entry of the notification center (bell); a click leads to its target
export interface CenterEntry {
  id: number;
  kind: 'due' | 'shared' | 'assigned' | 'mentioned' | 'taskCreated' | 'taskDone' | 'watched' | string;
  title: string;
  text: string;
  targetType?: 'task' | 'note' | 'list' | 'tasklist' | 'folder' | 'team';
  targetId?: string;
  blockId?: string;
  createdAt: string;
  read: boolean;
  // Only in NOTIFICATION: the ids of the entries this one replaced (a watched task keeps one entry)
  replaces?: number[];
}

export interface WSMessage<T = unknown> {
  event: string;
  space_id?: string;
  list_id?: string;
  listId?: string;
  payload: T;
  timestamp: string;
}
