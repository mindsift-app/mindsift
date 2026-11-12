import React, { useEffect, useRef, useState } from 'react';
import i18n from '../../../i18n';
import { User } from '../../../lib/types';
import { api, clearToken, triggerHaptic } from '../../../lib/api';
import { AvatarPlacement, cropImageToDataUrl, loadImageFile } from '../../../lib/avatarCrop';
import { clearStoredNotes } from '../../../lib/docSync/persist';

// Kontoeinstellungen → Profil: name, username, login address, avatar, and the danger zone (delete own data
// or the account). Lives in the view, so unsaved input survives switching sections. Password, two-factor
// sign-in and sessions are in Sicherheit (SecuritySection).
export function useProfileSettings(currentUser: User, onUserUpdated: (u: User) => void) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || '');
  const [username, setUsername] = useState(currentUser.username || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  // A picked picture waiting to be placed in the frame (AvatarCropSheet)
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);


  // The form follows the account when it changes (saved here or on another device). Only fields whose
  // saved value changed are replaced, so saving the avatar keeps a name still being typed.
  const shownUserRef = useRef(currentUser);
  useEffect(() => {
    const prev = shownUserRef.current;
    shownUserRef.current = currentUser;
    if (prev === currentUser) return;
    if (prev.displayName !== currentUser.displayName) setDisplayName(currentUser.displayName || '');
    if (prev.username !== currentUser.username) setUsername(currentUser.username || '');
    if (prev.email !== currentUser.email) setEmail(currentUser.email || '');
    if (prev.avatarUrl !== currentUser.avatarUrl) setAvatarUrl(currentUser.avatarUrl || '');
  }, [currentUser]);

  // Name, username or address typed but not saved yet (the avatar saves on its own)
  const profileDirty =
    displayName.trim() !== (currentUser.displayName || '') ||
    username.trim().toLowerCase() !== (currentUser.username || '') ||
    email.trim().toLowerCase() !== (currentUser.email || '').toLowerCase();


  // --- Handlers: Avatar ---
  // The avatar is saved right away: the save button is far down on phones and easily missed
  const saveAvatar = async (value: string) => {
    const before = avatarUrl;
    setAvatarUrl(value);
    setProfileMsg(null);
    setIsProcessingAvatar(true);
    try {
      const updated = await api.updateSettings({ avatarUrl: value });
      onUserUpdated(updated);
      setProfileMsg({ type: 'ok', text: i18n.t(value ? 'settings:profile.avatarSaved' : 'settings:profile.avatarRemoved') });
    } catch (err: any) {
      setAvatarUrl(before);
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.saveFailed') });
    } finally {
      setIsProcessingAvatar(false);
    }
  };

  const handleAvatarFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileMsg(null);
    try {
      setCropImage(await loadImageFile(file));
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.imageFailed') });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleApplyCrop = (placement: AvatarPlacement) => {
    if (!cropImage) return;
    let dataUrl: string;
    try {
      dataUrl = cropImageToDataUrl(cropImage, placement, 256);
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.imageFailed') });
      setCropImage(null);
      return;
    }
    setCropImage(null);
    triggerHaptic(10);
    void saveAvatar(dataUrl);
  };

  const handleSelectPresetAvatar = (preset: string) => {
    triggerHaptic(10);
    void saveAvatar(preset);
  };

  const handleRemoveAvatar = () => {
    triggerHaptic(10);
    void saveAvatar('');
  };

  // Changing the login address needs the current password (FLAW-30)
  const needsCurrentPassword = email.trim().toLowerCase() !== (currentUser.email || '').toLowerCase();

  // --- Handlers: Profile ---
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      // The avatar is not part of it: it saves on its own (saveAvatar)
      const patch: any = {
        displayName: displayName.trim(),
        email: email.trim() };
      // Only when changed: the shared demo accounts refuse any change of their username
      const cleanUsername = username.trim().toLowerCase();
      if (cleanUsername !== (currentUser.username || '')) patch.username = cleanUsername;
      if (needsCurrentPassword) patch.currentPassword = currentPassword;
      const updated = await api.updateSettings(patch);
      onUserUpdated(updated);
      // A new address waits for its link (shown under the field), the field shows the one in use
      setEmail(updated.email || '');
      setCurrentPassword('');
      setProfileMsg({ type: 'ok', text: i18n.t('settings:profile.saved') });
    } catch (err: any) {
      setProfileMsg({ type: 'err', text: err.message || i18n.t('settings:profile.saveFailed') });
    } finally {
      setSavingProfile(false);
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
        // The account is gone: drop the session and its stored notes, show the login screen
        clearToken();
        await clearStoredNotes();
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
    currentUser,
    onUserUpdated,
    displayName,
    username,
    email,
    avatarUrl,
    currentPassword,
    profileMsg,
    savingProfile,
    isProcessingAvatar,
    fileInputRef,
    handleAvatarFileSelected,
    cropImage,
    setCropImage,
    handleApplyCrop,
    profileDirty,
    handleSelectPresetAvatar,
    handleRemoveAvatar,
    needsCurrentPassword,
    handleSaveProfile,
    dangerAction,
    dangerPassword,
    dangerError,
    dangerBusy,
    dangerDone,
    isLastAdmin,
    openDanger,
    handleDangerSubmit,
    setDisplayName,
    setUsername,
    setEmail,
    setCurrentPassword,
    setDangerAction,
    setDangerPassword,
  };
}
