import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertCircle, Check, Trash2, Upload } from 'lucide-react';
import { UserAvatar } from '../../../components/UserAvatar';
import { FormSheet } from '../../../components/FormSheet';
import { useProfileSettings } from './useProfileSettings';
import { PendingEmailNote } from './PendingEmailNote';
import { getCurrentOidc } from '../../../lib/api';

// Kontoeinstellungen → Profil (state in useProfileSettings); password, two-factor sign-in and sessions
// are in Sicherheit (SecuritySection)
export function ProfileSection({
  profile,
  demoMode,
  onOpenSecurity,
}: {
  profile: ReturnType<typeof useProfileSettings>;
  demoMode: boolean;
  onOpenSecurity: () => void;
}) {
  const { t } = useTranslation('settings');
  const {
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
    handleSelectPresetAvatar,
    handleRemoveAvatar,
    needsCurrentPassword,
    profileDirty,
    handleSaveProfile,
    dangerDone,
    isLastAdmin,
    openDanger,
    setDisplayName,
    setUsername,
    setEmail,
    setCurrentPassword,
  } = profile;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">{t('profile.title')}</h2>
        <p className="text-muted mt-0.5">
          {t('profile.intro')}
        </p>
      </div>

      {profileMsg && (
        <div
          className={`flex items-center gap-2 ${
            profileMsg.type === 'ok' ? 'alert-ok' : 'alert-err'
          }`}
        >
          {profileMsg.type === 'ok' ? (
            <Check className="w-4 h-4 text-status-ok flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
          )}
          <span>{profileMsg.text}</span>
        </div>
      )}

      <form onSubmit={handleSaveProfile} className="space-y-5">
        {/* Avatar Management */}
        <div className="p-3.5 bg-panel-elevated/40 border border-border rounded-box space-y-3">
          <label className="block text-muted font-medium">{t('profile.avatar')}</label>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <div className="relative group shrink-0">
              <UserAvatar
                user={{ displayName, email, avatarUrl }}
                size="xl"
                className="border-2 border-border/80 shadow-md ring-2 ring-primary/20"
              />
              {isProcessingAvatar && (
                <div className="absolute inset-0 bg-base-100/70 rounded-full flex items-center justify-center text-[10px] font-medium text-main">
                  {t('profile.loading')}
                </div>
              )}
            </div>

            <div className="flex-1 space-y-2.5 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileSelected}
                  className="hidden"
                  id="avatar-upload-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessingAvatar}
                  className="btn-action h-8 px-3 text-xs flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{t('profile.upload')}</span>
                </button>

                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="btn-ghost h-8 px-2.5 text-xs text-status-err hover:bg-status-err/10 flex items-center gap-1"
                    title={t('profile.removeAvatar')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('profile.remove')}</span>
                  </button>
                )}
              </div>

              {/* Emoji Presets */}
              <div className="space-y-1">
                <span className="text-[11px] text-muted">{t('profile.emoji')}</span>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 pt-0.5">
                  {['🦊', '🐱', '🐶', '🐼', '🦁', '🦉', '🚀', '☕', '⚡', '🎨', '🌟', '🎯', '💡'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSelectPresetAvatar(preset)}
                        className={`w-7 h-7 rounded-full text-sm flex items-center justify-center transition-transform hover:scale-110 active:scale-95 ${
                          avatarUrl === preset
                            ? 'bg-primary/20 border-2 border-primary scale-105'
                            : 'bg-panel hover:bg-panel-hover border border-border'
                        }`}
                        title={`Emoji ${preset}`}
                      >
                        {preset}
                      </button>
                    )
                  )}
                </div>
              </div>

              <p className="text-[10px] text-faint">
                {t('profile.avatarHint')}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-muted font-medium mb-1">{t('profile.displayName')}</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full h-9 px-3 input-field"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">{t('profile.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              required
              minLength={2}
              maxLength={32}
              pattern="[a-z0-9][a-z0-9._\-]*[a-z0-9]"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={demoMode}
              title={demoMode ? t('profile.demoDisabled') : t('profile.usernameRules')}
              className="w-full h-9 px-3 input-field font-mono disabled:opacity-60"
            />
            <p className="mt-1 text-[10px] text-faint">{t('profile.usernameHint')}</p>
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              {t('settings:profile.emailLogin')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              // An admin from ADMIN_USER without ADMIN_EMAIL has no address yet and may save the rest
              required={Boolean(currentUser.email)}
              disabled={demoMode}
              title={demoMode ? t('profile.demoDisabled') : undefined}
              className="w-full h-9 px-3 input-field disabled:opacity-60"
            />
            {!currentUser.email && !currentUser.pendingEmail && (
              <p className="mt-1 text-[10px] text-faint">{t('settings:profile.noEmail')}</p>
            )}
            <PendingEmailNote user={currentUser} onUserUpdated={onUserUpdated} />
          </div>
        </div>

        {needsCurrentPassword && (
          <div>
            <label className="block text-muted font-medium mb-1">
              {t('profile.currentPassword')}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full h-9 px-3 input-field"
            />
          </div>
        )}

        {/* With unsaved input the bar floats above the bottom navigation on phones, where it is
            otherwise far below (same height as the toasts) */}
        <div
          className={`pt-2 border-t border-border flex items-center justify-end gap-3 ${
            profileDirty
              ? 'max-sm:sticky max-sm:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] max-sm:z-10 max-sm:p-2 max-sm:pl-3 max-sm:border max-sm:rounded-card max-sm:bg-panel-elevated max-sm:shadow-panel'
              : ''
          }`}
        >
          {profileDirty && <span className="text-[11px] text-muted mr-auto">{t('profile.unsaved')}</span>}
          <button
            type="submit"
            disabled={savingProfile}
            className="btn-primary h-11 sm:h-9 px-5 text-xs font-semibold"
          >
            {savingProfile ? t('saving') : t('profile.save')}
          </button>
        </div>
      </form>

      {/* Password, two-factor sign-in and sessions: Sicherheit (SecuritySection) */}
      <p className="text-[11px] text-muted">
        <Trans
          t={t}
          i18nKey="profile.securityMoved"
          components={{ link: <button type="button" onClick={onOpenSecurity} className="text-accent hover:underline" /> }}
        />
      </p>

      {/* Danger zone: delete own data or the whole account (password required) */}
      <div className="p-4 border border-status-err/40 bg-status-err/5 rounded-card space-y-3">
        <h3 className="font-bold text-status-err flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4" />
          <span>{t('profile.danger')}</span>
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-main font-medium">{t('profile.deleteData')}</p>
            <p className="text-[11px] text-muted">
              {t('profile.deleteDataHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openDanger('data')}
            disabled={demoMode}
            title={demoMode ? t('profile.demoDisabled') : undefined}
            className="btn-danger h-11 sm:h-8 px-3 text-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('profile.deleteDataButton')}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-status-err/20">
          <div>
            <p className="text-main font-medium">{t('profile.deleteAccount')}</p>
            <p className="text-[11px] text-muted">
              {isLastAdmin
                ? t('profile.lastAdmin')
                : t('profile.deleteAccountHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openDanger('account')}
            disabled={isLastAdmin || demoMode}
            title={demoMode ? t('profile.demoDisabled') : undefined}
            className="btn-danger h-11 sm:h-8 px-3 text-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('profile.deleteAccountButton')}
          </button>
        </div>
        {dangerDone && <p className="text-[11px] text-status-ok">{dangerDone}</p>}
      </div>
    </div>
  );
}

// Asks for the password before own data or the whole account is deleted
export function DangerConfirmSheet({ profile }: { profile: ReturnType<typeof useProfileSettings> }) {
  const { t } = useTranslation('settings');
  const {
    dangerAction,
    dangerPassword,
    dangerError,
    dangerBusy,
    handleDangerSubmit,
    setDangerAction,
    setDangerPassword,
  } = profile;
  return (
    <FormSheet
      title={dangerAction === 'account' ? t('profile.deleteAccount') : t('profile.deleteData')}
      icon={<AlertCircle className="w-4 h-4 text-status-err" />}
      onClose={() => setDangerAction(null)}
      onSubmit={handleDangerSubmit}
      submitLabel={dangerAction === 'account' ? t('profile.deleteAccountButton') : t('profile.deleteDataButton')}
      danger
      busy={dangerBusy || (!profile.currentUser.noPassword && !dangerPassword)}
    >
      <p className="text-xs text-muted">
        {dangerAction === 'account'
          ? t('profile.confirmAccount')
          : t('profile.confirmData')}
      </p>
      {/* An account of the OIDC provider without a password confirms there (withSecondFactor) */}
      {profile.currentUser.noPassword ? (
        <p className="text-xs text-muted">{t('security.oidc.confirmHint', { name: getCurrentOidc().name })}</p>
      ) : (
        <label className="block text-xs text-muted">
          {t('profile.confirmPassword')}
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={dangerPassword}
            onChange={(e) => setDangerPassword(e.target.value)}
            className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
          />
        </label>
      )}
      {dangerError && <p className="text-[11px] text-status-err">{dangerError}</p>}
    </FormSheet>
  );
}
