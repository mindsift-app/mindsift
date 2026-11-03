// MindSift API client (Doku/plans/frontend-aufteilen.md): REST areas in their own modules, put together
// in rest.ts; realtime transport in realtime.ts. Imports from lib/api stay as they were.
export { getToken, getCurrentUserId, setToken, clearToken, triggerHaptic, setCurrentSharingMode, isSharingDisabled } from './client';
export { api } from './rest';
export * from './realtime';
