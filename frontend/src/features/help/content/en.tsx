import React from 'react';
import {
  Layers,
  FileText,
  SquareCheckBig,
  Keyboard,
  Pin,
  Sparkles,
  Command,
  Users,
  Mic,
  ShoppingCart,
  Columns2,
  Tag,
  Link as LinkIcon,
  Bell,
  Lock,
  Heading1,
  ListTodo,
  Code,
  Download,
  KeyRound,
  Shapes,
  CloudOff,
  Table as TableIcon,
  LayoutTemplate,
} from 'lucide-react';
import type { HelpContent } from './types';
import { InDesktop, NotInDesktop, Only } from './desktop';

const kbd = 'px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent';

// English help: the same cards and shortcut table as the German one (content/de.tsx)
const en: HelpContent = {
  cards: [
    // WORKSPACE & OUTLINER
    {
      id: 'workspace-architecture',
      category: 'workspace',
      title: 'Hierarchical outliner & offline sync',
      subtitle: 'Atomic storage with collaborative real-time sync',
      without: { cap: 'install', title: 'Hierarchical outliner', subtitle: 'Atomic storage, local on your computer' },
      icon: FileText,
      keywords: ['title', 'paste', 'chatgpt', 'claude', 'code', 'workspace', 'outliner', 'database', 'sqlite', 'offline', 'indexeddb', 'export', 'markdown', 'save'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            In MindSift every note is a structured, hierarchical outliner. Your notes are stored safely and versioned in the{' '}
            <strong className="text-main">SQLite database</strong> and cached in the browser via{' '}
            <strong className="text-main">IndexedDB</strong>.
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <Only can="install">
              <li>
                <strong className="text-main">Fully offline-capable:</strong> you can keep working without an internet connection;
                changes sync automatically once you are back online.
              </li>
            </Only>
            <li>
              <strong className="text-main">Title:</strong> A note title has at most 60 characters, so it fits on one line and stays a usable file name on export. Close to the limit the field shows the count.
            </li>
            <li>
              <strong className="text-main">Pasting:</strong> Text with several lines becomes separate bullets. Code copied from chat pages such as ChatGPT or Claude, or from documentation, becomes a code block with the matching language.
            </li>
            <li>
              <strong className="text-main">Markdown export:</strong> with the download icon (<Download className="w-3 h-3 inline text-accent" />) in the note header you can export the current state as a standard Markdown file (<code className="font-mono text-accent">.md</code>) to your computer at any time.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-keyboard',
      category: 'workspace',
      title: 'Keyboard use in the notes editor',
      subtitle: 'Write and structure fluently without touching the mouse',
      icon: Keyboard,
      keywords: ['keyboard', 'shortcuts', 'enter', 'tab', 'shift', 'backspace', 'outliner', 'indent', 'outdent', 'undo', 'redo', 'arrow keys'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <kbd className={kbd}>Enter</kbd> : creates a new bullet on the same level right away. At the very start of a bullet, Enter adds an empty line above it; the bullet moves down with its type and children. If the bullet is empty and indented, it moves one level to the left. After a to-do the new bullet is a to-do too (unticked, without a task of its own); Enter in an empty to-do turns it into a plain bullet.
            </li>
            <li>
              <kbd className={kbd}>Tab</kbd> : indents the current bullet to the right and places it under the previous one.
            </li>
            <li>
              <kbd className={kbd}>Shift + Tab</kbd> : outdents the bullet to the left (reduces the indentation).
            </li>
            <li>
              <kbd className={kbd}>Shift + Enter</kbd> : creates a soft line break within the same text block.
            </li>
            <li>
              <kbd className={kbd}>Backspace</kbd> : on an empty block, deletes it right away. At the start of the text, merges the block with the previous one.
            </li>
            <li>
              <kbd className={kbd}>↑ / ↓</kbd> : jumps to the previous or next block when the cursor is at the very start or end of the text.
            </li>
            <li>
              <kbd className={kbd}>Ctrl + Z</kbd> / <kbd className={kbd}>Cmd + Z</kbd> : multi-step undo for notes. Redo with <kbd className={kbd}>Ctrl + Y</kbd> or <kbd className={kbd}>Ctrl + Shift + Z</kbd>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-slash-and-autoformat',
      category: 'workspace',
      title: 'Slash commands (/) & auto-formatting',
      subtitle: 'Switch block types and format Markdown while typing',
      icon: Command,
      keywords: ['slash', 'commands', 'todo', 'link', 'h1', 'h2', 'h3', 'code', 'callout', 'warn', 'fail', 'divider', 'image', 'extract', 'merge', 'audio', 'voice note', 'dictation', 'photo', 'auto-formatting', 'hidden value', 'password'],
      content: (
        <div className="space-y-3 text-muted leading-relaxed">
          <div>
            <p className="mb-1.5">
              Type <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">/</code> in a block to open the menu of block types:
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <ListTodo className="w-3.5 h-3.5 text-accent" />
                <span>/todo (checkbox task)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <LinkIcon className="w-3.5 h-3.5 text-accent" />
                <span>/link (link a note)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <Heading1 className="w-3.5 h-3.5 text-accent" />
                <span>/h1, /h2, /h3 (headings)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <Code className="w-3.5 h-3.5 text-accent" />
                <span>/code (code block; Enter twice at the end leaves it)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">1.</span>
                <span>/number or “1. ” at the start (numbered list; Enter counts on, an empty item ends it)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <TableIcon className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/table (table with a header row)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <KeyRound className="w-3.5 h-3.5 text-accent" />
                <span>/hidden (hide a value, e.g. a password)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">💬</span>
                <span>/callout (callout box)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <span className="text-status-warn font-bold">⚠</span>
                <span>/warn, /fail (warning, error)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">—</span>
                <span>/divider (divider)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🖼️</span>
                <span>/image (upload, photograph, paste or link an image; only in an empty bullet). A copied image or screenshot can also simply be pasted into the note with Ctrl+V (Cmd+V, long-press and Paste on a phone), or on a computer image files (from the file manager, or an image from a browser tab) dragged onto a bullet: it becomes an image bullet of its own below it, an empty bullet becomes the image itself; dragged beside the bullets or onto the title, the images go to the end of the note. Drag the bottom right corner of an image to make it larger or smaller (the aspect ratio stays, at most as wide as the note); the button at the top right brings it back to the default size</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <Shapes className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/canvas (drawing with shapes, arrows, text and freehand)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">📤</span>
                <span>/extract (move the bullet with all sub-bullets into a new or an existing note, chosen as with the button, leaving a [[link]] in its place; the “Pull note back” button at the link undoes it)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🎙️</span>
                <span>/audio (record a voice note: the green button starts, the red one saves; or upload an audio file)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🗣️</span>
                <span>/diktat (speak instead of typing: starts right away, tapping “Stop” puts the text into the bullet)</span>
              </div>
              <div className="p-1.5 bg-panel rounded-sm border border-border flex items-center gap-1.5 text-main col-span-2">
                <LayoutTemplate className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/template or /vorlage (insert the content of one of your templates here)</span>
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <span className="font-semibold text-main block mb-1">Hidden values (/hidden, also /secret):</span>
            <p className="text-xs">
              They keep values like passwords off the screen and out of shared or public notes; they are not a password manager. The text only shows ••••, and a click shows the value for a moment, to everyone who may see the note (never through a public link). Copy the bullet into another note and that note gets its own copy of the value.
            </p>
          </div>
          <div className="pt-2 border-t border-border">
            <span className="font-semibold text-main block mb-1">Instant formatting while writing:</span>
            <ul className="space-y-1 text-xs">
              <li><code className="text-accent font-mono">[] </code> or <code className="text-accent font-mono">[ ] </code> at the start of a line turns it into a to-do checkbox right away.</li>
              <li><code className="text-accent font-mono">[x] </code> turns it into a checked to-do checkbox.</li>
              <li><code className="text-accent font-mono"># </code>, <code className="text-accent font-mono">## </code> or <code className="text-accent font-mono">### </code> at the start of a line formats the block as a heading right away.</li>
            </ul>
          </div>
        </div>
      ),
    },
    // WORKSPACE: DRAWINGS
    {
      id: 'workspace-drawings',
      category: 'workspace',
      title: 'Drawings (/canvas)',
      subtitle: 'Sketches, flowcharts and mind maps right in the note',
      icon: Shapes,
      keywords: ['drawing', 'canvas', 'sketch', 'diagram', 'flowchart', 'mind map', 'sequence diagram', 'state diagram', 'arrow', 'shapes', 'freehand', 'grid', 'mermaid', 'live', 'draw along', 'draw together'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Creating one:</strong> Type <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">/canvas</kbd> (or <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">/draw</kbd>, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">/sketch</kbd>) in an empty bullet; the editor opens full screen. Esc or “Done” saves and closes it.
            </li>
            <li>
              <strong className="text-main">Tools:</strong> Select <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">V</kbd>, pan <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">H</kbd> (or hold the space bar), rectangle <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">R</kbd>, ellipse <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">O</kbd>, diamond <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">D</kbd>, arrow <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">A</kbd>, freehand <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">P</kbd>, text <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">T</kbd>, eraser <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">E</kbd>. With Shift, rectangles and ellipses become squares and circles; <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">G</kbd> turns the snapping grid on and off. Set line colour, fill, width and dashes on the selected shape.
            </li>
            <li>
              <strong className="text-main">Text and arrows:</strong> Double-click (or Enter) a shape to write text into it, double-click an arrow to give it a label such as “yes” or “no”. Arrows dock to shapes and follow them when they move; they run straight, curved or elbowed. For elbowed arrows, choose where they dock by dragging the end onto a side of the shape (it snaps to the middle); every stretch has a handle to move it, a double-click on a full handle removes the stretch. Docked arrows come loose only by their end.
            </li>
            <li>
              <strong className="text-main">Editing:</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Ctrl + Z</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Ctrl + Y</kbd> undo and redo, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Ctrl + D</kbd> duplicates, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Ctrl + C</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Ctrl + V</kbd> copy and paste, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Del</kbd> deletes, the arrow keys nudge the selection.
            </li>
            <li>
              <strong className="text-main">In the note:</strong> The drawing fills the width of the note. Click into it, then dragging moves the view and Ctrl + mouse wheel or two fingers zoom; the wheel alone keeps scrolling the page. Another click ends this, a view not saved glides back. Drag the lower edge to change the height. “Save view” keeps section, zoom and height for everyone, The size button switches between the recommended size and “all large” (tall drawings) or the recommended height to move sideways (wide drawings). Double-click or “Edit” opens the editor; it starts with the hand (only the view moves), choose another tool to change things. The button with the arrows next to “Done” leaves without saving and asks first if there are changes.
            </li>
            <Only can={['sharing', 'liveDrawing']}>
              <li>
                <strong className="text-main">Drawing together:</strong> Whoever opens a drawing draws alone; the others see the bullet locked (“… is editing”) and can only look at the drawing. In shared notes, “Draw together” at the top of the editor starts a live drawing with what is there so far (on phones the people icon); whoever starts it is the host, and the note shows “Live drawing: …”. Whoever opens it then chooses “Draw along” or “Watch” and sees the others' shapes, pointers and selections in their colour, with everyone taking part at the top of the editor. The host saves with “Done” for everyone; the others have “Leave”. Closing without saving while others draw along only leaves the drawing, also for the host: whoever has been there longest takes over. Only the last one to go discards (asked first when there are changes) and can bring it back with “Undo” for a few seconds afterwards. Undo only takes back your own changes. Drawing together needs a WebSocket connection; without one (some company proxies) you can watch live.
              </li>
            </Only>
            <li>
              <strong className="text-main">Offline and drafts:</strong> What you draw offline is saved once the connection is back; an unsaved draft is offered for restoring the next time you open the drawing. If everyone leaves a live drawing without “Done”, the server keeps its state for about 10 minutes; whoever chooses “Draw together” again within that time carries on.
            </li>
            <li>
              <strong className="text-main">Everywhere:</strong> Search finds the words in drawings, copy and paste keeps the drawing, and the Markdown export contains it as an SVG picture (importing turns it back into a drawing). AI agents (MCP) read a description of the drawing and can create drawings themselves from Mermaid: flowcharts, mind maps, sequence and state diagrams, and Git graphs.
            </li>
          </ul>
        </div>
      ),
    },
    // WORKSPACE: TABLES
    {
      id: 'workspace-tables',
      category: 'workspace',
      title: 'Tables (/table)',
      subtitle: 'Rows and columns right in the note',
      icon: TableIcon,
      keywords: ['table', 'rows', 'columns', 'header', 'lines', 'frame', 'align', 'center', 'markdown'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Creating one:</strong> Type <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">/table</kbd> in a bullet: a table with 2 columns and 2 rows appears, text already in the bullet goes into the first cell. The first row is the header (bold).
            </li>
            <li>
              <strong className="text-main">Typing:</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Enter</kbd> moves into the row below while that one is still empty, otherwise it adds a row below the current one, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Tab</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Shift + Tab</kbd> jump from cell to cell (Tab in the last cell adds a row), the arrow keys change rows and leave the table at the top and bottom. <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Backspace</kbd> in an empty row deletes it, in a completely empty table the table. <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Enter</kbd> in an empty last row removes it and adds a new bullet below the table. Bold, italics, links and #hashtags work as in text.
            </li>
            <li>
              <strong className="text-main">Columns2:</strong> The <strong className="text-main">+</strong> right of the table adds a column (on a desktop it shows while the mouse is over the table). Below it, the three dots open the menu: align the column with the cursor left, centered or right (kept in the Markdown table), insert a column left or right, delete the row or column with the cursor, indent or outdent the bullet.
            </li>
            <li>
              <strong className="text-main">Lines:</strong> In the same menu: <em>Default</em> shows only the inner lines, fading out towards the edge, without a frame; <em>Full frame</em> every line with an outer frame (corners as in the theme); <em>Header row and columns</em> only the line below the header and the column lines.
            </li>
            <li>
              <strong className="text-main">Phone:</strong> Wide tables scroll sideways, the page stays put. Cells, the + and the three dots are big enough to tap.
            </li>
            <li>
              <strong className="text-main">Everywhere:</strong> Copying, pasting, the Markdown export and AI agents (MCP) see the table as a Markdown table; pasted Markdown tables and tables from spreadsheets become a table again.
            </li>
          </ul>
        </div>
      ),
    },
    // WORKSPACE: TEMPLATES
    {
      id: 'workspace-templates',
      category: 'workspace',
      title: 'Templates (/template)',
      subtitle: 'Start recurring notes from a template',
      icon: LayoutTemplate,
      keywords: ['template', 'templates', 'vorlage', 'pattern', 'meeting', 'weekly plan', 'placeholder', 'date'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Create a template:</strong> Any note can be a template. Write it as usual and choose “Use as template” in the note’s ⋯ menu (“No longer a template” undoes it). You decide where it lives; a folder “Templates” keeps them together. A small mark in the folder tree and next to the title shows that it is a template.
            </li>
            <li>
              <strong className="text-main">Insert:</strong> Type <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">/template</kbd> (or <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">/vorlage</kbd>) in a bullet and choose the template; the search helps when there are many. Its content goes in like pasted bullets: an empty bullet becomes the template’s first bullet, otherwise it follows below the bullet on its level. Headings, code, tables, drawings, pictures and hidden values come along; to-do checkboxes start open and are not linked to any task.
            </li>
            <li>
              <strong className="text-main">New note:</strong> If you have templates, “New note” asks for name, emoji and template; the new note starts with the template’s content. Without templates the desktop creates the note at once, as before.
            </li>
            <li>
              <strong className="text-main">Placeholders:</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">{'{{date}}'}</kbd> (or <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">{'{{datum}}'}</kbd>) becomes today’s date when inserted, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">{'{{title}}'}</kbd> (or <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">{'{{titel}}'}</kbd>) the note’s title. In code blocks and drawings they stay as they are.
            </li>
            <li>
              <strong className="text-main">Personal:</strong> Templates are your own choice: you can use any note you may read as a template, also one shared with you. Others do not see your choice, and a shared note is no template for them just because you use it as one.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-wikilinks-tags',
      category: 'workspace',
      title: 'WikiLinks ([[...]]), hashtags (#) & tag pages',
      subtitle: 'Link knowledge both ways and filter by topic',
      icon: Tag,
      keywords: ['wikilinks', 'links', 'linking', 'hashtags', 'tags', 'filter', 'keywords'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Notes and thoughts can be linked with each other in many ways in MindSift:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Wiki links:</strong> With <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded-sm font-mono text-[11px] text-accent">Ctrl + L</kbd> or <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">/link</code> you link another note or a single bullet; a click opens it. The link always shows the note's current title and keeps working when you rename or move it, even with two notes of the same name. Text you mark first becomes the link text. By hand, <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">[[Note name]]</code> works too. If the linked note no longer exists, a click asks whether to create it or remove the link.
            </li>
            <li>
              <strong className="text-main">Hashtags:</strong> type <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">#project</code> or <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">#important</code> anywhere in the text. Hashtags are highlighted in color and indexed.
            </li>
            <li>
              <strong className="text-main">“Tags & filters” view:</strong> the tag overview is in the workspace tabs at the top. It shows all hashtags in use, lets you search their places across all documents and even keep free notes on tag pages.
            </li>
            <li>
              <strong className="text-main">Hashtags in the folder sidebar:</strong> a click on a hashtag below the folders filters the tree: only notes with that hashtag stay, their folders open, all others are hidden. Several selected hashtags show the notes that contain all of them; a second click takes one out again, the red ✕ next to “Hashtags” clears the filter. While it is on, the bar above the trash glows faintly red; a reload removes it.
            </li>
            <li>
              <strong className="text-main">Backlinks:</strong> at the end of every note, “Linked to this note” shows which other notes link to it with <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">[[title]]</code>. Clicking a place jumps right there.
            </li>
            <li>
              <strong className="text-main">Trash:</strong> you delete your own notes with ⋯ → “Delete note” or the trash button that appears when you hover over a note in the folder bar (on a phone, on the note that is open; it asks first). Deleted notes (also from deleted folders) land in the “Trash” at the bottom of the folder bar or in the mobile menu. There you can view them read-only, restore them or delete them for good. While a note is in the trash, the people it was shared with do not see it either. After the period set in Account settings → Retention (default 30 days) it is deleted for good. Deleted tasks are in the “Trash” tab of the tasks, discarded thoughts in the triage trash.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-zoom-drag',
      category: 'workspace',
      title: 'Zoom hoisting, drag & drop and favorites',
      subtitle: 'Keep focus and sort notes freely',
      icon: Pin,
      keywords: ['another note', 'extract', 'hoisting', 'zoom', 'drag', 'drop', 'folders', 'move', 'pin', 'breadcrumbs'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Zoom hoisting:</strong> click right on the bullet (<code className="text-accent">•</code>) of a block to zoom into that branch alone. The breadcrumb navigation at the top leads you back step by step at any time; on phones the house icon there takes you to the start of the note, and the back button goes up one level.
            </li>
            <li>
              <strong className="text-main">Moving blocks:</strong> grab a bullet with the mouse button held down to drag it to a new spot. An expanded bullet moves alone: its sub-bullets stay where they are and move up into its place. A collapsed bullet takes all its sub-bullets along. It takes the level of the bullet you drop it in front of and becomes its sibling; the line with the dot shows that level before you let go. Dragged below the last bullet, it goes to the end on the top level. Move the mouse further right to drop it deeper, as far as the last sub-bullet of the bullet above. Ctrl+Z undoes the move in one step.
            </li>
            <li>
              <strong className="text-main">Into another note:</strong> drag the bullet onto a note in the sidebar and the whole branch moves to the end of that note. Dropped onto the plus for a new note at the top of the sidebar, it becomes a new note of its own. The hint afterwards offers “Open” and “Undo”, Ctrl+Z works as well; linked tasks move along.
            </li>
            <li>
              <strong className="text-main">Moving out:</strong> the “Turn into its own note” button on the right of a bullet asks where to: Enter creates a new note, typing finds an existing one. A link to the moved bullet stays in its old place.
            </li>
            <li>
              <strong className="text-main">Folder navigation:</strong> notes in the file explorer on the left can be sorted into subfolders by drag & drop.
            </li>
            <li>
              <strong className="text-main">Pinned favorites:</strong> the pin icon keeps important notes at the very top of the explorer.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-collab-locks',
      category: 'workspace',
      title: 'Real-time collaboration, locks & conflicts',
      subtitle: 'Work together without overwriting each other by accident',
      icon: Lock,
      keywords: ['collaboration', 'locks', 'lock', 'conflicts', 'live', 'presence', 'sharing'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>MindSift supports working on documents together with built-in protection against data loss:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Block locks:</strong> while someone edits a bullet, it shows a lock icon and the user's name. Others cannot overwrite that bullet for the moment.
            </li>
            <li>
              <strong className="text-main">Conflict copies:</strong> if changes happen at the same time or offline, the server never silently overwrites your input. Instead a conflict block highlighted in yellow appears right under the original bullet, with three buttons: <em>“Use”</em> replaces the original text (Ctrl+Z undoes it), <em>“Keep both”</em> only takes the marking off and leaves both bullets, <em>“Discard”</em> deletes the copy. While someone is editing the original bullet, “Use” is greyed out and a line below says who holds it. Until you decide, the copy sticks to its bullet: Enter in the original adds the new bullet below the copy, and indenting or moving takes it along.
            </li>
            <li>
              <strong className="text-main">Connection indicator:</strong> next to the note title you always see the connection mode (e.g. <em>Live</em>, <em>long polling</em> or <em>Offline</em>).
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-global-todos',
      category: 'workspace',
      title: 'Global to-do rollup & task links',
      subtitle: 'All open to-dos from all notes in one place',
      icon: SquareCheckBig,
      keywords: ['rollup', 'todos', 'checkboxes', 'enhanced task', 'global', 'tasks'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            The workspace tab <strong className="text-main">“To-dos”</strong> automatically collects all unchecked checkboxes (<code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">- [ ]</code>) from all your notes.
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Two-way sync:</strong> check off a to-do in the global list and the block in the source note updates in real time.
            </li>
            <li>
              <strong className="text-main">Linked tasks (enhanced tasks):</strong> selected note to-dos can also be kept as full tasks in the tasks and Kanban area.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-search-cmdk',
      category: 'workspace',
      title: 'Global search & command palette (Cmd+K)',
      subtitle: 'FTS5 full-text search in notes, blocks, tasks and lists',
      icon: Command,
      keywords: ['search', 'command', 'palette', 'cmdk', 'find', 'fts', 'full text', 'keyboard'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Press <kbd className={kbd}>Cmd + K</kbd> / <kbd className={kbd}>Ctrl + K</kbd> or <kbd className={kbd}>/</kbd> (when no text field is active) to open the global search:
          </p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>
              <strong className="text-main">Full-text search (FTS5):</strong> searches note titles and blocks, tasks and list items in no time, with relevance ranking (BM25) and prefix search.
            </li>
            <li>
              <strong className="text-main">Security:</strong> only shows content you actually have access to (your own as well as shared notes, task lists and lists).
            </li>
            <li>
              <strong className="text-main">Keyboard navigation:</strong> browse with <kbd className={kbd}>↑</kbd> and <kbd className={kbd}>↓</kbd>, open a result with <kbd className={kbd}>Enter</kbd> (notes open right at the found block).
            </li>
          </ul>
        </div>
      ),
    },

    // TRIAGE & QUICK DUMP
    {
      id: 'triage-capture',
      category: 'triage',
      title: 'Instant capture bar',
      subtitle: 'Hold on to thoughts in under a second – by keyboard or voice',
      icon: Layers,
      keywords: ['date', 'due', 'tomorrow', 'time', 'capture', 'quick capture', 'dictation', 'voice', 'microphone', 'inbox', 'c'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>The Quick Dump makes sure no fleeting thought gets lost. On the desktop the round <strong className="text-main">+</strong> in the bar on the left opens it as a window over everything, on phones the <strong className="text-main">+</strong> at the bottom centre:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">From the keyboard:</strong> press <kbd className={kbd}>C</kbd> anywhere in the app (unless you are typing in a text field). <kbd className={kbd}>Enter</kbd> saves and the window stays open for the next thought; <kbd className={kbd}>Esc</kbd> or a click beside it closes it.
            </li>
            <li>
              <strong className="text-main">Voice dictation:</strong> click the microphone icon (<Mic className="w-3.5 h-3.5 inline text-accent" />) for continuous voice input. Spoken thoughts get the tag <code className="text-accent font-mono">#diktat</code> automatically. On a phone you can also press and hold the round <strong className="text-main">+</strong> button in the bottom bar to speak right away, and on the desktop the round <strong className="text-main">+</strong> in the left rail: when you let go, the text lands in the inbox; a short tap or click still opens the input. Slide up or away from the button while holding and the recording locks (as in WhatsApp): it keeps running without holding, and a tap or click on the red button with the stop symbol ends it. The small <strong className="text-main">×</strong> on its corner discards the current recording without asking, on the desktop <kbd className={kbd}>Esc</kbd> does too. With your own Whisper server you can hold the <strong className="text-main">+</strong> again right away while earlier dictations are still being recognised: they are saved in the order you spoke them, and a small number on the <strong className="text-main">+</strong> shows how many are still waiting. If one fails, the recording is kept until the page is reloaded, and the hint beside it offers <strong className="text-main">Try again</strong>. A date in the dictation ("dentist tomorrow at 2pm") becomes the due date and is taken out of the text, as when typing; the hint afterwards names it (<em>Due: Tomorrow, 14:00</em>), and <strong className="text-main">Undo</strong> keeps the text as you spoke it, without a due date.
            </li>
            <li>
              <strong className="text-main">Choosing the target:</strong> thoughts land in the inbox by default. With the options you can route them right away as a <strong className="text-main">task</strong> (with priority and due date), a <strong className="text-main">list item</strong> (e.g. on the shopping list) or a <strong className="text-main">new note</strong>.
            </li>
            <li>
              <strong className="text-main">Dates in the text:</strong> type “Dentist tomorrow 2pm” and the Quick Dump spots the date: the phrase is marked in the field and a chip shows <em>Tomorrow, 14:00</em>. Saving takes it out of the text and makes it the due date; the <strong className="text-main">×</strong> on the chip keeps the text as it is, without a date. It understands <em>today</em>, <em>tomorrow</em>, <em>day after tomorrow</em>, weekdays (<em>Friday</em>, <em>on Friday</em>, <em>next Tuesday</em>; today’s weekday means the one a week from now), <em>in 3 days</em>, <em>in a week</em>, <em>Dec 24</em>, <em>24 December</em>, <em>2026-12-24</em> and times such as <em>2pm</em>, <em>2:30 pm</em>, <em>14:30</em> or <em>at 9</em> (09:00), also together (“Friday at 9am”). A time alone means today if it is still ahead, otherwise tomorrow. A date picked in the date field wins. It works for the inbox and direct tasks, after dictation too, in the language of the app. If you would rather not, switch it off under <em>Account settings → Language → Recognize dates and quantities while typing</em>; then text stays as you typed it, dictation included, on all your devices.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'triage-deck-decisions',
      category: 'triage',
      title: 'Triage deck: decide with one key or swipe',
      subtitle: 'Work through the inbox in record time and keep a clear head',
      icon: Sparkles,
      keywords: ['triage', 'deck', 'h', 'l', 't', 'd', 'space', 'swipe', 'trash', 'gestures'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>The triage deck presents every collected thought card by card. You decide in a flash:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2.5 bg-panel border border-border rounded-sm">
              <span className="font-semibold text-main block mb-1">Keyboard (desktop):</span>
              <ul className="space-y-1 font-mono text-[11px]">
                <li><strong className="text-status-err">H</strong> or <strong>←</strong> : discard (trash)</li>
                <li><strong className="text-accent">L</strong> or <strong>→</strong> : create as a task</li>
                <li><strong className="text-main">T</strong> : with due date</li>
                <li><strong className="text-main">D</strong> : turn into a workspace note</li>
                <li><strong className="text-muted">Space</strong> : later (to the end of the stack)</li>
              </ul>
            </div>
            <div className="p-2.5 bg-panel border border-border rounded-sm">
              <span className="font-semibold text-main block mb-1">Swipe gestures (touch & mobile):</span>
              <ul className="space-y-1 text-xs">
                <li><strong className="text-status-err">Swipe left:</strong> discard</li>
                <li><strong className="text-accent">Swipe right:</strong> take over as a task</li>
                <li><strong className="text-main">Press and hold:</strong> open the menu (date, list, note)</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'triage-webhooks',
      category: 'triage',
      title: 'API: curl, smart home & AI agents (MCP)',
      subtitle: 'Read and change tasks and lists via curl or Home Assistant, deliver thoughts, connect AI agents like Claude Code.',
      without: { cap: 'publicAddress', title: 'API: curl & AI agents (MCP)', subtitle: 'Read and change tasks and lists via curl, deliver thoughts, connect AI agents like Claude Code.' },
      icon: Bell,
      keywords: ['webhooks', 'api', 'token', 'home assistant', 'siri', 'shortcuts', 'automation', 'curl', 'mcp', 'ai', 'agent', 'claude', 'codex'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            MindSift has an API. Under <em className="text-main">Account settings → API</em> you create personal keys and use switches to decide what each may do: read, create or change tasks, lists, notes and the inbox. These permissions apply to both kinds of access alike; notes as well as reading and sorting the inbox are available over MCP only. A key never reaches settings.
          </p>
          <InDesktop>
            <p>
              <strong className="text-main">In the desktop app:</strong> the API is at first only there for the app itself. Under <em className="text-main">Account settings → API</em> switch on “Reachable for local programs”, and programs on this computer reach MCP and the REST API at <code className="font-mono">127.0.0.1</code> (the port and ready examples are shown there). It is not reachable from the network, e.g. from Home Assistant on another device, and there is no connection via claude.ai or ChatGPT.
            </p>
          </InDesktop>
          <p>
            <strong className="text-main">curl and smart home:</strong> with read access, <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">GET /api/v1/tasks?due=today&amp;status=open</code> returns everything due today, e.g. for a Home Assistant sensor. More filters: <code className="font-mono">due=overdue</code>, a date, <code className="font-mono">taskListId</code>. Lists come via <code className="font-mono">GET /api/v1/lists</code>. With change access you check things off via <code className="font-mono">PATCH /api/v1/thoughts/ID</code>. The settings show ready-made examples.
          </p>
          <p>
            <strong className="text-main">Delivering:</strong> <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">POST /api/v1/webhooks/ingest</code> accepts thoughts from iOS Shortcuts, Home Assistant or n8n. The field <code className="font-mono">"target"</code> chooses the target: <code className="font-mono">triage</code> (default), <code className="font-mono">task</code> (optionally with <code className="font-mono">taskListId</code>) or <code className="font-mono">list_item</code> (with <code className="font-mono">listId</code>).
          </p>
          <p>
            <strong className="text-main">AI agents:</strong> over MCP (<code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">POST /api/v1/mcp</code>), Claude Code, OpenAI Codex, Claude Desktop, Cursor and your own agents read, create, change, check off and delete your tasks, lists and notes and sort the inbox. The settings show the ready command for every agent; an agent only sees the tools the key allows. An agent adds images (e.g. one it generated or a screenshot) to a note as a bullet of their own: as a file or from an https address that MindSift copies into the note (JPEG, PNG, GIF, WebP). In notes, agents also add code blocks with a language and dividers, move bullets with their children (indent and outdent too) and, like /extract, turn a bullet into a note of its own with a link in its place.
          </p>
          <p>
            <strong className="text-main">Origin:</strong> whatever a key creates or changes carries a badge with its name for good, starting with a webhook icon (API) or a robot (MCP). Hover or tap it to see who created it and last changed it, and when.
          </p>
        </div>
      ),
    },

    // TASKS & KANBAN
    {
      id: 'tasks-kanban',
      category: 'tasks',
      title: 'List view & flexible Kanban board',
      subtitle: 'Visualize tasks and steer them with custom columns',
      icon: Columns2,
      keywords: ['tasks', 'kanban', 'board', 'columns', 'drag', 'drop', 'lists'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Tasks can be managed in a classic <strong className="text-main">list view</strong> or on the interactive{' '}
            <strong className="text-main">Kanban board</strong>:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Switching views:</strong> on the desktop the switch at the top right changes between list, Kanban and calendar. On a phone the small pill next to the task list shows the view; tap it to move on (Kanban → calendar → list). Open, done and trash are chosen in the list view with the switch at the top of the list.
            </li>
            <li>
              <strong className="text-main">Custom Kanban columns:</strong> in the column settings you define individual stages for every task list (e.g. <em>Backlog</em>, <em>In progress</em>, <em>Review</em>, <em>Done</em>) including colors and done status.
            </li>
            <li>
              <strong className="text-main">Drag & drop:</strong> drag task cards between the columns with ease. Moving one into a done column checks the task off automatically.
            </li>
            <li>
              <strong className="text-main">Type the date along:</strong> in the field for a new task (on phones in the sheet behind the +) “Report Friday at 9am” makes a task “Report” due Friday at 09:00. The chip at the field shows the recognised date and its × drops it; a date picked in the date field wins. Which forms are understood is listed under <em>Instant capture bar</em>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'tasks-details-alarms',
      category: 'tasks',
      title: 'Subtasks, due dates & automatic alarms',
      subtitle: 'Checklists with a progress bar, Markdown notes and notifications',
      icon: SquareCheckBig,
      keywords: ['subtasks', 'alarms', 'notifications', 'mail', 'discord', 'date', 'due date', 'time zone', 'priority', 'assign', 'assigned', 'calendar', 'subscription', 'ical'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Subtasks:</strong> create a checklist within any task with a visible progress bar (e.g. “3 of 5 done”). The handle on the left reorders subtasks with mouse or finger, the arrow keys do it by keyboard.
            </li>
            <li>
              <strong className="text-main">New task in a Kanban column:</strong> “Add task” at the bottom of the column opens the task window right away with column and list filled in; just type the title. Close the window without a title and the empty task disappears again.
            </li>
            <li>
              <strong className="text-main">Priorities & notes:</strong> set priorities (<em className="text-accent">Urgent</em>, <em className="text-main">Important</em>, <em>Normal</em>) and add detailed Markdown notes.
            </li>
            <Only can="sharing">
              <li>
                <strong className="text-main">Assigning:</strong> in shared task lists you assign a task to one or more people with access (type a name, Enter). The assignees appear as small profile pictures on the task; whoever loses access to the list is removed automatically.
              </li>
            </Only>
            <li>
              <strong className="text-main">Recurring tasks:</strong> choose a repeat in the detail window (daily, weekdays from Monday to Friday, weekly, monthly or yearly). Checking it off creates the next task automatically in the rhythm of the old date; checked off late, the missed dates are skipped (daily, due Saturday, checked off Monday: the next one is due Tuesday). You recognize it by the 🔁 icon.
            </li>
            <li>
              <strong className="text-main">Due date with time:</strong> in the detail window you can set a time next to the date; “✕ Time” makes the task all-day again. It shows e.g. “Today, 14:30”, overdue items in red.
            </li>
            <NotInDesktop>
              <li>
                <strong className="text-main">Automatic alarms:</strong> at the due time (all-day tasks at 9:00, minus your advance warning) MindSift notifies you by <strong className="text-main">email</strong>, <strong className="text-main">Discord webhook</strong> or your own HTTP webhook. Move the due date or reopen the task and the alarm comes again. Configurable in your account settings. Email alarms go to your sign-in address. A new sign-in address counts only once you click the link in the confirmation e-mail sent to it; until then the previous one stays. All times are in the server's time zone, which a server admin sets under <em>Administration → Instance</em>.
              </li>
            </NotInDesktop>
            <InDesktop>
              <li>
                <strong className="text-main">Automatic alarms:</strong> at the due time (all-day tasks at 9:00, minus your advance warning) MindSift notifies you by <strong className="text-main">system notification</strong> (clicking it opens the task), <strong className="text-main">Discord webhook</strong> or a custom HTTP webhook, as long as the desktop app is running. If you move the due date or reopen the task, the alarm fires again. Configurable in your account settings under “Alarms”. All times use the instance’s time zone, which you set under <em>Administration → Instance</em> (otherwise the system’s).
              </li>
            </InDesktop>
            <li>
              <strong className="text-main">Reminders per task:</strong> In the detail window, tick one or more times under “Reminder”, e.g. 2 weeks before and on the due day. For this task they replace your lead time and apply to everyone who gets its due alarm; “Default” goes back to the lead time from the settings. Without a time, MindSift reminds whole days ahead at 9 am. Tasks with their own reminders carry a small 🔔.
            </li>
            <NotInDesktop>
              <li>
                <strong className="text-main">More notifications:</strong> When someone assigns a task to you, a new task lands in a shared list or one there is completed, MindSift can let you know; switch each event on or off in the settings under “Alarms”. Tasks you <strong className="text-main">watch</strong> report every change (status, priority, due date, text, description, subtasks, assignment …), also when they are ticked in a note. MindSift never notifies you about what you did yourself. Several events arrive bundled in one message. The <strong className="text-main">bell</strong> (desktop: at the bottom of the bar on the left; phones: next to search) collects everything of the last 14 days, even without any channel switched on; click an entry to open the task or note.
              </li>
            </NotInDesktop>
            <InDesktop>
              <li>
                <strong className="text-main">More notifications:</strong> The <strong className="text-main">bell</strong> (at the bottom of the bar on the left) collects the last 14 days of notices, such as due tasks; a click on an entry opens the task or note. Tasks you <strong className="text-main">watch</strong> also report your own changes if you switch that on in the settings under “Alarms”.
              </li>
            </InDesktop>
            <Only can="publicAddress">
              <li>
                <strong className="text-main">Calendar subscription:</strong> Under <em className="text-main">Account settings → Calendar subscription</em> you get a secret link to subscribe to in Google Calendar, Apple Calendar, Thunderbird or Outlook. It shows your open tasks with a due date and those of shared task lists (due from 30 days ago up to a year ahead): all-day tasks as all-day events, tasks with a time as 30-minute events, repeating tasks with their next date. The calendar only shows them, you edit in MindSift; calendar apps fetch the subscription only every few hours. Anyone who knows the link sees your tasks: “Create new link” invalidates the old one, switching off deletes it.
              </li>
            </Only>
            <Only can="sharing">
              <li>
                <strong className="text-main">@-mentions:</strong> In a task's description, in subtasks and in notes, <strong className="text-main">@</strong> opens a list of people (arrow keys, Enter). People without access are shown greyed out. The person mentioned gets a notification (Settings → Alarms, “I was mentioned”), even from a muted list; saving again does not send a second one.
              </li>
            </Only>
            <Only can="sharing">
              <li>
                <strong className="text-main">List menu (⋯):</strong> On the right above the list: <strong className="text-main">Mute</strong> (shared lists only: no notifications from this list, assignments, mentions and watched tasks still come), Share, Rename and Delete. If not all lists fit in the row, the rest are behind “⋯ n”. In a shared list a new task is first assigned to you; the due alarm goes to the people assigned, or to every member if nobody is.
              </li>
            </Only>
            <Only not="sharing">
              <li>
                <strong className="text-main">List menu (⋯):</strong> On the right above the list: Rename and Delete. If not all lists fit in the row, the rest are behind “⋯ n”.
              </li>
            </Only>
            <li>
              <strong className="text-main">Calendar:</strong> A third view next to list and Kanban: month or week on the desktop, the week on phones. Tasks without a date are under “Unscheduled”; drag one onto a day to set its date (a time stays), back to “Unscheduled” to remove it, <strong className="text-main">Ctrl + Z</strong> takes it back. Repeating tasks also show their coming dates, greyed with ↻. A column on the left switches between the chosen day (today until you click one) with its tasks and the unscheduled tasks. ← → leaf through, T jumps to today. On the desktop Monday to Friday fill the width; scroll sideways or use “Sat – Sun ›” for the weekend. Month or week is at the right of the hashtags; one wheel step scrolls the bars above away.
            </li>
          </ul>
        </div>
      ),
    },

    // LISTS & SHOPPING
    {
      id: 'lists-shared-shopping',
      category: 'lists',
      title: 'Lists, quantities & hashtag categories',
      subtitle: 'Shopping lists, packing lists and checklists',
      icon: ShoppingCart,
      keywords: ['lists', 'shopping', 'groceries', 'checklist', 'quantities', 'categories', 'hashtag', 'realtime', 'suggestions'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <Only can="sharing">
            <p>Shared lists are perfect for shopping, packing lists and errands together:</p>
          </Only>
          <Only not="sharing">
            <p>
              Lists are perfect for shopping, packing lists and errands:
            </p>
          </Only>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Type the quantity along with it:</strong> With <code className="text-accent font-mono">2x organic milk</code>, <code className="text-accent font-mono">500g pasta</code>, <code className="text-accent font-mono">3 apples</code> or <code className="text-accent font-mono">tomatoes 2 cans</code> the field marks the quantity and fills it into the quantity field right away; a small speech bubble at the quantity field points it out. When you add the item, the name goes onto the list without it. Tap the × in the bubble or empty the quantity field to keep the text as typed; a quantity you type into the field yourself wins. Recognized are a number with x, a number with a unit (g, kg, l, ml, pcs, pack, can, bottle, bunch …) and a number at the start. A number at the end without a unit belongs to the name (<code className="text-accent font-mono">iPhone 15</code>, <code className="text-accent font-mono">cola 0.5</code>), and so does one attached to a word (<code className="text-accent font-mono">7up</code>). The quantity field takes units too, such as <code className="text-accent font-mono">500 g</code>. The switch <em>Recognize dates and quantities while typing</em> under Account settings → Language turns this off as well.
            </li>
            <li>
              <strong className="text-main">Categories by hashtag:</strong> add a hashtag like <code className="text-accent font-mono">#fridge</code> or <code className="text-accent font-mono">#vegetables</code>. The list groups the items into matching sections automatically.
            </li>
            <li>
              <strong className="text-main">Suggestions while typing:</strong> from two letters on, the list shows below the field what you have added here before, also items checked and cleared long ago: first what starts that way, then what contains it, frequent and recent purchases first. Items already open on the list are left out. Tap one, or pick it with the arrow keys and Enter, to add it with its hashtag; Escape closes the suggestions, and typing on works as before. While you type a #hashtag, the hashtag suggestions show instead. <Only can="sharing">{' '}Shared lists share one history; it works offline too and goes when the list is deleted.</Only>
            </li>
            <Only can="sharing">
              <li>
                <strong className="text-main">Live sync & clearing checked items:</strong> checked items sync in real time and show who checked them. The clear button removes checked items all at once.
              </li>
            </Only>
            <Only not="sharing">
              <li>
                <strong className="text-main">Clearing checked items:</strong> The clear button removes checked items all at once.
              </li>
            </Only>
          </ul>
        </div>
      ),
    },

    // APPEARANCE: CUSTOM THEMES
    {
      id: 'workspace-custom-themes',
      category: 'account',
      title: 'Appearance & custom themes',
      subtitle: 'Pick a ready design or upload your own CSS theme',
      icon: Sparkles,
      keywords: ['theme', 'design', 'colors', 'css', 'dark', 'light', 'appearance'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Switching themes:</strong> in the profile menu (your profile picture, on the desktop at the bottom of the bar on the left) or under <em>Account settings → Appearance &amp; themes</em>.
            </li>
            <li>
              <strong className="text-main">Custom themes:</strong> under <em>Custom themes</em>, “+” creates a theme with the colours of the template; its name and colour tiles can be changed right in the row (applied at once while the theme is active), and export downloads it as a <code className="text-accent bg-panel px-1 py-0.5 rounded-sm font-mono">.css</code> file that can be imported again and shared. Custom themes are available on all your devices.
            </li>
          </ul>
        </div>
      ),
    },

    // ACCOUNT: OFFLINE, BACKUPS & PASSWORD
    {
      id: 'account-offline-backups',
      category: 'account',
      title: 'Offline, backups & password',
      subtitle: 'Keep working without internet, restore backups, reset your password',
      without: { cap: 'signIn', title: 'Backups', subtitle: 'Create backups and restore them' },
      icon: CloudOff,
      keywords: ['offline', 'internet', 'backup', 'restore', 'password', 'forgot', 'account', 'two-factor', '2fa', 'authenticator', 'security', 'passkey', 'fingerprint', 'sso', 'oidc'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <NotInDesktop>
              <li>
                <strong className="text-main">Server backups:</strong> if the administration has switched on automatic backups, you find the daily backups of your data under <em>Account settings → Export &amp; import</em>. You can download or restore them, also for single areas like lists or tasks. Every backup also holds your notes, tasks and lists as Markdown in the <em>Obsidian</em> folder, readable in Obsidian or any text editor, even without MindSift.
              </li>
            </NotInDesktop>
            <InDesktop>
              <li>
                <strong className="text-main">Backups:</strong> under <em>Administration → Data</em> you switch on daily backups and choose the folder they go to. Under <em>Account settings → Export &amp; import</em> you find them; download them or restore them, also only for single areas such as lists or tasks. Every backup also holds your notes, tasks and lists as Markdown in the <em>Obsidian</em> folder, readable in Obsidian or any text editor, even without MindSift. A backup can also be restored on a server if you move there later.
              </li>
              <li>
                <strong className="text-main">Taking over an account from a server:</strong> under <em>Administration → Data</em> you pick a backup of a MindSift server and one of its accounts. Its pictures and recordings come along when you pick the server's data folder or its <em>backups</em> folder as an archive (.zip, .tar or .tar.gz); a database snapshot (.db.gz) alone brings everything but them. Only what the account owns comes over: things shared with it, hidden values and the server's settings stay out.
              </li>
            </InDesktop>
            <Only can="install">
              <li>
                <strong className="text-main">Without internet:</strong> installed as an app (or in the browser), MindSift also starts offline with the last loaded state. Capturing thoughts and checking off tasks and list items keeps working; a hint at the bottom shows how many changes are waiting, and they are sent automatically once the connection is back.
              </li>
            </Only>
            <Only can="install">
              <li>
                <strong className="text-main">Where offline changes are kept:</strong> Notes you have opened on this device before can be read and edited offline. Anything not sent yet is stored only in this browser: it survives closing, restarting and shutting down, and is sent automatically the next time MindSift starts with a connection. It is lost if you sign out (MindSift asks first), clear the browser data or work in a private window. So after working offline, come back online with the same device soon. If someone changed the same bullet in the meantime, nothing is lost: your version appears as a conflict copy below it.
              </li>
            </Only>
            <Only can="signIn">
              <li>
                <strong className="text-main">Forgot your password:</strong> if the administration has set up mail delivery, the sign-in window shows “Forgot your password?”. You get a link valid for one hour; with the new password you are signed out on all devices.
              </li>
            </Only>
            <Only can="signIn">
              <li>
                <strong className="text-main">Two-factor sign-in:</strong> under <em>Account settings → Security</em> you connect an authenticator app (scan the QR code, enter the first code); from then on signing in asks for the app's six-digit code after the password. The ten recovery codes shown once along the way help when the phone is missing: each works once. With “Trust this device for 30 days” a device of your own asks for no code for a month. “Forgot your password” does not switch two-factor sign-in off.
              </li>
            </Only>
            <Only can="signIn">
              <li>
                <strong className="text-main">Passkeys:</strong> under <em>Account settings → Security → Passkeys</em> you create a passkey (confirm your password, give it a name, fingerprint, face or device PIN). From then on “Sign in with a passkey” signs you in without any password; some browsers also offer it right in the login field. Signing in with the password asks for the passkey afterwards: a passkey counts as second factor, even without an authenticator app. The recovery codes appear with the first passkey. Removing the last second factor switches two-factor sign-in off again. Passkeys are only available when the server has a fixed https address (BASE_URL).
              </li>
            </Only>
            <Only can="signIn">
              <li>
                <strong className="text-main">Signing in with a provider (SSO):</strong> When the administration has set up a provider such as Authentik, Authelia or Keycloak, the login shows “Sign in with …”. The first time, your account is created, or an existing one with the same verified address is linked; you link an account with a different address under <em>Account settings → Security</em>. Two-factor sign-in is then up to the provider. You confirm sensitive changes such as a new address, a password, API keys or deleting by signing in there again; after that you have five minutes. With the password sign-in switched off there is only this button, and the administration has emergency access at <em>/?login=password</em>.
              </li>
            </Only>
          </ul>
        </div>
      ),
    },

    // COLLABORATION: ORGANIZATIONS, GROUPS & SHARING
    {
      id: 'collab-teams-sharing',
      category: 'collaboration',
      title: 'Organizations, groups & sharing',
      subtitle: 'Who may share with whom, and sharing notes, folders and lists safely',
      icon: Users,
      keywords: ['teams', 'groups', 'organization', 'visibility', 'private', 'share', 'sharing', 'permissions', 'editor', 'reader', 'folders', 'public', 'link'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Who may share with whom:</strong> the server admin decides: with everyone, only with people you have at least one <em>organization</em> in common with, or with nobody (“Private” mode: no sharing, no groups). You can belong to several organizations; server admins and user managers look after them. With people search switched off, you enter the exact e-mail address or username when sharing. Whoever works on something with you always shows there by name.
            </li>
            <li>
              <strong className="text-main">Server time zone:</strong> server admins set it under <em>Administration → Instance → Time zone</em>. It applies to everyone at once: due times, alarms, the daily summary and the backup time.
            </li>
            <li>
              <strong className="text-main">Image quality:</strong> the app shrinks images to at most 2048 pixels before uploading them. How strongly it compresses them is set by server admins under <em>Administration → Data → Image quality</em>: High (default), Medium or Economy. The size stays the same at every level, so text in screenshots stays readable; the setting applies to newly added images.
            </li>
            <li>
              <strong className="text-main">Groups:</strong> combine people you can see into groups (e.g. family, flatmates, a project) and share with all of them at once. Whoever creates a group is its admin; only members can share with a group.
            </li>
            <li>
              <strong className="text-main">Only the owner shares:</strong> editors can change content but not share it further. You can leave a share given to you at any time. If someone leaves an organization or group, shares that were only allowed through it end automatically.
            </li>
            <li>
              <strong className="text-main">Public link:</strong> in the share dialog you can share a note of your own read only by link, also with people without an account, optionally with a password. The link always expires (1 hour to 14 days), can be revoked at any time and stays out of search engines. Visitors see changes live, but no hidden values and no names. Whether this is available is up to the server admin.
            </li>
            <li>
              <strong className="text-main">Roles (editor vs. reader):</strong> when sharing notes, folders or lists you choose between <em>Editor</em> (full access to content and checklists) and <em>Read only</em> (view only, with live updates).
            </li>
            <li>
              <strong className="text-main">Your own folder structure:</strong> every recipient can put shared documents and folders into their own folder structure without changing the owner's organization.
            </li>
          </ul>
        </div>
      ),
    },
  ],
  shortcuts: [
    { key: 'Cmd + K / Ctrl + K or /', scope: 'Global', desc: 'Open the global full-text search (command palette)' },
    { key: 'C', scope: 'Global', desc: 'Open the Quick Dump (on the desktop as a window over everything)' },
    { key: 'Enter', scope: 'Quick Dump', desc: 'Save the thought; the window stays open for the next one' },
    { key: 'Esc', scope: 'Quick Dump', desc: 'Clear the input and close the window' },
    { key: 'Enter', scope: 'Workspace outliner', desc: 'Create a new bullet (or outdent an empty block)' },
    { key: 'Tab', scope: 'Workspace outliner', desc: 'Indent the bullet (nest it)' },
    { key: 'Shift + Tab', scope: 'Workspace outliner', desc: 'Outdent the bullet to the left' },
    { key: 'Shift + Enter', scope: 'Workspace outliner', desc: 'Soft line break within the block' },
    { key: 'Backspace', scope: 'Workspace outliner', desc: 'On an empty block: delete the block; at the start: merge' },
    { key: '↑ / ↓', scope: 'Workspace outliner', desc: 'Go to the previous / next block' },
    { key: 'Ctrl + L / Cmd + L', scope: 'Workspace outliner', desc: 'Insert a link (note, bullet or web link); selected text becomes the link text' },
    { key: 'Ctrl + Shift + ↓', scope: 'Workspace outliner', desc: 'Expand all collapsed bullets of the note' },
    { key: 'Ctrl + Shift + ↑', scope: 'Workspace outliner', desc: 'Collapse all bullets of the note (in focus mode only within the branch)' },
    { key: 'Ctrl + click on ▸ / ▾', scope: 'Workspace outliner', desc: 'Expand or collapse a bullet together with all its sub-bullets' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Workspace outliner', desc: 'Undo the last note action' },
    { key: 'Ctrl + Y / Ctrl + Shift + Z', scope: 'Workspace outliner', desc: 'Redo an undone action' },
    { key: 'Drag the mouse over several bullets', scope: 'Workspace outliner', desc: 'Select text across several bullets; Del/Backspace deletes it, typing replaces it, Ctrl + C copies it as Markdown (indentation, to-dos, headings)' },
    { key: 'Ctrl + A twice', scope: 'Workspace outliner', desc: 'First selects the bullet, the second time the whole note; Ctrl + C copies it as Markdown, pasting creates the same bullets again' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Tasks', desc: 'Undo deleting, moving or checking off' },
    { key: '/', scope: 'Workspace outliner', desc: 'Open the slash menu (/todo, /link, /h1, /code, ...)' },
    { key: '[] or [ ] at the start', scope: 'Workspace outliner', desc: 'Turn into a to-do checkbox right away' },
    { key: '[x] at the start', scope: 'Workspace outliner', desc: 'Turn into a checked to-do checkbox right away' },
    { key: '#, ##, ### at the start', scope: 'Workspace outliner', desc: 'Turn into an H1, H2 or H3 heading right away' },
    { key: '[[Note title]]', scope: 'Workspace outliner', desc: 'Embed an interactive WikiLink to a note' },
    { key: '#tagname', scope: 'Workspace / lists', desc: 'Inline hashtag for linking or categorizing' },
    { key: 'V, H, R, O, D, A, P, T, E · G', scope: 'Drawing', desc: 'Choose a tool (select, pan, rectangle, ellipse, diamond, arrow, freehand, text, eraser) · grid on/off' },
    { key: 'H or ←', scope: 'Triage deck', desc: 'Discard the thought (to the trash)' },
    { key: 'L or →', scope: 'Triage deck', desc: 'Make the thought a task right away' },
    { key: 'T', scope: 'Triage deck', desc: 'Create a task with a due date' },
    { key: 'D', scope: 'Triage deck', desc: 'Turn the thought into a note document' },
    { key: 'Space', scope: 'Triage deck', desc: 'Skip the card (“Later” – to the end of the stack)' },
    { key: 'Swipe left', scope: 'Triage (touch/mobile)', desc: 'Discard the thought' },
    { key: 'Swipe right', scope: 'Triage (touch/mobile)', desc: 'Take over the thought as a task' },
    { key: 'Press and hold', scope: 'Triage (touch/mobile)', desc: 'Open the action menu (date, list, note)' },
  ],
};

export default en;
