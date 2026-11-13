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
} from 'lucide-react';
import type { HelpContent } from './types';

const kbd = 'px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent';

// French help: the same cards and shortcut table as the German/English ones
const fr: HelpContent = {
  cards: [
    // WORKSPACE & OUTLINER
    {
      id: 'workspace-architecture',
      category: 'workspace',
      title: 'Outliner hiérarchique & synchronisation hors ligne',
      subtitle: 'Stockage atomique avec synchronisation collaborative en temps réel',
      icon: FileText,
      keywords: ['workspace', 'outliner', 'base de données', 'sqlite', 'hors ligne', 'indexeddb', 'export', 'markdown', 'sauvegarde'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Dans MindSift, chaque note est un outliner hiérarchique et structuré. Tes notes sont stockées en toute sécurité et versionnées dans la{' '}
            <strong className="text-main">base de données SQLite</strong> et mises en cache dans le navigateur via{' '}
            <strong className="text-main">IndexedDB</strong>.
          </p>
          <ul className="space-y-1 list-disc list-inside">
            <li>
              <strong className="text-main">Entièrement utilisable hors ligne :</strong> tu peux continuer à travailler sans connexion Internet ;
              les modifications se synchronisent automatiquement dès que tu te reconnectes.
            </li>
            <li>
              <strong className="text-main">Export Markdown :</strong> grâce à l'icône de téléchargement (<Download className="w-3 h-3 inline text-accent" />) dans l'en-tête de la note, tu peux exporter à tout moment l'état actuel sous forme de fichier Markdown standard (<code className="font-mono text-accent">.md</code>) sur ton ordinateur.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-keyboard',
      category: 'workspace',
      title: 'Utilisation du clavier dans l\'éditeur de notes',
      subtitle: 'Écrire et structurer avec fluidité sans toucher à la souris',
      icon: Keyboard,
      keywords: ['clavier', 'raccourcis', 'entrée', 'tab', 'shift', 'retour arrière', 'outliner', 'indenter', 'désindenter', 'annuler', 'rétablir', 'touches fléchées'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <kbd className={kbd}>Entrée</kbd> : crée immédiatement une nouvelle puce au même niveau. Si la puce est vide et indentée, elle recule d'un niveau vers la gauche.
            </li>
            <li>
              <kbd className={kbd}>Tab</kbd> : indente la puce actuelle vers la droite et la subordonne à la puce précédente.
            </li>
            <li>
              <kbd className={kbd}>Maj + Tab</kbd> : désindente la puce vers la gauche.
            </li>
            <li>
              <kbd className={kbd}>Maj + Entrée</kbd> : insère un saut de ligne doux sans créer de nouvelle puce.
            </li>
            <li>
              <kbd className={kbd}>Retour arrière</kbd> : sur un bloc vide, supprime le bloc. Au début d'un bloc avec du texte, le fusionne avec le bloc précédent.
            </li>
            <li>
              <kbd className={kbd}>Touches fléchées ↑ / ↓</kbd> : déplace le curseur vers le bloc précédent ou suivant.
            </li>
            <li>
              <kbd className={kbd}>Ctrl + Z / Cmd + Z</kbd> et <kbd className={kbd}>Ctrl + Y</kbd> : annule ou rétablit les modifications.
            </li>
            <li>
              <strong className="text-main">Sélection sur plusieurs blocs :</strong> glisser la souris sur plusieurs puces sélectionne leur texte au-delà des limites de bloc. Taper remplace la sélection, Suppr ou Retour arrière la supprime proprement, et <kbd className={kbd}>Ctrl + C</kbd> copie la structure en Markdown avec les indentations, les tâches et les titres.
            </li>
            <li>
              <strong className="text-main">Sélectionner toute la note :</strong> appuyer sur <kbd className={kbd}>Ctrl + A</kbd> dans un bloc sélectionne d'abord ce bloc ; appuyer une deuxième fois sur <kbd className={kbd}>Ctrl + A</kbd> sélectionne l'intégralité de la note pour la copier en Markdown.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-slash-and-autoformat',
      category: 'workspace',
      title: 'Commandes slash (/) & formatage automatique',
      subtitle: 'Changer de type de bloc et formater en Markdown pendant la saisie',
      icon: Command,
      keywords: ['slash', 'commandes', 'tâche', 'lien', 'h1', 'h2', 'h3', 'code', 'callout', 'warn', 'fail', 'séparateur', 'image', 'extraire', 'fusionner', 'audio', 'note vocale', 'dictée', 'photo', 'auto-formatage'],
      content: (
        <div className="space-y-3 text-muted leading-relaxed">
          <div>
            <p className="mb-1.5">
              Tape <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">/</code> dans un bloc pour ouvrir le menu des types de blocs :
            </p>
            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <ListTodo className="w-3.5 h-3.5 text-accent" />
                <span>/todo (tâche avec case à cocher)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <LinkIcon className="w-3.5 h-3.5 text-accent" />
                <span>/link (lier une note)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Heading1 className="w-3.5 h-3.5 text-accent" />
                <span>/h1, /h2, /h3 (titres)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <Code className="w-3.5 h-3.5 text-accent" />
                <span>/code (bloc de code)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">1.</span>
                <span>/number ou « 1. » au début (liste numérotée ; Entrée continue la numérotation, une puce vide la termine)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <TableIcon className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/table ou /tableau (tableau avec ligne d’en-tête)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <KeyRound className="w-3.5 h-3.5 text-accent" />
                <span>/secret (masquer une valeur, p. ex. une IP ou un jeton)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">💬</span>
                <span>/callout (encadré)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-status-warn font-bold">⚠</span>
                <span>/warn, /fail (avertissement, erreur)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">—</span>
                <span>/divider (séparateur)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🖼️</span>
                <span>/image (téléverser, photographier, coller ou lier une image ; uniquement dans une puce vide)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <Shapes className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>/canvas (dessin avec formes, flèches, texte et main levée)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">📤</span>
                <span>/extract (déplacer la puce avec toutes ses sous-puces vers une note nouvelle ou existante, choisie comme avec le bouton, laissant un [[lien]] à sa place ; le bouton « Rappeler la note » sur le lien annule cela)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🎙️</span>
                <span>/audio (enregistrer une note vocale : le bouton vert démarre, le rouge enregistre ; ou téléverser un fichier audio)</span>
              </div>
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main col-span-2">
                <span className="text-accent font-bold">🗣️</span>
                <span>/diktat (parler au lieu de taper : démarre immédiatement, appuyer sur « Arrêter » insère le texte dans la puce)</span>
              </div>
            </div>
          </div>
          <div className="pt-2 border-t border-border">
            <span className="font-semibold text-main block mb-1">Formatage instantané pendant la saisie :</span>
            <ul className="space-y-1 text-xs">
              <li><code className="text-accent font-mono">[] </code> ou <code className="text-accent font-mono">[ ] </code> au début d'une ligne la transforme immédiatement en case à cocher.</li>
              <li><code className="text-accent font-mono">[x] </code> la transforme en case cochée.</li>
              <li><code className="text-accent font-mono"># </code>, <code className="text-accent font-mono">## </code> ou <code className="text-accent font-mono">### </code> au début d'une ligne formate immédiatement le bloc en titre.</li>
            </ul>
          </div>
        </div>
      ),
    },
    // WORKSPACE: DRAWINGS
    {
      id: 'workspace-drawings',
      category: 'workspace',
      title: 'Dessins (/canvas)',
      subtitle: 'Croquis, organigrammes et cartes mentales directement dans la note',
      icon: Shapes,
      keywords: ['dessin', 'canvas', 'croquis', 'diagramme', 'organigramme', 'carte mentale', 'flèche', 'formes', 'main levée', 'grille', 'mermaid', 'en direct', 'dessiner à plusieurs'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">En créer un :</strong> Tape <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/canvas</kbd> (ou <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/draw</kbd>, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/sketch</kbd>) dans une puce vide ; l’éditeur s’ouvre en plein écran. Échap ou « Terminé » enregistre et ferme.
            </li>
            <li>
              <strong className="text-main">Outils :</strong> Sélection <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">V</kbd>, déplacer la vue <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">H</kbd> (ou maintenir la barre d’espace), rectangle <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">R</kbd>, ellipse <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">O</kbd>, losange <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">D</kbd>, flèche <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">A</kbd>, main levée <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">P</kbd>, texte <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">T</kbd>, gomme <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">E</kbd>. Avec Maj, rectangles et ellipses deviennent carrés et cercles ; <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">G</kbd> active ou désactive la grille magnétique. Couleur du trait, remplissage, épaisseur et pointillés se règlent sur la forme sélectionnée.
            </li>
            <li>
              <strong className="text-main">Texte et flèches :</strong> Double-clic (ou Entrée) sur une forme pour y écrire, double-clic sur une flèche pour lui donner une étiquette comme « oui » ou « non ». Les flèches s’accrochent aux formes et les suivent quand elles bougent ; elles sont droites, courbes ou à angles droits. Pour les flèches à angles droits, tu choisis où elles s’accrochent en tirant l’extrémité sur un côté de la forme (au milieu, elle s’aimante) ; chaque segment a une poignée pour le déplacer, un double-clic sur une poignée pleine supprime le segment. Une flèche accrochée ne se détache que par son extrémité.
            </li>
            <li>
              <strong className="text-main">Modifier :</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + Z</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + Y</kbd> annulent et rétablissent, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + D</kbd> duplique, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + C</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + V</kbd> copient et collent, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Suppr</kbd> supprime, les flèches du clavier déplacent la sélection.
            </li>
            <li>
              <strong className="text-main">Dans la note :</strong> Le dessin occupe la largeur de la note. Clique dedans, puis faire glisser déplace la vue, Ctrl + molette ou deux doigts zooment ; la molette seule fait toujours défiler la page. Un autre clic y met fin, une vue non enregistrée revient en douceur. Tire le bord inférieur pour changer la hauteur. « Enregistrer la vue » fixe cadrage, zoom et hauteur pour tout le monde, Le bouton de taille passe de la taille recommandée à « tout en grand » (dessins hauts) ou à la hauteur recommandée à déplacer sur le côté (dessins larges). Double-clic ou « Modifier » ouvre l’éditeur ; il démarre avec la main (seule la vue bouge), choisis un autre outil pour modifier. Le bouton aux flèches à côté de « Terminé » quitte sans enregistrer et demande d’abord s’il y a des modifications.
            </li>
            <li>
              <strong className="text-main">Dessiner à plusieurs :</strong> Dans les notes partagées, vous pouvez dessiner en même temps dans un même dessin. Qui l’ouvre pour le modifier lance un dessin en direct et en est l’hôte ; la note affiche alors « Dessin en direct : … ». Qui l’ouvre ensuite choisit « Dessiner aussi » ou « Regarder » et voit les formes, les pointeurs et les sélections des autres dans leur couleur, avec tous les participants en haut de l’éditeur. L’hôte enregistre avec « Terminé » pour tous ou abandonne pour tous ; les autres ont « Quitter ». Si l’hôte s’en va, celui qui est là depuis le plus longtemps prend le relais. Annuler ne reprend que tes propres modifications. Dessiner ensemble demande une connexion WebSocket ; sans elle (certains proxys d’entreprise), tu peux regarder en direct, et sans dessin en direct en cours tu modifies seul comme avant pendant que les autres regardent.
            </li>
            <li>
              <strong className="text-main">Hors ligne et brouillons :</strong> Ce que tu dessines hors ligne est enregistré dès le retour de la connexion ; un brouillon non enregistré est proposé à la restauration à la prochaine ouverture. Si tout le monde quitte un dessin en direct sans « Terminé », le serveur garde son état environ 10 minutes ; qui le rouvre dans ce délai reprend là où il en était.
            </li>
            <li>
              <strong className="text-main">Partout :</strong> La recherche trouve les mots des dessins, copier-coller conserve le dessin et l’export Markdown le contient en image SVG (l’import en refait un dessin). Les agents IA (MCP) lisent une description du dessin et peuvent eux-mêmes créer des dessins à partir d’organigrammes et de cartes mentales Mermaid.
            </li>
          </ul>
        </div>
      ),
    },
    // WORKSPACE: TABLES
    {
      id: 'workspace-tables',
      category: 'workspace',
      title: 'Tableaux (/table)',
      subtitle: 'Lignes et colonnes directement dans la note',
      icon: TableIcon,
      keywords: ['tableau', 'table', 'lignes', 'colonnes', 'en-tête', 'traits', 'cadre', 'aligner', 'centrer', 'markdown'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">En créer un :</strong> Tape <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/table</kbd> (ou <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">/tableau</kbd>) dans une puce : un tableau de 2 colonnes et 2 lignes apparaît, le texte déjà présent dans la puce va dans la première cellule. La première ligne est l’en-tête (en gras).
            </li>
            <li>
              <strong className="text-main">Saisir :</strong> <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Entrée</kbd> ajoute une ligne sous la ligne actuelle, <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Tab</kbd> / <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Maj + Tab</kbd> passent d’une cellule à l’autre (Tab dans la dernière cellule ajoute une ligne), les flèches changent de ligne et quittent le tableau en haut et en bas. <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Retour arrière</kbd> dans une ligne vide la supprime, dans un tableau entièrement vide le tableau. Gras, italique, liens et #hashtags fonctionnent comme dans le texte.
            </li>
            <li>
              <strong className="text-main">Colonnes :</strong> Le <strong className="text-main">+</strong> à droite du tableau ajoute une colonne (sur ordinateur, il apparaît quand la souris survole le tableau). En dessous, les trois points ouvrent le menu : aligner la colonne du curseur à gauche, au centre ou à droite (conservé dans le tableau Markdown), insérer une colonne à gauche ou à droite, supprimer la ligne ou la colonne du curseur, augmenter ou réduire le retrait de la puce.
            </li>
            <li>
              <strong className="text-main">Traits :</strong> Dans le même menu : <em>Standard</em> n’affiche que les traits intérieurs, estompés vers le bord, sans cadre ; <em>Cadre complet</em> tous les traits avec un cadre extérieur (coins selon le thème) ; <em>En-tête et colonnes</em> seulement le trait sous l’en-tête et les traits de colonne.
            </li>
            <li>
              <strong className="text-main">Téléphone :</strong> Les tableaux larges défilent sur le côté, la page ne bouge pas. Les cellules, le + et les trois points sont assez grands pour être touchés.
            </li>
            <li>
              <strong className="text-main">Partout :</strong> La copie, le collage, l’export Markdown et les agents IA (MCP) voient le tableau comme un tableau Markdown ; les tableaux Markdown collés et ceux des tableurs redeviennent un tableau.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-wikilinks-tags',
      category: 'workspace',
      title: 'WikiLinks ([[...]]), hashtags (#) & pages de tags',
      subtitle: 'Relier les connaissances de manière bidirectionnelle et filtrer par thème',
      icon: Tag,
      keywords: ['wikilinks', 'liens', 'maillage', 'hashtags', 'tags', 'filtre', 'mots-clés'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Dans MindSift, notes et pensées peuvent être reliées de nombreuses façons :</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Liens wiki :</strong> Avec <kbd className="px-1.5 py-0.5 bg-panel border border-border rounded font-mono text-[11px] text-accent">Ctrl + L</kbd> ou <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">/link</code>, tu relies une autre note ou une seule puce ; un clic l’ouvre. Le lien affiche toujours le titre actuel de la note et fonctionne encore si tu la renommes ou la déplaces, même avec deux notes du même nom. Le texte sélectionné avant devient le texte du lien. À la main, <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[Nom de la note]]</code> marche aussi. Si la note liée n’existe plus, un clic demande s’il faut la créer ou supprimer le lien.
            </li>
            <li>
              <strong className="text-main">Hashtags :</strong> tape <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">#tag</code> directement dans le texte. Les hashtags regroupent automatiquement les thèmes dans la vue d'ensemble des tags.
            </li>
            <li>
              <strong className="text-main">Vue d'ensemble des tags :</strong> clique sur un hashtag dans la barre latérale pour afficher toutes les puces et notes contenant ce tag sous forme de tuiles filtrables.
            </li>
            <li>
              <strong className="text-main">Rétroliens (Backlinks) :</strong> en bas de chaque note, une section affiche toutes les autres notes qui font référence à la note actuelle.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-zoom-drag',
      category: 'workspace',
      title: 'Zoom hoisting, glisser-déposer et favoris',
      subtitle: 'Garder le focus et organiser les notes en toute liberté',
      icon: Pin,
      keywords: ['autre note', 'extraire', 'hoisting', 'zoom', 'glisser', 'déposer', 'dossiers', 'déplacer', 'épingler', 'fil d ariane'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Zoom hoisting :</strong> clique directement sur la puce (<code className="text-accent">•</code>) d'un bloc pour zoomer sur cette branche uniquement. Le fil d'Ariane en haut te permet de revenir en arrière étape par étape à tout moment ; sur le téléphone, l'icône de la maison te ramène au début de la note et le bouton retour remonte d'un niveau.
            </li>
            <li>
              <strong className="text-main">Déplacer des blocs :</strong> saisis une puce en maintenant le bouton de la souris enfoncé pour la déplacer avec toutes ses sous-puces vers un nouvel emplacement.
            </li>
            <li>
              <strong className="text-main">Vers une autre note :</strong> fais glisser la puce sur une note de la barre latérale et toute la branche passe à la fin de cette note. Déposée sur le + de nouvelle note en haut de la barre latérale, elle devient une nouvelle note à part entière. Le message qui suit propose « Ouvrir » et « Annuler », Ctrl+Z fonctionne aussi ; les tâches liées suivent.
            </li>
            <li>
              <strong className="text-main">Extraire :</strong> le bouton « Transformer en note » à droite de la puce demande la destination : Entrée crée une nouvelle note, en tapant tu cherches une note existante. Un lien vers la puce déplacée reste à l’ancien endroit.
            </li>
            <li>
              <strong className="text-main">Dossiers et arborescence :</strong> dans la barre latérale, organise tes notes dans des dossiers et sous-dossiers par glisser-déposer.
            </li>
            <li>
              <strong className="text-main">Épingler des notes :</strong> épingle tes notes les plus importantes en haut de la barre latérale avec l'icône d'épingle pour y accéder instantanément.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-collab-locks',
      category: 'workspace',
      title: 'Collaboration en temps réel, verrous & conflits',
      subtitle: 'Travailler ensemble sans risque d\'écrasement accidentel',
      icon: Lock,
      keywords: ['collaboration', 'verrous', 'conflits', 'en direct', 'présence', 'partage'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>MindSift prend en charge le travail collaboratif sur les documents avec une protection intégrée contre la perte de données :</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Verrous de bloc :</strong> pendant que quelqu'un modifie une puce, une icône de cadenas apparaît avec le nom de l'utilisateur. Les autres utilisateurs ne peuvent pas modifier cette puce à ce moment-là.
            </li>
            <li>
              <strong className="text-main">Copies de conflit :</strong> si des modifications surviennent simultanément ou hors ligne, le serveur n'écrase jamais silencieusement tes données : une copie surlignée en jaune apparaît juste sous la puce d'origine, avec trois boutons : <em>« Utiliser »</em> remplace le texte d'origine (Ctrl+Z l'annule), <em>« Garder les deux »</em> retire seulement le marquage et laisse les deux puces, <em>« Ignorer »</em> supprime la copie. Tant que quelqu'un modifie la puce d'origine, « Utiliser » est grisé et une ligne indique qui la tient. Tant que tu n'as pas choisi, la copie reste collée à sa puce : Entrée dans la puce d'origine ajoute la nouvelle puce sous la copie, et l'indentation ou le déplacement l'emmène avec elle.
            </li>
            <li>
              <strong className="text-main">Indicateur de présence :</strong> en haut à droite de la note, tu vois qui est actuellement en train de consulter ou modifier le document.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-global-todos',
      category: 'workspace',
      title: 'Rollup global des tâches & liens de tâches',
      subtitle: 'Toutes les tâches ouvertes de l\'ensemble des notes réunies en un seul endroit',
      icon: SquareCheckBig,
      keywords: ['rollup', 'todos', 'cases à cocher', 'tâche étendue', 'global', 'tâches'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            L'onglet de l'espace de travail <strong className="text-main">« Tâches »</strong> rassemble automatiquement toutes les cases à cocher non cochées (<code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">- [ ]</code>) de toutes tes notes.
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Synchronisation bidirectionnelle :</strong> coche une tâche dans la liste globale et le bloc correspondant dans la note d'origine est mis à jour en temps réel.
            </li>
            <li>
              <strong className="text-main">Tâche étendue :</strong> via le menu contextuel d'une puce ou la commande slash <code className="text-accent font-mono">/todo</code>, transforme une simple ligne de note en une tâche complète avec date d'échéance, priorité et assignation.
            </li>
            <li>
              <strong className="text-main">Accès direct :</strong> clique sur le titre de la note à côté d'une tâche dans le rollup pour ouvrir directement la note à l'emplacement exact de la tâche.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'workspace-search-cmdk',
      category: 'workspace',
      title: 'Recherche globale & palette de commandes (Cmd+K)',
      subtitle: 'Recherche plein texte FTS5 dans les notes, blocs, tâches et listes',
      icon: Command,
      keywords: ['recherche', 'commande', 'palette', 'cmdk', 'trouver', 'fts', 'plein texte', 'clavier'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Appuie sur <kbd className={kbd}>Cmd + K</kbd> / <kbd className={kbd}>Ctrl + K</kbd> ou <kbd className={kbd}>/</kbd> (lorsqu'aucun champ de texte n'est actif) pour ouvrir la recherche globale :
          </p>
          <ul className="space-y-1.5 list-disc list-inside">
            <li>
              <strong className="text-main">Recherche plein texte (FTS5) :</strong> recherche instantanément dans les titres de notes et les blocs, les tâches et les éléments de listes, avec classement par pertinence (BM25) et recherche par préfixe.
            </li>
            <li>
              <strong className="text-main">Filtres rapides :</strong> filtre par statut (ouvert / terminé), priorité, date d'échéance ou dossier pour cibler exactement ce que tu cherches.
            </li>
            <li>
              <strong className="text-main">Navigation au clavier :</strong> utilise les touches <kbd className={kbd}>↑</kbd> et <kbd className={kbd}>↓</kbd> pour naviguer dans les résultats et appuie sur <kbd className={kbd}>Entrée</kbd> pour ouvrir directement l'élément sélectionné.
            </li>
          </ul>
        </div>
      ),
    },

    // TRIAGE & QUICK CAPTURE
    {
      id: 'triage-capture',
      category: 'triage',
      title: 'Barre de saisie instantanée (Instant Capture Bar)',
      subtitle: 'Capturer des pensées en moins d\'une seconde – au clavier ou à la voix',
      icon: Layers,
      keywords: ['capture', 'saisie rapide', 'dictée', 'voix', 'microphone', 'boîte de réception', 'c'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Le Quick Dump garantit qu'aucune idée fugace ne se perde. Sur ordinateur, le <strong className="text-main">+</strong> rond dans la barre de gauche l'ouvre en fenêtre par-dessus tout ; sur mobile, le <strong className="text-main">+</strong> en bas au centre :</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Au clavier :</strong> appuie sur <kbd className={kbd}>C</kbd> n'importe où dans l'application (sauf si tu écris dans un champ de texte). <kbd className={kbd}>Entrée</kbd> enregistre et la fenêtre reste ouverte pour l'idée suivante ; <kbd className={kbd}>Échap</kbd> ou un clic à côté la ferme.
            </li>
            <li>
              <strong className="text-main">Dictée vocale :</strong> clique sur l'icône de micro (<Mic className="w-3.5 h-3.5 inline text-accent" />) ou maintiens appuyé le bouton d'action flottant (+) sur mobile pour dicter ta pensée. La reconnaissance vocale la transcrit en temps réel.
            </li>
            <li>
              <strong className="text-main">Destination personnalisée :</strong> par défaut, les pensées arrivent dans le Quick Dump (pour triage ultérieur), mais tu peux aussi les envoyer directement comme tâche, note ou élément de liste en un clic.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'triage-deck-decisions',
      category: 'triage',
      title: 'Deck de triage : décider avec 1 touche ou un geste tactile',
      subtitle: 'Traiter la boîte de réception à vitesse grand V et garder l\'esprit serein',
      icon: Sparkles,
      keywords: ['triage', 'deck', 'h', 'l', 't', 'd', 'espace', 'balayer', 'corbeille', 'gestes'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Le deck de triage présente chaque pensée collectée carte par carte. Tu tranches en une fraction de seconde :</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1">
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Clavier (ordinateur) :</span>
              <ul className="space-y-1 font-mono text-[11px]">
                <li><strong className="text-status-err">H</strong> ou <strong>←</strong> : jeter (corbeille)</li>
                <li><strong className="text-status-ok">L</strong> ou <strong>→</strong> : transformer en tâche</li>
                <li><strong className="text-accent">T</strong> : planifier comme tâche avec date</li>
                <li><strong className="text-accent">D</strong> : transformer en note de Workspace</li>
                <li><strong className="text-muted">Espace</strong> : décider plus tard (fin de pile)</li>
              </ul>
            </div>
            <div className="p-2.5 bg-panel border border-border rounded">
              <span className="font-semibold text-main block mb-1">Mobile &amp; tactile :</span>
              <ul className="space-y-1 text-[11px]">
                <li>👉 <strong>Balayer vers la droite :</strong> tâche</li>
                <li>👈 <strong>Balayer vers la gauche :</strong> jeter</li>
                <li>👆 <strong>Appui long :</strong> menu d'options</li>
                <li>👆 <strong>Appuyer dans la file :</strong> faire passer devant</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'triage-webhooks',
      category: 'triage',
      title: 'API : curl, domotique & agents IA (MCP)',
      subtitle: 'Lire et modifier tâches et listes via curl ou Home Assistant, injecter des pensées, connecter des agents IA comme Claude Code.',
      icon: Bell,
      keywords: ['webhooks', 'api', 'jeton', 'home assistant', 'siri', 'raccourcis', 'automatisation', 'curl', 'mcp', 'ia', 'agent', 'claude', 'codex'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            MindSift dispose d'une API. Dans <em className="text-main">Paramètres du compte → API</em>, crée des clés personnelles et définis précisément par interrupteur ce que chacune peut faire : lire, créer ou modifier tâches, listes, notes et boîte de réception. Ces autorisations s'appliquent aux deux modes d'accès ; les notes ainsi que la lecture et le tri de la boîte de réception ne sont accessibles que via MCP. Une clé n'accède jamais aux paramètres.
          </p>
          <p>
            <strong className="text-main">curl et domotique :</strong> avec les droits de lecture, <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">GET /api/v1/thoughts?due=today</code> renvoie les tâches du jour au format JSON (par ex. pour un capteur Home Assistant) ; avec les droits de modification, tu peux cocher des tâches. Via <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">POST /api/v1/webhooks/ingest</code>, Home Assistant, n8n ou des scripts peuvent injecter directement des alertes ou des points dans la boîte de réception, les tâches ou les listes.
          </p>
          <p>
            <strong className="text-main">Agents IA (MCP) :</strong> Claude Code, Cursor, Codex et Claude Desktop se connectent via le protocole standardisé Model Context Protocol (MCP) avec une clé d'API. claude.ai et ChatGPT se connectent sans clé comme connecteur : MindSift demande lors de la connexion quelles autorisations accorder.
          </p>
        </div>
      ),
    },

    // TASKS & KANBAN
    {
      id: 'tasks-kanban',
      category: 'tasks',
      title: 'Vue en liste & tableau Kanban modulable',
      subtitle: 'Visualiser les tâches et les piloter grâce à des colonnes personnalisées',
      icon: Columns2,
      keywords: ['tâches', 'kanban', 'tableau', 'colonnes', 'glisser', 'déposer', 'listes'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>
            Les tâches peuvent être gérées dans une <strong className="text-main">vue en liste</strong> classique ou sur le{' '}
            <strong className="text-main">tableau Kanban</strong> interactif :
          </p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Changer de vue :</strong> utilise le sélecteur en haut à droite pour basculer entre la liste et le Kanban.
            </li>
            <li>
              <strong className="text-main">Colonnes Kanban personnalisées :</strong> dans les paramètres des colonnes, définis des colonnes sur mesure pour chaque liste de tâches (par ex. « En attente de retour », « Revue »), avec couleurs et indicateur d'achèvement.
            </li>
            <li>
              <strong className="text-main">Glisser-déposer :</strong> déplace simplement les cartes d'une colonne à une autre pour actualiser leur statut.
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'tasks-details-alarms',
      category: 'tasks',
      title: 'Sous-tâches, échéances & alertes automatiques',
      subtitle: 'Listes de contrôle avec barre de progression, notes en Markdown et notifications',
      icon: SquareCheckBig,
      keywords: ['sous-tâches', 'alarmes', 'notifications', 'e-mail', 'discord', 'date', 'échéance', 'priorité', 'assigner', 'assigné'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Sous-tâches :</strong> crée une checklist au sein de n'importe quelle tâche avec barre de progression visible (par ex. « 3 sur 5 terminées »). La poignée à gauche permet de réordonner les sous-tâches à la souris ou au doigt, les touches fléchées le font au clavier.
            </li>
            <li>
              <strong className="text-main">Nouvelle tâche dans une colonne Kanban :</strong> « Ajouter une tâche » en bas de la colonne ouvre directement la fenêtre de tâche avec colonne et liste préremplies ; saisis simplement le titre. Cliquer sur le titre d'une tâche existante permet de la renommer immédiatement.
            </li>
            <li>
              <strong className="text-main">Répétition :</strong> sous <em>Répétition</em>, choisis quotidien, hebdomadaire, mensuel ou annuel. Cocher la tâche crée automatiquement la suivante pour la prochaine occurrence.
            </li>
            <li>
              <strong className="text-main">Alertes &amp; notifications :</strong> reçois des alertes par e-mail, webhook Discord ou notifications push sur tes appareils à l'approche d'une échéance (par ex. 15 minutes ou 1 jour avant). Les alertes par e-mail vont à ton adresse de connexion. Une nouvelle adresse de connexion ne compte qu'après un clic sur le lien de l'e-mail de confirmation qui lui est envoyé ; d'ici là, l'ancienne reste valable.
            </li>
            <li>
              <strong className="text-main">Rappels par tâche :</strong> Dans la fenêtre de détail, coche une ou plusieurs heures sous « Rappel », p. ex. 2 semaines avant et le jour de l’échéance. Pour cette tâche, ils remplacent ton délai et valent pour tous ceux qui reçoivent son alarme d’échéance ; « Par défaut » revient au délai des paramètres. Sans heure, MindSift rappelle des jours entiers avant, à 9 h. Les tâches avec leurs propres rappels portent une petite 🔔.
            </li>
            <li>
              <strong className="text-main">Autres notifications :</strong> Quand quelqu’un t’attribue une tâche, qu’une nouvelle tâche arrive dans une liste partagée ou qu’une tâche y est terminée, MindSift peut te prévenir ; chaque événement s’active ou se désactive séparément dans les paramètres, sous « Alarmes ». Les tâches que tu <strong className="text-main">suis</strong> signalent chaque modification (statut, priorité, échéance, texte, description, sous-tâches, attribution …), même cochées dans une note. MindSift ne te signale jamais ce que tu fais toi-même. Plusieurs événements arrivent regroupés dans un seul message. La <strong className="text-main">cloche</strong> (ordinateur : en bas de la barre de gauche ; mobile : à côté de la recherche) rassemble tout ce qui s’est passé ces 14 derniers jours, même sans canal activé ; un clic sur une entrée ouvre la tâche ou la note.
            </li>
            <li>
              <strong className="text-main">Mentions avec @ :</strong> Dans la description d’une tâche, dans les sous-tâches et dans les notes, <strong className="text-main">@</strong> ouvre une liste de personnes (flèches, Entrée). Celles sans accès apparaissent grisées. La personne mentionnée reçoit une notification (Paramètres → Alarmes, « On m’a mentionné »), même depuis une liste en sourdine ; enregistrer à nouveau n’en envoie pas une deuxième.
            </li>
            <li>
              <strong className="text-main">Menu de la liste (⋯) :</strong> À droite au-dessus de la liste : <strong className="text-main">Mettre en sourdine</strong> (listes partagées seulement : aucune notification de cette liste ; attributions, mentions et tâches suivies arrivent toujours), Partager, Renommer et Supprimer. Si toutes les listes ne tiennent pas dans la ligne, les autres sont derrière « ⋯ n ». Dans une liste partagée, une nouvelle tâche t’est d’abord attribuée ; l’alerte d’échéance va aux personnes attribuées, ou à tous les membres si personne ne l’est.
            </li>
            <li>
              <strong className="text-main">Calendrier :</strong> Une troisième vue à côté de la liste et du Kanban : mois ou semaine sur ordinateur, la semaine sur téléphone. Les tâches sans date sont dans « Non planifiées » ; glisse-en une sur un jour pour lui donner une date (l’heure reste), de retour dans « Non planifiées » pour l’enlever, <strong className="text-main">Ctrl + Z</strong> annule. Les tâches répétées montrent aussi leurs prochaines dates, grisées avec ↻. À gauche, une colonne bascule entre le jour choisi (aujourd’hui tant que tu n’en as pas choisi un) avec ses tâches et les tâches non planifiées. ← → pour feuilleter, T revient à aujourd’hui. Sur ordinateur, du lundi au vendredi occupent la largeur ; le week-end s’atteint en faisant défiler sur le côté ou avec « sam. – dim. › ». Mois ou semaine se choisit à droite des hashtags ; un cran de molette fait défiler les barres du dessus.
            </li>
            <li>
              <strong className="text-main">Suivre des tâches :</strong> avec l'icône en forme d'œil dans le détail de la tâche, abonne-toi aux notifications lors de modifications apportées par d'autres personnes.
            </li>
          </ul>
        </div>
      ),
    },

    // LISTS: SHARED SHOPPING & CHECKLISTS
    {
      id: 'lists-shared-shopping',
      category: 'lists',
      title: 'Listes partagées, quantités & catégories par hashtag',
      subtitle: 'Listes de courses en temps réel, listes de bagages et check-lists',
      icon: ShoppingCart,
      keywords: ['listes', 'courses', 'achats', 'checklist', 'quantités', 'catégories', 'hashtag', 'temps réel'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <p>Les listes partagées sont idéales pour les courses communes, les valises et les listes de choses à faire à plusieurs :</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Quantités automatiques :</strong> une saisie comme <code className="text-accent font-mono">2x lait bio</code> ou <code className="text-accent font-mono">500g pâtes</code> sépare automatiquement la quantité et le libellé.
            </li>
            <li>
              <strong className="text-main">Catégories par hashtag :</strong> ajoute un hashtag comme <code className="text-accent font-mono">#frais</code> ou <code className="text-accent font-mono">#légumes</code>. La liste regroupe automatiquement les articles dans les sections correspondantes.
            </li>
            <li>
              <strong className="text-main">Synchronisation en direct &amp; nettoyage :</strong> les éléments cochés se synchronisent en temps réel et indiquent qui les a cochés. Le bouton de nettoyage supprime tous les éléments cochés d'un seul coup.
            </li>
          </ul>
        </div>
      ),
    },

    // APPEARANCE: CUSTOM THEMES
    {
      id: 'workspace-custom-themes',
      category: 'account',
      title: 'Apparence & thèmes personnalisés',
      subtitle: 'Choisir un design prêt à l\'emploi ou téléverser son propre thème CSS',
      icon: Sparkles,
      keywords: ['thème', 'design', 'couleurs', 'css', 'sombre', 'clair', 'apparence'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Changer de thème :</strong> dans le menu de profil en haut à droite ou sous <em>Paramètres du compte → Apparence &amp; thèmes</em>.
            </li>
            <li>
              <strong className="text-main">Thème personnalisé :</strong> télécharge ou colle le modèle, ajuste les couleurs et les arrondis, téléverse-le ou colle-le sous forme de fichier <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">.css</code> et choisis « Enregistrer &amp; activer ». Le thème s'applique immédiatement et est disponible sur tous tes appareils.
            </li>
          </ul>
        </div>
      ),
    },

    // ACCOUNT: OFFLINE, BACKUPS & PASSWORD
    {
      id: 'account-offline-backups',
      category: 'account',
      title: 'Hors ligne, sauvegardes et mot de passe',
      subtitle: 'Continuer sans Internet, restaurer des sauvegardes, réinitialiser le mot de passe',
      icon: CloudOff,
      keywords: ['hors ligne', 'offline', 'internet', 'sauvegarde', 'restaurer', 'mot de passe', 'oublié', 'compte', 'deux facteurs', '2fa', 'authentification', 'sécurité', "clé d'accès", 'passkey', 'empreinte', 'sso', 'oidc'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Sauvegardes du serveur :</strong> si l'administration a activé les sauvegardes automatiques, tu trouveras les sauvegardes quotidiennes de tes données sous <em>Paramètres du compte → Export &amp; import</em>. Tu peux les télécharger ou les restaurer, y compris pour des domaines individuels comme les listes ou les tâches. Chaque sauvegarde contient aussi tes notes, tâches et listes en Markdown dans le dossier <em>Obsidian</em>, lisibles dans Obsidian ou n'importe quel éditeur de texte, même sans MindSift.
            </li>
            <li>
              <strong className="text-main">Sans connexion Internet :</strong> installée comme application (ou dans le navigateur), MindSift démarre également hors ligne avec le dernier état chargé. La capture de pensées et la validation de tâches ou de listes continuent de fonctionner ; un indicateur en bas affiche le nombre de modifications en attente, qui sont synchronisées dès le rétablissement de la connexion.
            </li>
            <li>
              <strong className="text-main">Où restent les modifications hors ligne :</strong> Les notes que tu as déjà ouvertes sur cet appareil peuvent être lues et modifiées hors ligne. Ce qui n’est pas encore envoyé n’est enregistré que dans ce navigateur : cela survit à la fermeture, au redémarrage et à l’extinction, et est envoyé automatiquement au prochain démarrage de MindSift avec une connexion. Cela disparaît si tu te déconnectes (MindSift demande avant), effaces les données du navigateur ou travailles dans une fenêtre privée. Après avoir travaillé hors ligne, reconnecte-toi donc bientôt avec le même appareil. Si quelqu’un a modifié la même puce entre-temps, rien n’est perdu : ta version apparaît en dessous comme copie de conflit.
            </li>
            <li>
              <strong className="text-main">Mot de passe oublié :</strong> si l'administration a configuré l'envoi d'e-mails, la fenêtre de connexion affiche « Mot de passe oublié ? ». Tu reçois un lien valable une heure ; la définition du nouveau mot de passe te déconnecte de tous les appareils.
            </li>
            <li>
              <strong className="text-main">Connexion à deux facteurs :</strong> sous <em>Paramètres du compte → Sécurité</em>, tu relies une application d'authentification (scanner le code QR, saisir le premier code) ; ensuite, la connexion demande après le mot de passe le code à six chiffres de l'application. Les dix codes de récupération affichés une seule fois servent si le téléphone manque : chacun fonctionne une fois. Avec « Faire confiance à cet appareil pendant 30 jours », un appareil à toi ne demande pas de code pendant un mois. « Mot de passe oublié » ne désactive pas la connexion à deux facteurs.
            </li>
            <li>
              <strong className="text-main">Clés d'accès :</strong> sous <em>Paramètres du compte → Sécurité → Clés d'accès</em>, tu crées une clé d'accès (confirmer le mot de passe, lui donner un nom, empreinte digitale, visage ou code PIN de l'appareil). Ensuite, « Se connecter avec une clé d'accès » te connecte sans aucun mot de passe ; certains navigateurs la proposent aussi directement dans le champ de connexion. Si tu te connectes avec le mot de passe, la clé d'accès est demandée ensuite : une clé d'accès compte comme second facteur, même sans application d'authentification. Les codes de récupération apparaissent avec la première clé d'accès. Retirer le dernier second facteur désactive de nouveau la connexion à deux facteurs. Les clés d'accès ne sont disponibles que si le serveur a une adresse https fixe (BASE_URL).
            </li>
            <li>
              <strong className="text-main">Connexion via un fournisseur (SSO) :</strong> Si l'administration a configuré un fournisseur comme Authentik, Authelia ou Keycloak, l'écran de connexion affiche « Se connecter avec … ». La première fois, ton compte est créé, ou un compte existant avec la même adresse vérifiée est lié ; tu lies un compte avec une autre adresse sous <em>Paramètres du compte → Sécurité</em>. La connexion à deux facteurs revient alors au fournisseur. Tu confirmes les modifications sensibles comme une nouvelle adresse, un mot de passe, des clés d'API ou la suppression en te reconnectant chez lui ; tu as ensuite cinq minutes. Si la connexion avec mot de passe est désactivée, il ne reste que ce bouton, et l'administration dispose d'un accès de secours sous <em>/?login=password</em>.
            </li>
          </ul>
        </div>
      ),
    },

    // COLLABORATION: ORGANIZATIONS, GROUPS & SHARING
    {
      id: 'collab-teams-sharing',
      category: 'collaboration',
      title: 'Organisations, groupes & partages',
      subtitle: 'Qui peut partager avec qui, et partager notes, dossiers et listes en toute sécurité',
      icon: Users,
      keywords: ['équipes', 'groupes', 'organisation', 'visibilité', 'privé', 'partage', 'partager', 'autorisations', 'éditeur', 'lecteur', 'dossiers', 'public', 'lien'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Qui peut partager avec qui :</strong> l'administrateur du serveur décide : avec tout le monde, uniquement avec les personnes avec qui tu as au moins une <em>organisation</em> en commun, ou avec personne (mode « Privé » : pas de partage, pas de groupes). Tu peux appartenir à plusieurs organisations ; les administrateurs et la gestion des utilisateurs s'en occupent. Si la recherche de personnes est désactivée, tu saisis l'adresse e-mail ou le nom d'utilisateur exacts lors du partage. Les personnes qui travaillent avec toi sur quelque chose y apparaissent toujours avec leur nom.
            </li>
            <li>
              <strong className="text-main">Groupes :</strong> regroupe les personnes visibles au sein de groupes (par ex. famille, colocation, projet) et partage avec tous simultanément. Le créateur du groupe en est l'administrateur ; seuls les membres peuvent partager avec un groupe.
            </li>
            <li>
              <strong className="text-main">Seul le propriétaire partage :</strong> les éditeurs peuvent modifier le contenu mais ne peuvent pas le repartager. Tu peux quitter un partage qui t'a été accordé à tout moment. Si quelqu'un quitte une organisation ou un groupe, les partages autorisés uniquement par leur biais prennent fin automatiquement.
            </li>
            <li>
              <strong className="text-main">Lien public :</strong> dans la fenêtre de partage, tu peux partager une de tes notes en lecture seule par lien, y compris avec des personnes sans compte, avec mot de passe en option. Le lien expire toujours (d'1 heure à 14 jours), peut être retiré à tout moment et n'apparaît pas dans les moteurs de recherche. Les visiteurs voient les modifications en direct, mais ni valeurs masquées ni noms. C'est l'administrateur du serveur qui décide si c'est disponible.
            </li>
            <li>
              <strong className="text-main">Rôles (éditeur vs lecteur) :</strong> lors du partage de notes, dossiers ou listes, choisis entre <em>Éditeur</em> (accès complet au contenu et aux listes) et <em>Lecture seule</em> (consultation seule avec mises à jour en direct).
            </li>
            <li>
              <strong className="text-main">Arborescence personnelle :</strong> chaque destinataire peut intégrer des documents et dossiers partagés dans sa propre arborescence de dossiers sans modifier l'organisation du propriétaire.
            </li>
          </ul>
        </div>
      ),
    },
  ],
  shortcuts: [
    { key: 'Cmd + K / Ctrl + K ou /', scope: 'Global', desc: 'Ouvrir la recherche globale en texte intégral (palette de commandes)' },
    { key: 'C', scope: 'Global', desc: 'Ouvrir le Quick Dump (sur ordinateur en fenêtre par-dessus tout)' },
    { key: 'Entrée', scope: 'Quick Dump', desc: 'Enregistrer la pensée ; la fenêtre reste ouverte pour la suivante' },
    { key: 'Échap', scope: 'Quick Dump', desc: 'Effacer la saisie et fermer la fenêtre' },
    { key: 'Entrée', scope: 'Outliner Workspace', desc: 'Créer une nouvelle puce (ou désindenter un bloc vide)' },
    { key: 'Tab', scope: 'Outliner Workspace', desc: 'Indenter la puce vers la droite (l\'imbriquer)' },
    { key: 'Maj + Tab', scope: 'Outliner Workspace', desc: 'Désindenter la puce vers la gauche' },
    { key: 'Maj + Entrée', scope: 'Outliner Workspace', desc: 'Saut de ligne doux au sein du bloc' },
    { key: 'Retour arrière', scope: 'Outliner Workspace', desc: 'Sur un bloc vide : supprimer le bloc ; au début : fusionner' },
    { key: '↑ / ↓', scope: 'Outliner Workspace', desc: 'Naviguer vers le bloc précédent / suivant' },
    { key: 'Ctrl + L / Cmd + L', scope: 'Outliner Workspace', desc: 'Insérer un lien (note, puce ou lien web) ; le texte sélectionné devient le texte du lien' },
    { key: 'Ctrl + Maj + ↓', scope: 'Outliner Workspace', desc: 'Déplier toutes les puces repliées de la note' },
    { key: 'Ctrl + Maj + ↑', scope: 'Outliner Workspace', desc: 'Replier toutes les puces de la note (en mode focus, seulement dans la branche)' },
    { key: 'Ctrl + clic sur ▸ / ▾', scope: 'Outliner Workspace', desc: 'Déplier ou replier une puce avec toutes ses sous-puces' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Outliner Workspace', desc: 'Annuler la dernière action dans la note' },
    { key: 'Ctrl + Y / Ctrl + Maj + Z', scope: 'Outliner Workspace', desc: 'Rétablir une action annulée' },
    { key: 'Glisser la souris sur plusieurs puces', scope: 'Outliner Workspace', desc: 'Sélectionner le texte sur plusieurs puces ; Suppr/Retour arrière le supprime, taper le remplace, Ctrl + C copie en Markdown (indentation, tâches, titres)' },
    { key: 'Ctrl + A deux fois', scope: 'Outliner Workspace', desc: 'Sélectionne d\'abord la puce, puis toute la note ; Ctrl + C la copie en Markdown, coller recrée les mêmes puces' },
    { key: 'Ctrl + Z / Cmd + Z', scope: 'Tâches', desc: 'Annuler la suppression, le déplacement ou la validation' },
    { key: '/', scope: 'Outliner Workspace', desc: 'Ouvrir le menu slash (/todo, /link, /h1, /code, ...)' },
    { key: '[] ou [ ] au début', scope: 'Outliner Workspace', desc: 'Transformer immédiatement en case à cocher à faire' },
    { key: '[x] au début', scope: 'Outliner Workspace', desc: 'Transformer immédiatement en case à cocher terminée' },
    { key: '#, ##, ### au début', scope: 'Outliner Workspace', desc: 'Transformer immédiatement en titre H1, H2 ou H3' },
    { key: '[[Titre de la note]]', scope: 'Outliner Workspace', desc: 'Intégrer un WikiLink interactif vers une note' },
    { key: '#nomdutag', scope: 'Workspace / listes', desc: 'Hashtag en ligne pour lier ou catégoriser' },
    { key: 'V, H, R, O, D, A, P, T, E · G', scope: 'Dessin', desc: 'Choisir un outil (sélection, déplacer, rectangle, ellipse, losange, flèche, main levée, texte, gomme) · grille oui/non' },
    { key: 'H ou ←', scope: 'Deck de triage', desc: 'Jeter la pensée (vers la corbeille)' },
    { key: 'L ou →', scope: 'Deck de triage', desc: 'Transformer la pensée en tâche immédiatement' },
    { key: 'T', scope: 'Deck de triage', desc: 'Créer une tâche avec date d\'échéance' },
    { key: 'D', scope: 'Deck de triage', desc: 'Transformer la pensée en document de note' },
    { key: 'Espace', scope: 'Deck de triage', desc: 'Passer la carte (« Plus tard » – vers la fin de la pile)' },
    { key: 'Balayer vers la gauche', scope: 'Triage (tactile/mobile)', desc: 'Jeter la pensée' },
    { key: 'Balayer vers la droite', scope: 'Triage (tactile/mobile)', desc: 'Prendre en charge la pensée comme tâche' },
    { key: 'Maintenir appuyé', scope: 'Triage (tactile/mobile)', desc: 'Ouvrir le menu d\'action (date, liste, note)' },
  ],
};

export default fr;
