import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  Key,
  Plus,
  Trash,
  Pencil,
  Copy,
  Check,
  Webhook,
  Zap,
  Terminal,
  Bot,
} from 'lucide-react';
import { APIKey, ApiKeyScope, PriorityLevel, SharedList, TaskList } from '../../lib/types';
import { SCOPES, scopeGroups, scopeChip, toggleScopeIn } from '../../lib/apiScopes';
import { api, ApiError, triggerHaptic } from '../../lib/api';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { formatDate } from '../../lib/format';
import { askConfirm } from '../../components/askConfirm';
import { showError } from '../../components/ErrorNotice';
import { withSecondFactor } from './user/askSecondFactor';
import { SelectMenu } from '../../components/SelectMenu';

interface ApiKeysPanelProps {
  onIngested?: () => void;
}

type SimTarget = 'triage' | 'task' | 'list_item';
// The tools of the MCP endpoint (internal/api/mcp.go, mcp_write.go), in that order
const MCP_TOOLS = [
  'list_task_lists',
  'create_task_list',
  'list_tasks',
  'get_task',
  'create_task',
  'update_task',
  'complete_task',
  'add_subtask',
  'update_subtask',
  'delete_task',
  'list_lists',
  'create_list',
  'get_list',
  'add_list_item',
  'check_list_item',
  'update_list_item',
  'list_notes',
  'get_note',
  'create_note',
  'update_note',
  'add_note_bullet',
  'update_note_bullet',
  'delete_note_bullet',
  'delete_note',
  'search',
  'capture_to_inbox',
  'list_inbox',
  'convert_inbox_item',
  'discard_inbox_item',
];

type McpClient = 'connector' | 'claude' | 'codex' | 'json';
type Access = 'rest' | 'mcp';

// Personal API keys with rights (switches) and how to connect: curl / smart home (read examples,
// delivery simulator) or AI agents over MCP (settings → API)
export const ApiKeysPanel: React.FC<ApiKeysPanelProps> = ({ onIngested }) => {
  const { t } = useTranslation('settings');
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<ApiKeyScope[]>(['webhook:triage']);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [mcpClient, setMcpClient] = useState<McpClient>('connector');
  // Address for claude.ai / ChatGPT connectors; empty while the server has no OAuth (no BASE_URL)
  const [connectorUrl, setConnectorUrl] = useState('');
  const [copiedConnector, setCopiedConnector] = useState(false);
  const [access, setAccess] = useState<Access>('rest');
  // The operator can switch MCP off; then only the curl / smart home access is shown
  const [mcpEnabled, setMcpEnabled] = useState(true);

  // Live Webhook Simulator State
  const [simTitle, setSimTitle] = useState(() => i18n.t('settings:api.sim.defaultTitle'));
  const [simPriority, setSimPriority] = useState<PriorityLevel>('high');
  const [simTarget, setSimTarget] = useState<SimTarget>('triage');
  const [simListId, setSimListId] = useState('');
  const [simTaskListId, setSimTaskListId] = useState('');
  const [simStatus, setSimStatus] = useState<string | null>(null);
  const [lists, setLists] = useState<SharedList[]>([]);
  const [taskLists, setTaskLists] = useState<TaskList[]>([]);

  const loadKeys = async () => {
    const k = await api.getAPIKeys();
    setKeys(k);
  };

  useEffect(() => {
    loadKeys();
    api.getAllLists().then(setLists).catch(() => {});
    api.getTaskLists().then(setTaskLists).catch(() => {});
    api
      .getAuthStatus()
      .then((st) => {
        setConnectorUrl(st.mcpConnectorUrl || '');
        setMcpEnabled(st.mcpEnabled !== false);
      })
      .catch(() => {});
  }, []);

  // Editing an existing key: name and rights (the secret stays the same)
  const [editKeyId, setEditKeyId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editScopes, setEditScopes] = useState<ApiKeyScope[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (k: APIKey) => {
    setEditKeyId(k.id);
    setEditName(k.name);
    setEditScopes(k.scopes.split(',').filter(Boolean) as ApiKeyScope[]);
    setEditError(null);
  };

  const toggleEditScope = (id: ApiKeyScope) => setEditScopes((prev) => toggleScopeIn(prev, id));

  const handleSaveEdit = async () => {
    if (!editKeyId) return;
    try {
      await api.updateAPIKey(editKeyId, { name: editName.trim(), scopes: editScopes });
      triggerHaptic(15);
      setEditKeyId(null);
      await loadKeys();
    } catch (err: any) {
      setEditError(err?.message || t('api.saveFailed'));
    }
  };

  // Switches grouped by tasks, lists, notes and inbox (same layout for a new and an existing key)
  const renderScopeSwitches = (selected: ApiKeyScope[], toggle: (id: ApiKeyScope) => void, label: string) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" role="group" aria-label={label}>
      {scopeGroups().filter(([group]) => mcpEnabled || SCOPES.some((sc) => sc.group === group && !sc.mcpOnly)).map(([group, heading]) => (
        <div key={group} className="border border-border rounded-card bg-panel px-3 py-1.5">
          <p className="text-[11px] text-muted pt-1 pb-0.5 font-semibold">{heading}</p>
          {SCOPES.filter((sc) => sc.group === group && (mcpEnabled || !sc.mcpOnly)).map((sc) => (
            <div key={sc.id} className="flex items-center justify-between gap-3 min-h-[44px] sm:min-h-[36px]">
              <div className="min-w-0">
                <span className="block text-xs text-main">{sc.label}</span>
                <span className="block text-[11px] text-muted">{sc.hint}</span>
              </div>
              <ToggleSwitch checked={selected.includes(sc.id)} onChange={() => toggle(sc.id)} title={sc.chip} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  const toggleScope = (id: ApiKeyScope) => setNewKeyScopes((prev) => toggleScopeIn(prev, id));

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic(15);
    let created: APIKey;
    try {
      // A key never asks for the second factor itself: with one on, creating it does (withSecondFactor)
      created = await withSecondFactor((proof) => api.createAPIKey(newKeyName.trim() || t('api.defaultKeyName'), newKeyScopes, proof));
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'mfa_cancelled')) showError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (created.rawKey) {
      setNewlyCreatedKey(created.rawKey);
    }
    setNewKeyName('');
    setNewKeyScopes(['webhook:triage']);
    await loadKeys();
  };

  const handleDeleteKey = async (k: APIKey) => {
    const oauth = k.kind === 'oauth';
    const ok = await askConfirm({
      message: oauth ? t('api.confirmDisconnect', { name: k.name }) : t('api.confirmRevoke'),
      confirmLabel: oauth ? t('api.disconnect') : t('api.revoke'),
      danger: true,
    });
    if (!ok) return;
    triggerHaptic(20);
    await api.deleteAPIKey(k.id);
    await loadKeys();
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleSimulateWebhook = async () => {
    triggerHaptic(20);
    if (simTarget === 'list_item' && !simListId) {
      setSimStatus(t('api.sim.chooseList'));
      return;
    }
    try {
      // With a freshly created key the simulator tests exactly that key (and its scopes)
      await api.testWebhookIngest(newlyCreatedKey, {
        title: simTitle,
        priority: simPriority,
        tags: simTarget === 'list_item' ? [] : ['smarthome', 'automation'],
        target: simTarget,
        taskListId: simTarget === 'task' ? simTaskListId || undefined : undefined,
        listId: simTarget === 'list_item' ? simListId : undefined,
      });
      setSimStatus(
        simTarget === 'task'
          ? t('api.sim.okTask')
          : simTarget === 'list_item'
          ? t('api.sim.okListItem')
          : t('api.sim.okInbox')
      );
      onIngested?.();
      setTimeout(() => setSimStatus(null), 4000);
    } catch (err: any) {
      setSimStatus('❌ ' + t('api.sim.error', { message: err.message }));
    }
  };

  const exampleToken = newlyCreatedKey || t('api.example.token');
  const baseUrl = window.location.origin;
  const examplePayload =
    simTarget === 'task'
      ? `{
    "target": "task",
    "title": "${t('api.example.task')}",
    "priority": "high",
    "dueDate": "2026-11-15T09:00"${simTaskListId ? `,\n    "taskListId": "${simTaskListId}"` : ''}
  }`
      : simTarget === 'list_item'
      ? `{
    "target": "list_item",
    "listId": "${simListId || t('api.example.listIdPlaceholder')}",
    "content": "${t('api.example.listItem')}",
    "quantity": "2"
  }`
      : `{
    "title": "${t('api.example.inbox')}",
    "priority": "urgent",
    "tags": ["smarthome", "${t('api.example.inboxTag')}"]
  }`;

  const mcpUrl = `${baseUrl}/api/v1/mcp`;
  const mcpSnippet =
    mcpClient === 'claude'
      ? `claude mcp add --transport http mindsift ${mcpUrl} \\
  --header "X-API-Key: ${exampleToken}"`
      : mcpClient === 'codex'
      ? `# ~/.codex/config.toml
[mcp_servers.mindsift]
url = "${mcpUrl}"
http_headers = { "X-API-Key" = "${exampleToken}" }`
      : `{
  "mcpServers": {
    "mindsift": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "X-API-Key": "${exampleToken}" }
    }
  }
}`;

  return (
    <div className="space-y-6">
      {/* API keys */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 bg-accent text-on-accent flex items-center justify-center flex-shrink-0">
            <Key className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-main">{t('api.title')}</h3>
            <p className="text-xs text-muted">
              {t('api.intro')}
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateKey} className="mt-3 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t('api.namePlaceholder')}
              className="w-full sm:flex-1 min-w-0 h-11 sm:h-9 px-3 input-field text-base sm:text-sm"
            />
            <button type="submit" className="btn-primary h-11 sm:h-9 px-4 text-sm flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>{t('api.create')}</span>
            </button>
          </div>
          {renderScopeSwitches(newKeyScopes, toggleScope, t('api.rightsNew'))}
        </form>

        {newlyCreatedKey && (
          <div className="mt-3 p-3 bg-accent/15 border border-accent/30 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-accent mb-1">{t('api.created')}</p>
              <code className="text-xs sm:text-sm font-mono text-main break-all">{newlyCreatedKey}</code>
            </div>
            <button onClick={() => handleCopy(newlyCreatedKey)} className="btn-primary h-8 px-3 text-xs">
              {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey ? t('api.copied') : t('api.copyKey')}</span>
            </button>
          </div>
        )}

        {/* Active Keys List */}
        <div className="mt-3 border border-border divide-y divide-border">
          {keys.length === 0 ? (
            <p className="text-xs text-faint px-3 py-2">{t('api.empty')}</p>
          ) : (
            keys.map((k) =>
              editKeyId === k.id ? (
                <div key={k.id} className="px-3 py-3 bg-canvas space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label={t('api.keyName')}
                      className="w-full sm:flex-1 min-w-0 h-11 sm:h-9 px-3 input-field text-base sm:text-sm"
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditKeyId(null)} className="btn-action h-11 sm:h-9 px-3 text-xs flex-1 sm:flex-none">
                        {t('common:cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={!editName.trim()}
                        className="btn-primary h-11 sm:h-9 px-4 text-xs flex-1 sm:flex-none disabled:opacity-40"
                      >
                        {t('common:save')}
                      </button>
                    </div>
                  </div>
                  {renderScopeSwitches(editScopes, toggleEditScope, t('api.rightsOf', { name: k.name }))}
                  <p className="text-[11px] text-faint">
                    {k.kind === 'oauth'
                      ? t('api.editOauthHint')
                      : t('api.editKeyHint')}
                  </p>
                  {editError && <p className="text-[11px] text-status-err">{editError}</p>}
                </div>
              ) : (
              <div key={k.id} className="px-3 py-2 bg-canvas flex items-center justify-between gap-3">
                <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-main">{k.name}</span>
                  {k.kind === 'oauth' ? (
                    <span className="px-1.5 py-0.5 rounded-btn bg-accent/15 text-accent text-[10px] font-semibold" title={t('api.oauthBadge')}>
                      OAuth
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-accent">{k.keyPrefix}</span>
                  )}
                  {k.scopes
                    .split(',')
                    .filter(Boolean)
                    .map((sc) => (
                      <span key={sc} className="px-1.5 py-0.5 rounded-btn border border-border text-muted text-[10px]">
                        {scopeChip(sc)}
                      </span>
                    ))}
                  {k.lastUsedAt && (
                    <span className="text-xs text-faint">
                      {t('api.lastUsed', { date: formatDate(k.lastUsedAt) })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEdit(k)}
                    className="btn-icon w-7 h-7"
                    aria-label={t('api.editKey', { name: k.name })}
                    title={t('api.editTitle')}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteKey(k)}
                    className="btn-icon btn-icon-danger w-7 h-7"
                    aria-label={t('api.deleteKey', { name: k.name })}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              )
            )
          )}
        </div>
      </div>

      {/* How to connect: one API, two accesses */}
      <div className="pt-4 border-t border-border space-y-4">
        {mcpEnabled && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('api.access')}>
            {(
              [
                ['rest', t('api.accessRest'), Terminal],
                ['mcp', t('api.accessMcp'), Bot],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={access === value}
                onClick={() => setAccess(value)}
                className={`h-11 sm:h-8 px-3 rounded-btn border text-xs flex items-center gap-1.5 transition-colors ${
                  access === value ? 'border-accent bg-accent/10 text-main' : 'border-border text-muted hover:text-main'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-accent" />
                {label}
              </button>
            ))}
          </div>
        )}

        {(access === 'rest' || !mcpEnabled) && (
          <div className="space-y-5">
            {/* Reading: e.g. a smart home sensor for what is due today */}
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted mb-2">
                <Terminal className="w-3.5 h-3.5 text-accent" />
                <span>{t('api.readExample')}</span>
              </div>
              <pre className="p-3 bg-canvas border border-border font-mono text-xs text-main overflow-x-auto">
{`curl "${baseUrl}/api/v1/tasks?due=today&status=open" \\
  -H "X-API-Key: ${exampleToken}"`}
              </pre>
              <p className="mt-2 text-[11px] text-faint">
                <Trans t={t} i18nKey="api.readFilters" components={{ c: <code className="font-mono" /> }} />
              </p>
              <div className="flex items-center gap-2 text-xs font-medium text-muted mt-3 mb-2">
                <Terminal className="w-3.5 h-3.5 text-accent" />
                <span>{t('api.haSensor')}</span>
              </div>
              <pre className="p-3 bg-canvas border border-border font-mono text-xs text-main overflow-x-auto">
{`rest:
  - resource: "${baseUrl}/api/v1/tasks?due=today&status=open"
    headers:
      X-API-Key: "${exampleToken}"
    scan_interval: 900
    sensor:
      - name: "${t('api.haSensorName')}"
        value_template: "{{ value_json | length }}"`}
              </pre>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-7 h-7 bg-accent text-on-accent flex items-center justify-center flex-shrink-0">
                  <Webhook className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-main">{t('api.sim.title')}</h3>
                  <p className="text-xs text-muted">
                    <Trans
                      t={t}
                      i18nKey={newlyCreatedKey ? 'api.sim.introKey' : 'api.sim.introSession'}
                      components={{ c: <code className="font-mono" /> }}
                    />
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3" role="radiogroup" aria-label={t('api.sim.target')}>
                {(
                  [
                    ['triage', t('api.sim.targetInbox')],
                    ['task', t('api.sim.targetTask')],
                    ['list_item', t('api.sim.targetListItem')],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={simTarget === value}
                    onClick={() => setSimTarget(value)}
                    className={`h-11 sm:h-8 px-3 rounded-btn border text-xs transition-colors ${
                    simTarget === value ? 'border-accent bg-accent/10 text-main' : 'border-border text-muted hover:text-main'
                  }`}
                  >
                    {label}
                  </button>
                ))}
                {simTarget === 'list_item' && (
                  <SelectMenu
                    size="sm"
                    ariaLabel={t('api.sim.list')}
                    value={simListId}
                    onChange={setSimListId}
                    options={[
                      { value: '', label: t('api.sim.chooseListOption') },
                      ...lists.map((l) => ({ value: l.id, label: l.title, lead: l.icon ? <span>{l.icon}</span> : undefined })),
                    ]}
                  />
              )}
                {simTarget === 'task' && (
                  <SelectMenu
                    size="sm"
                    ariaLabel={t('api.sim.taskList')}
                    value={simTaskListId}
                    onChange={setSimTaskListId}
                    options={[
                      { value: '', label: t('api.sim.noTaskList') },
                      ...taskLists.map((tl) => ({ value: tl.id, label: tl.title, lead: tl.icon ? <span>{tl.icon}</span> : undefined })),
                    ]}
                  />
              )}
              </div>

              {simTarget === 'triage' && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {[
                    { label: t('api.sim.preset1'), text: t('api.sim.preset1Text'), prio: 'high' as PriorityLevel },
                    { label: t('api.sim.preset2'), text: t('api.sim.preset2Text'), prio: 'urgent' as PriorityLevel },
                    { label: t('api.sim.preset3'), text: t('api.sim.preset3Text'), prio: 'urgent' as PriorityLevel },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setSimTitle(preset.text);
                        setSimPriority(preset.prio);
                      }}
                      className="btn-action text-xs"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
            )}

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={simTitle}
                  onChange={(e) => setSimTitle(e.target.value)}
                  className="flex-1 h-11 sm:h-9 px-3 input-field text-base sm:text-sm"
                />
                <button
                  type="button"
                  onClick={handleSimulateWebhook}
                  className="btn-primary h-11 sm:h-9 px-4 text-xs sm:text-sm flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-4 h-4" />
                  <span>{t('api.sim.fire')}</span>
                </button>
              </div>

              {simStatus && (
                <p className={`mt-3 text-xs font-medium ${simStatus.startsWith('❌') ? 'text-status-err' : 'text-status-ok'}`}>{simStatus}</p>
            )}

              {/* Code Example Snippets */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted">
                  <Terminal className="w-3.5 h-3.5 text-accent" />
                  <span>{t('api.sim.curlTitle')}</span>
                </div>
                <pre className="p-3 bg-canvas border border-border font-mono text-xs text-main overflow-x-auto">
{`curl -X POST "${baseUrl}/api/v1/webhooks/ingest" \\
  -H "X-API-Key: ${exampleToken}" \\
  -H "Content-Type: application/json" \\
  -d '${examplePayload}'`}
                </pre>
                <p className="text-[11px] text-faint">
                  <Trans t={t} i18nKey="api.sim.headerHint" components={{ c: <code className="font-mono" /> }} />
                </p>
              </div>
            </div>
          </div>
        )}

        {access === 'mcp' && mcpEnabled && (
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-7 h-7 bg-accent text-on-accent flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-main">{t('api.mcp.title')}</h3>
                <p className="text-xs text-muted">
                  {t('api.mcp.intro')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2" role="radiogroup" aria-label={t('api.mcp.agent')}>
              {(
                [
                  ['connector', 'claude.ai / ChatGPT'],
                  ['claude', 'Claude Code'],
                  ['codex', 'OpenAI Codex'],
                  ['json', 'Claude Desktop / Cursor'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mcpClient === value}
                  onClick={() => setMcpClient(value)}
                  className={`h-11 sm:h-8 px-3 rounded-btn border text-xs transition-colors ${
                    mcpClient === value ? 'border-accent bg-accent/10 text-main' : 'border-border text-muted hover:text-main'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mcpClient === 'connector' ? (
              connectorUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 p-3 bg-canvas border border-border font-mono text-xs text-main break-all">{connectorUrl}</code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(connectorUrl);
                        setCopiedConnector(true);
                        setTimeout(() => setCopiedConnector(false), 2000);
                      }}
                      className="btn-icon w-11 h-11 sm:w-9 sm:h-9 flex-shrink-0"
                      aria-label={t('api.mcp.copyAddress')}
                      title={t('api.mcp.copyAddress')}
                    >
                      {copiedConnector ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted">
                    <Trans t={t} i18nKey="api.mcp.connectorHint" components={{ b: <span className="text-main" /> }} />
                  </p>
                </div>
              ) : (
                <p className="p-3 bg-canvas border border-border text-xs text-muted">
                  <Trans t={t} i18nKey="api.mcp.needsBaseUrl" components={{ c: <code className="font-mono" /> }} />
                </p>
              )
            ) : (
              <pre className="p-3 bg-canvas border border-border font-mono text-xs text-main overflow-x-auto">{mcpSnippet}</pre>
            )}
            <p className="mt-2 text-[11px] text-faint">
              {t('api.mcp.tools')}{' '}
              {MCP_TOOLS.map((name, i) => (
                <React.Fragment key={name}>
                  {i > 0 && ', '}
                  <code className="font-mono">{name}</code>
                </React.Fragment>
              ))}
              . {t('api.mcp.toolsHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
