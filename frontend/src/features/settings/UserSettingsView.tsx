import React, { useEffect, useState } from 'react';
import {
  User as UserIcon,
  Bell,
  Key,
  ArrowLeft,
  Palette,
  Archive,
  Mic,
  Clock,
} from 'lucide-react';
import { AuthStatus, User, UserTheme } from '../../lib/types';
import { ApiKeysPanel } from './ApiKeysPanel';
import { api } from '../../lib/api';
import { loadVoiceConfig, voiceChoiceAvailable } from '../../lib/voice';
import {
  ThemeId,
  ThemeOption,
} from '../../lib/theme';
import { LegalLinks } from '../../components/LegalLinks';
import { AboutModal } from '../../components/AboutModal';
import { useAlarmSettings } from './user/useAlarmSettings';
import { AlarmsSection } from './user/AlarmsSection';
import { useAppearanceSettings } from './user/useAppearanceSettings';
import { AppearanceSection } from './user/AppearanceSection';
import { useProfileSettings } from './user/useProfileSettings';
import { DangerConfirmSheet, ProfileSection } from './user/ProfileSection';
import { RetentionSection, useRetentionSettings } from './user/RetentionSection';
import { useVoiceSetting, VoiceSection } from './user/VoiceSection';
import { DataSection, useDataExport } from './user/DataSection';

interface UserSettingsViewProps {
  currentUser: User;
  activeTheme: ThemeId;
  themes: ThemeOption[]; // built-in + custom
  customThemes: UserTheme[];
  onThemeChange: (themeId: ThemeId) => void;
  onCustomThemesChange: (themes: UserTheme[], activate?: ThemeId) => void;
  onUserUpdated: (u: User) => void;
  onBack: () => void;
}

type UserSettingsSection = 'profile' | 'appearance' | 'alarms' | 'voice' | 'retention' | 'webhooks' | 'data';

export const UserSettingsView: React.FC<UserSettingsViewProps> = ({
  currentUser,
  activeTheme,
  themes,
  customThemes,
  onThemeChange,
  onCustomThemesChange,
  onUserUpdated,
  onBack }) => {
  const [section, setSection] = useState<UserSettingsSection>('profile');
  // Voice input: the choice Whisper/browser only exists with a Whisper server that allows the browser
  const [voiceChoice, setVoiceChoice] = useState(false);
  useEffect(() => {
    void loadVoiceConfig().then(() => setVoiceChoice(voiceChoiceAvailable()));
  }, []);
  // Aufbewahrung, Spracheingabe, Export (user/RetentionSection.tsx, VoiceSection.tsx, DataSection.tsx)
  const retention = useRetentionSettings(currentUser, onUserUpdated);
  const voice = useVoiceSetting(onUserUpdated);
  const dataExport = useDataExport();

  const [legal, setLegal] = useState<AuthStatus['legal']>();

  // Profil & Sicherheit with the danger zone (user/useProfileSettings.ts)
  const profile = useProfileSettings(currentUser, onUserUpdated);
  const { dangerAction } = profile;
  const [showAbout, setShowAbout] = useState(false);
  // The public demo sends nothing and keeps the shared accounts intact (FLAW-33)
  const [demoMode, setDemoMode] = useState(false);
  // Darstellung & Themes (user/useAppearanceSettings.ts)
  const appearance = useAppearanceSettings(activeTheme, customThemes, onCustomThemesChange);
  useEffect(() => {
    api
      .getAuthStatus()
      .then((st) => {
        setLegal(st.legal);
        setDemoMode(Boolean(st.demoMode));
      })
      .catch(() => {});
  }, []);

  // --- Multi-Channel Alarms State (user/useAlarmSettings.ts) ---
  const alarms = useAlarmSettings(currentUser, onUserUpdated);


  const roleBadgeLabel =
    currentUser.role === 'admin'
      ? 'Server-Admin'
      : 'Mitglied';

  return (
    <div className="w-full space-y-4">
      {/* Top Page Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn-action h-8 px-2.5 text-xs flex items-center gap-1.5"
            title="Zurück zur Übersicht"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Zurück</span>
          </button>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight">Kontoeinstellungen</h1>
            <p className="text-xs text-muted">
              Persönliches Profil, Design-Themes, Aufgaben-Alarme, API, Export & Import
            </p>
          </div>
        </div>

        <span className="px-2.5 py-1 bg-panel border border-border text-xs text-muted font-medium">
          Rolle: <strong className="text-accent">{roleBadgeLabel}</strong>
        </span>
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        {/* Left Navigation Sidebar */}
        <aside className="panel-surface divide-y divide-border overflow-hidden">
          <button
            onClick={() => setSection('profile')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'profile'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-panel-hover'
            }`}
          >
            <UserIcon className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">Profil & Sicherheit</p>
              <p className="text-[10px] text-faint">Name, E-Mail & Passwort</p>
            </div>
          </button>

          <button
            onClick={() => setSection('appearance')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'appearance'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-panel-hover'
            }`}
          >
            <Palette className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">Darstellung & Themes</p>
              <p className="text-[10px] text-faint">Farben, Kontraste & Rundungen</p>
            </div>
          </button>

          <button
            onClick={() => setSection('alarms')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'alarms'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-panel-hover'
            }`}
          >
            <Bell className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">Alarme</p>
              <p className="text-[10px] text-faint">E-Mail, Discord & Webhooks</p>
            </div>
          </button>

          {voiceChoice && (
            <button
              onClick={() => setSection('voice')}
              className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
                section === 'voice'
                  ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                  : 'text-muted hover:text-main hover:bg-panel-hover'
              }`}
            >
              <Mic className="w-4 h-4 text-accent flex-shrink-0" />
              <div>
                <p className="font-semibold">Spracheingabe</p>
                <p className="text-[10px] text-faint">Whisper-Server oder Browser</p>
              </div>
            </button>
          )}

          <button
            onClick={() => setSection('retention')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'retention'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-panel-hover'
            }`}
          >
            <Clock className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">Aufbewahrung</p>
              <p className="text-[10px] text-faint">Erledigtes & Papierkörbe aufräumen</p>
            </div>
          </button>

          <button
            onClick={() => setSection('webhooks')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'webhooks'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-panel-hover'
            }`}
          >
            <Key className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">API</p>
              <p className="text-[10px] text-faint">Schlüssel, curl, Smart Home & KI-Agenten</p>
            </div>
          </button>

          <button
            onClick={() => setSection('data')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'data'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-panel-hover'
            }`}
          >
            <Archive className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">Export & Import</p>
              <p className="text-[10px] text-faint">Backups, Obsidian & Wiederherstellen</p>
            </div>
          </button>
        </aside>

        {/* Right Content Area */}
        <div className="md:col-span-3 panel-surface p-5 text-xs">
          {/* ================================================================= */}
          {/* SECTION 1: PROFIL & SICHERHEIT */}
          {/* ================================================================= */}
          {section === 'profile' && <ProfileSection profile={profile} demoMode={demoMode} />}

          {/* ================================================================= */}
          {/* SECTION 2: DARSTELLUNG & THEMES (SINGLE-FILE CSS THEMING) */}
          {/* ================================================================= */}
          {section === 'appearance' && (
            <AppearanceSection
              appearance={appearance}
              activeTheme={activeTheme}
              themes={themes}
              customThemes={customThemes}
              onThemeChange={onThemeChange}
            />
          )}

          {/* ================================================================= */}
          {/* SECTION 3: ALARME (MULTI-CHANNEL: EMAIL, DISCORD, CUSTOM WEBHOOK) */}
          {/* ================================================================= */}
          {section === 'alarms' && <AlarmsSection alarms={alarms} currentUser={currentUser} demoMode={demoMode} />}

          {/* ================================================================= */}
          {/* SECTION 4: API (KEYS, CURL / SMART HOME, AI AGENTS) */}
          {/* ================================================================= */}
          {section === 'webhooks' && (
            <div className="space-y-5">
              <div className="border-b border-border pb-3">
                <h2 className="text-sm font-bold text-main">API</h2>
                <p className="text-muted mt-0.5">
                  Mit persönlichen API-Schlüsseln lesen und ändern Skripte, dein Smart Home oder KI-Agenten wie Claude Code
                  und Codex deine Aufgaben, Listen, Notizen und die Inbox: per curl oder über MCP, mit denselben Rechten.
                  Notizen sowie Lesen und Sortieren der Inbox gehen nur über MCP.
                </p>
              </div>

              <ApiKeysPanel />
            </div>
          )}

          {/* ================================================================= */}
          {/* SECTION: SPRACHEINGABE */}
          {/* ================================================================= */}
          {section === 'voice' && voiceChoice && <VoiceSection voice={voice} currentUser={currentUser} />}

          {/* ================================================================= */}
          {/* SECTION: AUFBEWAHRUNG */}
          {/* ================================================================= */}
          {section === 'retention' && <RetentionSection retention={retention} currentUser={currentUser} />}

          {/* ================================================================= */}
          {/* SECTION 5: EXPORT & IMPORT */}
          {/* ================================================================= */}
          {section === 'data' && <DataSection dataExport={dataExport} />}
        </div>
      </div>

      {/* Footer: legal notices of this instance and project info */}
      <LegalLinks legal={legal} className="pt-4 border-t border-border">
        <button type="button" onClick={() => setShowAbout(true)} className="hover:text-main underline-offset-2 hover:underline">
          Über MindSift
        </button>
      </LegalLinks>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {dangerAction && <DangerConfirmSheet profile={profile} />}
    </div>
  );
};
