// The REST client as one object, as before the split: every call stays api.<name>, so spies and
// mocks on api keep working
import { authApi } from './auth';
import { tasksApi } from './tasks';
import { workspaceApi } from './workspace';
import { listsApi } from './lists';
import { teamsApi } from './teams';
import { adminApi } from './admin';
import { dataApi } from './data';

export const api = {
  ...authApi,
  ...tasksApi,
  ...workspaceApi,
  ...listsApi,
  ...teamsApi,
  ...adminApi,
  ...dataApi,
};
