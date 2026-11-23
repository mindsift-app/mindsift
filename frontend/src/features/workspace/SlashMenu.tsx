import React from 'react';
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  ListTodo,
  ListOrdered,
  Minus,
  MessageSquare,
  Link as LinkIcon,
  TriangleAlert,
  CircleX,
  Image as ImageIcon,
  Mic,
  Shapes,
  AudioLines,
  FileOutput,
  Type,
  KeyRound,
  Table as TableIcon,
  LayoutTemplate,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { BlockType } from '../../lib/types';
import { currentVoiceConfig } from '../../lib/voice';
import { imagesAllowed } from '../../lib/media';
import { isNoteLinkOnly } from '../../lib/wikiLink';
import { slashCommandFitsText } from '../../lib/slashCommand';

// The commands of a bullet's slash menu (OutlinerBlock), which of them fit, and the menu itself

export interface SlashCommand {
  type: BlockType | 'link' | 'secret' | 'dictation' | 'extract' | 'template';
  readonly label: string;
  readonly desc: string;
  icon: React.ReactNode;
  /** Only offered in an empty bullet; the bullet turns into an inline picker first */
  media?: boolean;
  /** Further names that find the command (e.g. German ones) */
  aliases?: string[];
}

// The command name counts most: "/li" finds /link before /number (whose description says "Liste")
function slashRank(c: SlashCommand, q: string): number {
  if (!q) return 0;
  const name = c.label.slice(1).toLowerCase();
  if (name.startsWith(q)) return 0;
  if ((c.aliases || []).some((a) => a.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if ((c.aliases || []).some((a) => a.includes(q))) return 3;
  return 4;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { type: 'todo', label: '/todo', get desc() { return i18n.t('workspace:slash.todo'); }, icon: <ListTodo className="w-3.5 h-3.5" /> },
  { type: 'numbered', label: '/number', get desc() { return i18n.t('workspace:slash.numbered'); }, icon: <ListOrdered className="w-3.5 h-3.5" />, aliases: ['nummer', 'liste', 'ol'] },
  { type: 'link', label: '/link', get desc() { return i18n.t('workspace:slash.link'); }, icon: <LinkIcon className="w-3.5 h-3.5" /> },
  { type: 'bullet', label: '/text', get desc() { return i18n.t('workspace:slash.bullet'); }, icon: <Type className="w-3.5 h-3.5" />, aliases: ['p', 'paragraph', 'bullet', 'standard'] },
  { type: 'h1', label: '/h1', get desc() { return i18n.t('workspace:slash.h1'); }, icon: <Heading1 className="w-3.5 h-3.5" /> },
  { type: 'h2', label: '/h2', get desc() { return i18n.t('workspace:slash.h2'); }, icon: <Heading2 className="w-3.5 h-3.5" /> },
  { type: 'h3', label: '/h3', get desc() { return i18n.t('workspace:slash.h3'); }, icon: <Heading3 className="w-3.5 h-3.5" /> },
  // A hidden value; /secret, its name before, still finds it. After the headings, so "/h" still means /h1
  { type: 'secret', label: '/hidden', get desc() { return i18n.t('workspace:slash.secret'); }, icon: <KeyRound className="w-3.5 h-3.5" />, aliases: ['secret', 'versteckt', 'verstecken', 'geheim', 'verdeckt', 'passwort', 'password', 'oculto', 'ocultar', 'secreto', 'masquer', 'masqué', 'nascosto', 'nascondi', 'segreto'] },
  { type: 'code', label: '/code', get desc() { return i18n.t('workspace:slash.code'); }, icon: <Code className="w-3.5 h-3.5" /> },
  { type: 'table', label: '/table', get desc() { return i18n.t('workspace:slash.table'); }, icon: <TableIcon className="w-3.5 h-3.5" />, aliases: ['tabelle', 'tabla', 'tableau', 'tabella', 'grid'] },
  { type: 'callout', label: '/callout', get desc() { return i18n.t('workspace:slash.callout'); }, icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { type: 'warning', label: '/warn', get desc() { return i18n.t('workspace:slash.warning'); }, icon: <TriangleAlert className="w-3.5 h-3.5 text-status-warn" />, aliases: ['warnung', 'warning', 'achtung'] },
  { type: 'error', label: '/fail', get desc() { return i18n.t('workspace:slash.error'); }, icon: <CircleX className="w-3.5 h-3.5 text-status-err" />, aliases: ['fehler', 'error', 'danger'] },
  { type: 'divider', label: '/divider', get desc() { return i18n.t('workspace:slash.divider'); }, icon: <Minus className="w-3.5 h-3.5" /> },
  { type: 'extract', label: '/extract', get desc() { return i18n.t('workspace:slash.extract'); }, icon: <FileOutput className="w-3.5 h-3.5" />, aliases: ['notiz', 'auslagern'] },
  { type: 'image', label: '/image', get desc() { return i18n.t('workspace:slash.image'); }, icon: <ImageIcon className="w-3.5 h-3.5" />, media: true, aliases: ['bild', 'foto'] },
  { type: 'drawing', label: '/canvas', get desc() { return i18n.t('workspace:slash.drawing'); }, icon: <Shapes className="w-3.5 h-3.5" />, aliases: ['draw', 'sketch', 'diagram', 'zeichnung', 'skizze'] },
  { type: 'audio', label: '/audio', get desc() { return i18n.t('workspace:slash.audio'); }, icon: <Mic className="w-3.5 h-3.5" />, media: true, aliases: ['sprachnotiz'] },
  { type: 'dictation', label: '/diktat', get desc() { return i18n.t('workspace:slash.dictation'); }, icon: <AudioLines className="w-3.5 h-3.5" />, media: true, aliases: ['dictate'] },
  // A template's bullets (lib/noteTemplate.ts): named in the app's language, every language's name finds it
  { type: 'template', get label() { return `/${i18n.t('workspace:slash.templateName')}`; }, get desc() { return i18n.t('workspace:slash.template'); }, icon: <LayoutTemplate className="w-3.5 h-3.5" />, aliases: ['template', 'vorlage', 'plantilla', 'modèle', 'modele', 'modello'] },
];

/**
 * The commands for the typed query, best match first. restOfBlock: the bullet's text without the typed
 * "/query"; templates and extract: whether the tree offers them.
 */
export function slashCommandsFor(query: string, restOfBlock: string, { templates, extract }: { templates: boolean; extract: boolean }): SlashCommand[] {
  const q = query.toLowerCase();
  const cmdQuery = q.startsWith('code ') ? 'code' : q;
  return SLASH_COMMANDS.filter((c) => {
    const matchesQuery =
      c.label.toLowerCase().includes(cmdQuery) ||
      c.desc.toLowerCase().includes(cmdQuery) ||
      (c.aliases || []).some((a) => a.includes(cmdQuery));
    if (!matchesQuery) return false;

    // /link, /hidden and /dictation everywhere; /template where the tree offers templates (the copy goes
    // below the bullet, or replaces it when it is empty)
    if (c.type === 'link' || c.type === 'secret') return true;
    if (c.type === 'template') return templates;
    if (c.type === 'dictation') {
      return ['server', 'browser'].includes(currentVoiceConfig().mode);
    }
    // Switched off by the administration: no new images
    if (c.type === 'image' && !imagesAllowed()) return false;
    if (c.type === 'extract' && (!extract || isNoteLinkOnly(restOfBlock))) return false;

    // Type changes take the bullet's text along; divider, image, audio and drawing need an empty bullet
    return slashCommandFitsText(c.type, restOfBlock);
  }).sort((a, b) => slashRank(a, cmdQuery) - slashRank(b, cmdQuery));
}

/** The menu under the bullet's text while a "/query" is typed; index: the command Enter takes. */
export const SlashMenu: React.FC<{
  commands: SlashCommand[];
  index: number;
  menuRef: React.RefObject<HTMLDivElement | null>;
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  onApply: (cmd: SlashCommand) => void;
}> = ({ commands, index, menuRef, itemRefs, onApply }) => {
  const { t } = useTranslation('workspace');
  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-8 z-40 w-72 max-w-[calc(100vw-2rem)] panel-surface shadow-panel border border-border rounded-card p-1"
    >
      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-faint border-b border-border mb-1">
        {t('block.chooseCommand')}
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {commands.map((cmd, i) => (
          <button
            key={cmd.type}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onApply(cmd);
            }}
            className={`w-full text-left px-2 py-1 rounded-btn text-xs flex items-center justify-between transition-colors ${
              i === index
                ? 'bg-accent-dim text-accent font-semibold'
                : 'text-main hover:bg-panel-elevated'
            }`}
          >
            <div className="flex items-center gap-1.5 shrink-0">
              {cmd.icon}
              <span className="font-semibold whitespace-nowrap">{cmd.label}</span>
            </div>
            <span className="ml-3 min-w-0 truncate text-right text-[10px] opacity-75">{cmd.desc}</span>
          </button>
        ))}
        {commands.length === 0 && (
          <div className="p-2 text-center text-xs text-faint">
            {t('block.noCommand')}
          </div>
        )}
      </div>
    </div>
  );
};
