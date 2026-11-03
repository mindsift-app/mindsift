// The app's pages (top navigation and phone nav); the open one survives a reload of the browser tab
export const APP_TABS = ['triage', 'tasks', 'workspace', 'lists', 'groups', 'user_settings', 'admin_settings', 'help'] as const;
export type ActiveTab = (typeof APP_TABS)[number];
