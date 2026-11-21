package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// seedHelpNotesIT: the help notes in Italian, see seedHelpNotes. Same notes, blocks and links as the English
// ones (seed_en.go), without the parts that only fit the online demo (which has its help in English).
func (s *Store) seedHelpNotesIT(user *domain.User, desktop bool) {
	const folder = "Aiuto di MindSift"
	_, _ = s.CreateFolder(user.ID, folder)
	help := func(title, icon string, spec []seedBlock) {
		_, _ = s.CreateDocument(user.ID, "", title, icon, folder, seedBlocks(forEdition(spec, desktop)), []string{"aiuto"}, false)
	}
	help("Primi passi", "", []seedBlock{
		{typ: "callout", text: "Benvenuto! Queste note ti spiegano MindSift. Tutto qui è contenuto di esempio – puoi modificarlo, spostarlo ed eliminarlo senza problemi. #aiuto"},
		{typ: "h2", text: "L'idea in tre passi"},
		{typ: "numbered", text: "**Cattura:** tutto ciò che ti viene in mente va subito nella barra in alto (Quick Dump) – tasto `C` o `/`, sul telefono il +."},
		{typ: "numbered", text: "**Ordina:** più tardi passi in rassegna i pensieri nel Triage: scarta, attività, nota o voce di lista."},
		{typ: "numbered", text: orDesktop(desktop, "**Approfondisci:** le attività hanno sottoattività e scadenze, le note diventano schemi, le liste si condividono con la famiglia.", "**Approfondisci:** le attività hanno sottoattività e scadenze, le note diventano schemi, le liste aiutano con la spesa e la valigia.")},
		{typ: "h2", text: "Continua a leggere"},
		{level: 1, text: "[[Note e outliner]] – punti, livelli, zoom e collegamenti"},
		{level: 1, text: "[[Prova lo zoom]] – uno schema su dieci livelli"},
		{level: 1, text: "[[Attività e Kanban]] – liste, colonne, cestino"},
		{level: 1, text: "[[Liste e spesa]] – " + orDesktop(desktop, "fare la spesa e la valigia insieme", "fare la spesa e la valigia")},
		{level: 1, text: "[[Scorciatoie da tastiera]] – lavorare più in fretta"},
		{level: 1, text: "[[Inserimento vocale]] – dettare invece di scrivere"},
		{serverOnly: true, level: 1, text: "[[Condividere e modificare insieme]]"},
		{level: 1, text: "[[API e smart home]] – " + orDesktop(desktop, "collegare Home Assistant e agenti IA", "collegare agenti IA e script")},
	})
	help("Note e outliner", "", []seedBlock{
		{typ: "h2", text: "Punti e livelli"},
		{level: 1, text: "`Invio` crea un nuovo punto, `Tab` lo rientra, `Shift+Tab` riduce il rientro"},
		{level: 1, text: "I punti con sottopunti si possono comprimere ed espandere (freccia a sinistra al passaggio del mouse)"},
		{level: 1, text: "Trascinare il punto (•) lo sposta e i sottopunti restano; compresso, si sposta l'intero ramo"},
		{level: 1, text: "Un clic sul punto (•) **ingrandisce** il ramo (zoom) – provalo in [[Prova lo zoom]]"},
		{typ: "h2", text: "Formattare"},
		{level: 1, text: "All'inizio di una riga: `- ` punto, `1. ` numero, `[] ` casella, `# ` titolo"},
		{level: 1, text: "`/` apre il menu: /todo, /h1, /code, /callout, /warn, /fail, /image, /audio, /diktat, /extract …"},
		{level: 1, text: "**grassetto** con `Ctrl+B`, *corsivo* con `Ctrl+I`, collegamento con `Ctrl+K`"},
		{typ: "h2", text: "Collegare"},
		{level: 1, text: "`[[Titolo della nota]]` collega una nota, ad es. [[Primi passi]]"},
		{level: 1, text: "Si possono collegare anche singoli punti: cerca il testo nella finestra dei collegamenti, i punti trovati compaiono sotto le note"},
		{level: 1, text: "Gli `#hashtag` raccolgono le occorrenze in tutte le note, ad es. #aiuto"},
		{typ: "h2", text: "Selezionare ed eliminare"},
		{level: 1, text: "Trascinando il mouse su più punti si seleziona il testo oltre i confini dei punti; Canc lo elimina come in un editor di testo"},
		{level: 1, text: "`Ctrl+Z` annulla ogni tua modifica"},
		{typ: "callout", text: "Le note eliminate finiscono nel cestino, in basso nella barra delle cartelle. Per quanto tempo restano lì si imposta in Impostazioni account → Conservazione."},
	})
	help("Prova lo zoom", "🔍", []seedBlock{
		{typ: "callout", text: "Un clic su un punto (•) mostra solo quel ramo. In alto compare il percorso – cliccandoci si torna indietro livello per livello."},
		{text: "Livello 1: progetto «Giardino nuovo»"},
		{level: 1, text: "Livello 2: aiuole"},
		{level: 2, text: "Livello 3: aiuola rialzata vicino alla recinzione"},
		{level: 3, text: "Livello 4: piantumazione"},
		{level: 4, text: "Livello 5: primavera"},
		{level: 5, text: "Livello 6: lattuga e ravanelli"},
		{level: 6, text: "Livello 7: varietà"},
		{level: 7, text: "Livello 8: lattuga da taglio «Lollo Rosso»"},
		{level: 8, text: "Livello 9: semina da metà marzo"},
		{level: 9, text: "Livello 10: riseminare ogni due settimane – insalata per tutta l'estate 🥗"},
		{level: 7, text: "Livello 8: ravanello «Ghiacciolo»"},
		{level: 5, text: "Livello 6: erbe aromatiche"},
		{level: 6, text: "Livello 7: erba cipollina, prezzemolo, basilico"},
		{level: 4, text: "Livello 5: estate"},
		{level: 5, text: "Livello 6: pomodori e zucchine"},
		{level: 2, text: "Livello 3: spirale di erbe aromatiche"},
		{level: 1, text: "Livello 2: prato"},
		{level: 2, typ: "todo", text: "Livello 3: arieggiare in aprile"},
	})
	help("Attività e Kanban", "✅", []seedBlock{
		{typ: "h2", text: "Viste"},
		{level: 1, text: "**Elenco** con le schede Aperte, Completate e Cestino; raggruppamento e ordinamento si trovano sopra, a destra"},
		{level: 1, text: "**Kanban** con colonne proprie per ogni lista di attività (personalizza colonne: nome, colore, colonna dei completati)"},
		{level: 1, text: "«Tutte le attività» mostra le colonne di tutte le liste unite"},
		{typ: "h2", text: "Lavorare con le attività"},
		{level: 1, text: "Un clic apre i dettagli: priorità, scadenza con ora, ripetizione, sottoattività, note (con microfono)"},
		{level: 1, text: "Trascinando si riordina o si cambia colonna; `Ctrl+Z` annulla eliminazione, spostamento e spunta"},
		{level: 1, text: "Attività e note si possono collegare"},
		{typ: "h2", text: "Fare ordine"},
		{level: 1, text: "Le attività completate finiscono nel cestino dopo un po' e il cestino si svuota poi da solo"},
		{level: 1, text: "I tempi si impostano in Impostazioni account → Conservazione"},
	})
	help("Liste e spesa", "🛒", []seedBlock{
		{text: "Le categorie nascono dagli hashtag: `latte d'avena #frigo` finisce sotto «frigo»"},
		{text: "Le quantità vanno nel campo apposito, ad es. `500 g` o `3x`"},
		{serverOnly: true, text: "Le liste condivise mostrano subito a tutti le voci spuntate – ideale per la spesa settimanale"},
		{text: "Le voci spuntate scompaiono da sole dopo una settimana (regolabile in Conservazione)"},
	})
	help("Scorciatoie da tastiera", "⌨️", []seedBlock{
		{typ: "h2", text: "Ovunque"},
		{level: 1, text: "`C` o `/` – Quick Dump"},
		{level: 1, text: "`Ctrl+K` – ricerca globale in note, attività e liste"},
		{typ: "h2", text: "Triage"},
		{level: 1, text: "`H` / `←` scarta, `L` / `→` attività, `T` con scadenza, `D` nota, spazio per più tardi"},
		{typ: "h2", text: "Note"},
		{level: 1, text: "`Tab` / `Shift+Tab` aumenta e riduce il rientro, `Ctrl+Z` / `Ctrl+Shift+Z` annulla e ripristina"},
		{level: 1, text: "`Ctrl+Shift+F` modalità focus – solo la nota, a larghezza di lettura"},
		{typ: "h2", text: "Attività"},
		{level: 1, text: "`Ctrl+Z` annulla eliminazione, spostamento e spunta"},
	})
	help("Inserimento vocale", "🎙️", []seedBlock{
		{text: "I microfoni si trovano nel Quick Dump, quando crei attività e voci di lista, nelle note di un'attività e come `/diktat` nelle note"},
		{text: "Sul telefono: tenere premuto il + avvia subito una registrazione"},
		{text: "Con un tuo server Whisper la registrazione resta sul tuo server; in Impostazioni account → Inserimento vocale scegli Whisper o il riconoscimento del browser"},
	})
	// Nobody to share with in the desktop app
	if !desktop {
		help("Condividere e modificare insieme", "🤝", []seedBlock{
			{text: "Note, cartelle, liste di attività e liste si possono condividere con persone o gruppi – in modifica o in sola lettura"},
			{text: "In una nota condivisa scrivono più persone contemporaneamente; chi digita in un punto lo riserva per un momento"},
			{text: "Le attività nelle liste condivise si possono assegnare a persone e seguire"},
		})
	}
	help("API e smart home", "🔌", []seedBlock{
		{text: "In Impostazioni account → API crei chiavi con esattamente i permessi che serve a un dispositivo"},
		{desktopOnly: true, text: "Nell'app desktop l'API inizialmente è disponibile solo per l'app stessa: in Impostazioni account → API attiva «Raggiungibile dai programmi locali»; i programmi su questo computer la raggiungono allora su 127.0.0.1 (la porta è indicata lì)"},
		{typ: "h3", text: "Richiedere le attività in scadenza oggi"},
		{serverOnly: true, typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"https://mindsift.example.com/api/v1/tasks?due=today&status=open\""},
		{desktopOnly: true, typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"http://127.0.0.1:18890/api/v1/tasks?due=today&status=open\""},
		{typ: "h3", text: "Agenti IA (MCP)"},
		{text: "Claude Code, Codex e altri agenti leggono e gestiscono attività, liste e note tramite `/api/v1/mcp`"},
		{text: "Tutto ciò che una chiave crea o modifica porta un piccolo badge con il suo nome"},
	})
}
