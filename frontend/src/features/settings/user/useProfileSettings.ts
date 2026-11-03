import React, { useEffect, useRef, useState } from 'react';
import i18n from '../../../i18n';
import { User } from '../../../lib/types';
import { api, clearToken, triggerHaptic } from '../../../lib/api';
import { passwordProblem } from '../../../lib/password';
import { resizeImageToDataUrl } from '../../../components/UserAvatar';

// Kontoeinstellungen → Profil & Sicherheit: name, login address, password, avatar, ending all sessions,
// and the danger zone (delete own data or the account). Lives in the view, so unsaved input survives
// switching sections.
export function useProfileSettings(currentUser: User, onUserUpdated: (u: User) => void) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  // The form follows the account when it changes (saved here or on another device)
  useEffect(() => {
    setDisplayName(currentUser.displayName || '');
    setEmail(currentUser.email || '');
    setAvatarUrl(currentUser.avatarUrl || '');
  }, [currentUser]);


  // --- Handlers: Avatar ---
  const handleAvatarFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingAvatar(true);
    setProfileMsg(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 256);
      setAvatarUrl(dataUrl);
      triggerHaptic(10);
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.imageFailed') });
    } finally {
      setIsProcessingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectPresetAvatar = (preset: string) => {
    setAvatarUrl(preset);
    triggerHaptic(10);
  };

  const handleRemoveAvatar = () => {
    setAvatarUrl('');
    triggerHaptic(10);
  };

  // Changing the password or the login address needs the current password (FLAW-30)
  const needsCurrentPassword =
    newPassword.trim() !== '' || email.trim().toLowerCase() !== (currentUser.email || '').toLowerCase();

  // --- Handlers: Profile ---
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const patch: any = {
        displayName: displayName.trim(),
        email: email.trim(),
        avatarUrl: avatarUrl.trim() };
      if (newPassword.trim()) {
        const problem = passwordProblem(newPassword);
        if (problem) {
          setProfileMsg({ type: 'err', text: problem });
          return;
        }
        // Not trimmed: login compares the password exactly as typed
        patch.password = newPassword;
      }
      if (needsCurrentPassword) patch.currentPassword = currentPassword;
      const updated = await api.updateSettings(patch);
      onUserUpdated(updated);
      setNewPassword('');
      setCurrentPassword('');
      setProfileMsg({ type: 'ok', text: i18n.t('settings:profile.saved') });
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.saveFailed') });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!window.confirm(i18n.t('settings:profile.confirmRevokeAll'))) {
      return;
    }
    setRevokingSessions(true);
    try {
      await api.revokeAllSessions();
      await api.logout();
      window.location.reload();
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.revokeFailed') });
      setRevokingSessions(false);
    }
  };

  // --- Danger zone ---
  const [dangerAction, setDangerAction] = useState<'data' | 'account' | null>(null);
  const [dangerPassword, setDangerPassword] = useState('');
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerDone, setDangerDone] = useState<string | null>(null);
  const [isLastAdmin, setIsLastAdmin] = useState(false);
  useEffect(() => {
    api.getMe().then((me) => setIsLastAdmin(Boolean(me.isLastAdmin))).catch(() => {});
  }, []);
  const openDanger = (action: 'data' | 'account') => {
    setDangerAction(action);
    setDangerPassword('');
    setDangerError(null);
    setDangerDone(null);
  };
  const handleDangerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDangerBusy(true);
    setDangerError(null);
    try {
      if (dangerAction === 'account') {
        await api.deleteOwnAccount(dangerPassword);
        // The account is gone: drop the session and show the login screen
        clearToken();
        window.location.reload();
        return;
      }
      await api.purgeOwnData(dangerPassword);
      setDangerAction(null);
      setDangerDone(i18n.t('settings:profile.dataDeleted'));
      onUserUpdated(currentUser);
    } catch (err: any) {
      setDangerError(err.message || i18n.t('settings:profile.actionFailed'));
    } finally {
      setDangerBusy(false);
    }
  };

  return {
    displayName,
    email,
    avatarUrl,
    newPassword,
    currentPassword,
    profileMsg,
    savingProfile,
    revokingSessions,
    isProcessingAvatar,
    fileInputRef,
    handleAvatarFileSelected,
    handleSelectPresetAvatar,
    handleRemoveAvatar,
    needsCurrentPassword,
    handleSaveProfile,
    handleRevokeAllSessions,
    dangerAction,
    dangerPassword,
    dangerError,
    dangerBusy,
    dangerDone,
    isLastAdmin,
    openDanger,
    handleDangerSubmit,
    setDisplayName,
    setEmail,
    setNewPassword,
    setCurrentPassword,
    setDangerAction,
    setDangerPassword,
  };
}
