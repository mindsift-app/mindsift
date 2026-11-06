import app from './app.json';
import auth from './auth.json';
import common from './common.json';
import help from './help.json';
import workspace from './workspace.json';
import groups from './groups.json';
import lists from './lists.json';
import tasks from './tasks.json';
import triage from './triage.json';
import settings from './settings.json';
import publicPage from './public.json';

// French texts by area (namespace), the same files and keys as the German ones
const fr = { common, app, auth, settings, triage, tasks, lists, groups, workspace, help, public: publicPage };
export default fr;
