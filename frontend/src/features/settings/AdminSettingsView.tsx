import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  Users,
  Server,
  Mail,
  ArrowLeft,
  CircleAlert,
  BuildingComplex,
  ScrollText,
  KeyRound,
  Share2,
  Database,
  Images,
  Mic,
  LucideIcon,
} from 'lucide-react';
import {
  User,
} from '../../lib/types';
import { StatusToast } from '../../components/StatusToast';
import { useAdminSettings } from './admin/useAdminSettings';
import { UsersSection } from './admin/UsersSection';
import { OrganizationsSection } from './admin/OrganizationsSection';
import { ServerSection } from './admin/ServerSection';
import { SignInSection } from './admin/SignInSection';
import { SharingSection } from './admin/SharingSection';
import { DataSettingsSection } from './admin/DataSettingsSection';
import { MediaSettingsSection } from './admin/MediaSettingsSection';
import { AiSection } from './admin/AiSection';
import { SmtpSection } from './admin/SmtpSection';
import { AuditSection } from './admin/AuditSection';

interface AdminSettingsViewProps {
  currentUser: User;
  onBack: () => void;
}

type AdminSection =
  | 'users'
  | 'signin'
  | 'organizations'
  | 'sharing'
  | 'server'
  | 'data'
  | 'media'
  | 'ai'
  | 'smtp'
  | 'audit';

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

  // The left column, top to bottom. User managers look after people only; the server's settings, mail
  // and the audit log are for server admins.
  const navItems: { id: AdminSection; icon: LucideIcon; label: string; hint: string; serverAdminOnly?: boolean }[] = [
    { id: 'users', icon: Users, label: t('admin.nav.users'), hint: t('admin.nav.usersHint') },
    { id: 'signin', icon: KeyRound, label: t('admin.nav.signin'), hint: t('admin.nav.signinHint'), serverAdminOnly: true },
    { id: 'organizations', icon: BuildingComplex, label: t('orgs.title'), hint: t('admin.nav.orgsHint') },
    { id: 'sharing', icon: Share2, label: t('admin.nav.sharing'), hint: t('admin.nav.sharingHint'), serverAdminOnly: true },
    { id: 'server', icon: Server, label: t('admin.nav.server'), hint: t('admin.nav.serverHint'), serverAdminOnly: true },
    { id: 'data', icon: Database, label: t('admin.nav.data'), hint: t('admin.nav.dataHint'), serverAdminOnly: true },
    { id: 'media', icon: Images, label: t('admin.nav.media'), hint: t('admin.nav.mediaHint'), serverAdminOnly: true },
    { id: 'ai', icon: Mic, label: t('admin.nav.ai'), hint: t('admin.nav.aiHint'), serverAdminOnly: true },
    { id: 'smtp', icon: Mail, label: t('admin.nav.smtp'), hint: t('admin.nav.smtpHint'), serverAdminOnly: true },
    { id: 'audit', icon: ScrollText, label: t('admin.nav.audit'), hint: t('admin.nav.auditHint'), serverAdminOnly: true },
  ];

  return (
    // Wide screens: a narrow column of sections and the content at about the width of a note's text, left
    // aligned; nothing grows beyond that
    <div className="w-full md:max-w-[64rem] space-y-4">
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

        <span className="badge-accent">{t(`common:role.${currentUser.role}`)}</span>
      </div>

      {/* Answers to saves float above the page, so nothing in it moves */}
      <StatusToast msg={statusMsg} onClose={() => setStatusMsg(null)} />

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)] gap-4 items-start">
        {/* Left Navigation Sidebar */}
        <aside className="panel-surface divide-y divide-border overflow-hidden">
          {navItems
            .filter((item) => !item.serverAdminOnly || isServerAdmin)
            .map(({ id, icon: Icon, label, hint }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                data-admin-nav={id}
                className={`w-full px-3.5 py-3 text-left text-xs font-medium flex items-center gap-2.5 transition-colors ${
                  section === id
                    ? 'bg-panel-elevated text-main border-l-2 border-l-accent'
                    : 'text-muted hover:text-main hover:bg-canvas/50'
                }`}
              >
                <Icon className="w-4 h-4 text-accent shrink-0" />
                <div>
                  <p className="font-semibold">{label}</p>
                  <p className="text-[10px] text-faint">{hint}</p>
                </div>
              </button>
            ))}
        </aside>

        {/* Right Content Area */}
        <div className="min-w-0 panel-surface p-5 text-xs">
          {demoMode && (
            <div className="flex items-center gap-2 alert-err mb-4">
              <CircleAlert className="w-4 h-4 text-status-err shrink-0" />
              <span>
                {t('admin.demo')}
              </span>
            </div>
          )}
          {section === 'users' && <UsersSection admin={admin} currentUser={currentUser} isServerAdmin={isServerAdmin} />}
          {section === 'organizations' && <OrganizationsSection admin={admin} />}
          {/* Everything else only for server admins */}
          {isServerAdmin && (
            <>
              {section === 'signin' && <SignInSection admin={admin} />}
              {section === 'sharing' && <SharingSection admin={admin} />}
              {section === 'server' && <ServerSection admin={admin} />}
              {section === 'data' && <DataSettingsSection admin={admin} />}
              {section === 'media' && <MediaSettingsSection admin={admin} />}
              {section === 'ai' && <AiSection admin={admin} />}
              {section === 'smtp' && <SmtpSection admin={admin} />}
              {section === 'audit' && <AuditSection users={admin.users} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
