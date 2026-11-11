import React, { useCallback, useEffect, useState } from 'react';
import i18n from '../../../i18n';
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
      assigned: {
        email: s?.events?.assigned?.email ?? true,
        discord: s?.events?.assigned?.discord ?? false,
        webhook: s?.events?.assigned?.webhook ?? false,
        push: s?.events?.assigned?.push ?? false,
      },
      mentioned: {
        email: s?.events?.mentioned?.email ?? true,
        discord: s?.events?.mentioned?.discord ?? false,
        webhook: s?.events?.mentioned?.webhook ?? false,
        push: s?.events?.mentioned?.push ?? false,
      },
      taskCreated: {
        email: s?.events?.taskCreated?.email ?? false,
        discord: s?.events?.taskCreated?.discord ?? false,
        webhook: s?.events?.taskCreated?.webhook ?? false,
        push: s?.events?.taskCreated?.push ?? false,
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
      setPushMsg({ type: 'err', text: err instanceof Error ? err.message : i18n.t('settings:alarms.push.removeFailed') });
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
      setPushMsg({ type: 'ok', text: on ? i18n.t('settings:alarms.push.on') : i18n.t('settings:alarms.push.off') });
    } catch (err) {
      setPushMsg({ type: 'err', text: err instanceof Error ? err.message : i18n.t('settings:alarms.push.enableFailed') });
    } finally {
      setPushBusy(false);
    }
  };
  const sendTestPush = async () => {
    setPushBusy(true);
    setPushMsg(null);
    try {
      const res = await api.testPush();
      setPushMsg({ type: 'ok', text: i18n.t('settings:alarms.push.testSent', { count: res.devices }) });
    } catch (err) {
      setPushMsg({ type: 'err', text: err instanceof Error ? err.message : i18n.t('settings:alarms.push.testFailed') });
    } finally {
      setPushBusy(false);
    }
  };


  // The form follows the account when it changes (saved here or on another device)
  useEffect(() => {
    setNotificationSettings(buildNotificationSettings(currentUser));
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
        discordWebhookUrl: discordWebhookUrl.trim(),
        customWebhookUrl: customWebhookUrl.trim(),
        notifyBeforeMinutes: Number(notifyBeforeMinutes),
        notificationSettings,
      });
      onUserUpdated({
        ...updated,
        notificationSettings: updated.notificationSettings ?? notificationSettings,
      });
      setAlarmMsg({ type: 'ok', text: i18n.t('settings:alarms.saved') });
    } catch (err: any) {
      setAlarmMsg({ type: 'err', text: err.message || i18n.t('settings:alarms.saveFailed') });
    } finally {
      setSavingAlarms(false);
    }
  };

  const handleTestChannel = async (channel: 'email' | 'discord' | 'webhook') => {
    setAlarmMsg(null);
    let target = '';
    // E-mail goes to the login address, the server takes no target for it
    if (channel === 'discord') {
      target = discordWebhookUrl.trim();
      if (!target) {
        setAlarmMsg({ type: 'err', text: i18n.t('settings:alarms.needDiscordUrl') });
        return;
      }
    } else if (channel === 'webhook') {
      target = customWebhookUrl.trim();
      if (!target) {
        setAlarmMsg({ type: 'err', text: i18n.t('settings:alarms.needWebhookUrl') });
        return;
      }
    }

    setTestingChannel(channel);
    try {
      await api.testAlarmChannel(channel, target);
      const label =
        channel === 'email'
          ? i18n.t('settings:alarms.channel.email')
          : channel === 'discord'
            ? 'Discord'
            : i18n.t('settings:alarms.channel.ownWebhook');
      setAlarmMsg({
        type: 'ok',
        text: i18n.t('settings:alarms.testSent', { label }),
      });
    } catch (err: any) {
      setAlarmMsg({
        type: 'err',
        text: i18n.t('settings:alarms.testFailedWith', { message: err.message || i18n.t('common:errors.unknown') }),
      });
    } finally {
      setTestingChannel(null);
    }
  };

  return {
    onUserUpdated,
    notificationSettings,
    setNotificationSettings,
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
