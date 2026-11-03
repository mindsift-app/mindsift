import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  Users,
  Server,
  Mail,
  Check,
  ArrowLeft,
  AlertCircle,
  Building2,
} from 'lucide-react';
import {
  User,
} from '../../lib/types';
import { useAdminSettings } from './admin/useAdminSettings';
import { UsersSection } from './admin/UsersSection';
import { OrganizationsSection } from './admin/OrganizationsSection';
import { ServerSection } from './admin/ServerSection';
import { SmtpSection } from './admin/SmtpSection';

interface AdminSettingsViewProps {
  currentUser: User;
  onBack: () => void;
}

type AdminSection = 'users' | 'organizations' | 'server' | 'smtp';

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  currentUser,
  onBack,
}) => {
  const { t } = useTranslation('settings');
  const isServerAdmin = currentUser.role === 'admin';
  const [section, setSection] = useState<AdminSection>('users');

  // Users, invites, organizations, server and mail settings (admin/useAdminSettings.ts)
  const admin = useAdminSettings(currentUser, isServerAdmin);
  const { statusMsg, setStatusMsg, demoMode } = admin;

  return (
    <div className="w-full space-y-4">
      {/* Top Page Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn-action h-8 px-2.5 text-xs flex items-center gap-1.5"
            title={t('user.backTitle')}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('user.back')}</span>
          </button>
          <div>
            <h1 className="text-base font-bold text-main tracking-tight flex items-center gap-2">
              <Shield className="w-4 h-4 text-accent" />
              <span>{t('admin.title')}</span>
            </h1>
            <p className="text-xs text-muted">
              {t('admin.subtitle')}
            </p>
          </div>
        </div>

        <span className="badge-accent">{t('admin.badge')}</span>
      </div>

      {statusMsg && (
        <div
          className={`p-3 text-xs flex items-center justify-between gap-2 rounded-card ${
            statusMsg.type === 'ok' ? 'alert-ok' : 'alert-err'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMsg.type === 'ok' ? (
              <Check className="w-4 h-4 text-accent flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
          <button
            onClick={() => setStatusMsg(null)}
            className="text-muted hover:text-main text-[11px]"
          >
            {t('admin.close')}
          </button>
        </div>
      )}

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        {/* Left Navigation Sidebar */}
        <aside className="panel-surface divide-y divide-border overflow-hidden">
          <button
            onClick={() => setSection('users')}
            className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
              section === 'users'
                ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                : 'text-muted hover:text-main hover:bg-canvas/50'
            }`}
          >
            <Users className="w-4 h-4 text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold">{t('admin.nav.users')}</p>
              <p className="text-[10px] text-faint">{t('admin.nav.usersHint')}</p>
            </div>
          </button>

          {isServerAdmin && (
            <>
              <button
                onClick={() => setSection('organizations')}
                className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  section === 'organizations'
                    ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                    : 'text-muted hover:text-main hover:bg-canvas/50'
                }`}
              >
                <Building2 className="w-4 h-4 text-accent flex-shrink-0" />
                <div>
                  <p className="font-semibold">{t('orgs.title')}</p>
                  <p className="text-[10px] text-faint">{t('admin.nav.orgsHint')}</p>
                </div>
              </button>

              <button
                onClick={() => setSection('server')}
                className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  section === 'server'
                    ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                    : 'text-muted hover:text-main hover:bg-canvas/50'
                }`}
              >
                <Server className="w-4 h-4 text-accent flex-shrink-0" />
                <div>
                  <p className="font-semibold">{t('admin.nav.server')}</p>
                  <p className="text-[10px] text-faint">{t('admin.nav.serverHint')}</p>
                </div>
              </button>

              <button
                onClick={() => setSection('smtp')}
                className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  section === 'smtp'
                    ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                    : 'text-muted hover:text-main hover:bg-canvas/50'
                }`}
              >
                <Mail className="w-4 h-4 text-accent flex-shrink-0" />
                <div>
                  <p className="font-semibold">{t('admin.nav.smtp')}</p>
                  <p className="text-[10px] text-faint">{t('admin.nav.smtpHint')}</p>
                </div>
              </button>
            </>
          )}
        </aside>

        {/* Right Content Area */}
        <div className="md:col-span-3 panel-surface p-5 text-xs">
          {demoMode && (
            <div className="flex items-center gap-2 alert-err mb-4">
              <AlertCircle className="w-4 h-4 text-status-err flex-shrink-0" />
              <span>
                {t('admin.demo')}
              </span>
            </div>
          )}
          {/* ================================================================= */}
          {/* SECTION 1: BENUTZER, ROLLEN & EINLADUNGEN */}
          {/* ================================================================= */}
          {section === 'users' && <UsersSection admin={admin} currentUser={currentUser} isServerAdmin={isServerAdmin} />}

          {/* ================================================================= */}
          {/* SECTION 2: ORGANISATIONEN (SERVER-ADMIN ONLY) */}
          {/* ================================================================= */}
          {section === 'organizations' && isServerAdmin && <OrganizationsSection admin={admin} />}

          {/* ================================================================= */}
          {/* SECTION 3: SERVER & SHARING-ISOLATION (SERVER-ADMIN ONLY) */}
          {/* ================================================================= */}
          {section === 'server' && isServerAdmin && <ServerSection admin={admin} />}

          {/* ================================================================= */}
          {/* SECTION 4: E-MAIL / SMTP-SERVER (SERVER-ADMIN ONLY) */}
          {/* ================================================================= */}
          {section === 'smtp' && isServerAdmin && <SmtpSection admin={admin} />}
        </div>
      </div>
    </div>
  );
};
