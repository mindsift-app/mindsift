import React from 'react';
import { AlertCircle, Bell, Check, Globe, Mail, MessageSquare, Send, X } from 'lucide-react';
import { NotificationEvents, User } from '../../../lib/types';
import { pushSupported } from '../../../lib/push';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { useAlarmSettings } from './useAlarmSettings';
import { formatDate } from '../../../lib/format';

const NOTIFICATION_EVENT_ROWS: { key: keyof NotificationEvents; label: string }[] = [
  { key: 'due', label: 'Fällige Aufgaben (sofort)' },
  { key: 'shared', label: 'Freigabe erhalten' },
  { key: 'taskDone', label: 'Geteilte Aufgabe erledigt' },
  { key: 'watched', label: 'Beobachtete Aufgaben' },
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
  const {
    notificationSettings,
    setNotificationSettings,
    alarmEmail,
    setAlarmEmail,
    discordWebhookUrl,
    setDiscordWebhookUrl,
    customWebhookUrl,
    setCustomWebhookUrl,
    notifyBeforeMinutes,
    setNotifyBeforeMinutes,
    alarmMsg,
    savingAlarms,
    testingChannel,
    pushDevices,
    pushHere,
    pushEndpointHere,
    pushBusy,
    pushMsg,
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
          Aufgaben-Alarme & Benachrichtigungsziele
        </h2>
        <p className="text-muted mt-0.5">
          Wähle aus, über welche Kanäle du benachrichtigt werden möchtest, sobald eine
          Aufgabe mit Fälligkeitsdatum ansteht. Mehrere Ziele können gleichzeitig aktiv sein.
        </p>
      </div>

      {demoMode && (
        <div className="flex items-center gap-2 alert-err">
          <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          <span>In der Demo deaktiviert: Alarme und Tests werden nicht verschickt.</span>
        </div>
      )}

      {alarmMsg && (
        <div
          className={`flex items-center gap-2 ${
            alarmMsg.type === 'ok' ? 'alert-ok' : 'alert-err'
          }`}
        >
          {alarmMsg.type === 'ok' ? (
            <Check className="w-4 h-4 text-status-ok flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          )}
          <span>{alarmMsg.text}</span>
        </div>
      )}

      <form onSubmit={handleSaveAlarms} className="space-y-4">
        {/* Global Pause & Own Watched Toggles */}
        <div className="p-3.5 bg-canvas border border-border space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-main">Alle Benachrichtigungen pausieren</p>
              <p className="text-[11px] text-muted">
                Pausiert vorübergehend sämtliche E-Mail- und Discord-Benachrichtigungen.
              </p>
            </div>
            <ToggleSwitch
              checked={notificationSettings.paused}
              onChange={(v) => setNotificationSettings((prev) => ({ ...prev, paused: v }))}
              title="Alle Benachrichtigungen pausieren"
            />
          </div>
          <div className="flex items-center justify-between gap-4 pt-3 border-t border-border">
            <div>
              <p className="font-semibold text-main">
                Auch eigene Änderungen an beobachteten Aufgaben melden
              </p>
              <p className="text-[11px] text-muted">
                Standardmäßig wirst du nur über Änderungen anderer Personen benachrichtigt.
              </p>
            </div>
            <ToggleSwitch
              checked={notificationSettings.includeOwnWatched}
              onChange={(v) => setNotificationSettings((prev) => ({ ...prev, includeOwnWatched: v }))}
              title="Auch eigene Änderungen an beobachteten Aufgaben melden"
            />
          </div>
        </div>

        {/* Routing Matrix: Events x (E-Mail / Discord / own webhook) */}
        {(() => {
          const hasDiscordWebhook = Boolean(discordWebhookUrl.trim());
          const hasCustomWebhook = Boolean(customWebhookUrl.trim());
          const hasPush = pushDevices.length > 0;
          return (
            <>
              <div className="p-4 bg-canvas border border-border space-y-3">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1 sm:gap-4 pb-2 border-b border-border">
                  <span className="font-bold text-main">Ereignis</span>
                  <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                    <Mail className="w-3.5 h-3.5 text-accent" />
                    <span>E-Mail</span>
                  </span>
                  <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-accent" />
                    <span>Discord</span>
                  </span>
                  <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                    <Globe className="w-3.5 h-3.5 text-accent" />
                    <span>Webhook</span>
                  </span>
                  <span className="w-12 sm:w-16 text-center font-semibold text-muted flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1">
                    <Bell className="w-3.5 h-3.5 text-accent" />
                    <span>Push</span>
                  </span>
                </div>

                <div className="divide-y divide-border">
                  {NOTIFICATION_EVENT_ROWS.map((row) => {
                    const routing = notificationSettings.events[row.key];
                    return (
                      <div
                        key={row.key}
                        className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-1 sm:gap-4 py-2.5"
                      >
                        <span className="font-medium text-main">{row.label}</span>
                        <div className="w-12 sm:w-16 flex justify-center">
                          <ToggleSwitch
                            checked={routing.email}
                            onChange={(v) => setEventChannel(row.key, 'email', v)}
                            title={`${row.label} – E-Mail`}
                          />
                        </div>
                        <div className="w-12 sm:w-16 flex justify-center">
                          <ToggleSwitch
                            checked={routing.discord}
                            disabled={!hasDiscordWebhook}
                            onChange={(v) => setEventChannel(row.key, 'discord', v)}
                            title={
                              hasDiscordWebhook
                                ? `${row.label} – Discord`
                                : 'Bitte zuerst unten eine Discord Webhook URL eintragen'
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
                                ? `${row.label} – Webhook`
                                : 'Bitte zuerst unten eine eigene Webhook URL eintragen'
                            }
                          />
                        </div>
                        <div className="w-12 sm:w-16 flex justify-center">
                          <ToggleSwitch
                            checked={routing.push}
                            disabled={!hasPush}
                            onChange={(v) => setEventChannel(row.key, 'push', v)}
                            title={hasPush ? `${row.label} – Push` : 'Bitte zuerst unten Push auf einem Gerät einschalten'}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[11px] text-faint pt-1">
                  Gebündelt: höchstens alle 5 Minuten eine Nachricht (außer fällige Aufgaben)
                </p>
                {!hasDiscordWebhook && (
                  <p className="text-[11px] text-status-warn">
                    Discord-Schalter sind deaktiviert, solange unten kein Discord-Webhook eingetragen ist.
                  </p>
                )}
                {!hasCustomWebhook && (
                  <p className="text-[11px] text-faint">
                    Webhook-Schalter werden aktiv, sobald unten eine eigene Webhook-URL eingetragen ist.
                  </p>
                )}
              </div>

              {/* Daily Summary */}
              <div className="p-4 bg-canvas border border-border space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-bold text-main">Tageszusammenfassung</p>
                    <p className="text-[11px] text-muted">
                      Überfällige, heutige und morgige Aufgaben; nichts fällig = keine Nachricht
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={notificationSettings.dailySummary.enabled}
                    onChange={(v) =>
                      setNotificationSettings((prev) => ({
                        ...prev,
                        dailySummary: { ...prev.dailySummary, enabled: v } }))
                    }
                    title="Tageszusammenfassung"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border">
                  <label className="flex items-center gap-2 text-xs text-main font-medium">
                    <span>Uhrzeit:</span>
                    <input
                      type="time"
                      aria-label="Uhrzeit der Tageszusammenfassung"
                      value={notificationSettings.dailySummary.time}
                      onChange={(e) =>
                        setNotificationSettings((prev) => ({
                          ...prev,
                          dailySummary: { ...prev.dailySummary, time: e.target.value } }))
                      }
                      className="h-11 sm:h-8 px-2.5 input-field font-mono"
                    />
                  </label>

                  {/* Phones: 2×2 grid, the four switches do not fit in one row */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 w-full sm:w-auto sm:flex sm:items-center sm:gap-5">
                    <div className="flex items-center justify-between sm:justify-start gap-2">
                      <span className="text-xs text-muted">E-Mail</span>
                      <ToggleSwitch
                        checked={notificationSettings.dailySummary.email}
                        onChange={(v) =>
                          setNotificationSettings((prev) => ({
                            ...prev,
                            dailySummary: { ...prev.dailySummary, email: v } }))
                        }
                        title="Tageszusammenfassung – E-Mail"
                      />
                    </div>
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
                            ? 'Tageszusammenfassung – Discord'
                            : 'Bitte zuerst unten eine Discord Webhook URL eintragen'
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
                            ? 'Tageszusammenfassung – Webhook'
                            : 'Bitte zuerst unten eine eigene Webhook URL eintragen'
                        }
                      />
                    </div>
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
                        title={hasPush ? 'Tageszusammenfassung – Push' : 'Bitte zuerst unten Push auf einem Gerät einschalten'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

        {/* Lead Time Selector */}
        <div className="p-3.5 bg-canvas border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <label className="font-semibold text-main block">
              Vorwarnzeit vor Fälligkeit
            </label>
            <p className="text-[11px] text-muted">
              Wann soll MindSift den Alarm vor dem Fälligkeitszeitpunkt auslösen?
            </p>
          </div>
          <select
            value={notifyBeforeMinutes}
            onChange={(e) => setNotifyBeforeMinutes(Number(e.target.value))}
            className="h-9 px-3 input-field min-w-[200px]"
          >
            <option value={0}>Pünktlich bei Fälligkeit (0 Min.)</option>
            <option value={15}>15 Minuten vorher</option>
            <option value={30}>30 Minuten vorher</option>
            <option value={60}>1 Stunde vorher</option>
            <option value={120}>2 Stunden vorher</option>
            <option value={1440}>1 Tag vorher (24 Std.)</option>
          </select>
        </div>

        {/* Channel 1: E-Mail */}
        <div className="p-4 border border-border transition-colors space-y-3 bg-canvas">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Mail className="w-4 h-4 text-accent" />
              <div>
                <span className="font-bold text-main block">Ziel: E-Mail</span>
                <span className="text-[11px] text-muted">
                  Sendet eine E-Mail über den konfigurierten SMTP-Server der Instanz.
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleTestChannel('email')}
              disabled={demoMode || testingChannel === 'email'}
              className="btn-action h-8 px-3 text-xs flex items-center gap-1.5 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'email' ? 'Sende…' : 'E-Mail testen'}</span>
            </button>
          </div>

          <div className="pl-6">
            <label className="block text-muted mb-1">
              Abweichende Empfänger-E-Mail (optional, Standard: {currentUser.email})
            </label>
            <input
              type="email"
              value={alarmEmail}
              onChange={(e) => setAlarmEmail(e.target.value)}
              placeholder={currentUser.email}
              className="w-full h-8 px-2.5 input-field"
            />
          </div>
        </div>

        {/* Channel 2: Discord Webhook */}
        <div className="p-4 border border-border transition-colors space-y-3 bg-canvas">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-accent" />
              <div>
                <span className="font-bold text-main block">Ziel: Discord Webhook</span>
                <span className="text-[11px] text-muted">
                  Sendet eine formatierte Embed-Benachrichtigung direkt in deinen
                  Discord-Kanal.
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleTestChannel('discord')}
              disabled={demoMode || testingChannel === 'discord'}
              className="btn-action h-8 px-3 text-xs flex items-center gap-1.5 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'discord' ? 'Sende…' : 'Discord testen'}</span>
            </button>
          </div>

          <div className="pl-6">
            <label className="block text-muted mb-1">Discord Webhook URL</label>
            <input
              type="url"
              value={discordWebhookUrl}
              onChange={(e) => setDiscordWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/123456789/token..."
              className="w-full h-8 px-2.5 input-field font-mono"
            />
          </div>
        </div>

        {/* Channel 3: Custom HTTP Webhook */}
        <div
          className={`p-4 border transition-colors space-y-3 bg-canvas ${
            customWebhookUrl.trim() ? 'border-accent' : 'border-border'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Globe className="w-4 h-4 text-accent" />
              <div>
                <span className="font-bold text-main block">
                  Ziel: Eigener Webhook (HTTP POST JSON)
                </span>
                <span className="text-[11px] text-muted">
                  Für eigene Empfänger-Skripte, Ntfy, Gotify, Slack, Mattermost oder
                  Automatisierungen. Welche Ereignisse hierher gehen, stellst du oben in der Spalte „Webhook“ ein.
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleTestChannel('webhook')}
              disabled={demoMode || testingChannel === 'webhook'}
              className="btn-action h-8 px-3 text-xs flex items-center gap-1.5 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3 text-accent" />
              <span>{testingChannel === 'webhook' ? 'Sende…' : 'Webhook testen'}</span>
            </button>
          </div>

          <div className="pl-6">
            <label className="block text-muted mb-1">
              Ziel-URL (empfängt JSON-Payload per POST)
            </label>
            <input
              type="url"
              value={customWebhookUrl}
              onChange={(e) => setCustomWebhookUrl(e.target.value)}
              placeholder="https://dein-server.local/webhook/mindsift-alarm"
              className="w-full h-8 px-2.5 input-field font-mono"
            />
          </div>
        </div>

        {/* Web push: this browser or installed app */}
        <div className={`p-4 border transition-colors space-y-3 bg-canvas ${pushHere ? 'border-accent' : 'border-border'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Bell className="w-4 h-4 text-accent shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-main block">Ziel: Push-Benachrichtigungen</span>
                <span className="text-[11px] text-muted">
                  Systembenachrichtigung auf diesem Gerät, auch wenn MindSift geschlossen ist. Auf iPhone und
                  iPad nur, wenn MindSift zum Home-Bildschirm hinzugefügt wurde.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted">Dieses Gerät</span>
              <ToggleSwitch
                checked={pushHere}
                disabled={pushBusy || demoMode || !pushSupported()}
                onChange={(v) => void togglePushHere(v)}
                title={pushSupported() ? 'Push auf diesem Gerät' : 'Dieser Browser unterstützt keine Push-Benachrichtigungen'}
              />
              <button
                type="button"
                onClick={() => void sendTestPush()}
                disabled={pushBusy || demoMode || pushDevices.length === 0}
                className="btn-action h-8 px-3 text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3 h-3 text-accent" />
                <span>Test senden</span>
              </button>
            </div>
          </div>
          {pushDevices.length > 0 && (
            <div className="pl-6 space-y-1">
              <p className="text-[11px] text-faint">
                Aktiv auf {pushDevices.length} {pushDevices.length === 1 ? 'Gerät' : 'Geräten'}. Alte Installationen
                verschwinden beim nächsten Push von selbst oder lassen sich hier entfernen.
              </p>
              <ul className="border border-border divide-y divide-border bg-panel">
                {pushDevices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 pl-2.5 pr-1 py-1">
                    <span className="min-w-0 text-[11px] text-main truncate">
                      {d.device || 'Gerät'}
                      <span className="text-faint">
                        {' · seit '}
                        {formatDate(d.createdAt)}
                        {d.endpoint === pushEndpointHere && ' · dieses Gerät'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeDevice(d.endpoint)}
                      disabled={pushBusy || demoMode}
                      title="Gerät entfernen"
                      aria-label={`${d.device || 'Gerät'} entfernen`}
                      className="h-9 w-9 sm:h-7 sm:w-7 shrink-0 flex items-center justify-center text-faint hover:text-status-err disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {pushMsg && (
            <p className={`pl-6 text-[11px] ${pushMsg.type === 'ok' ? 'text-status-ok' : 'text-status-err'}`}>{pushMsg.text}</p>
          )}
        </div>

        <div className="pt-2 border-t border-border flex justify-end">
          <button
            type="submit"
            disabled={savingAlarms}
            className="btn-primary h-9 px-5 text-xs font-semibold"
          >
            {savingAlarms ? 'Speichere…' : 'Alarm-Einstellungen speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}
