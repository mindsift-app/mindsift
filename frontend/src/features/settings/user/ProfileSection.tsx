import React from 'react';
import { AlertCircle, Check, Trash2, Upload } from 'lucide-react';
import { UserAvatar } from '../../../components/UserAvatar';
import { FormSheet } from '../../../components/FormSheet';
import { SessionsPanel } from '../SessionsPanel';
import { useProfileSettings } from './useProfileSettings';

// Kontoeinstellungen → Profil & Sicherheit (state in useProfileSettings)
export function ProfileSection({
  profile,
  demoMode,
}: {
  profile: ReturnType<typeof useProfileSettings>;
  demoMode: boolean;
}) {
  const {
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
    dangerDone,
    isLastAdmin,
    openDanger,
    setDisplayName,
    setEmail,
    setNewPassword,
    setCurrentPassword,
  } = profile;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">Profil & Anmeldedaten</h2>
        <p className="text-muted mt-0.5">
          Verwalte deinen Anzeigenamen, deine E-Mail-Adresse und dein persönliches Passwort.
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
          <label className="block text-muted font-medium">Profilbild</label>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <div className="relative group shrink-0">
              <UserAvatar
                user={{ displayName, email, avatarUrl }}
                size="xl"
                className="border-2 border-border/80 shadow-md ring-2 ring-primary/20"
              />
              {isProcessingAvatar && (
                <div className="absolute inset-0 bg-base-100/70 rounded-full flex items-center justify-center text-[10px] font-medium text-main">
                  Lädt…
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
                  <span>Bild hochladen</span>
                </button>

                {avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="btn-ghost h-8 px-2.5 text-xs text-status-err hover:bg-status-err/10 flex items-center gap-1"
                    title="Profilbild entfernen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Entfernen</span>
                  </button>
                )}
              </div>

              {/* Emoji Presets */}
              <div className="space-y-1">
                <span className="text-[11px] text-muted">Oder schnelles Emoji wählen:</span>
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
                Wird überall kreisförmig dargestellt (z.&nbsp;B. Menüleiste oben, Freigabelisten, Aufgaben).
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-muted font-medium mb-1">Anzeigename</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              className="w-full h-9 px-3 input-field"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              E-Mail-Adresse (Login)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={demoMode}
              title={demoMode ? 'In der Demo deaktiviert' : undefined}
              className="w-full h-9 px-3 input-field disabled:opacity-60"
            />
          </div>
        </div>

        <div>
          <label className="block text-muted font-medium mb-1">
            Neues Passwort (optional — leer lassen für keine Änderung)
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={demoMode ? 'In der Demo deaktiviert' : 'Mindestens 8 Zeichen'}
            autoComplete="new-password"
            disabled={demoMode}
            className="w-full h-9 px-3 input-field disabled:opacity-60"
          />
        </div>

        {needsCurrentPassword && (
          <div>
            <label className="block text-muted font-medium mb-1">
              Aktuelles Passwort (zur Bestätigung)
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

        <div className="pt-2 border-t border-border flex justify-end">
          <button
            type="submit"
            disabled={savingProfile}
            className="btn-primary h-9 px-5 text-xs font-semibold"
          >
            {savingProfile ? 'Speichere…' : 'Profil speichern'}
          </button>
        </div>
      </form>

      {/* Sessions & Security */}
      <div className="pt-5 border-t border-border space-y-3">
        <div>
          <h3 className="text-xs font-bold text-main">Aktive Sitzungen & Sicherheit</h3>
          <p className="text-[11px] text-muted">
            Geräte, auf denen du angemeldet bist. Unbenutzte Sitzungen enden nach 30 Tagen; eine Passwortänderung meldet alle anderen Geräte ab.
          </p>
        </div>
        <SessionsPanel />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-card border border-border bg-canvas">
          <div className="text-xs">
            <p className="font-semibold text-main">Alle Sitzungen sofort beenden</p>
            <p className="text-[11px] text-faint">
              Invalidiert alle ausgestellten Tokens auf allen Geräten und Browsern.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRevokeAllSessions}
            disabled={demoMode || revokingSessions}
            title={demoMode ? 'In der Demo deaktiviert' : undefined}
            className="btn-danger h-8 px-3 text-xs shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {revokingSessions ? 'Beende…' : 'Alle Sitzungen beenden'}
          </button>
        </div>
      </div>

      {/* Danger zone: delete own data or the whole account (password required) */}
      <div className="p-4 border border-status-err/40 bg-status-err/5 rounded-card space-y-3">
        <h3 className="font-bold text-status-err flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4" />
          <span>Gefahrenzone</span>
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-main font-medium">Alle eigenen Daten löschen</p>
            <p className="text-[11px] text-muted">
              Löscht deine Notizen, Ordner, Aufgaben, Gedanken und Listen. Konto, Passwort und Einstellungen bleiben.
              Mit dir geteilte Inhalte anderer bleiben erhalten.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openDanger('data')}
            className="btn-danger h-11 sm:h-8 px-3 text-xs shrink-0"
          >
            Daten löschen
          </button>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-status-err/20">
          <div>
            <p className="text-main font-medium">Konto unwiderruflich löschen</p>
            <p className="text-[11px] text-muted">
              {isLastAdmin
                ? 'Der letzte Server-Administrator kann nicht gelöscht werden. Bitte ernenne vorher ein anderes Konto zum Administrator.'
                : 'Löscht dein Konto mit allen Daten. Du wirst danach abgemeldet.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openDanger('account')}
            disabled={isLastAdmin || demoMode}
            title={demoMode ? 'In der Demo deaktiviert' : undefined}
            className="btn-danger h-11 sm:h-8 px-3 text-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Konto löschen
          </button>
        </div>
        {dangerDone && <p className="text-[11px] text-status-ok">{dangerDone}</p>}
      </div>
    </div>
  );
}

// Asks for the password before own data or the whole account is deleted
export function DangerConfirmSheet({ profile }: { profile: ReturnType<typeof useProfileSettings> }) {
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
      title={dangerAction === 'account' ? 'Konto unwiderruflich löschen' : 'Alle eigenen Daten löschen'}
      icon={<AlertCircle className="w-4 h-4 text-status-err" />}
      onClose={() => setDangerAction(null)}
      onSubmit={handleDangerSubmit}
      submitLabel={dangerAction === 'account' ? 'Konto löschen' : 'Daten löschen'}
      danger
      busy={dangerBusy || !dangerPassword}
    >
      <p className="text-xs text-muted">
        {dangerAction === 'account'
          ? 'Dein Konto und alle deine Daten werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.'
          : 'Alle deine Notizen, Ordner, Aufgaben, Gedanken und Listen werden endgültig gelöscht. Lade vorher ein Backup herunter, wenn du sie behalten willst.'}
      </p>
      <label className="block text-xs text-muted">
        Zur Bestätigung dein Passwort
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={dangerPassword}
          onChange={(e) => setDangerPassword(e.target.value)}
          className="mt-1 input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs"
        />
      </label>
      {dangerError && <p className="text-[11px] text-status-err">{dangerError}</p>}
    </FormSheet>
  );
}
