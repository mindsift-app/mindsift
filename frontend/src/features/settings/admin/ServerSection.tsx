import React from 'react';
import {
  Users,
  AlertCircle,
} from 'lucide-react';
import { RegistrationMode } from '../../../lib/types';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { BackupAdminCard } from '../BackupAdminCard';
import { VoiceStatusCard } from '../VoiceStatusCard';
import { SHARING_MODES, useAdminSettings } from './useAdminSettings';

// Administration → Server & Isolation (state in useAdminSettings)
export function ServerSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const {
    pendingMode,
    settings,
    demoMode,
    handleSelectSharingMode,
    handleSaveSystemSettings,
    setPendingMode,
    setSettings,
  } = admin;
  return (
    <fieldset disabled={demoMode} className="min-w-0 border-0 p-0 m-0">
      <div className="space-y-6">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-bold text-main">
            Server-Grundeinstellungen & Benutzer-Sichtbarkeit
          </h2>
          <p className="text-muted mt-0.5">
            Als Server-Admin bestimmst du zentral, ob Nutzer komplett isoliert arbeiten, sich nur
            innerhalb ihrer Organisation sehen oder ob alle Nutzer für alle sichtbar sind.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-muted font-semibold mb-1">
              Name der MindSift-Instanz
            </label>
            <div className="flex gap-2 max-w-md">
              <input
                type="text"
                value={settings.instanceName}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, instanceName: e.target.value }))
                }
                className="flex-1 h-9 px-3 input-field"
              />
              <button
                type="button"
                onClick={() => handleSaveSystemSettings()}
                className="btn-primary h-9 px-4 text-xs"
              >
                Speichern
              </button>
            </div>
          </div>

          {/* Sharing Isolation Cards */}
          <div className="space-y-2">
            <label className="block text-muted font-semibold flex items-center gap-1.5">
              <Users className="w-4 h-4 text-accent" />
              <span>Globale Sharing- & Sichtbarkeits-Isolation</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SHARING_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectSharingMode(m.id)}
                  className={`p-4 text-left border rounded-card transition-colors ${
                    settings.sharingMode === m.id
                      ? 'bg-canvas border-accent text-main shadow-panel'
                      : 'bg-canvas/50 border-border text-muted hover:text-main'
                  }`}
                >
                  <p className="font-bold text-xs text-main">{m.title}</p>
                  <p className="text-[11px] text-muted mt-1 leading-relaxed">{m.text}</p>
                </button>
              ))}
            </div>

            {pendingMode && (
              <div className="p-3 border border-status-warn/40 bg-status-warn/5 rounded-card flex flex-wrap items-center gap-2">
                <AlertCircle className="w-4 h-4 text-status-warn shrink-0" />
                <span className="flex-1 min-w-0 text-main">
                  Beim Wechsel zu „{SHARING_MODES.find((m) => m.id === pendingMode.mode)?.title.replace(/^\d\.\s*/, '')}“
                  fallen {pendingMode.affected} Freigaben und Gruppen-Mitgliedschaften weg, die danach nicht mehr erlaubt sind.
                </span>
                <button
                  onClick={() => {
                    const mode = pendingMode.mode;
                    setPendingMode(null);
                    handleSaveSystemSettings({ sharingMode: mode });
                  }}
                  className="btn-primary h-7 px-3 text-[11px]"
                >
                  Trotzdem wechseln
                </button>
                <button onClick={() => setPendingMode(null)} className="btn-action h-7 px-2 text-[11px]">
                  Abbrechen
                </button>
              </div>
            )}
          </div>

          <BackupAdminCard settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />

          <VoiceStatusCard />

          {/* Alarm webhooks into the local network (SSRF protection) */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">Alarm-Webhooks ins lokale Netz erlauben</p>
              <p className="text-[11px] text-muted mt-0.5">
                Standard: Discord- und Webhook-Alarme gehen nur an öffentliche https-Adressen. Eingeschaltet sind auch Ziele
                im Heimnetz erlaubt (z. B. Home Assistant unter 192.168.x.x oder über Tailscale), dort auch per http.
                Der Server selbst (localhost) und Cloud-Metadaten bleiben immer gesperrt.
              </p>
            </div>
            <ToggleSwitch
              checked={Boolean(settings.allowPrivateWebhooks)}
              onChange={(allowPrivateWebhooks) => handleSaveSystemSettings({ allowPrivateWebhooks })}
            />
          </div>

          {/* Retention: may people keep finished and deleted things for good? */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">Dauerhaftes Aufbewahren erlauben</p>
              <p className="text-[11px] text-muted mt-0.5">
                Eingeschaltet kann jede Person unter Kontoeinstellungen → Aufbewahrung „nie“ wählen, also Erledigtes und
                Gelöschtes behalten. Ausgeschaltet gilt dort für „nie“ die Voreinstellung des Bereichs (z. B. 30 Tage).
                {settings.retentionNeverViaEnv && ' Festgelegt per RETENTION_ALLOW_NEVER.'}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.retentionAllowNever !== false}
              disabled={Boolean(settings.retentionNeverViaEnv)}
              onChange={(retentionAllowNever) => handleSaveSystemSettings({ retentionAllowNever })}
            />
          </div>

          {/* AI agents over MCP (and claude.ai / ChatGPT over OAuth) */}
          <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4">
            <div className="pr-4">
              <p className="font-bold text-main">KI-Agenten (MCP) erlauben</p>
              <p className="text-[11px] text-muted mt-0.5">
                Eingeschaltet können Claude Code, Codex & Co. per API-Schlüssel und claude.ai oder ChatGPT als Connector
                auf MindSift zugreifen. Ausgeschaltet ist der MCP-Endpunkt samt Connector-Anmeldung abgeschaltet;
                bestehende Connector-Verbindungen ruhen, API-Schlüssel funktionieren per curl weiter.
                {settings.mcpConfiguredViaEnv && ' Festgelegt per MCP_ENABLED.'}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.mcpEnabled !== false}
              disabled={Boolean(settings.mcpConfiguredViaEnv)}
              onChange={(mcpEnabled) => handleSaveSystemSettings({ mcpEnabled })}
            />
          </div>

          {/* Who may register without an invite */}
          {(() => {
            const mode = settings.registrationMode || 'closed';
            const locked = Boolean(settings.registrationConfiguredViaEnv);
            const needsDomains = mode === 'domain' || mode === 'domain+approval';
            return (
              <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
                <div>
                  <p className="font-bold text-main">Registrierung ohne Einladung</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    Wer sich auf dem Login-Bildschirm selbst ein Konto anlegen darf. Einladungslinks und -codes funktionieren
                    immer. Wartende Konten gibst du unter „Benutzer &amp; Einladungen“ frei.
                  </p>
                </div>
                <select
                  value={mode}
                  disabled={locked}
                  onChange={(e) => handleSaveSystemSettings({ registrationMode: e.target.value as RegistrationMode })}
                  className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs disabled:opacity-60"
                >
                  <option value="closed">Geschlossen – nur mit Einladung</option>
                  <option value="approval">Mit Freigabe – jeder darf sich registrieren, ein Admin schaltet frei</option>
                  <option value="domain">Nur bestimmte E-Mail-Endungen – sofort aktiv</option>
                  <option value="domain+approval">Endungen sofort, alle anderen nach Freigabe</option>
                  <option value="open">Offen – jeder, sofort aktiv</option>
                </select>
                {needsDomains && (
                  <label className="block text-[11px] text-muted">
                    Erlaubte E-Mail-Endungen (durch Komma getrennt, <code className="font-mono">*.firma.de</code> auch für Subdomains)
                    <input
                      type="text"
                      disabled={locked}
                      value={settings.registrationDomains || ''}
                      onChange={(e) => setSettings((prev) => ({ ...prev, registrationDomains: e.target.value }))}
                      onBlur={() => handleSaveSystemSettings()}
                      placeholder="firma.de, familie-dach.de"
                      className="block w-full mt-1 h-11 sm:h-8 px-2.5 input-field font-mono text-base sm:text-xs disabled:opacity-60"
                    />
                  </label>
                )}
                {locked && (
                  <p className="text-[11px] text-status-warn">
                    Über die Umgebung festgelegt (<code className="font-mono">REGISTRATION_MODE</code> /{' '}
                    <code className="font-mono">REGISTRATION_DOMAINS</code>) und hier nicht änderbar.
                  </p>
                )}
                {mode !== 'closed' && (
                  <div className="pt-3 border-t border-border flex items-start justify-between gap-4">
                    <div className="pr-2">
                      <p className="font-semibold text-main">E-Mail-Adresse bestätigen lassen</p>
                      <p className="text-[11px] text-muted mt-0.5">
                        Neue Konten ohne Einladung bekommen einen Link per E-Mail und sind erst danach aktiv (bei Freigabe
                        landen sie danach bei dir). Unbestätigte Konten werden nach 48 Stunden gelöscht.
                      </p>
                      {!settings.emailLinksAvailable && (
                        <p className="text-[11px] text-status-warn mt-1">
                          Wirkt erst mit eingerichtetem Mail-Server und gesetzter <code className="font-mono">BASE_URL</code>.
                        </p>
                      )}
                      {settings.registrationVerifyConfiguredViaEnv && (
                        <p className="text-[11px] text-status-warn mt-1">
                          Über <code className="font-mono">REGISTRATION_VERIFY_EMAIL</code> festgelegt.
                        </p>
                      )}
                    </div>
                    <ToggleSwitch
                      checked={Boolean(settings.registrationVerifyEmail)}
                      disabled={Boolean(settings.registrationVerifyConfiguredViaEnv)}
                      onChange={(registrationVerifyEmail) => handleSaveSystemSettings({ registrationVerifyEmail })}
                      title="E-Mail-Adresse bei der Registrierung bestätigen lassen"
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </fieldset>
  );
}
