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
      keywords: ['slash', 'commandes', 'tâche', 'lien', 'h1', 'h2', 'h3', 'code', 'callout', 'séparateur', 'image', 'extraire', 'fusionner', 'audio', 'note vocale', 'dictée', 'photo', 'auto-formatage'],
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
              <div className="p-1.5 bg-panel rounded border border-border flex items-center gap-1.5 text-main">
                <span className="text-accent font-bold">💬</span>
                <span>/callout (encadré)</span>
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
                <span className="text-accent font-bold">📤</span>
                <span>/extract (déplacer la puce avec toutes ses sous-puces vers sa propre note, laissant un [[lien]] à sa place ; le bouton « Rappeler la note » sur le lien annule cela)</span>
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
              <strong className="text-main">WikiLinks :</strong> écris <code className="text-accent bg-panel px-1 py-0.5 rounded font-mono">[[Nom de la note]]</code> pour créer un lien direct vers une autre note. Un clic ouvre immédiatement la note cible.
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
      keywords: ['hoisting', 'zoom', 'glisser', 'déposer', 'dossiers', 'déplacer', 'épingler', 'fil d ariane'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Zoom hoisting :</strong> clique directement sur la puce (<code className="text-accent">•</code>) d'un bloc pour zoomer sur cette branche uniquement. Le fil d'Ariane en haut te permet de revenir en arrière étape par étape à tout moment.
            </li>
            <li>
              <strong className="text-main">Déplacer des blocs :</strong> saisis une puce en maintenant le bouton de la souris enfoncé pour la déplacer avec toutes ses sous-puces vers un nouvel emplacement.
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
              <strong className="text-main">Copies de conflit :</strong> si des modifications surviennent simultanément ou hors ligne, le serveur n'écrase jamais silencieusement tes données : une version en conflit est créée pour que tu puisses choisir quelle version conserver.
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
      icon: CheckSquare,
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
          <p>La barre de saisie rapide en haut de l'écran garantit qu'aucune idée fugace ne se perde :</p>
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Focus instantané :</strong> appuie sur <kbd className={kbd}>C</kbd> ou <kbd className={kbd}>/</kbd> n'importe où dans l'application (sauf si tu es déjà en train d'écrire dans un champ de texte).
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
      icon: Columns,
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
      icon: CheckSquare,
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
              <strong className="text-main">Alertes &amp; notifications :</strong> reçois des alertes par e-mail, webhook Discord ou notifications push sur tes appareils à l'approche d'une échéance (par ex. 15 minutes ou 1 jour avant).
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
      category: 'workspace',
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
            <li>
              <strong className="text-main">Sauvegardes du serveur :</strong> si l'administration a activé les sauvegardes automatiques, tu trouveras les sauvegardes quotidiennes de tes données sous <em>Paramètres du compte → Export &amp; import</em>. Tu peux les télécharger ou les restaurer, y compris pour des domaines individuels comme les listes ou les tâches.
            </li>
            <li>
              <strong className="text-main">Sans connexion Internet :</strong> installée comme application (ou dans le navigateur), MindSift démarre également hors ligne avec le dernier état chargé. La capture de pensées et la validation de tâches ou de listes continuent de fonctionner ; un indicateur en bas affiche le nombre de modifications en attente, qui sont synchronisées dès le rétablissement de la connexion.
            </li>
            <li>
              <strong className="text-main">Mot de passe oublié :</strong> si l'administration a configuré l'envoi d'e-mails, la fenêtre de connexion affiche « Mot de passe oublié ? ». Tu reçois un lien valable une heure ; la définition du nouveau mot de passe te déconnecte de tous les appareils.
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
      subtitle: 'Qui voit qui, et partager notes, dossiers et listes en toute sécurité',
      icon: Users,
      keywords: ['équipes', 'groupes', 'organisation', 'visibilité', 'privé', 'partage', 'partager', 'autorisations', 'éditeur', 'lecteur', 'dossiers'],
      content: (
        <div className="space-y-2 text-muted leading-relaxed">
          <ul className="space-y-1.5">
            <li>
              <strong className="text-main">Qui voit qui :</strong> l'administrateur du serveur décide. Selon la configuration, tu vois tous les utilisateurs, uniquement les membres de ton <em>organisation</em> ou personne (mode « Privé » : pas de partage, pas de groupes). Seul l'administrateur du serveur gère les organisations ; chacun appartient au maximum à une seule.
            </li>
            <li>
              <strong className="text-main">Groupes :</strong> regroupe les personnes visibles au sein de groupes (par ex. famille, colocation, projet) et partage avec tous simultanément. Le créateur du groupe en est l'administrateur ; seuls les membres peuvent partager avec un groupe.
            </li>
            <li>
              <strong className="text-main">Seul le propriétaire partage :</strong> les éditeurs peuvent modifier le contenu mais ne peuvent pas le repartager. Tu peux quitter un partage qui t'a été accordé à tout moment. Si quelqu'un change d'organisation ou quitte un groupe, ses partages associés prennent fin automatiquement.
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
    { key: 'C', scope: 'Global', desc: 'Placer immédiatement le focus dans la barre de saisie rapide' },
    { key: 'Entrée', scope: 'Saisie rapide', desc: 'Enregistrer la pensée en un éclair' },
    { key: 'Échap', scope: 'Saisie rapide', desc: 'Effacer la saisie et fermer les options' },
    { key: 'Entrée', scope: 'Outliner Workspace', desc: 'Créer une nouvelle puce (ou désindenter un bloc vide)' },
    { key: 'Tab', scope: 'Outliner Workspace', desc: 'Indenter la puce vers la droite (l\'imbriquer)' },
    { key: 'Maj + Tab', scope: 'Outliner Workspace', desc: 'Désindenter la puce vers la gauche' },
    { key: 'Maj + Entrée', scope: 'Outliner Workspace', desc: 'Saut de ligne doux au sein du bloc' },
    { key: 'Retour arrière', scope: 'Outliner Workspace', desc: 'Sur un bloc vide : supprimer le bloc ; au début : fusionner' },
    { key: '↑ / ↓', scope: 'Outliner Workspace', desc: 'Naviguer vers le bloc précédent / suivant' },
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
