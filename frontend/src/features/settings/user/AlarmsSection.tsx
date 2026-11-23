import React from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Bell, Globe, Mail, MessageSquare, Monitor, Send, X } from 'lucide-react';
import { NotificationEvents, User } from '../../../lib/types';
import { pushSupported } from '../../../lib/push';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { StatusToast } from '../../../components/StatusToast';
import { useAlarmSettings } from './useAlarmSettings';
import { formatDate } from '../../../lib/format';
import { TimeField } from '../../../components/TimeField';
import { SelectMenu } from '../../../components/SelectMenu';
import { can, type Capability } from '../../../lib/capabilities';
import { SettingRow, SettingsCard } from '../../../components/SettingsCard';

// The routing matrix: the event, Discord and the own webhook, plus e-mail, push and system notifications
// where available
const MATRIX_COLS = [
  'grid-cols-[1fr_auto_auto]',
  'grid-cols-[1fr_auto_auto_auto]',
  'grid-cols-[1fr_auto_auto_auto_auto]',
  'grid-cols-[1fr_auto_auto_auto_auto_auto]',
];

// Kontoeinstellungen → Alarme (state in useAlarmSettings)
export function AlarmsSection({
  alarms,
  currentUser,
  demoMode }: {
  alarms: ReturnType<typeof useAlarmSettings>;
  currentUser: User;
  demoMode: boolean;
}) {
  const { t } = useTranslation('settings');
  const eventRows: { key: keyof NotificationEvents; label: string; needs?: Capability }[] = [
    { key: 'due', label: t('alarms.event.due') },
    { key: 'shared', label: t('alarms.event.shared'), needs: 'sharing' },
    { key: 'assigned', label: t('alarms.event.assigned'), needs: 'sharing' },
    { key: 'mentioned', label: t('alarms.event.mentioned'), needs: 'sharing' },
    { key: 'taskCreated', label: t('alarms.event.taskCreated'), needs: 'sharing' },
    { key: 'taskDone', label: t('alarms.event.taskDone'), needs: 'sharing' },
    { key: 'watched', label: t('alarms.event.watched'), needs: 'watch' },
  ];
  // Sharing off (sharing mode private, the desktop app): nothing is shared, assigned or mentioned; without
  // watching (the desktop app) no task is watched
  const NOTIFICATION_EVENT_ROWS = eventRows.filter((row) => !row.needs || can(row.needs));
  const {
    notificationSettings,
    setNotificationSettings,
    discordWebhookUrl,
    setDiscordWebhookUrl,
    customWebhookUrl,
    setCustomWebhookUrl,
    notifyBeforeMinutes,
    setNotifyBeforeMinutes,
    alarmMsg,
    setAlarmMsg,
    savingAlarms,
    testingChannel,
    pushDevices,
    pushHere,
    pushEndpointHere,
    pushBusy,
    removeDevice,
    togglePushHere,
    sendTestPush,
    setEventChannel,
    handleSaveAlarms,
    handleTestChannel } = alarms;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">
          {t('settings:alarms.title')}
        </h2>
        <p className="text-muted mt-0.5">
          {t('alarms.intro')}
        </p>
      </div>

      {demoMode && (
        <div className="flex items-center gap-2 alert-err">
          <CircleAlert className="w-4 h-4 text-status-err shrink-0" />
          <span>{t('alarms.demoOff')}</span>
        </div>
      )}

      <StatusToast msg={alarmMsg} onClose={() => setAlarmMsg(null)} />

      <form onSubmit={handleSaveAlarms} className="space-y-4">
        {/* Global Pause & Own Watched Toggles */}
        <SettingsCard
          title={t('alarms.pauseAll')}
          action={
            <ToggleSwitch
              checked={notificationSettings.paused}
              onChange={(v) => setNotificationSettings((prev) => ({ ...prev, paused: v }))}
              title={t('alarms.pauseAll')}
            />
          }
        >
          {can('watch') && (
            <SettingRow plain className="pt-3 border-t border-border" title={t('alarms.ownChanges')}>
              <ToggleSwitch
                checked={notificationSettings.includeOwnWatched}
                onChange={(v) => setNotificationSettings((prev) => ({ ...prev, includeOwnWatched: v }))}
                title={t('alarms.ownChanges')}
              />
            </SettingRow>
          )}
        </SettingsCard>

        {/* Routing Matrix: Events x (E-Mail / Discord / own webhook) */}
        {(() => {
          const hasDiscordWebhook = Boolean(discordWebhookUrl.trim());
          const hasCustomWebhook = Boolean(customWebhookUrl.trim());
          const hasPush = pushDevices.length > 0;
          // Mail only where the instance may send it, web push only in a browser (not in the desktop app)
          const mail = can('email');
          const push = can('push');
          // System notifications only where the desktop app shows them (its local instances)
          const desktop = can('desktopNotify');
          const matrixCols = MATRIX_COLS[Number(mail) + Number(push) + Number(desktop)];
          return (
            <>
              <SettingsCard>
                <div className={`grid ${matrixCols} items-center gap-1 sm:gap-4 pb-2 border-b border-border`}>
                  <span className="font-bold text-main">{t('alarms.eventHeader')}</span>
                  {mail && (
                    <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                      <Mail className="w-3.5 h-3.5 text-accent" />
                      <span>{t('alarms.channel.email')}</span>
                    </span>
                  )}
                  <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-accent" />
                    <span>Discord</span>
                  </span>
                  <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                    <Globe className="w-3.5 h-3.5 text-accent" />
                    <span>Webhook</span>
                  </span>
                  {push && (
                    <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                      <Bell className="w-3.5 h-3.5 text-accent" />
                      <span>Push</span>
                    </span>
                  )}
                  {desktop && (
                    <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                      <Monitor className="w-3.5 h-3.5 text-accent" />
                      <span>{t('alarms.channel.desktopShort')}</span>
                    </span>
                  )}
                </div>

                <div className="divide-y divide-border">
                  {NOTIFICATION_EVENT_ROWS.map((row) => {
                    const routing = notificationSettings.events[row.key];
                    return (
                      <div
                        key={row.key}
                        className={`grid ${matrixCols} items-center gap-1 sm:gap-4 py-2.5`}
                      >
                        <span className="font-medium text-main">{row.label}</span>
                        {mail && (
                          <div className="w-12 sm:w-16 flex justify-center">
                            <ToggleSwitch
                              checked={routing.email}
                              onChange={(v) => setEventChannel(row.key, 'email', v)}
                              title={t('alarms.channelTitle', { what: row.label, channel: t('alarms.channel.email') })}
                            />
                          </div>
                        )}
                        <div className="w-12 sm:w-16 flex justify-center">
                          <ToggleSwitch
                            checked={routing.discord}
                            disabled={!hasDiscordWebhook}
                            onChange={(v) => setEventChannel(row.key, 'discord', v)}
                            title={
                              hasDiscordWebhook
                                ? t('alarms.channelTitle', { what: row.label, channel: 'Discord' })
                                : t('alarms.needDiscord')
                            }
                          />
                        </div>
                        <div className="w-12 sm:w-16 flex justify-center">
                          <ToggleSwitch
                            checked={routing.webhook}
                            disabled={!hasCustomWebhook}
                            onChange={(v) => setEventChannel(row.key, 'webhook', v)}
                            title={
                              hasCustomWebhook
                                ? t('alarms.channelTitle', { what: row.label, channel: 'Webhook' })
                                : t('alarms.needWebhook')
                            }
                          />
                        </div>
                        {push && (
                          <div className="w-12 sm:w-16 flex justify-center">
                            <ToggleSwitch
                              checked={routing.push}
                              disabled={!hasPush}
                              onChange={(v) => setEventChannel(row.key, 'push', v)}
                              title={hasPush ? t('alarms.channelTitle', { what: row.label, channel: 'Push' }) : t('alarms.needPush')}
                            />
                          </div>
                        )}
                        {desktop && (
                          <div className="w-12 sm:w-16 flex justify-center">
                            <ToggleSwitch
                              checked={routing.desktop}
                              onChange={(v) => setEventChannel(row.key, 'desktop', v)}
                              title={t('alarms.channelTitle', { what: row.label, channel: t('alarms.channel.desktop') })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-[11px] text-faint pt-1">
                  {t('alarms.bundled')}
                </p>
                {!hasDiscordWebhook && (
                  <p className="text-[11px] text-status-warn">
                    {t('settings:alarms.discordDisabled')}
                  </p>
                )}
                {!hasCustomWebhook && (
                  <p className="text-[11px] text-faint">
                    {t('settings:alarms.webhookHint')}
                  </p>
                )}
              </SettingsCard>

              {/* Daily Summary */}
              <SettingsCard
                title={t('alarms.daily.title')}
                hint={t('alarms.daily.hint')}
                action={
                  <ToggleSwitch
                    checked={notificationSettings.dailySummary.enabled}
                    onChange={(v) =>
                      setNotificationSettings((prev) => ({
                        ...prev,
                        dailySummary: { ...prev.dailySummary, enabled: v } }))
                    }
                    title={t('alarms.daily.title')}
                  />
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border">
                  <div className="flex items-center gap-2 text-xs text-main font-medium">
                    <span>{t('alarms.daily.time')}</span>
                    <TimeField
                      ariaLabel={t('alarms.daily.timeLabel')}
                      value={notificationSettings.dailySummary.time}
                      onChange={(time) =>
                        time &&
                        setNotificationSettings((prev) => ({
                          ...prev,
                          dailySummary: { ...prev.dailySummary, time } }))
                      }
                      className="w-28"
                      inputClassName="h-11 sm:h-8 px-2.5 input-field font-mono"
                    />
                  </div>

                  {/* Phones: 2×2 grid, the four switches do not fit in one row */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 w-full sm:w-auto sm:flex sm:items-center sm:gap-5">
                    {can('email') && (
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs text-muted">{t('alarms.channel.email')}</span>
                      <ToggleSwitch
                        checked={notificationSettings.dailySummary.email}
                        onChange={(v) =>
                          setNotificationSettings((prev) => ({
                            ...prev,
                            dailySummary: { ...prev.dailySummary, email: v } }))
                        }
                        title={t('alarms.daily.email')}
                      />
                    </div>
                    )}
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs text-muted">Discord</span>
                      <ToggleSwitch
                        checked={notificationSettings.dailySummary.discord}
                        disabled={!hasDiscordWebhook}
                        onChange={(v) =>
                          setNotificationSettings((prev) => ({
                            ...prev,
                            dailySummary: { ...prev.dailySummary, discord: v } }))
                        }
                        title={
                          hasDiscordWebhook
                            ? t('alarms.daily.discord')
                            : t('alarms.needDiscord')
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs text-muted">Webhook</span>
                      <ToggleSwitch
                        checked={notificationSettings.dailySummary.webhook}
                        disabled={!hasCustomWebhook}
                        onChange={(v) =>
                          setNotificationSettings((prev) => ({
                            ...prev,
                            dailySummary: { ...prev.dailySummary, webhook: v } }))
                        }
                        title={
                          hasCustomWebhook
                            ? t('alarms.daily.webhook')
                            : t('alarms.needWebhook')
                        }
                      />
                    </div>
                    {can('push') && (
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs text-muted">Push</span>
                      <ToggleSwitch
                        checked={notificationSettings.dailySummary.push}
                        disabled={!hasPush}
                        onChange={(v) =>
                          setNotificationSettings((prev) => ({
                            ...prev,
                            dailySummary: { ...prev.dailySummary, push: v } }))
                        }
                        title={hasPush ? t('alarms.daily.push') : t('alarms.needPush')}
                      />
                    </div>
                    )}
                    {desktop && (
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs text-muted">{t('alarms.channel.desktopShort')}</span>
                      <ToggleSwitch
                        checked={notificationSettings.dailySummary.desktop}
                        onChange={(v) =>
                          setNotificationSettings((prev) => ({
                            ...prev,
                            dailySummary: { ...prev.dailySummary, desktop: v } }))
                        }
                        title={t('alarms.daily.desktop')}
                      />
                    </div>
                    )}
                  </div>
                </div>
              </SettingsCard>
            </>
          );
        })()}

        {/* Lead Time Selector */}
        <SettingRow title={t('alarms.lead.title')}>
          <div className="w-full sm:w-auto sm:min-w-[200px]">
            <SelectMenu
              ariaLabel={t('alarms.lead.title')}
              value={String(notifyBeforeMinutes)}
              onChange={(m) => setNotifyBeforeMinutes(Number(m))}
              options={[0, 15, 30, 60, 120, 1440].map((m) => ({ value: String(m), label: t(`alarms.lead.${m}`) }))}
            />
          </div>
        </SettingRow>

        {/* Channel 1: E-Mail, where the instance may send mail */}
        {can('email') && (
        <SettingsCard
          title={t('alarms.email.title')}
          icon={<Mail className="w-3.5 h-3.5 text-accent" />}
          hint={<span className="wrap-break-word">{t('alarms.email.recipient', { email: currentUser.email })}</span>}
          action={
            <button
              type="button"
              onClick={() => handleTestChannel('email')}
              disabled={demoMode || testingChannel === 'email'}
              className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'email' ? t('sending') : t('alarms.email.test')}</span>
            </button>
          }
        />
        )}

        {/* System notifications of the desktop app (its local instances, while the app is open) */}
        {can('desktopNotify') && (
        <SettingsCard
          title={t('alarms.desktop.title')}
          icon={<Monitor className="w-3.5 h-3.5 text-accent" />}
          hint={t('alarms.desktop.hint')}
          action={
            <button
              type="button"
              onClick={() => handleTestChannel('desktop')}
              disabled={testingChannel === 'desktop'}
              className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'desktop' ? t('sending') : t('alarms.desktop.test')}</span>
            </button>
          }
        />
        )}

        {/* Channel 2: Discord Webhook */}
        <SettingsCard
          title={t('alarms.discord.title')}
          icon={<MessageSquare className="w-3.5 h-3.5 text-accent" />}
          action={
            <button
              type="button"
              onClick={() => handleTestChannel('discord')}
              disabled={demoMode || testingChannel === 'discord'}
              className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'discord' ? t('sending') : t('alarms.discord.test')}</span>
            </button>
          }
        >
          <div>
            <label className="block text-muted mb-1">{t('alarms.discord.url')}</label>
            <input
              type="url"
              value={discordWebhookUrl}
              onChange={(e) => setDiscordWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/123456789/token..."
              className="w-full h-11 sm:h-8 px-2.5 input-field font-mono"
            />
          </div>
        </SettingsCard>

        {/* Channel 3: Custom HTTP Webhook */}
        <SettingsCard
          active={Boolean(customWebhookUrl.trim())}
          title={t('alarms.webhook.title')}
          icon={<Globe className="w-3.5 h-3.5 text-accent" />}
          hint={t('alarms.webhook.hint')}
          action={
            <button
              type="button"
              onClick={() => handleTestChannel('webhook')}
              disabled={demoMode || testingChannel === 'webhook'}
              className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'webhook' ? t('sending') : t('alarms.webhook.test')}</span>
            </button>
          }
        >
          <div>
            <label className="block text-muted mb-1">
              {t('alarms.webhook.url')}
            </label>
            <input
              type="url"
              value={customWebhookUrl}
              onChange={(e) => setCustomWebhookUrl(e.target.value)}
              placeholder={t('alarms.webhook.placeholder')}
              className="w-full h-11 sm:h-8 px-2.5 input-field font-mono"
            />
          </div>
        </SettingsCard>

        {/* Web push: this browser or installed app (not in the desktop app's webview) */}
        {can('push') && (
        <SettingsCard
          active={pushHere}
          title={t('alarms.push.title')}
          icon={<Bell className="w-3.5 h-3.5 text-accent shrink-0" />}
          hint={t('alarms.push.hint')}
          action={
            <>
              <span className="text-xs text-muted">{t('alarms.push.thisDeviceLabel')}</span>
              <ToggleSwitch
                checked={pushHere}
                disabled={pushBusy || demoMode || !pushSupported()}
                onChange={(v) => void togglePushHere(v)}
                title={pushSupported() ? t('alarms.push.toggle') : t('alarms.push.unsupported')}
              />
              <button
                type="button"
                onClick={() => void sendTestPush()}
                disabled={pushBusy || demoMode || pushDevices.length === 0}
                className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3 h-3 text-accent" />
                <span>{t('alarms.push.test')}</span>
              </button>
            </>
          }
        >
          {pushDevices.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-faint">
                {t('alarms.push.activeOn', { count: pushDevices.length })}
              </p>
              <ul className="border border-border divide-y divide-border bg-panel">
                {pushDevices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 pl-2.5 pr-1 py-1">
                    <span className="min-w-0 text-[11px] text-main truncate">
                      {d.device || t('alarms.push.device')}
                      <span className="text-faint">
                        {' · '}
                        {t('alarms.push.since', { date: formatDate(d.createdAt) })}
                        {d.endpoint === pushEndpointHere && ` · ${t('alarms.push.thisDevice')}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeDevice(d.endpoint)}
                      disabled={pushBusy || demoMode}
                      title={t('alarms.push.remove')}
                      aria-label={t('alarms.push.removeNamed', { name: d.device || t('alarms.push.device') })}
                      className="h-11 w-11 sm:h-7 sm:w-7 shrink-0 flex items-center justify-center text-faint hover:text-status-err disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SettingsCard>
        )}

        <div className="pt-2 border-t border-border flex justify-end">
          <button
            type="submit"
            disabled={savingAlarms}
            className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold"
          >
            {savingAlarms ? t('saving') : t('alarms.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
