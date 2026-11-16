package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// seedHelpNotesFR: the help notes in French, see seedHelpNotes. Same notes, blocks and links as the English
// ones (seed_en.go), without the parts that only fit the online demo (which has its help in English).
func (s *Store) seedHelpNotesFR(user *domain.User) {
	const folder = "Aide MindSift"
	_, _ = s.CreateFolder(user.ID, folder)
	help := func(title, icon string, spec []seedBlock) {
		_, _ = s.CreateDocument(user.ID, "", title, icon, folder, seedBlocks(spec), []string{"aide"}, false)
	}
	help("Premiers pas", "", []seedBlock{
		{typ: "callout", text: "Bienvenue ! Ces notes t'expliquent MindSift. Tout ce qui se trouve ici est du contenu d'exemple – tu peux le modifier, le déplacer et le supprimer sans hésiter. #aide"},
		{typ: "h2", text: "L'idée en trois étapes"},
		{typ: "numbered", text: "**Capturer :** tout ce qui te passe par la tête va directement dans la barre du haut (Quick Dump) – touche `C` ou `/`, le + sur le téléphone."},
		{typ: "numbered", text: "**Trier :** plus tard, tu passes tes pensées en revue dans le Triage : jeter, tâche, note ou élément de liste."},
		{typ: "numbered", text: "**Approfondir :** les tâches reçoivent des sous-tâches et des échéances, les notes deviennent des plans, les listes se partagent avec la famille."},
		{typ: "h2", text: "Pour continuer"},
		{level: 1, text: "[[Notes et outliner]] – puces, niveaux, zoom et liens"},
		{level: 1, text: "[[Essayer le zoom]] – un plan sur dix niveaux"},
		{level: 1, text: "[[Tâches et Kanban]] – listes, colonnes, corbeille"},
		{level: 1, text: "[[Listes et courses]] – faire les courses et la valise à plusieurs"},
		{level: 1, text: "[[Raccourcis clavier]] – travailler plus vite"},
		{level: 1, text: "[[Saisie vocale]] – dicter au lieu de taper"},
		{level: 1, text: "[[Partager et modifier à plusieurs]]"},
		{level: 1, text: "[[API et domotique]] – connecter Home Assistant et des agents IA"},
	})
	help("Notes et outliner", "", []seedBlock{
		{typ: "h2", text: "Puces et niveaux"},
		{level: 1, text: "`Entrée` crée une nouvelle puce, `Tab` l'indente, `Maj+Tab` la désindente"},
		{level: 1, text: "Les puces avec des sous-puces se replient et se déplient (flèche à gauche au survol)"},
		{level: 1, text: "Faire glisser la puce (•) déplace toute la branche"},
		{level: 1, text: "Un clic sur la puce (•) **zoome** sur la branche – essaie dans [[Essayer le zoom]]"},
		{typ: "h2", text: "Mise en forme"},
		{level: 1, text: "Au début d'une ligne : `- ` puce, `1. ` numéro, `[] ` case à cocher, `# ` titre"},
		{level: 1, text: "`/` ouvre le menu : /todo, /h1, /code, /callout, /warn, /fail, /image, /audio, /diktat, /extract …"},
		{level: 1, text: "**gras** avec `Ctrl+B`, *italique* avec `Ctrl+I`, lien avec `Ctrl+K`"},
		{typ: "h2", text: "Créer des liens"},
		{level: 1, text: "`[[Titre de la note]]` relie une note, p. ex. [[Premiers pas]]"},
		{level: 1, text: "Des puces isolées peuvent aussi être liées : cherche du texte dans la fenêtre de liens, les puces trouvées apparaissent sous les notes"},
		{level: 1, text: "Les `#hashtags` rassemblent les mentions de toutes les notes, p. ex. #aide"},
		{typ: "h2", text: "Sélectionner et supprimer"},
		{level: 1, text: "Faire glisser la souris sur plusieurs puces sélectionne du texte au-delà des limites des puces ; Suppr l'efface comme dans un éditeur de texte"},
		{level: 1, text: "`Ctrl+Z` annule chacune de tes modifications"},
		{typ: "callout", text: "Les notes supprimées vont dans la corbeille, en bas de la barre des dossiers. Combien de temps elles y restent se règle dans Paramètres du compte → Rétention."},
	})
	help("Essayer le zoom", "🔍", []seedBlock{
		{typ: "callout", text: "Un clic sur une puce (•) n'affiche que cette branche. Le chemin apparaît en haut – un clic dessus remonte niveau par niveau."},
		{text: "Niveau 1 : projet « Nouveau jardin »"},
		{level: 1, text: "Niveau 2 : plates-bandes"},
		{level: 2, text: "Niveau 3 : carré surélevé près de la clôture"},
		{level: 3, text: "Niveau 4 : plantation"},
		{level: 4, text: "Niveau 5 : printemps"},
		{level: 5, text: "Niveau 6 : salade et radis"},
		{level: 6, text: "Niveau 7 : variétés"},
		{level: 7, text: "Niveau 8 : laitue à couper « Lollo Rosso »"},
		{level: 8, text: "Niveau 9 : semis à partir de la mi-mars"},
		{level: 9, text: "Niveau 10 : ressemer toutes les deux semaines – de la salade tout l'été 🥗"},
		{level: 7, text: "Niveau 8 : radis « Glaçon »"},
		{level: 5, text: "Niveau 6 : herbes aromatiques"},
		{level: 6, text: "Niveau 7 : ciboulette, persil, basilic"},
		{level: 4, text: "Niveau 5 : été"},
		{level: 5, text: "Niveau 6 : tomates et courgettes"},
		{level: 2, text: "Niveau 3 : spirale aromatique"},
		{level: 1, text: "Niveau 2 : pelouse"},
		{level: 2, typ: "todo", text: "Niveau 3 : scarifier en avril"},
	})
	help("Tâches et Kanban", "✅", []seedBlock{
		{typ: "h2", text: "Vues"},
		{level: 1, text: "**Liste** avec les onglets À faire, Terminé et Corbeille ; le groupement et le tri se trouvent au-dessus, à droite"},
		{level: 1, text: "**Kanban** avec des colonnes propres à chaque liste de tâches (personnaliser les colonnes : nom, couleur, colonne terminé)"},
		{level: 1, text: "« Toutes les tâches » affiche les colonnes de toutes les listes réunies"},
		{typ: "h2", text: "Travailler avec les tâches"},
		{level: 1, text: "Un clic ouvre les détails : priorité, échéance avec heure, répétition, sous-tâches, notes (avec microphone)"},
		{level: 1, text: "Glisser réorganise ou change de colonne ; `Ctrl+Z` annule la suppression, le déplacement et le fait de cocher"},
		{level: 1, text: "Les tâches et les notes peuvent être liées"},
		{typ: "h2", text: "Faire le ménage"},
		{level: 1, text: "Les tâches terminées vont dans la corbeille après un certain temps, et la corbeille se vide ensuite toute seule"},
		{level: 1, text: "Règle les délais dans Paramètres du compte → Rétention"},
	})
	help("Listes et courses", "🛒", []seedBlock{
		{text: "Les catégories viennent des hashtags : `lait d'avoine #frais` atterrit sous « frais »"},
		{text: "Les quantités vont dans leur propre champ, p. ex. `500 g` ou `3x`"},
		{text: "Les listes partagées montrent immédiatement ce qui est coché à tout le monde – idéal pour les courses de la semaine"},
		{text: "Les éléments cochés disparaissent d'eux-mêmes au bout d'une semaine (réglable sous Rétention)"},
	})
	help("Raccourcis clavier", "⌨️", []seedBlock{
		{typ: "h2", text: "Partout"},
		{level: 1, text: "`C` ou `/` – Quick Dump"},
		{level: 1, text: "`Ctrl+K` – recherche globale dans les notes, tâches et listes"},
		{typ: "h2", text: "Triage"},
		{level: 1, text: "`H` / `←` jeter, `L` / `→` tâche, `T` avec échéance, `D` note, espace pour plus tard"},
		{typ: "h2", text: "Notes"},
		{level: 1, text: "`Tab` / `Maj+Tab` indenter et désindenter, `Ctrl+Z` / `Ctrl+Maj+Z` annuler et rétablir"},
		{level: 1, text: "`Ctrl+Maj+F` mode focus – seulement la note, en largeur de lecture"},
		{typ: "h2", text: "Tâches"},
		{level: 1, text: "`Ctrl+Z` annule la suppression, le déplacement et le fait de cocher"},
	})
	help("Saisie vocale", "🎙️", []seedBlock{
		{text: "Il y a des microphones dans le Quick Dump, à la création de tâches et d'éléments de liste, dans les notes d'une tâche et en `/diktat` dans les notes"},
		{text: "Sur le téléphone : maintenir le + appuyé lance tout de suite un enregistrement"},
		{text: "Avec ton propre serveur Whisper, l'enregistrement reste sur ton serveur ; sous Paramètres du compte → Saisie vocale, tu choisis Whisper ou la reconnaissance du navigateur"},
	})
	help("Partager et modifier à plusieurs", "🤝", []seedBlock{
		{text: "Les notes, dossiers, listes de tâches et listes peuvent être partagés avec des personnes ou des groupes – en modification ou en lecture seule"},
		{text: "Plusieurs personnes écrivent en même temps dans une note partagée ; celui qui tape dans une puce la réserve un instant"},
		{text: "Les tâches des listes partagées peuvent être attribuées à des personnes et suivies"},
	})
	help("API et domotique", "🔌", []seedBlock{
		{text: "Sous Paramètres du compte → API, tu crées des clés avec exactement les droits dont un appareil a besoin"},
		{typ: "h3", text: "Interroger les tâches du jour"},
		{typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"https://mindsift.example.com/api/v1/tasks?due=today&status=open\""},
		{typ: "h3", text: "Agents IA (MCP)"},
		{text: "Claude Code, Codex et d'autres agents lisent et gèrent les tâches, listes et notes via `/api/v1/mcp`"},
		{text: "Tout ce qu'une clé crée ou modifie porte un petit badge avec son nom"},
	})
}
