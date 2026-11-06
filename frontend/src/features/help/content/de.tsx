import React from 'react';
import {
  Layers,
  FileText,
  CheckSquare,
  Keyboard,
  Pin,
  Sparkles,
  Command,
  Users,
  Mic,
  ShoppingCart,
  Columns,
  Tag,
  Link as LinkIcon,
  Bell,
  Lock,
  Heading1,
  ListTodo,
  Code,
  Download,
  KeyRound,
} from 'lucide-react';
import type { HelpContent } from './types';

// German help: the cards and the shortcut table. Other languages copy this file (content/<code>.tsx)
// and translate the texts; layout and icons stay the same.
const de: HelpContent = {
  cards: [
    // WORKSPACE & OUTLINER
    {
      id: 'workspace-architecture',
      category: 'workspace',
      title: 'Hierarchischer Outliner & Offline-Sync',
      subtitle: 'Atomare Speicherung mit kollaborativem Echtzeit-Abgleich',
      icon: FileText,
      keywords: [
        'workspace',
        'outliner',
        'datenbank',
        'sqlite',
        'offline',
        'indexeddb',
        'export',
        'markdown',
        'speichern',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            In MindSift ist jede Notiz ein strukturierter, hierarchischer Outliner.
            Deine Notizen werden sicher und versioniert in der <strong className="text-main">SQLite-Datenbank</strong> abgelegt
            und im Browser per <strong className="text-main">IndexedDB</strong> zwischengespeichert.
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <strong className="text-main">Volle Offline-Fähigkeit:</strong> Du kannst auch ohne Internetverbindung nahtlos weiterarbeiten;
              Änderungen synchronisieren sich automatisch, sobald du wieder online bist.
            </li>
            <li>
              <strong className="text-main">Markdown-Export:</strong> Über das Download-Symbol (<Download className="w-3 h-3 inline text-accent" />) im Kopf der Notiz kannst du den aktuellen Stand jederzeit als Standard-Markdown-Datei (<code className="font-mono text-accent">.md</code>) auf deinen Rechner exportieren.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-keyboard',
      category: 'workspace',
      title: 'Tastaturbedienung im Notizen-Editor',
      subtitle: 'Flüssiges Schreiben und Gliedern ohne die Maus zu berühren',
      icon: Keyboard,
      keywords: [
        'tastatur',
        'shortcuts',
        'enter',
        'tab',
        'shift',
        'backspace',
        'outliner',
        'einrücken',
        'ausrücken',
        'undo',
        'redo',
        'pfeiltasten',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Enter</kbd> : Erzeugt sofort einen neuen Bullet-Point auf derselben Ebene. Ist der Punkt leer und eingerückt, rückt er eine Ebene nach links aus.
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Tab</kbd> : Rückt den aktuellen Bullet-Point nach rechts ein und ordnet ihn dem vorherigen Punkt unter.
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Shift + Tab</kbd> : Rückt den Bullet-Point nach links aus (verringert die Einrückungstiefe).
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Shift + Enter</kbd> : Erzeugt einen weichen Zeilenumbruch innerhalb desselben Textblocks.
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Backspace</kbd> : Auf einem leeren Block löscht die Taste diesen sofort. Am Textanfang wird der Block mit dem vorherigen zusammengeführt.
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">↑ / ↓</kbd> : Springt flüssig zum vorherigen bzw. nächsten Block, wenn sich der Cursor ganz am Anfang oder Ende des Textes befindet.
            </li>
            <li>
              <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Strg + Z</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Cmd + Z</kbd> : Mehrstufiges Notiz-Undo. Wiederholen mit <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Strg + Y</kbd> bzw. <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Strg + Shift + Z</kbd>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-slash-and-autoformat',
      category: 'workspace',
      title: 'Slash-Befehle (/) & Auto-Formatierung',
      subtitle: 'Block-Typen wechseln und Markdown direkt beim Tippen formatieren',
      icon: Command,
      keywords: [
        'slash',
        'befehle',
        'commands',
        'todo',
        'link',
        'h1',
        'h2',
        'h3',
        'code',
        'callout',
        'warn',
        'fail',
        'divider',
        'bild',
        'extract',
        'auslagern',
        'zusammenführen',
        'audio',
        'sprachnotiz',
        'diktat',
        'image',
        'foto',
        'auto-formatting',
      ],
      content: (
        <div className="space-y-3 text-muted leading-relaxed">
          <div>
            <p className="mb-1.5">
              Tippe <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">/</code> in einen Block, um das Menü für Blocktypen zu öffnen:
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <ListTodo className="w-3.5 h-3.5 text-accent" />
                <span>/todo (Checkbox-Aufgabe)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <LinkIcon className="w-3.5 h-3.5 text-accent" />
                <span>/link (Notiz verknüpfen)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Heading1 className="w-3.5 h-3.5 text-accent" />
                <span>/h1, /h2, /h3 (Überschriften)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Code className="w-3.5 h-3.5 text-accent" />
                <span>/code (Code-Block)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <KeyRound className="w-3.5 h-3.5 text-accent" />
                <span>/secret (Wert verdecken, z. B. IP oder Token)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">💬</span>
                <span>/callout (Hinweis-Box)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-status-warn font-bold">⚠</span>
                <span>/warn, /fail (Warnung, Fehler)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">—</span>
                <span>/divider (Trennlinie)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🖼️</span>
                <span>/image oder /bild (Bild hochladen, fotografieren, einfügen oder per Link; nur im leeren Punkt)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">📤</span>
                <span>/extract oder /notiz (Punkt mit allen Unterpunkten in eine eigene Notiz auslagern, an seiner Stelle bleibt ein [[Link]]; der Knopf „Notiz zurückholen“ am Link macht das wieder rückgängig)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🎙️</span>
                <span>/audio (Sprachnotiz aufnehmen: grüner Knopf startet, roter speichert; oder Audiodatei hochladen)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🗣️</span>
                <span>/diktat (sprechen statt tippen: startet sofort, Tipp auf „Stopp“ setzt den Text in den Punkt)</span>
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <span className="font-semibold text-main block mb-1">Blitz-Formatierung beim Schreiben:</span>
            <ul className="space-y-1 text-xs">
              <li><code className="text-accent font-mono">[] </code> oder <code className="text-accent font-mono">[ ] </code> am Zeilenanfang wandelt die Zeile sofort in eine Todo-Checkbox um.</li>
              <li><code className="text-accent font-mono">[x] </code> wandelt sie in eine erledigte Todo-Checkbox um.</li>
              <li><code className="text-accent font-mono"># </code>, <code className="text-accent font-mono">## </code> oder <code className="text-accent font-mono">### </code> am Zeilenanfang formatiert den Block sofort als Überschrift.</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 'workspace-wikilinks-tags',
      category: 'workspace',
      title: 'WikiLinks ([[...]]), Hashtags (#) & Tag-Seiten',
      subtitle: 'Wissen bidirektional vernetzen und thematisch filtern',
      icon: Tag,
      keywords: [
        'wikilinks',
        'links',
        'vernetzung',
        'hashtags',
        'tags',
        'filter',
        'schlagwörter',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Notizen und Gedanken können in MindSift auf vielfältige Weise miteinander verknüpft werden:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">WikiLinks:</strong> Schreibe <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[Name der Notiz]]</code>, um eine direkte Verknüpfung zu einer anderen Notiz herzustellen. Ein Klick darauf öffnet die Zielnotiz unmittelbar.
            </li>
            <li>
              <strong className="text-main">Hashtags:</strong> Tippe <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#Projekt</code> oder <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#Wichtig</code> an beliebiger Stelle in den Text. Hashtags werden farbig hervorgehoben und indiziert.
            </li>
            <li>
              <strong className="text-main">Ansicht „Tags & Filter“:</strong> Im oberen Workspace-Reiter findest du die Tag-Übersicht. Hier siehst du alle verwendeten Hashtags, kannst Fundstellen aus allen Dokumenten gebündelt durchsuchen und sogar eigene freie Notizen auf Tag-Seiten hinterlegen.
            </li>
            <li>
              <strong className="text-main">Rückverweise:</strong> Am Ende jeder Notiz siehst du unter „Verlinkt auf diese Notiz“, welche anderen Notizen sie mit <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[Titel]]</code> verlinken. Ein Klick auf die Fundstelle springt direkt dorthin.
            </li>
            <li>
              <strong className="text-main">Papierkorb:</strong> Gelöschte Notizen (auch aus gelöschten Ordnern) landen im „Papierkorb“ unten in der Ordnerleiste bzw. im mobilen Menü. Dort kannst du sie schreibgeschützt ansehen, wiederherstellen oder endgültig löschen. Solange eine Notiz im Papierkorb liegt, sehen sie auch die Personen nicht, mit denen sie geteilt war. Nach der Frist aus Kontoeinstellungen → Aufbewahrung (Standard 30 Tage) wird sie endgültig gelöscht. Gelöschte Aufgaben liegen im Reiter „Papierkorb“ der Aufgaben, verworfene Gedanken im Papierkorb der Triage.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-zoom-drag',
      category: 'workspace',
      title: 'Zoom-Hoisting, Drag & Drop und Favoriten',
      subtitle: 'Fokus behalten und Notizen flexibel sortieren',
      icon: Pin,
      keywords: [
        'andere notiz',
        'auslagern',
        'hoisting',
        'zoom',
        'drag',
        'drop',
        'ordner',
        'verschieben',
        'anpinnen',
        'breadcrumbs',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Zoom-Hoisting:</strong> Klicke direkt auf den Bullet-Punkt (<code className="text-accent">•</code>) eines Blocks, um exklusiv in diesen Ast hineinzuzoomen. Die Breadcrumb-Navigation am oberen Rand führt dich jederzeit stufenweise zurück.
            </li>
            <li>
              <strong className="text-main">Blöcke verschieben:</strong> Packe einen Bullet-Punkt mit gedrückter Maustaste, um ihn samt aller untergeordneten Punkte an eine neue Stelle zu ziehen.
            </li>
            <li>
              <strong className="text-main">In eine andere Notiz:</strong> Ziehst du den Bullet-Punkt auf eine Notiz in der Seitenleiste, wandert der ganze Ast ans Ende dieser Notiz. Auf dem Plus für eine neue Notiz oben in der Seitenleiste abgelegt, wird er zu einer eigenen neuen Notiz. Der Hinweis danach bietet „Öffnen“ und „Rückgängig“, Strg+Z geht auch; verknüpfte Aufgaben ziehen mit.
            </li>
            <li>
              <strong className="text-main">Auslagern:</strong> Der Knopf „In eigene Notiz umwandeln“ rechts am Bullet fragt nach dem Ziel: Enter legt eine neue Notiz an, Tippen sucht eine bestehende. An der alten Stelle bleibt ein Link auf den verschobenen Punkt.
            </li>
            <li>
              <strong className="text-main">Ordner-Navigation:</strong> Notizen im linken Datei-Explorer lassen sich per Drag & Drop bequem in Unterordner einsortieren.
            </li>
            <li>
              <strong className="text-main">Angepinnte Favoriten:</strong> Mit dem Stecknadel-Symbol heftest du wichtige Notizen dauerhaft ganz oben im Explorer an.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-collab-locks',
      category: 'workspace',
      title: 'Echtzeit-Zusammenarbeit, Sperren & Konflikte',
      subtitle: 'Gemeinsames Arbeiten ohne versehentliches Überschreiben',
      icon: Lock,
      keywords: [
        'kollaboration',
        'sperren',
        'schloss',
        'konflikte',
        'live',
        'presence',
        'sharing',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            MindSift unterstützt kooperatives Arbeiten an Dokumenten mit integriertem Schutz vor Datenverlust:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Block-Sperren:</strong> Bearbeitet jemand einen Bullet-Point, wird dieser mit einem Schloss-Symbol und dem Benutzernamen gekennzeichnet. Andere Nutzer können diesen Punkt temporär nicht überschreiben.
            </li>
            <li>
              <strong className="text-main">Konfliktkopien:</strong> Sollten Änderungen zeitgleich oder offline entstehen, überschreibt der Server niemals still deine Eingaben. Stattdessen erscheint ein gelb hervorgehobener Konfliktblock mit zwei Schaltflächen: <em>„Übernehmen“</em> oder <em>„Verwerfen“</em>.
            </li>
            <li>
              <strong className="text-main">Verbindungsanzeige:</strong> Neben dem Notiztitel siehst du immer den Verbindungsmodus (z.B. <em>Live</em>, <em>Long-Polling</em> oder <em>Offline</em>).
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-global-todos',
      category: 'workspace',
      title: 'Globale To-Dos Rollup & Aufgaben-Verknüpfung',
      subtitle: 'Alle offenen Aufgaben aus sämtlichen Notizen an einem Ort',
      icon: CheckSquare,
      keywords: [
        'rollup',
        'todos',
        'checkboxen',
        'enhanced task',
        'global',
        'aufgaben',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Im Workspace-Tab <strong className="text-main">„Globale To-Dos“</strong> werden automatisch sämtliche unerledigten Checkboxen (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">- [ ]</code>) aus allen deinen Notizen gesammelt.
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Zweiseitige Synchronisation:</strong> Hakst du eine Aufgabe in der globalen To-Do-Liste ab, wird der Block in der Quell-Notiz in Echtzeit aktualisiert.
            </li>
            <li>
              <strong className="text-main">Verknüpfte Aufgaben (Enhanced Tasks):</strong> Ausgewählte Notiz-Aufgaben können zusätzlich als vollwertige Aufgaben im Aufgaben- und Kanban-Bereich geführt werden.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-search-cmdk',
      category: 'workspace',
      title: 'Globale Suche & Command Palette (Cmd+K)',
      subtitle: 'FTS5-Volltextsuche in Notizen, Blöcken, Aufgaben und Listen',
      icon: Command,
      keywords: [
        'suche',
        'search',
        'command',
        'palette',
        'cmdk',
        'find',
        'fts',
        'volltext',
        'tastatur',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Drücke <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Cmd + K</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Strg + K</kbd> oder <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/</kbd> (wenn kein Textfeld aktiv ist), um die globale Suche zu öffnen:
          </p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>
              <strong className="text-main">Volltextsuche (FTS5):</strong> Durchsucht Notiz-Titel und Blöcke, Aufgaben und Listeneinträge blitzschnell mit Relevanz-Ranking (BM25) und Präfixsuche.
            </li>
            <li>
              <strong className="text-main">Sicherheit:</strong> Zeigt nur Inhalte, auf die du tatsächlich Zugriff hast (eigene sowie freigegebene Notizen, Aufgabenlisten und Listen).
            </li>
            <li>
              <strong className="text-main">Tastaturnavigation:</strong> Mit <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">↑</kbd> und <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">↓</kbd> blättern, mit <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Enter</kbd> Treffer direkt öffnen (Notizen direkt am gefundenen Block).
            </li>
          </ul>
        </div>
      ),
    },

    // TRIAGE & QUICK DUMP
    {
      id: 'triage-capture',
      category: 'triage',
      title: 'Blitz-Erfassung (Instant Capture Bar)',
      subtitle: 'Gedanken in unter 1 Sekunde festhalten – per Tastatur oder Sprache',
      icon: Layers,
      keywords: [
        'capture',
        'schnellerfassung',
        'diktat',
        'sprache',
        'mikrofon',
        'inbox',
        'posteingang',
        'c',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Die Schnellerfassungsleiste am oberen Bildschirmrand sorgt dafür, dass kein flüchtiger Gedanke verloren geht:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Sofortiger Fokus:</strong> Drücke irgendwo in der App <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">C</kbd> oder <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/</kbd> (sofern du nicht bereits in einem Textfeld tippst).
            </li>
            <li>
              <strong className="text-main">Sprach-Diktat:</strong> Klicke auf das Mikrofon-Symbol (<Mic className="w-3.5 h-3.5 inline text-accent" />) für kontinuierliche Spracheingabe über die Web Speech API. Gesprochene Gedanken werden automatisch mit dem Tag <code className="text-accent font-mono">#diktat</code> versehen. Auf dem Smartphone kannst du außerdem den runden <strong className="text-main">+</strong>-Button in der unteren Leiste gedrückt halten, um direkt einzusprechen – beim Loslassen landet der Text sofort im Posteingang (nach oben ziehen bricht ab).
            </li>
            <li>
              <strong className="text-main">Ziel-Auswahl:</strong> Gedanken landen standardmäßig im Posteingang. Über die Optionen kannst du sie jedoch sofort als <strong className="text-main">Aufgabe</strong> (mit Priorität und Fälligkeit), <strong className="text-main">Listeneintrag</strong> (z.B. auf die Einkaufsliste) oder <strong className="text-main">neue Notiz</strong> routen.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'triage-deck-decisions',
      category: 'triage',
      title: 'Triage-Deck: Entscheiden mit 1 Taste oder Wischgeste',
      subtitle: 'Posteingang in Rekordzeit abarbeiten und den Kopf frei halten',
      icon: Sparkles,
      keywords: [
        'triage',
        'deck',
        'h',
        'l',
        't',
        'd',
        'leertaste',
        'swipe',
        'wischen',
        'papierkorb',
        'gesten',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Im Triage-Deck wird jeder gesammelte Gedanke Karte für Karte vorgelegt. Du entscheidest blitzschnell:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Tastatur (Desktop):</span>
              <ul className="space-y-1 font-mono text-[11px]">
                <li><strong className="text-status-err">H</strong> oder <strong>←</strong> : Wegwerfen (Papierkorb)</li>
                <li><strong className="text-accent">L</strong> oder <strong>→</strong> : Als Aufgabe anlegen</li>
                <li><strong className="text-main">T</strong> : Mit Fälligkeit / Termin</li>
                <li><strong className="text-main">D</strong> : In Workspace-Notiz wandeln</li>
                <li><strong className="text-muted">Leertaste</strong> : Später (ans Stapelende)</li>
              </ul>
            </div>
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Wischgesten (Touch & Mobile):</span>
              <ul className="space-y-1 text-xs">
                <li><strong className="text-status-err">Nach links wischen:</strong> Wegwerfen</li>
                <li><strong className="text-accent">Nach rechts wischen:</strong> Als Aufgabe übernehmen</li>
                <li><strong className="text-main">Gedrückt halten:</strong> Menü öffnen (Termin, Liste, Notiz)</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'triage-webhooks',
      category: 'triage',
      title: 'API: curl, Smart Home & KI-Agenten (MCP)',
      subtitle: 'Aufgaben und Listen per curl oder Home Assistant lesen und ändern, Gedanken einliefern, KI-Agenten wie Claude Code anbinden.',
      icon: Bell,
      keywords: [
        'webhooks',
        'api',
        'token',
        'home assistant',
        'siri',
        'shortcuts',
        'automation',
        'curl',
        'mcp',
        'ki',
        'agent',
        'claude',
        'codex',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            MindSift hat eine API. Unter <em className="text-main">Kontoeinstellungen → API</em> erzeugst du persönliche Schlüssel und legst mit Schaltern fest, was jeder darf: Aufgaben, Listen, Notizen und die Inbox jeweils lesen, anlegen oder ändern. Diese Rechte gelten für beide Zugänge gleich; Notizen sowie Lesen und Sortieren der Inbox gibt es nur über MCP. Einstellungen erreicht ein Schlüssel nie.
          </p>
          <p>
            <strong className="text-main">curl und Smart Home:</strong> Mit Leserecht liefert z. B. <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">GET /api/v1/tasks?due=today&amp;status=open</code> alles, was heute ansteht, etwa für einen Home-Assistant-Sensor. Weitere Filter: <code className="font-mono">due=overdue</code>, ein Datum, <code className="font-mono">taskListId</code>. Listen kommen über <code className="font-mono">GET /api/v1/lists</code>. Mit Änderungsrecht hakst du per <code className="font-mono">PATCH /api/v1/thoughts/ID</code> ab. Die Einstellungen zeigen fertige Beispiele.
          </p>
          <p>
            <strong className="text-main">Einliefern:</strong> <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/webhooks/ingest</code> nimmt Gedanken aus iOS-Kurzbefehlen, Home Assistant oder n8n an. Mit dem Feld <code className="font-mono">"target"</code> wählst du das Ziel: <code className="font-mono">triage</code> (Standard), <code className="font-mono">task</code> (optional mit <code className="font-mono">taskListId</code>) oder <code className="font-mono">list_item</code> (mit <code className="font-mono">listId</code>).
          </p>
          <p>
            <strong className="text-main">KI-Agenten:</strong> Über MCP (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/mcp</code>) lesen, anlegen, ändern, abhaken und löschen Claude Code, OpenAI Codex, Claude Desktop, Cursor und eigene Agenten deine Aufgaben, Listen und Notizen und sortieren die Inbox. Die Einstellungen zeigen den fertigen Befehl für jeden Agenten; ein Agent sieht nur die Werkzeuge, die der Schlüssel erlaubt.
          </p>
          <p>
            <strong className="text-main">Herkunft:</strong> Was ein Schlüssel anlegt oder ändert, trägt dauerhaft eine Badge mit seinem Namen, vorne ein Webhook-Symbol (API) oder ein Roboter (MCP). Fährst du darüber oder tippst darauf, siehst du, wer wann angelegt und zuletzt geändert hat.
          </p>
        </div>
      ),
    },

    // TASKS & KANBAN
    {
      id: 'tasks-kanban',
      category: 'tasks',
      title: 'Listenansicht & Flexibles Kanban-Board',
      subtitle: 'Aufgaben visualisieren und mit anpassbaren Spalten steuern',
      icon: Columns,
      keywords: [
        'aufgaben',
        'tasks',
        'kanban',
        'board',
        'spalten',
        'drag',
        'drop',
        'listen',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Aufgaben können flexibel in einer klassischen <strong className="text-main">Listenansicht</strong> oder im interaktiven <strong className="text-main">Kanban-Board</strong> verwaltet werden:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Ansicht umschalten:</strong> Nutze den Umschalter oben rechts zwischen Liste und Kanban.
            </li>
            <li>
              <strong className="text-main">Eigene Kanban-Spalten:</strong> Über die Spaltenverwaltung kannst du für jede Aufgabenliste individuelle Phasen definieren (z.B. <em>Backlog</em>, <em>In Bearbeitung</em>, <em>Review</em>, <em>Erledigt</em>) inklusive Farben und Erledigt-Status.
            </li>
            <li>
              <strong className="text-main">Drag & Drop:</strong> Ziehe Aufgabenkarten mühelos zwischen den Spalten umher. Das Verschieben in eine Erledigt-Spalte hakt die Aufgabe automatisch ab.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'tasks-details-alarms',
      category: 'tasks',
      title: 'Teilaufgaben, Fälligkeiten & Automatische Alarme',
      subtitle: 'Checklisten mit Fortschrittsbalken, Markdown-Notizen und Benachrichtigungen',
      icon: CheckSquare,
      keywords: [
        'subtasks',
        'unteraufgaben',
        'alarme',
        'benachrichtigungen',
        'mail',
        'discord',
        'termin',
        'fälligkeit',
        'priorität',
        'zuweisen',
        'zugewiesen',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Teilaufgaben (Subtasks):</strong> Erstelle innerhalb jeder Aufgabe eine Checkliste mit sichtbarem Fortschrittsbalken (z.B. „3 von 5 erledigt“). Am Griff links lassen sich Teilaufgaben mit Maus oder Finger umsortieren, per Tastatur mit den Pfeiltasten.
            </li>
            <li>
              <strong className="text-main">Neue Aufgabe in einer Kanban-Spalte:</strong> „Aufgabe hinzufügen“ unten in der Spalte öffnet direkt das Aufgaben-Fenster mit Spalte und Liste vorbelegt; den Titel einfach eintippen. Schließt du das Fenster ohne Titel, verschwindet die leere Aufgabe wieder.
            </li>
            <li>
              <strong className="text-main">Prioritäten & Notizen:</strong> Vergib Prioritäten (<em className="text-accent">Dringend</em>, <em className="text-main">Wichtig</em>, <em>Normal</em>) und hinterlege detaillierte Markdown-Notizen.
            </li>
            <li>
              <strong className="text-main">Zuweisen:</strong> In geteilten Aufgabenlisten weist du eine Aufgabe einer oder mehreren Personen mit Zugriff zu (Namen tippen, Enter). Die Zugewiesenen erscheinen als kleine Profilbilder an der Aufgabe; wer den Zugriff auf die Liste verliert, wird automatisch entfernt.
            </li>
            <li>
              <strong className="text-main">Wiederkehrende Aufgaben:</strong> Im Detail-Fenster eine Wiederholung wählen (täglich bis jährlich). Beim Abhaken entsteht automatisch die nächste Aufgabe mit fortgeschriebenem Datum; erkennbar am 🔁-Symbol.
            </li>
            <li>
              <strong className="text-main">Fälligkeit mit Uhrzeit:</strong> Im Detail-Fenster neben dem Datum optional eine Uhrzeit setzen; „✕ Uhrzeit“ macht die Aufgabe wieder ganztägig. Angezeigt wird z.B. „Heute, 14:30“, Überfälliges in Rot.
            </li>
            <li>
              <strong className="text-main">Automatische Alarme:</strong> Zur Fälligkeit (ganztägige Aufgaben um 9:00, abzüglich deiner Vorlaufzeit) benachrichtigt MindSift dich per <strong className="text-main">E-Mail</strong>, <strong className="text-main">Discord-Webhook</strong> oder individuellem HTTP-Webhook. Verschiebst du die Fälligkeit oder öffnest die Aufgabe wieder, kommt der Alarm erneut. Konfigurierbar in deinen Benutzereinstellungen.
            </li>
          </ul>
        </div>
      ),
    },

    // LISTS & SHOPPING
    {
      id: 'lists-shared-shopping',
      category: 'lists',
      title: 'Geteilte Listen, Mengenangaben & Hashtag-Kategorien',
      subtitle: 'Echtzeit-Einkaufslisten, Packlisten und Checklisten',
      icon: ShoppingCart,
      keywords: [
        'listen',
        'einkauf',
        'shopping',
        'checkliste',
        'mengen',
        'kategorien',
        'hashtag',
        'realtime',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Geteilte Listen eignen sich perfekt für Einkäufe, Packlisten und gemeinsame Besorgungen:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Automatische Mengenerkennung:</strong> Eingaben wie <code className="text-accent font-mono">2x Bio-Milch</code> oder <code className="text-accent font-mono">500g Pasta</code> trennen Menge und Bezeichnung automatisch.
            </li>
            <li>
              <strong className="text-main">Kategorisierung per Hashtag:</strong> Ergänze einen Hashtag wie <code className="text-accent font-mono">#Kühlregal</code> oder <code className="text-accent font-mono">#Gemüse</code>. Die Liste gruppiert die Artikel automatisch in entsprechende Abschnitte.
            </li>
            <li>
              <strong className="text-main">Live-Abgleich & Erledigte aufräumen:</strong> Abgehakte Artikel werden in Echtzeit synchronisiert und zeigen an, wer sie erledigt hat. Mit dem Aufräumen-Button entfernst du erledigte Artikel gesammelt.
            </li>
          </ul>
        </div>
      ),
    },

    // APPEARANCE: CUSTOM THEMES
    {
      id: 'workspace-custom-themes',
      category: 'workspace',
      title: 'Darstellung & eigene Themes',
      subtitle: 'Fertige Designs wählen oder ein eigenes CSS-Theme hochladen',
      icon: Sparkles,
      keywords: ['theme', 'design', 'farben', 'css', 'dunkel', 'hell', 'darstellung'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Theme wechseln:</strong> Im Profilmenü oben rechts oder unter <em>Kontoeinstellungen → Darstellung &amp; Themes</em>.
            </li>
            <li>
              <strong className="text-main">Eigenes Theme:</strong> Vorlage herunterladen oder einfügen, Farben und Rundungen anpassen, als <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">.css</code>-Datei hochladen oder einfügen und „Speichern &amp; aktivieren“. Das Theme greift sofort und steht dir auf allen Geräten zur Verfügung.
            </li>
            <li>
              <strong className="text-main">Server-Backups:</strong> Hat die Administration automatische Backups eingeschaltet, findest du unter <em>Kontoeinstellungen → Export &amp; Import</em> die täglichen Sicherungen deiner Daten. Du kannst sie herunterladen oder wieder einspielen, auch nur für einzelne Bereiche wie Listen oder Aufgaben.
            </li>
            <li>
              <strong className="text-main">Ohne Internet:</strong> Als App installiert (oder im Browser) startet MindSift auch offline mit dem zuletzt geladenen Stand. Gedanken erfassen sowie Aufgaben und Listeneinträge abhaken geht weiter; ein Hinweis unten zeigt, wie viele Änderungen warten, und sie werden automatisch übertragen, sobald die Verbindung zurück ist.
            </li>
            <li>
              <strong className="text-main">Wo Offline-Änderungen liegen:</strong> Notizen, die du auf diesem Gerät schon einmal geöffnet hast, kannst du offline lesen und bearbeiten. Was noch nicht gesendet ist, liegt nur in diesem Browser: Es übersteht Schließen, Neustart und Herunterfahren und wird beim nächsten Start mit Verbindung automatisch gesendet. Verloren geht es, wenn du dich abmeldest (MindSift fragt vorher), die Browserdaten löschst oder in einem privaten Fenster arbeitest. Komm deshalb nach dem Offline-Arbeiten bald mit demselben Gerät wieder online. Hat in der Zwischenzeit jemand denselben Punkt geändert, geht nichts verloren: Deine Fassung erscheint als Konfliktkopie darunter.
            </li>
            <li>
              <strong className="text-main">Passwort vergessen:</strong> Hat die Administration den Mailversand eingerichtet, steht im Anmeldefenster „Passwort vergessen?“. Du bekommst einen Link, der eine Stunde gilt; mit dem neuen Passwort bist du auf allen Geräten abgemeldet.
            </li>
          </ul>
        </div>
      ),
    },

    // COLLABORATION: ORGANIZATIONS, GROUPS & SHARING
    {
      id: 'collab-teams-sharing',
      category: 'collaboration',
      title: 'Organisationen, Gruppen & Freigaben',
      subtitle: 'Wer wen sieht, und Notizen, Ordner und Listen sicher teilen',
      icon: Users,
      keywords: [
        'teams',
        'gruppen',
        'organisation',
        'sichtbarkeit',
        'privat',
        'freigabe',
        'sharing',
        'berechtigungen',
        'bearbeiter',
        'leser',
        'ordner',
      ],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Wer wen sieht:</strong> Das legt der Server-Admin fest. Je nach Einstellung siehst du alle Nutzer, nur die Mitglieder deiner <em>Organisation</em> oder niemanden (Modus „Privat“: kein Teilen, keine Gruppen). Organisationen verwaltet nur der Server-Admin; jeder gehört höchstens einer an.
            </li>
            <li>
              <strong className="text-main">Gruppen:</strong> Fasse Personen, die du sehen kannst, zu Gruppen zusammen (z. B. Familie, WG, Projekt) und teile mit allen auf einmal. Wer eine Gruppe anlegt, ist ihr Admin; mit einer Gruppe teilen kann nur, wer selbst Mitglied ist.
            </li>
            <li>
              <strong className="text-main">Nur der Eigentümer teilt:</strong> Bearbeiter können Inhalte ändern, aber nicht weiterteilen. Eine Freigabe an dich kannst du jederzeit selbst verlassen. Wechselt jemand die Organisation oder verlässt eine Gruppe, fallen seine Freigaben dort automatisch weg.
            </li>
            <li>
              <strong className="text-main">Rollen (Bearbeiter vs. Leser):</strong> Beim Teilen von Notizen, Ordnern oder Listen wählst du zwischen <em>Bearbeiter</em> (Vollzugriff auf Inhalte und Checklisten) und <em>Nur Lesen</em> (reine Ansicht mit Live-Updates).
            </li>
            <li>
              <strong className="text-main">Dezentrale Ordnerablage:</strong> Jeder Empfänger kann geteilte Dokumente und Ordner in seine eigene Verzeichnisstruktur einhängen, ohne die Organisation des Eigentümers zu verändern.
            </li>
          </ul>
        </div>
      ),
    },
  ],
  shortcuts: [
    { key: 'Cmd + K / Strg + K oder /', scope: 'Global', desc: 'Globale Volltextsuche (Command Palette) öffnen' },
    { key: 'C', scope: 'Global', desc: 'Fokus sofort in die Schnellerfassungsleiste setzen' },
    { key: 'Enter', scope: 'Schnellerfassung', desc: 'Gedanken blitzschnell speichern' },
    { key: 'Esc', scope: 'Schnellerfassung', desc: 'Eingabe leeren & Optionen schließen' },
    { key: 'Enter', scope: 'Workspace Outliner', desc: 'Neuen Bullet-Point anlegen (oder leeren Block ausrücken)' },
    { key: 'Tab', scope: 'Workspace Outliner', desc: 'Bullet-Point einrücken (unterordnen)' },
    { key: 'Shift + Tab', scope: 'Workspace Outliner', desc: 'Bullet-Point nach links ausrücken' },
    { key: 'Shift + Enter', scope: 'Workspace Outliner', desc: 'Weicher Zeilenumbruch innerhalb des Blocks' },
    { key: 'Backspace', scope: 'Workspace Outliner', desc: 'Auf leerem Block: Block löschen; Am Anfang: Zusammenführen' },
    { key: '↑ / ↓', scope: 'Workspace Outliner', desc: 'Zum vorherigen / nächsten Block navigieren' },
    { key: 'Strg + L / Cmd + L', scope: 'Workspace Outliner', desc: 'Link einfügen (Notiz, Bullet oder Web-Link); mit markiertem Text wird er zum Linktext' },
    { key: 'Strg + Shift + ↓', scope: 'Workspace Outliner', desc: 'Alle zugeklappten Punkte der Notiz aufklappen' },
    { key: 'Strg + Shift + ↑', scope: 'Workspace Outliner', desc: 'Alle Punkte der Notiz zuklappen (im Fokus-Modus nur im Ast)' },
    { key: 'Strg + Z / Cmd + Z', scope: 'Workspace Outliner', desc: 'Letzte Notiz-Aktion rückgängig machen' },
    { key: 'Strg + Y / Strg + Shift + Z', scope: 'Workspace Outliner', desc: 'Rückgängig gemachte Aktion wiederholen' },
    { key: 'Maus über mehrere Punkte ziehen', scope: 'Workspace Outliner', desc: 'Text über mehrere Punkte markieren; Entf/Backspace löscht ihn, Tippen ersetzt ihn, Strg + C kopiert ihn als Markdown (Einrückung, To-dos, Überschriften)' },
    { key: 'Strg + A zweimal', scope: 'Workspace Outliner', desc: 'Erst den Punkt, beim zweiten Mal die ganze Notiz markieren; Strg + C kopiert sie als Markdown, eingefügt entstehen wieder dieselben Punkte' },
    { key: 'Strg + Z / Cmd + Z', scope: 'Aufgaben', desc: 'Löschen, Verschieben oder Abhaken rückgängig machen' },
    { key: '/', scope: 'Workspace Outliner', desc: 'Slash-Menü öffnen (/todo, /link, /h1, /code, ...)' },
    { key: '[] oder [ ] am Anfang', scope: 'Workspace Outliner', desc: 'Sofort in Todo-Checkbox umwandeln' },
    { key: '[x] am Anfang', scope: 'Workspace Outliner', desc: 'Sofort in erledigte Todo-Checkbox umwandeln' },
    { key: '#, ##, ### am Anfang', scope: 'Workspace Outliner', desc: 'Sofort in H1, H2 oder H3 Überschrift wandeln' },
    { key: '[[Notiztitel]]', scope: 'Workspace Outliner', desc: 'Interaktiven WikiLink zu Notiz einbetten' },
    { key: '#Tagname', scope: 'Workspace / Listen', desc: 'Inline-Hashtag für globale Vernetzung oder Kategorisierung' },
    { key: 'H oder ←', scope: 'Triage-Deck', desc: 'Gedanken verwerfen (in den Papierkorb)' },
    { key: 'L oder →', scope: 'Triage-Deck', desc: 'Gedanken sofort zur Aufgabe machen' },
    { key: 'T', scope: 'Triage-Deck', desc: 'Aufgabe mit Fälligkeitsdatum / Termin anlegen' },
    { key: 'D', scope: 'Triage-Deck', desc: 'Gedanken in Notizdokument umwandeln' },
    { key: 'Leertaste', scope: 'Triage-Deck', desc: 'Karte überspringen („Später" – ans Ende des Stapels)' },
    { key: 'Swipe links', scope: 'Triage (Touch/Mobile)', desc: 'Gedanken verwerfen' },
    { key: 'Swipe rechts', scope: 'Triage (Touch/Mobile)', desc: 'Gedanken als Aufgabe übernehmen' },
    { key: 'Gedrückt halten', scope: 'Triage (Touch/Mobile)', desc: 'Aktionsmenü öffnen (Termin, Liste, Notiz)' },
  ],
};

export default de;
