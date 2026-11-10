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
  Shapes,
  CloudOff,
} from 'lucide-react';
import type { HelpContent } from './types';

const kbd = 'px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent';

// Guida in italiano: le stesse schede e la stessa tabella scorciatoie di en.tsx e de.tsx
const it: HelpContent = {
  cards: [
    // WORKSPACE & OUTLINER
    {
      id: 'workspace-architecture',
      category: 'workspace',
      title: 'Outliner gerarchico e sincronizzazione offline',
      subtitle: 'Archiviazione atomica con sincronizzazione collaborativa in tempo reale',
      icon: FileText,
      keywords: ['workspace', 'outliner', 'database', 'sqlite', 'offline', 'indexeddb', 'esportazione', 'markdown', 'salvataggio'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            In MindSift ogni nota è un outliner strutturato e gerarchico. Le tue note vengono salvate in modo sicuro e con controllo di versione nel{' '}
            <strong className="text-main">database SQLite</strong> e memorizzate nella cache del browser tramite{' '}
            <strong className="text-main">IndexedDB</strong>.
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <strong className="text-main">Pienamente utilizzabile offline:</strong> puoi continuare a lavorare anche senza connessione a Internet;
              le modifiche si sincronizzano automaticamente appena torni online.
            </li>
            <li>
              <strong className="text-main">Esportazione Markdown:</strong> con l'icona di download (<Download className="w-3 h-3 inline text-accent" />) nell'intestazione della nota puoi esportare lo stato corrente in qualsiasi momento come file Markdown standard (<code className="font-mono text-accent">.md</code>) sul tuo computer.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-keyboard',
      category: 'workspace',
      title: "Uso della tastiera nell'editor di note",
      subtitle: 'Scrivi e organizza fluidamente senza toccare il mouse',
      icon: Keyboard,
      keywords: ['tastiera', 'scorciatoie', 'invio', 'tab', 'shift', 'backspace', 'outliner', 'rientro', 'annulla', 'ripeti', 'frecce'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <kbd className={kbd}>Enter</kbd> : crea subito un nuovo punto sullo stesso livello. Se il punto è vuoto e indentato, si sposta di un livello a sinistra.
            </li>
            <li>
              <kbd className={kbd}>Tab</kbd> : aumenta il rientro del punto corrente verso destra e lo posiziona sotto il punto precedente.
            </li>
            <li>
              <kbd className={kbd}>Shift + Tab</kbd> : riduce il rientro del punto verso sinistra.
            </li>
            <li>
              <kbd className={kbd}>Shift + Enter</kbd> : inserisce un'interruzione di riga morbida all'interno dello stesso blocco di testo.
            </li>
            <li>
              <kbd className={kbd}>Backspace</kbd> : su un blocco vuoto lo elimina subito. All'inizio del testo unisce il blocco con quello precedente.
            </li>
            <li>
              <kbd className={kbd}>↑ / ↓</kbd> : passa al blocco precedente o successivo quando il cursore si trova all'inizio o alla fine del testo.
            </li>
            <li>
              <kbd className={kbd}>Ctrl + Z</kbd> / <kbd className={kbd}>Cmd + Z</kbd> : annullamento a più livelli per le note. Ripeti con <kbd className={kbd}>Ctrl + Y</kbd> o <kbd className={kbd}>Ctrl + Shift + Z</kbd>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-slash-and-autoformat',
      category: 'workspace',
      title: 'Comandi slash (/) e formattazione automatica',
      subtitle: 'Cambia tipo di blocco e formatta in Markdown durante la digitazione',
      icon: Command,
      keywords: ['slash', 'comandi', 'todo', 'link', 'h1', 'h2', 'h3', 'codice', 'callout', 'warn', 'fail', 'separatore', 'immagine', 'estrai', 'unisci', 'audio', 'nota vocale', 'dettatura', 'foto', 'formattazione automatica'],
      content: (
        <div className="space-y-3 text-muted leading-relaxed">
          <div>
            <p className="mb-1.5">
              Digita <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">/</code> in un blocco per aprire il menu dei tipi di blocco:
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <ListTodo className="w-3.5 h-3.5 text-accent" />
                <span>/todo (attività con casella di controllo)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <LinkIcon className="w-3.5 h-3.5 text-accent" />
                <span>/link (collega una nota)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Heading1 className="w-3.5 h-3.5 text-accent" />
                <span>/h1, /h2, /h3 (intestazioni)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Code className="w-3.5 h-3.5 text-accent" />
                <span>/code (blocco di codice)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <KeyRound className="w-3.5 h-3.5 text-accent" />
                <span>/secret (nascondi un valore, ad es. un IP o un token)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">💬</span>
                <span>/callout (riquadro informativo)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-status-warn font-bold">⚠</span>
                <span>/warn, /fail (avviso, errore)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">—</span>
                <span>/divider (separatore)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🖼️</span>
                <span>/image (carica, fotografa, incolla o collega un'immagine; solo in un punto vuoto)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <Shapes className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/canvas (disegno con forme, frecce, testo e mano libera)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">📤</span>
                <span>/extract (sposta il punto con tutti i sottopunti in una nota indipendente, lasciando un [[link]] al suo posto; il pulsante «Recupera nota» sul link annulla l'operazione)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🎙️</span>
                <span>/audio (registra una nota vocale: il pulsante verde avvia, quello rosso salva; oppure carica un file audio)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🗣️</span>
                <span>/diktat (parla invece di digitare: si avvia subito, tocca «Stop» per inserire il testo nel punto)</span>
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <span className="font-semibold text-main block mb-1">Formattazione immediata durante la scrittura:</span>
            <ul className="space-y-1 text-xs">
              <li><code className="text-accent font-mono">[] </code> o <code className="text-accent font-mono">[ ] </code> all'inizio della riga lo trasforma subito in una casella to-do da spuntare.</li>
              <li><code className="text-accent font-mono">[x] </code> lo trasforma in una casella to-do già spuntata.</li>
              <li><code className="text-accent font-mono"># </code>, <code className="text-accent font-mono">## </code> o <code className="text-accent font-mono">### </code> all'inizio della riga formatta subito il blocco come intestazione.</li>
            </ul>
          </div>
        </div>
      ),
    },
    // WORKSPACE: DRAWINGS
    {
      id: 'workspace-drawings',
      category: 'workspace',
      title: 'Disegni (/canvas)',
      subtitle: 'Schizzi, diagrammi di flusso e mappe mentali direttamente nella nota',
      icon: Shapes,
      keywords: ['disegno', 'canvas', 'schizzo', 'diagramma', 'diagramma di flusso', 'mappa mentale', 'freccia', 'forme', 'mano libera', 'griglia', 'mermaid'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Crearne uno:</strong> Scrivi <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/canvas</kbd> (o <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/draw</kbd>, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/sketch</kbd>) in un punto vuoto; l’editor si apre a schermo intero. Esc o «Fatto» salva e chiude.
            </li>
            <li>
              <strong className="text-main">Strumenti:</strong> Seleziona <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">V</kbd>, sposta la vista <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">H</kbd> (o tieni premuta la barra spaziatrice), rettangolo <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">R</kbd>, ellisse <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">O</kbd>, rombo <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">D</kbd>, freccia <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">A</kbd>, mano libera <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">P</kbd>, testo <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">T</kbd>, gomma <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">E</kbd>. Con Maiusc rettangoli ed ellissi diventano quadrati e cerchi; <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">G</kbd> attiva e disattiva la griglia magnetica. Colore della linea, riempimento, spessore e tratteggio si impostano sulla forma selezionata.
            </li>
            <li>
              <strong className="text-main">Testo e frecce:</strong> Doppio clic (o Invio) su una forma per scriverci dentro, doppio clic su una freccia per darle un’etichetta come «sì» o «no». Le frecce si agganciano alle forme e le seguono quando si spostano; possono essere dritte, curve o ad angolo.
            </li>
            <li>
              <strong className="text-main">Modificare:</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + Z</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + Y</kbd> annullano e ripetono, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + D</kbd> duplica, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + C</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + V</kbd> copiano e incollano, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Canc</kbd> elimina, i tasti freccia spostano la selezione.
            </li>
            <li>
              <strong className="text-main">Nella nota:</strong> Il disegno occupa la larghezza della nota. Fai clic dentro, poi trascinare sposta la vista e la rotellina o due dita zoomano. Trascina il bordo inferiore per cambiare l’altezza. «Salva vista» fissa inquadratura, zoom e altezza per tutti, «Automatico» rimette tutto in vista. Doppio clic o «Modifica» apre l’editor.
            </li>
            <li>
              <strong className="text-main">Insieme e offline:</strong> Nelle note condivise un disegno è bloccato per gli altri mentre qualcuno ci disegna. Ciò che disegni offline viene salvato appena torna la connessione; una bozza non salvata viene proposta per il ripristino alla prossima apertura.
            </li>
            <li>
              <strong className="text-main">Ovunque:</strong> La ricerca trova le parole nei disegni, copia e incolla mantiene il disegno e l’esportazione Markdown lo contiene come immagine SVG (l’importazione lo trasforma di nuovo in disegno). Gli agenti IA (MCP) leggono una descrizione del disegno e possono creare disegni da diagrammi di flusso e mappe mentali Mermaid.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-wikilinks-tags',
      category: 'workspace',
      title: 'WikiLink ([[...]]), hashtag (#) e pagine tag',
      subtitle: 'Collega le conoscenze in entrambe le direzioni e filtra per argomento',
      icon: Tag,
      keywords: ['wikilink', 'link', 'collegamenti', 'hashtag', 'tag', 'filtri', 'parole chiave'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Note e pensieri possono essere collegati tra loro in molti modi in MindSift:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Wiki link:</strong> Con <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + L</kbd> o <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">/link</code> colleghi un’altra nota o un singolo punto; un clic lo apre. Il link mostra sempre il titolo attuale della nota e continua a funzionare se la rinomini o la sposti, anche con due note dallo stesso nome. Il testo selezionato prima diventa il testo del link. A mano funziona anche <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[Nome della nota]]</code>. Se la nota collegata non esiste più, un clic chiede se crearla o rimuovere il link.
            </li>
            <li>
              <strong className="text-main">Hashtag:</strong> digita <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#progetto</code> o <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#importante</code> in qualsiasi punto del testo. Gli hashtag vengono evidenziati a colori e indicizzati.
            </li>
            <li>
              <strong className="text-main">Vista «Tag e filtri»:</strong> la panoramica dei tag si trova nelle schede in alto nel Workspace. Mostra tutti gli hashtag in uso, consente di cercare le loro occorrenze in tutti i documenti e include anche note libere sulle pagine dei tag.
            </li>
            <li>
              <strong className="text-main">Backlink:</strong> in fondo a ogni nota, la sezione «Collegano a questa nota» mostra quali altre note la collegano con <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[titolo]]</code>. Facendo clic su un riferimento si salta direttamente al blocco corrispondente.
            </li>
            <li>
              <strong className="text-main">Cestino:</strong> le note eliminate (anche dalle cartelle eliminate) finiscono nel «Cestino» in fondo alla barra delle cartelle o nel menu mobile. Lì puoi visualizzarle in sola lettura, ripristinarle o eliminarle definitivamente. Finché una nota è nel cestino, non è visibile nemmeno a chi la condivideva. Trascorso il periodo impostato in Impostazioni account → Conservazione (predefinito 30 giorni) viene eliminata per sempre. Le attività eliminate si trovano nella scheda «Cestino» delle attività, i pensieri scartati nel cestino di Triage.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-zoom-drag',
      category: 'workspace',
      title: 'Zoom isolato, trascinamento e preferiti',
      subtitle: 'Mantieni la concentrazione e ordina liberamente le note',
      icon: Pin,
      keywords: ['altra nota', 'estrai', 'hoisting', 'zoom', 'trascina', 'rilascia', 'cartelle', 'sposta', 'fissa', 'breadcrumb'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Zoom isolato:</strong> fai clic direttamente sul punto elenco (<code className="text-accent">•</code>) di un blocco per isolare e ingrandire solo quel ramo. La navigazione breadcrumb in alto ti permette di tornare indietro passo dopo passo in qualsiasi momento.
            </li>
            <li>
              <strong className="text-main">Spostamento blocchi:</strong> afferra un punto elenco tenendo premuto il pulsante del mouse per trascinarlo con tutti i suoi sottopunti in una nuova posizione.
            </li>
            <li>
              <strong className="text-main">In un'altra nota:</strong> trascina il punto elenco su una nota nella barra laterale e l'intero ramo finisce in fondo a quella nota. Se lo rilasci sul + per una nuova nota in cima alla barra laterale, diventa una nuova nota a sé. L'avviso successivo offre «Apri» e «Annulla», anche Ctrl+Z funziona; le attività collegate lo seguono.
            </li>
            <li>
              <strong className="text-main">Estrarre:</strong> il pulsante «Trasforma in nota» a destra del punto chiede la destinazione: Invio crea una nuova nota, digitando ne cerchi una esistente. Al vecchio posto resta un link al punto spostato.
            </li>
            <li>
              <strong className="text-main">Gestione cartelle:</strong> le note nella barra laterale a sinistra possono essere organizzate in sottocartelle tramite trascinamento.
            </li>
            <li>
              <strong className="text-main">Note fissate:</strong> l'icona della puntina mantiene le note più importanti in cima alla barra laterale.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-collab-locks',
      category: 'workspace',
      title: 'Collaborazione in tempo reale, blocchi e conflitti',
      subtitle: 'Lavora insieme ad altri senza sovrascrivere accidentalmente le modifiche',
      icon: Lock,
      keywords: ['collaborazione', 'blocchi', 'lucchetto', 'conflitti', 'live', 'presenza', 'condivisione'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>MindSift supporta la collaborazione sui documenti con protezione integrata contro la perdita di dati:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Blocco dei punti:</strong> quando qualcuno modifica un punto elenco, viene mostrata un'icona a lucchetto con il nome dell'utente. Gli altri non possono sovrascrivere quel punto per il momento.
            </li>
            <li>
              <strong className="text-main">Gestione dei conflitti:</strong> se si verificano modifiche contemporanee o offline, il server non sovrascrive mai i tuoi dati di nascosto. Compare invece un blocco di conflitto evidenziato in giallo con due pulsanti: <em>«Applica»</em> o <em>«Scarta»</em>.
            </li>
            <li>
              <strong className="text-main">Indicatore di connessione:</strong> accanto al titolo della nota visualizzi sempre la modalità di connessione (es. <em>Live</em>, <em>long polling</em> o <em>Offline</em>).
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-global-todos',
      category: 'workspace',
      title: 'Riepilogo globale dei to-do e collegamenti alle attività',
      subtitle: 'Tutti i to-do aperti di tutte le note raccolti in un unico posto',
      icon: CheckSquare,
      keywords: ['rollup', 'todos', 'caselle di controllo', 'attività avanzata', 'globale', 'attività'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            La scheda del workspace <strong className="text-main">«To-dos»</strong> raccoglie automaticamente tutte le caselle non spuntate (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">- [ ]</code>) di tutte le tue note.
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Sincronizzazione bidirezionale:</strong> spunta un to-do nell'elenco globale e il punto nella nota originale si aggiornerà in tempo reale.
            </li>
            <li>
              <strong className="text-main">Attività collegate (attività avanzate):</strong> i to-do selezionati nelle note possono anche essere gestiti come attività complete nell'area Attività e Kanban.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-search-cmdk',
      category: 'workspace',
      title: 'Ricerca globale e riquadro dei comandi (Cmd+K)',
      subtitle: 'Ricerca full-text FTS5 in note, blocchi, attività e liste',
      icon: Command,
      keywords: ['ricerca', 'comandi', 'palette', 'cmdk', 'trova', 'fts', 'testo completo', 'tastiera'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Premi <kbd className={kbd}>Cmd + K</kbd> / <kbd className={kbd}>Ctrl + K</kbd> o <kbd className={kbd}>/</kbd> (quando nessun campo di testo è attivo) per aprire la ricerca globale:
          </p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>
              <strong className="text-main">Ricerca full-text (FTS5):</strong> cerca nei titoli e nei blocchi delle note, nelle attività e negli elementi di liste all'istante, con ordinamento per rilevanza (BM25) e ricerca per prefisso.
            </li>
            <li>
              <strong className="text-main">Sicurezza:</strong> mostra solo i contenuti a cui hai effettivamente accesso (le tue note personali e quelle condivise, liste di attività e liste della spesa).
            </li>
            <li>
              <strong className="text-main">Navigazione da tastiera:</strong> sfoglia con <kbd className={kbd}>↑</kbd> e <kbd className={kbd}>↓</kbd>, apri un risultato con <kbd className={kbd}>Enter</kbd> (le note si aprono esattamente nel blocco trovato).
            </li>
          </ul>
        </div>
      ),
    },

    // TRIAGE & QUICK DUMP
    {
      id: 'triage-capture',
      category: 'triage',
      title: 'Barra di registrazione rapida',
      subtitle: 'Cattura i pensieri in meno di un secondo – da tastiera o a voce',
      icon: Layers,
      keywords: ['cattura', 'registrazione rapida', 'dettatura', 'voce', 'microfono', 'inbox', 'c'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>La barra di registrazione rapida in cima allo schermo assicura che nessun pensiero vada perso:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Focus immediato:</strong> premi <kbd className={kbd}>C</kbd> o <kbd className={kbd}>/</kbd> ovunque nell'app (a meno che tu non stia già digitando in un campo di testo).
            </li>
            <li>
              <strong className="text-main">Dettatura vocale:</strong> fai clic sull'icona del microfono (<Mic className="w-3.5 h-3.5 inline text-accent" />) per l'inserimento vocale continuo. Ai pensieri registrati a voce viene assegnato automaticamente il tag <code className="text-accent font-mono">#diktat</code>. Su smartphone puoi anche tenere premuto il pulsante rotondo <strong className="text-main">+</strong> nella barra inferiore per parlare subito – al rilascio il testo finisce nella posta in arrivo (trascinando verso l'alto si annulla).
            </li>
            <li>
              <strong className="text-main">Scelta della destinazione:</strong> i pensieri finiscono nel Quick Dump per impostazione predefinita. Tramite le opzioni puoi indirizzarli subito come <strong className="text-main">attività</strong> (con priorità e scadenza), <strong className="text-main">elemento di lista</strong> (es. nella lista della spesa) o <strong className="text-main">nuova nota</strong>.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'triage-deck-decisions',
      category: 'triage',
      title: 'Mazzo di Triage: decidi con un tasto o uno swipe',
      subtitle: 'Svuota la posta in arrivo a tempo di record e mantieni la mente libera',
      icon: Sparkles,
      keywords: ['triage', 'mazzo', 'h', 'l', 't', 'd', 'spazio', 'swipe', 'cestino', 'gesti'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Il mazzo di Triage presenta ogni pensiero raccolto scheda dopo scheda. Puoi decidere in un attimo:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Tastiera (desktop):</span>
              <ul className="space-y-1 font-mono text-[11px]">
                <li><strong className="text-status-err">H</strong> o <strong>←</strong> : scarta (cestino)</li>
                <li><strong className="text-accent">L</strong> o <strong>→</strong> : crea come attività</li>
                <li><strong className="text-main">T</strong> : con data di scadenza</li>
                <li><strong className="text-main">D</strong> : converti in nota del workspace</li>
                <li><strong className="text-muted">Space</strong> : più tardi (sposta in fondo al mazzo)</li>
              </ul>
            </div>
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Gesti swipe (touch e mobile):</span>
              <ul className="space-y-1 text-xs">
                <li><strong className="text-status-err">Scorri a sinistra:</strong> scarta</li>
                <li><strong className="text-accent">Scorri a destra:</strong> converti in attività</li>
                <li><strong className="text-main">Tieni premuto:</strong> apri il menu delle azioni (data, lista, nota)</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'triage-webhooks',
      category: 'triage',
      title: 'API: curl, smart home e agenti IA (MCP)',
      subtitle: 'Leggi e modifica attività e liste via curl o Home Assistant, invia pensieri, collega agenti IA come Claude Code.',
      icon: Bell,
      keywords: ['webhook', 'api', 'token', 'home assistant', 'siri', 'scorciatoie', 'automazione', 'curl', 'mcp', 'ia', 'agente', 'claude', 'codex'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            MindSift dispone di un'API. In <em className="text-main">Impostazioni account → API</em> crei chiavi personali e decidi con appositi selettori cosa ciascuna può fare: leggere, creare o modificare attività, liste, note e la posta in arrivo. Questi permessi si applicano a entrambi i tipi di accesso allo stesso modo; le note e la lettura/organizzazione della posta in arrivo sono disponibili solo via MCP. Una chiave non ha mai accesso alle impostazioni.
          </p>
          <p>
            <strong className="text-main">curl e smart home:</strong> con accesso in lettura, <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">GET /api/v1/tasks?due=today&amp;status=open</code> restituisce tutto ciò che scade oggi, ad es. per un sensore di Home Assistant. Altri filtri: <code className="font-mono">due=overdue</code>, una data, <code className="font-mono">taskListId</code>. Le liste si ottengono tramite <code className="font-mono">GET /api/v1/lists</code>. Con accesso in modifica puoi spuntare elementi via <code className="font-mono">PATCH /api/v1/thoughts/ID</code>. Nelle impostazioni trovi esempi già pronti.
          </p>
          <p>
            <strong className="text-main">Invio dati:</strong> <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/webhooks/ingest</code> accetta pensieri da Comandi Rapidi di iOS, Home Assistant o n8n. Il campo <code className="font-mono">"target"</code> specifica la destinazione: <code className="font-mono">triage</code> (predefinita), <code className="font-mono">task</code> (opzionalmente con <code className="font-mono">taskListId</code>) o <code className="font-mono">list_item</code> (con <code className="font-mono">listId</code>).
          </p>
          <p>
            <strong className="text-main">Agenti IA:</strong> tramite MCP (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/mcp</code>), Claude Code, OpenAI Codex, Claude Desktop, Cursor e i tuoi agenti possono leggere, creare, modificare, spuntare ed eliminare attività, liste e note, oltre a organizzare la posta in arrivo. Nelle impostazioni trovi il comando pronto per ogni agente; un agente vede solo gli strumenti autorizzati dalla chiave.
          </p>
          <p>
            <strong className="text-main">Origine:</strong> tutto ciò che una chiave crea o modifica riporta in modo permanente un contrassegno con il suo nome, preceduto dall'icona di un webhook (API) o di un robot (MCP). Passandoci sopra o toccandolo puoi verificare chi lo ha creato e modificato per l'ultima volta, e quando.
          </p>
        </div>
      ),
    },

    // TASKS & KANBAN
    {
      id: 'tasks-kanban',
      category: 'tasks',
      title: 'Vista elenco e bacheca Kanban flessibile',
      subtitle: 'Visualizza le attività e gestiscile con colonne personalizzate',
      icon: Columns,
      keywords: ['attività', 'kanban', 'bacheca', 'colonne', 'trascina', 'rilascia', 'liste'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Le attività possono essere gestite nella classica <strong className="text-main">vista elenco</strong> o nella{' '}
            <strong className="text-main">bacheca Kanban</strong> interattiva:
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Cambio di vista:</strong> usa il selettore in alto a destra tra elenco e Kanban.
            </li>
            <li>
              <strong className="text-main">Colonne Kanban personalizzate:</strong> nelle impostazioni delle colonne puoi definire stati individuali per ciascuna lista di attività (es. <em>Backlog</em>, <em>In corso</em>, <em>Revisione</em>, <em>Completata</em>) impostando colori e stato di completamento.
            </li>
            <li>
              <strong className="text-main">Trascina e rilascia:</strong> sposta le schede delle attività tra le colonne con semplicità. Spostare una scheda in una colonna di completamento segna automaticamente l'attività come completata.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'tasks-details-alarms',
      category: 'tasks',
      title: 'Sottoattività, date di scadenza e notifiche automatiche',
      subtitle: 'Liste di controllo con barra di avanzamento, note in Markdown e notifiche',
      icon: CheckSquare,
      keywords: ['sottoattività', 'notifiche', 'avvisi', 'email', 'discord', 'data', 'scadenza', 'priorità', 'assegna', 'assegnato'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Sottoattività:</strong> crea una lista di controllo all'interno di qualsiasi attività con una barra di avanzamento visibile (es. «3 di 5 completate»). La maniglia a sinistra riordina le sottoattività con mouse o tocco, oppure usa i tasti freccia da tastiera.
            </li>
            <li>
              <strong className="text-main">Nuova attività in una colonna Kanban:</strong> «Aggiungi attività» in fondo alla colonna apre subito la finestra dell'attività con colonna e lista già compilate; basta digitare il titolo. Chiudendo la finestra senza titolo, l'attività vuota scompare.
            </li>
            <li>
              <strong className="text-main">Priorità e note:</strong> imposta la priorità (<em className="text-accent">Urgente</em>, <em className="text-main">Importante</em>, <em>Normale</em>) e aggiungi note dettagliate in formato Markdown.
            </li>
            <li>
              <strong className="text-main">Assegnazione:</strong> nelle liste condivise puoi assegnare un'attività a una o più persone con accesso (digita il nome, Invio). Gli assegnatari compaiono come piccole immagini del profilo sull'attività; chi perde l'accesso alla lista viene rimosso automaticamente.
            </li>
            <li>
              <strong className="text-main">Attività ricorrenti:</strong> scegli una ripetizione nella finestra dei dettagli (da giornaliera ad annuale). Spuntandola viene creata automaticamente l'attività successiva con la data aggiornata; la riconosci dall'icona 🔁.
            </li>
            <li>
              <strong className="text-main">Data di scadenza con ora:</strong> nella finestra dei dettagli puoi impostare un orario accanto alla data; «✕ Ora» rende nuovamente l'attività valida per l'intera giornata. Mostra ad esempio «Oggi, 14:30», gli elementi scaduti in rosso.
            </li>
            <li>
              <strong className="text-main">Notifiche automatiche:</strong> all'orario di scadenza (per le attività valide tutto il giorno alle 9:00, meno il tuo tempo di preavviso) MindSift ti avvisa via <strong className="text-main">email</strong>, <strong className="text-main">webhook Discord</strong> o il tuo webhook HTTP. Se sposti la data di scadenza o riapri l'attività, l'avviso scatterà di nuovo. Configurabile nelle impostazioni dell'account.
            </li>
            <li>
              <strong className="text-main">Promemoria per attività:</strong> Nella finestra dei dettagli, spunta uno o più orari in «Promemoria», ad es. 2 settimane prima e il giorno della scadenza. Per questa attività sostituiscono il tuo preavviso e valgono per tutti quelli che ricevono il suo allarme di scadenza; «Predefinito» torna al preavviso delle impostazioni. Senza orario, MindSift ricorda giorni interi prima alle 9. Le attività con promemoria propri hanno una piccola 🔔.
            </li>
            <li>
              <strong className="text-main">Altre notifiche:</strong> Quando qualcuno ti assegna un'attività, una nuova attività arriva in una lista condivisa o lì ne viene completata una, MindSift può avvisarti; ogni evento si attiva o disattiva singolarmente nelle impostazioni, alla voce “Notifiche”. Le attività che <strong className="text-main">segui</strong> segnalano ogni modifica (stato, priorità, scadenza, testo, descrizione, sottoattività, assegnazione …), anche se spuntate in una nota. MindSift non ti avvisa mai di ciò che fai tu. Più eventi arrivano raggruppati in un unico messaggio. La <strong className="text-main">campanella</strong> accanto alla ricerca raccoglie tutto degli ultimi 14 giorni, anche senza canali attivi; un clic su una voce apre l'attività o la nota.
            </li>
            <li>
              <strong className="text-main">Menzioni con @:</strong> Nella descrizione di un'attività, nelle sottoattività e nelle note, <strong className="text-main">@</strong> apre un elenco di persone (frecce, Invio). Chi non ha accesso appare in grigio. La persona menzionata riceve una notifica (Impostazioni → Notifiche, “Sono stato menzionato”), anche da una lista silenziata; salvare di nuovo non ne invia una seconda.
            </li>
            <li>
              <strong className="text-main">Menu della lista (⋯):</strong> A destra sopra la lista: <strong className="text-main">Silenzia</strong> (solo liste condivise: nessuna notifica da questa lista; assegnazioni, menzioni e attività seguite arrivano comunque), Condividi, Rinomina ed Elimina. Se non tutte le liste entrano nella riga, le altre sono dietro “⋯ n”. In una lista condivisa una nuova attività è assegnata prima a te; l'avviso di scadenza va alle persone assegnate o, se non c'è nessuno, a tutti i membri.
            </li>
            <li>
              <strong className="text-main">Calendario:</strong> Una terza vista accanto a lista e Kanban: mese o settimana sul desktop, la settimana sul telefono. Le attività senza data sono in “Senza data”; trascinane una su un giorno per darle una data (l'orario resta) o di nuovo in “Senza data” per toglierla, <strong className="text-main">Ctrl + Z</strong> annulla. Le attività ricorrenti mostrano anche le prossime date, in grigio con ↻. A sinistra una colonna passa dal giorno scelto (oggi finché non ne scegli un altro) con le sue attività alle attività senza data. ← → per sfogliare, T torna a oggi. Sul desktop da lunedì a venerdì occupano la larghezza; il fine settimana si raggiunge scorrendo di lato o con “sab – dom ›”. Mese o settimana e la larghezza intera sono a destra degli hashtag, come nel Kanban; uno scatto della rotellina fa scorrere via le barre sopra.
            </li>
          </ul>
        </div>
      ),
    },

    // LISTS & SHOPPING
    {
      id: 'lists-shared-shopping',
      category: 'lists',
      title: 'Liste condivise, quantità e categorie hashtag',
      subtitle: 'Liste della spesa, liste bagagli e liste di controllo in tempo reale',
      icon: ShoppingCart,
      keywords: ['liste', 'spesa', 'checklist', 'quantità', 'categorie', 'hashtag', 'tempo reale'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Le liste condivise sono ideali per fare la spesa, preparare la valigia o gestire commissioni insieme:</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Quantità automatiche:</strong> inserimenti come <code className="text-accent font-mono">2x latte bio</code> o <code className="text-accent font-mono">500g pasta</code> separano automaticamente quantità e nome.
            </li>
            <li>
              <strong className="text-main">Categorie tramite hashtag:</strong> aggiungi un hashtag come <code className="text-accent font-mono">#frigo</code> o <code className="text-accent font-mono">#verdure</code>. La lista raggruppa automaticamente gli elementi nelle sezioni corrispondenti.
            </li>
            <li>
              <strong className="text-main">Sincronizzazione in tempo reale e rimozione completati:</strong> gli elementi spuntati si sincronizzano in tempo reale e mostrano chi li ha spuntati. Il pulsante di pulizia rimuove tutti gli elementi spuntati in un colpo solo.
            </li>
          </ul>
        </div>
      ),
    },

    // APPEARANCE: CUSTOM THEMES
    {
      id: 'workspace-custom-themes',
      category: 'account',
      title: 'Aspetto e temi personalizzati',
      subtitle: 'Scegli un design pronto o carica il tuo tema CSS',
      icon: Sparkles,
      keywords: ['tema', 'design', 'colori', 'css', 'scuro', 'chiaro', 'aspetto'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Cambio tema:</strong> nel menu del profilo in alto a destra oppure in <em>Impostazioni account → Aspetto e temi</em>.
            </li>
            <li>
              <strong className="text-main">Tema personalizzato:</strong> scarica o incolla il modello, adatta colori e angoli, carica o incolla come file <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">.css</code> e scegli «Salva e attiva». Il tema si applica subito ed è disponibile su tutti i tuoi dispositivi.
            </li>
          </ul>
        </div>
      ),
    },

    // ACCOUNT: OFFLINE, BACKUPS & PASSWORD
    {
      id: 'account-offline-backups',
      category: 'account',
      title: 'Offline, backup e password',
      subtitle: 'Lavorare senza Internet, ripristinare backup, reimpostare la password',
      icon: CloudOff,
      keywords: ['offline', 'internet', 'backup', 'ripristino', 'password', 'dimenticata', 'account'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Backup del server:</strong> se l'amministrazione ha abilitato i backup automatici, trovi i backup giornalieri dei tuoi dati in <em>Impostazioni account → Esportazione e importazione</em>. Puoi scaricarli o ripristinarli, anche per singole aree come liste o attività. Ogni backup contiene inoltre le tue note, attività e liste in Markdown nella cartella <em>Obsidian</em>, leggibili in Obsidian o in qualsiasi editor di testo, anche senza MindSift.
            </li>
            <li>
              <strong className="text-main">Senza Internet:</strong> installato come app (o nel browser), MindSift si avvia anche offline con l'ultimo stato caricato. Registrare pensieri e spuntare attività e voci di lista continua a funzionare; un avviso in basso mostra quante modifiche sono in attesa, e verranno inviate automaticamente appena torna la connessione.
            </li>
            <li>
              <strong className="text-main">Dove restano le modifiche offline:</strong> Le note che hai già aperto su questo dispositivo si possono leggere e modificare offline. Ciò che non è ancora stato inviato è salvato solo in questo browser: resiste a chiusura, riavvio e spegnimento, e viene inviato automaticamente al prossimo avvio di MindSift con la connessione. Si perde se ti disconnetti (MindSift chiede prima), cancelli i dati del browser o lavori in una finestra privata. Perciò, dopo aver lavorato offline, torna presto online con lo stesso dispositivo. Se nel frattempo qualcuno ha modificato lo stesso punto, non si perde nulla: la tua versione compare sotto come copia di conflitto.
            </li>
            <li>
              <strong className="text-main">Password dimenticata:</strong> se l'amministrazione ha configurato l'invio delle email, la schermata di accesso mostra «Password dimenticata?». Ricevi un link valido per un'ora; impostando la nuova password verrai disconnesso su tutti i dispositivi.
            </li>
          </ul>
        </div>
      ),
    },

    // COLLABORATION: ORGANIZATIONS, GROUPS & SHARING
    {
      id: 'collab-teams-sharing',
      category: 'collaboration',
      title: 'Organizzazioni, gruppi e condivisioni',
      subtitle: 'Chi può condividere con chi, e condivisione sicura di note, cartelle e liste',
      icon: Users,
      keywords: ['team', 'gruppi', 'organizzazione', 'visibilità', 'privato', 'condividi', 'condivisione', 'permessi', 'editor', 'lettore', 'cartelle', 'pubblico', 'link'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Chi può condividere con chi:</strong> lo decide l'amministratore del server: con tutti, solo con le persone con cui hai almeno un'<em>organizzazione</em> in comune, o con nessuno (modalità «Privato»: nessuna condivisione, nessun gruppo). Puoi appartenere a più organizzazioni; le gestiscono gli amministratori e la gestione utenti. Se la ricerca persone è disattivata, durante la condivisione inserisci l'indirizzo e-mail o il nome utente esatti. Chi lavora con te a qualcosa compare sempre lì con il nome.
            </li>
            <li>
              <strong className="text-main">Gruppi:</strong> raggruppa le persone visibili in gruppi (es. famiglia, coinquilini, progetto) e condividi con tutti in una volta sola. Chi crea un gruppo ne è amministratore; solo i membri possono condividere con un gruppo.
            </li>
            <li>
              <strong className="text-main">Solo il proprietario condivide:</strong> gli editor possono modificare i contenuti ma non condividerli ulteriormente. Puoi abbandonare una condivisione ricevuta in qualsiasi momento. Se qualcuno lascia un'organizzazione o un gruppo, le condivisioni consentite solo tramite essi terminano automaticamente.
            </li>
            <li>
              <strong className="text-main">Link pubblico:</strong> nella finestra di condivisione puoi condividere una tua nota in sola lettura tramite link, anche con persone senza account, eventualmente con password. Il link scade sempre (da 1 ora a 14 giorni), si può revocare in qualsiasi momento e non finisce nei motori di ricerca. I visitatori vedono le modifiche in tempo reale, ma né valori nascosti né nomi. Se è disponibile lo decide l'amministratore del server.
            </li>
            <li>
              <strong className="text-main">Ruoli (editor vs. lettore):</strong> quando condividi note, cartelle o liste puoi scegliere tra <em>Editor</em> (accesso completo ai contenuti e alle caselle di controllo) e <em>Sola lettura</em> (sola visualizzazione con aggiornamenti in tempo reale).
            </li>
            <li>
              <strong className="text-main">Struttura delle cartelle personale:</strong> ogni destinatario può inserire documenti e cartelle condivisi nella propria gerarchia di cartelle senza alterare l'organizzazione del proprietario.
            </li>
          </ul>
        </div>
      ),
    },
  ],
  shortcuts: [
    { key: 'Cmd + K / Ctrl + K o /', scope: 'Globale', desc: 'Apri la ricerca globale full-text (tavolozza dei comandi)' },
    { key: 'C', scope: 'Globale', desc: 'Sposta subito il focus sulla barra di registrazione rapida' },
    { key: 'Enter', scope: 'Registrazione rapida', desc: 'Salva il pensiero all\'istante' },
    { key: 'Esc', scope: 'Registrazione rapida', desc: 'Cancella l\'inserimento e chiudi le opzioni' },
    { key: 'Enter', scope: 'Workspace outliner', desc: 'Crea un nuovo punto (o riduci il rientro se vuoto)' },
    { key: 'Tab', scope: 'Workspace outliner', desc: 'Aumenta il rientro del punto (nidificazione)' },
    { key: 'Shift + Tab', scope: 'Workspace outliner', desc: 'Riduci il rientro del punto verso sinistra' },
    { key: 'Shift + Enter', scope: 'Workspace outliner', desc: 'Interruzione di riga morbida all\'interno del blocco' },
    { key: 'Backspace', scope: 'Workspace outliner', desc: 'Su blocco vuoto: elimina il blocco; all\'inizio: unisci' },
    { key: '↑ / ↓', scope: 'Workspace outliner', desc: 'Passa al blocco precedente o successivo' },
    { key: 'Ctrl + L / Cmd + L', scope: 'Workspace outliner', desc: 'Inserisci un link (nota, punto o link web); il testo selezionato diventa il testo del link' },
    { key: 'Ctrl + Maiusc + ↓', scope: 'Workspace outliner', desc: 'Espandi tutti i punti chiusi della nota' },
    { key: 'Ctrl + Maiusc + ↑', scope: 'Workspace outliner', desc: 'Comprimi tutti i punti della nota (in modalità focus solo nel ramo)' },
    { key: 'Ctrl + clic su ▸ / ▾', scope: 'Workspace outliner', desc: 'Espandi o comprimi un punto insieme a tutti i suoi sottopunti' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Workspace outliner', desc: 'Annulla l\'ultima azione nella nota' },
    { key: 'Ctrl + Y / Ctrl + Shift + Z', scope: 'Workspace outliner', desc: 'Ripeti un\'azione annullata' },
    { key: 'Trascina il mouse su più punti', scope: 'Workspace outliner', desc: 'Seleziona testo attraverso più punti; Canc/Backspace lo elimina, digitando lo sostituisce, Ctrl + C copia in Markdown (rientri, to-do, intestazioni)' },
    { key: 'Ctrl + A due volte', scope: 'Workspace outliner', desc: 'La prima volta seleziona il punto, la seconda l\'intera nota; Ctrl + C copia in Markdown, incollando si ricreano gli stessi punti' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Attività', desc: 'Annulla eliminazione, spostamento o completamento' },
    { key: '/', scope: 'Workspace outliner', desc: 'Apri il menu dei comandi slash (/todo, /link, /h1, /code, ...)' },
    { key: '[] o [ ] all\'inizio', scope: 'Workspace outliner', desc: 'Trasforma subito in una casella to-do' },
    { key: '[x] all\'inizio', scope: 'Workspace outliner', desc: 'Trasforma subito in una casella to-do già spuntata' },
    { key: '#, ##, ### all\'inizio', scope: 'Workspace outliner', desc: 'Formatta subito come intestazione H1, H2 o H3' },
    { key: '[[Titolo della nota]]', scope: 'Workspace outliner', desc: 'Incorpora un WikiLink interattivo a una nota' },
    { key: '#nometag', scope: 'Workspace / liste', desc: 'Hashtag inline per collegamenti o categorizzazione' },
    { key: 'V, H, R, O, D, A, P, T, E · G', scope: 'Disegno', desc: 'Scegli lo strumento (seleziona, sposta, rettangolo, ellisse, rombo, freccia, mano libera, testo, gomma) · griglia sì/no' },
    { key: 'H o ←', scope: 'Mazzo di Triage', desc: 'Scarta il pensiero (nel cestino)' },
    { key: 'L o →', scope: 'Mazzo di Triage', desc: 'Trasforma subito il pensiero in attività' },
    { key: 'T', scope: 'Mazzo di Triage', desc: 'Crea attività con data di scadenza' },
    { key: 'D', scope: 'Mazzo di Triage', desc: 'Converti il pensiero in una nota' },
    { key: 'Space', scope: 'Mazzo di Triage', desc: 'Salta scheda («Più tardi» – sposta in fondo al mazzo)' },
    { key: 'Scorri a sinistra', scope: 'Triage (touch/mobile)', desc: 'Scarta il pensiero' },
    { key: 'Scorri a destra', scope: 'Triage (touch/mobile)', desc: 'Converti il pensiero in attività' },
    { key: 'Tieni premuto', scope: 'Triage (touch/mobile)', desc: 'Apri il menu delle azioni (data, lista, nota)' },
  ],
};

export default it;
