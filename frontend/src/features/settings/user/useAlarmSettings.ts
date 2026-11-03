import React, { useCallback, useEffect, useState } from 'react';
import { NotificationEvents, NotificationSettings, PushDevice, User } from '../../../lib/types';
import { api } from '../../../lib/api';
import { currentPushSubscription, disablePush, enablePush, removePushDevice } from '../../../lib/push';

// The notification settings of an account; old accounts only have alarmChannels (the channels of due tasks)
export function buildNotificationSettings(user: User): NotificationSettings {
  const hasLegacy = Array.isArray(user.alarmChannels);
  const dueEmailDefault = hasLegacy ? user.alarmChannels!.includes('email') : true;
  const dueDiscordDefault = hasLegacy ? user.alarmChannels!.includes('discord') : true;
  const dueWebhookDefault = hasLegacy ? user.alarmChannels!.includes('webhook') : false;
  const s = user.notificationSettings;
  return {
    paused: Boolean(s?.paused),
    includeOwnWatched: Boolean(s?.includeOwnWatched),
    events: {
      due: {
        email: s?.events?.due?.email ?? dueEmailDefault,
        discord: s?.events?.due?.discord ?? dueDiscordDefault,
        webhook: s?.events?.due?.webhook ?? dueWebhookDefault,
        push: s?.events?.due?.push ?? false,
      },
      shared: {
        email: s?.events?.shared?.email ?? true,
        discord: s?.events?.shared?.discord ?? false,
        webhook: s?.events?.shared?.webhook ?? false,
        push: s?.events?.shared?.push ?? false,
      },
      taskDone: {
        email: s?.events?.taskDone?.email ?? false,
        discord: s?.events?.taskDone?.discord ?? false,
        webhook: s?.events?.taskDone?.webhook ?? false,
        push: s?.events?.taskDone?.push ?? false,
      },
      watched: {
        email: s?.events?.watched?.email ?? true,
        discord: s?.events?.watched?.discord ?? true,
        webhook: s?.events?.watched?.webhook ?? false,
        push: s?.events?.watched?.push ?? false,
      },
    },
    dailySummary: {
      enabled: s?.dailySummary?.enabled ?? false,
      time: s?.dailySummary?.time || '07:00',
      email: s?.dailySummary?.email ?? true,
      discord: s?.dailySummary?.discord ?? false,
      webhook: s?.dailySummary?.webhook ?? false,
      push: s?.dailySummary?.push ?? false,
    },
  };
}

// Kontoeinstellungen → Alarme: channels per event, daily summary, lead time, the targets (e-mail, Discord,
// own webhook) with a test each, and web push on this device. Lives in the view, so unsaved input survives
// switching sections.
export function useAlarmSettings(currentUser: User, onUserUpdated: (u: User) => void) {
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() =>
    buildNotificationSettings(currentUser)
  );
  const [alarmEmail, setAlarmEmail] = useState(currentUser.alarmEmail || currentUser.email || '');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(currentUser.discordWebhookUrl || '');
  const [customWebhookUrl, setCustomWebhookUrl] = useState(currentUser.customWebhookUrl || '');
  const [notifyBeforeMinutes, setNotifyBeforeMinutes] = useState<number>(
    currentUser.notifyBeforeMinutes ?? 30
  );
  const [alarmMsg, setAlarmMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingAlarms, setSavingAlarms] = useState(false);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  // Web push: devices of this account and whether this browser is one of them
  const [pushDevices, setPushDevices] = useState<PushDevice[]>([]);
  const [pushHere, setPushHere] = useState(false);
  const [pushEndpointHere, setPushEndpointHere] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const reloadPush = useCallback(async () => {
    const [devices, sub] = await Promise.all([api.getPushDevices().catch(() => []), currentPushSubscription()]);
    setPushDevices(devices);
    setPushHere(Boolean(sub && devices.some((d) => d.endpoint === sub.endpoint)));
    setPushEndpointHere(sub?.endpoint ?? null);
  }, []);
  // An old installation or a device you no longer use: remove it from the list
  const removeDevice = async (endpoint: string) => {
    setPushBusy(true);
    setPushMsg(null);
    try {
      await removePushDevice(endpoint);
      await reloadPush();
    } catch (err) {
      setPushMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gerät konnte nicht entfernt werden' });
    } finally {
      setPushBusy(false);
    }
  };
  useEffect(() => {
    void reloadPush();
  }, [reloadPush]);
  const togglePushHere = async (on: boolean) => {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (on) await enablePush();
      else await disablePush();
      await reloadPush();
      setPushMsg({ type: 'ok', text: on ? 'Push ist auf diesem Gerät eingeschaltet.' : 'Push ist auf diesem Gerät ausgeschaltet.' });
    } catch (err) {
      setPushMsg({ type: 'err', text: err instanceof Error ? err.message : 'Push konnte nicht eingeschaltet werden' });
    } finally {
      setPushBusy(false);
    }
  };
  const sendTestPush = async () => {
    setPushBusy(true);
    setPushMsg(null);
    try {
      const res = await api.testPush();
      setPushMsg({ type: 'ok', text: `Test-Benachrichtigung an ${res.devices} ${res.devices === 1 ? 'Gerät' : 'Geräte'} gesendet.` });
    } catch (err) {
      setPushMsg({ type: 'err', text: err instanceof Error ? err.message : 'Test fehlgeschlagen' });
    } finally {
      setPushBusy(false);
    }
  };


  // The form follows the account when it changes (saved here or on another device)
  useEffect(() => {
    setNotificationSettings(buildNotificationSettings(currentUser));
    setAlarmEmail(currentUser.alarmEmail || currentUser.email || '');
    setDiscordWebhookUrl(currentUser.discordWebhookUrl || '');
    setCustomWebhookUrl(currentUser.customWebhookUrl || '');
    setNotifyBeforeMinutes(currentUser.notifyBeforeMinutes ?? 30);
  }, [currentUser]);

  const setEventChannel = (eventKey: keyof NotificationEvents, channel: 'email' | 'discord' | 'webhook' | 'push', value: boolean) => {
    setNotificationSettings((prev) => ({
      ...prev,
      events: {
        ...prev.events,
        [eventKey]: {
          ...prev.events[eventKey],
          [channel]: value,
        },
      },
    }));
  };

  // --- Handlers: Alarms ---
  const handleSaveAlarms = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlarmMsg(null);
    setSavingAlarms(true);
    try {
      const nextAlarmChannels = [
        ...(notificationSettings.events.due.email ? ['email'] : []),
        ...(notificationSettings.events.due.discord ? ['discord'] : []),
        ...(notificationSettings.events.due.webhook ? ['webhook'] : []),
      ];
      const updated = await api.updateSettings({
        alarmChannels: nextAlarmChannels,
        alarmEmail: alarmEmail.trim(),
        discordWebhookUrl: discordWebhookUrl.trim(),
        customWebhookUrl: customWebhookUrl.trim(),
        notifyBeforeMinutes: Number(notifyBeforeMinutes),
        notificationSettings,
      });
      onUserUpdated({
        ...updated,
        notificationSettings: updated.notificationSettings ?? notificationSettings,
      });
      setAlarmMsg({ type: 'ok', text: 'Alarm-Kanäle und Vorwarnzeit erfolgreich gespeichert.' });
    } catch (err: any) {
      setAlarmMsg({ type: 'err', text: err.message || 'Fehler beim Speichern der Alarme' });
    } finally {
      setSavingAlarms(false);
    }
  };

  const handleTestChannel = async (channel: 'email' | 'discord' | 'webhook') => {
    setAlarmMsg(null);
    let target = '';
    if (channel === 'email') {
      target = (alarmEmail || currentUser.email || '').trim();
      if (!target) {
        setAlarmMsg({ type: 'err', text: 'Bitte gib zuerst eine Empfänger-E-Mail-Adresse an.' });
        return;
      }
    } else if (channel === 'discord') {
      target = discordWebhookUrl.trim();
      if (!target) {
        setAlarmMsg({ type: 'err', text: 'Bitte gib zuerst eine Discord Webhook URL ein.' });
        return;
      }
    } else if (channel === 'webhook') {
      target = customWebhookUrl.trim();
      if (!target) {
        setAlarmMsg({ type: 'err', text: 'Bitte gib zuerst eine eigene Webhook URL ein.' });
        return;
      }
    }

    setTestingChannel(channel);
    try {
      await api.testAlarmChannel(channel, target);
      const label =
        channel === 'email' ? 'E-Mail' : channel === 'discord' ? 'Discord' : 'Eigener Webhook';
      setAlarmMsg({
        type: 'ok',
        text: `Test-Alarm über "${label}" wurde erfolgreich vom Server versendet!`,
      });
    } catch (err: any) {
      setAlarmMsg({
        type: 'err',
        text: `Test fehlgeschlagen: ${err.message || 'Unbekannter Fehler'}`,
      });
    } finally {
      setTestingChannel(null);
    }
  };

  return {
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
    handleTestChannel,
  };
}
