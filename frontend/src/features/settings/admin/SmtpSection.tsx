import React from 'react';
import {
  Send,
} from 'lucide-react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { useAdminSettings } from './useAdminSettings';

// Administration → E-Mail / SMTP-Server (state in useAdminSettings)
export function SmtpSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const {
    settings,
    testSmtpEmail,
    testingSmtp,
    demoMode,
    handleSaveSystemSettings,
    handleTestSmtp,
    setSettings,
    setTestSmtpEmail,
  } = admin;
  return (
    <fieldset disabled={demoMode} className="min-w-0 border-0 p-0 m-0">
      <div className="space-y-6">
        <div className="border-b border-border pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-main">
              E-Mail / SMTP-Server für Aufgaben-Alarme
            </h2>
            <p className="text-muted mt-0.5">
              Konfiguriere den Postausgangsserver per Docker-Compose Environment-Variablen oder
              direkt hier über die Oberfläche (wird persistent in der SQLite-Datenbank gespeichert).
            </p>
          </div>

          {settings.smtpConfiguredViaEnv && (
            <span className="badge-ok text-[11px] flex-shrink-0">
              Docker Env erkannt
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-muted font-medium mb-1">
              SMTP Host (`SMTP_HOST`)
            </label>
            <input
              type="text"
              value={settings.smtpHost || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, smtpHost: e.target.value }))
              }
              placeholder="z.B. smtp.example.com oder mail.deinedomain.de"
              className="w-full h-9 px-3 input-field font-mono"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              SMTP Port (`SMTP_PORT`)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={settings.smtpPort ?? ''}
              onChange={(e) =>
                // Digits only; an empty field stays empty while typing (saved as 587)
                setSettings((prev) => ({ ...prev, smtpPort: e.target.value.replace(/\D/g, '').slice(0, 5) }))
              }
              placeholder="587"
              className="w-full h-9 px-3 input-field font-mono"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              SMTP Benutzername (`SMTP_USER`)
            </label>
            <input
              type="text"
              value={settings.smtpUser || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, smtpUser: e.target.value }))
              }
              placeholder="alerts@deinedomain.de"
              className="w-full h-9 px-3 input-field font-mono"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              SMTP Passwort (`SMTP_PASS`)
            </label>
            <input
              type="password"
              value={settings.smtpPass || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, smtpPass: e.target.value }))
              }
              placeholder={settings.smtpPassSet ? 'Gespeichert – leer lassen für keine Änderung' : '••••••••••••'}
              autoComplete="new-password"
              className="w-full h-9 px-3 input-field font-mono"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              Absender-Adresse (`SMTP_FROM`)
            </label>
            <input
              type="text"
              value={settings.smtpFrom || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, smtpFrom: e.target.value }))
              }
              placeholder="alerts@deinedomain.de"
              className="w-full h-9 px-3 input-field"
            />
          </div>

          <div>
            <label className="block text-muted font-medium mb-1">
              Absender-Name (`SMTP_FROM_NAME`)
            </label>
            <input
              type="text"
              value={settings.smtpFromName || ''}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, smtpFromName: e.target.value }))
              }
              placeholder="MindSift"
              className="w-full h-9 px-3 input-field"
            />
            <p className="text-[11px] text-faint mt-1">
              Erscheint beim Empfänger als Absender. Leer = „MindSift“; ein Name direkt in der Adresse
              („Name &lt;adresse&gt;“) hat Vorrang.
            </p>
          </div>

          <div className="sm:col-span-2 space-y-3 pt-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-main font-medium">Verschlüsselung (`SMTP_TLS`)</p>
                <p className="text-[11px] text-muted">
                  Port 465: TLS ab Verbindungsbeginn, sonst STARTTLS. Ist es an, wird ohne Verschlüsselung nicht gesendet.
                </p>
              </div>
              <ToggleSwitch
                checked={settings.smtpTls ?? true}
                onChange={(smtpTls) => setSettings((prev) => ({ ...prev, smtpTls }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-main font-medium">Zertifikatsprüfung deaktivieren (`SMTP_SKIP_VERIFY`)</p>
                <p className="text-[11px] text-muted">
                  Nur für interne Mailserver mit selbstsigniertem Zertifikat oder abweichendem Namen. Die Verbindung
                  bleibt verschlüsselt, der Server wird aber nicht mehr geprüft.
                </p>
              </div>
              <ToggleSwitch
                checked={settings.smtpSkipVerify ?? false}
                disabled={!(settings.smtpTls ?? true)}
                onChange={(smtpSkipVerify) => setSettings((prev) => ({ ...prev, smtpSkipVerify }))}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => handleSaveSystemSettings()}
            className="btn-primary h-9 px-5 text-xs font-semibold"
          >
            SMTP-Konfiguration in Datenbank speichern
          </button>
        </div>

        {/* Test SMTP Delivery */}
        <div className="p-4 bg-canvas border border-border rounded-card space-y-2">
          <h3 className="font-bold text-main">SMTP-Verbindung testen</h3>
          <p className="text-[11px] text-muted">
            Sendet sofort eine Test-E-Mail mit den oben eingetragenen Daten.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={testSmtpEmail}
              onChange={(e) => setTestSmtpEmail(e.target.value)}
              placeholder="empfaenger@beispiel.de"
              className="flex-1 h-8 px-3 input-field"
            />
            <button
              type="button"
              onClick={handleTestSmtp}
              disabled={testingSmtp || !testSmtpEmail.trim()}
              className="btn-action h-8 px-4 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5 text-accent" />
              <span>{testingSmtp ? 'Sende Test-Mail…' : 'Test-E-Mail senden'}</span>
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  );
}
