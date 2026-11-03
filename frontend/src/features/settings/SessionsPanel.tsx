import { useEffect, useState } from 'react';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { api } from '../../lib/api';
import { Session } from '../../lib/types';
import { formatDateTime } from '../../lib/format';

// Rough device label from the user agent; good enough to tell one's own devices apart
export function describeDevice(ua: string): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unbekanntes Gerät', mobile: false };
  if (ua.startsWith('MindSift-')) return { label: 'MindSift-Client', mobile: false };
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return { label: os ? `${browser} auf ${os}` : browser, mobile };
}

function formatLastUsed(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 10) return 'gerade aktiv';
  return `zuletzt ${formatDateTime(d, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function SessionsPanel() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState('');
  const [ending, setEnding] = useState('');

  const load = async () => {
    try {
      const list = await api.listSessions();
      setSessions([...list.filter((s) => s.current), ...list.filter((s) => !s.current)]);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Sitzungen konnten nicht geladen werden');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const endSession = async (id: string) => {
    setEnding(id);
    try {
      await api.endSession(id);
      setSessions((prev) => (prev || []).filter((s) => s.id !== id));
    } catch (err: any) {
      setError(err.message || 'Sitzung konnte nicht beendet werden');
    } finally {
      setEnding('');
    }
  };

  if (error) return <p className="text-[11px] text-status-err">{error}</p>;
  if (!sessions) return <p className="text-[11px] text-muted">Lade Sitzungen…</p>;

  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-canvas">
      {sessions.map((s) => {
        const device = describeDevice(s.userAgent);
        const Icon = device.mobile ? Smartphone : Monitor;
        return (
          <li key={s.id} className="flex items-center gap-3 p-3 text-xs">
            <Icon size={16} className="text-muted shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-main truncate">
                {device.label}
                {s.current && <span className="ml-2 text-[10px] font-semibold text-accent">Dieses Gerät</span>}
              </p>
              <p className="text-[11px] text-faint truncate">
                {[formatLastUsed(s.lastUsedAt), s.ip].filter(Boolean).join(' · ')}
              </p>
            </div>
            {!s.current && (
              <button
                type="button"
                onClick={() => endSession(s.id)}
                disabled={ending === s.id}
                title="Dieses Gerät abmelden"
                className="btn-secondary min-h-[44px] sm:min-h-0 h-8 px-3 text-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut size={13} />
                <span>{ending === s.id ? 'Melde ab…' : 'Abmelden'}</span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
