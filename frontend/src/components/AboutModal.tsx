import React from 'react';
import { Brain, ExternalLink } from 'lucide-react';
import { APP_VERSION } from '../version';
import { ReadingModal } from './ReadingModal';

// Project facts shown in "Über MindSift"; change here when the repository or license changes
export const PROJECT_REPO_URL = 'https://github.com/mindsift-app/mindsift';
export const PROJECT_LICENSE = 'GNU AGPLv3 – freie Software, Änderungen bleiben frei';

export const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <ReadingModal title="Über MindSift" onClose={onClose}>
    <div className="space-y-4 text-xs text-muted leading-relaxed">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-accent text-on-accent rounded-btn flex items-center justify-center shrink-0">
          <Brain className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm font-bold text-main">MindSift</p>
          <p>Der Kopf frei in drei Sekunden.</p>
        </div>
      </div>

      <p>
        Die meisten Notiz- und Aufgaben-Apps verlangen Struktur im falschen Moment. MindSift trennt deshalb{' '}
        <strong className="text-main">Erfassen</strong> und <strong className="text-main">Organisieren</strong>: Gedanken
        landen sofort im Quick Dump und werden später mit einem Tastendruck zu Aufgabe, Notiz oder Listeneintrag. Alles läuft
        selbst gehostet in einem Container mit einer SQLite-Datei – deine Daten bleiben bei dir.
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="font-semibold text-main">Version</dt>
        <dd className="font-mono">{APP_VERSION}</dd>
        <dt className="font-semibold text-main">Lizenz</dt>
        <dd>{PROJECT_LICENSE}</dd>
        <dt className="font-semibold text-main">Quellcode</dt>
        <dd>
          <a href={PROJECT_REPO_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
            {PROJECT_REPO_URL.replace(/^https:\/\//, '')}
            <ExternalLink className="w-3 h-3" />
          </a>
        </dd>
      </dl>

      <p className="text-[11px] text-faint">
        Impressum und Datenschutz dieser Instanz verantwortet ihr Betreiber; die Links stehen in den Kontoeinstellungen und auf der Anmeldeseite.
      </p>
    </div>
  </ReadingModal>
);
