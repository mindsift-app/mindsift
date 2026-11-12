// Everything of the app that is only needed once someone is signed in (or opens a public note). Loaded as
// one chunk through useMainViews, so the sign-in page starts with the small entry chunk; nothing else may
// import these modules statically, or the bundler keeps them in the entry chunk.
export { TriageDeck } from '../features/triage/TriageDeck';
export { TriageTrash } from '../features/triage/TriageTrash';
export { TasksView } from '../features/triage/TasksView';
export { WorkspaceView } from '../features/workspace/WorkspaceView';
export { SharedListsView } from '../features/lists/SharedListsView';
export { UserSettingsView } from '../features/settings/UserSettingsView';
export { AdminSettingsView } from '../features/settings/AdminSettingsView';
export { HelpView } from '../features/help/HelpView';
export { GroupsView } from '../features/teams/GroupsView';
export { CommandPalette } from '../components/CommandPalette';
export { PublicNoteView } from '../features/public/PublicNoteView';
export { GuidedTour } from '../features/tour/GuidedTour';
