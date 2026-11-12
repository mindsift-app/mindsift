// MindSift API client: REST areas in their own modules, put together
// in rest.ts; realtime transport in realtime.ts. Imports from lib/api stay as they were.
export { ApiError, authHeaders } from './client';
export { getToken, getCurrentUserId, setToken, clearToken, triggerHaptic, setCurrentSharingMode, isSharingDisabled, setCurrentPeopleSearch, isPeopleSearchOn, getCurrentOidc } from './client';
export { api } from './rest';
export * from './realtime';
