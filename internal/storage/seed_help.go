package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// seedLinkedTodos shows the link between notes and tasks both ways: a checklist in a note whose main
// checkbox became a task (the checkboxes below are its subtasks), and a task deepened into a note.
func (s *Store) seedLinkedTodos(user *domain.User, homelab *domain.TaskList) {
	listID := ""
	if homelab != nil {
		listID = homelab.ID
	}
	blocks := seedBlocks([]seedBlock{
		{typ: "callout", text: "Das Häkchen „Backup-Konzept umsetzen“ ist mit einer Aufgabe in der Liste Homelab verknüpft (Badge „Erweitert“). Die Häkchen direkt darunter sind ihre Unteraufgaben: Abhaken hier oder in der Aufgabe – beide Seiten bleiben gleich."},
		{typ: "todo", text: "Backup-Konzept umsetzen #backup"},
		{level: 1, typ: "todo", text: "restic-Repository auf der Storage Box anlegen", checked: true},
		{level: 1, typ: "todo", text: "Nächtlicher Lauf per systemd-Timer"},
		{level: 1, typ: "todo", text: "Wiederherstellung einmal komplett testen"},
		{level: 1, text: "Normale Punkte gehören nicht zur Aufgabe – hier ist Platz für Gedanken zum Ablauf"},
		{level: 2, text: "Aufbewahrung: 7 tägliche, 4 wöchentliche, 6 monatliche Stände"},
		{typ: "h3", text: "So geht's"},
		{level: 1, text: "Ein Häkchen über „Erweitert“ (Menü am Häkchen) zur Aufgabe machen"},
		{level: 1, text: "Neue Häkchen direkt eine Ebene darunter werden automatisch Unteraufgaben"},
		{level: 1, text: "Umgekehrt: In den Aufgaben „Als Notiz vertiefen“ – siehe die Notiz zur Aufgabe „Uptime-Monitoring“"},
	})
	doc, err := s.CreateDocument(user.ID, "", "Backup-Konzept", "💾", "Projekte", blocks, []string{"homelab"}, false)
	if err != nil || doc == nil {
		return
	}
	task, err := s.CreateTaskFromDocBlock(user.ID, doc.ID, blocks[1].ID, blocks[1].Content, false)
	if err != nil || task == nil {
		return
	}
	s.ReconcileDocTaskLinks(doc.ID)
	high, status := "high", "in_progress"
	_, _ = s.UpdateThoughtDetails(user.ID, task.ID, nil, nil, nil, &high, &listID, &status, nil, nil, nil)

	// A task of the list deepened into a note: the note starts with its checkbox and subtasks
	var monitoringID string
	_ = s.db.QueryRow(`SELECT id FROM thoughts WHERE user_id = ? AND content LIKE 'Uptime-Monitoring%'`, user.ID).Scan(&monitoringID)
	if monitoringID != "" {
		_, _ = s.UpdateThoughtTriage(user.ID, monitoringID, "keep", "document", "", "", "")
	}
}

// seedHelpNotes: a short guide to MindSift as notes, so the demo explains itself while showing the block
// types (headings, callouts, numbered lists, code, links to notes).
func (s *Store) seedHelpNotes(user *domain.User) {
	_, _ = s.CreateFolder(user.ID, "MindSift-Hilfe")
	help := func(title, icon string, spec []seedBlock) {
		_, _ = s.CreateDocument(user.ID, "", title, icon, "MindSift-Hilfe", seedBlocks(spec), []string{"hilfe"}, false)
	}
	help("Erste Schritte", "👋", []seedBlock{
		{typ: "callout", text: "Willkommen! Diese Notizen erklären MindSift. Alles hier ist Beispielinhalt – ändern, verschieben und löschen ist ausdrücklich erlaubt. #hilfe"},
		{typ: "h2", text: "Die Idee in drei Schritten"},
		{typ: "numbered", text: "**Erfassen:** Alles, was dir einfällt, sofort in die Leiste oben (Quick Dump) – Taste `C` oder `/`, am Handy das +."},
		{typ: "numbered", text: "**Sortieren:** In der Triage gehst du die Gedanken später durch: verwerfen, Aufgabe, Notiz oder Listeneintrag."},
		{typ: "numbered", text: "**Vertiefen:** Aufgaben bekommen Unteraufgaben und Termine, Notizen werden zu Gliederungen, Listen teilst du mit der Familie."},
		{typ: "h2", text: "Weiterlesen"},
		{level: 1, text: "[[Notizen & Outliner]] – Punkte, Ebenen, Zoom und Verlinken"},
		{level: 1, text: "[[Zoom ausprobieren]] – eine Gliederung zehn Ebenen tief"},
		{level: 1, text: "[[Aufgaben & Kanban]] – Listen, Spalten, Papierkorb"},
		{level: 1, text: "[[Listen & Einkauf]] – gemeinsam einkaufen und packen"},
		{level: 1, text: "[[Tastenkürzel]] – schneller arbeiten"},
		{level: 1, text: "[[Spracheingabe]] – diktieren statt tippen"},
		{level: 1, text: "[[Teilen & gemeinsam bearbeiten]]"},
		{level: 1, text: "[[API & Smart Home]] – Home Assistant und KI-Agenten anbinden"},
	})
	help("Notizen & Outliner", "📝", []seedBlock{
		{typ: "h2", text: "Punkte und Ebenen"},
		{level: 1, text: "`Enter` legt einen neuen Punkt an, `Tab` rückt ein, `Shift+Tab` rückt aus"},
		{level: 1, text: "Punkte mit Unterpunkten lassen sich auf- und zuklappen (Pfeil links beim Drüberfahren)"},
		{level: 1, text: "Am Punkt (•) ziehen verschiebt den ganzen Ast"},
		{level: 1, text: "Klick auf den Punkt (•) **zoomt** in den Ast – probier es in [[Zoom ausprobieren]]"},
		{typ: "h2", text: "Formatieren"},
		{level: 1, text: "Am Zeilenanfang: `- ` Punkt, `1. ` Nummer, `[] ` Häkchen, `# ` Überschrift"},
		{level: 1, text: "`/` öffnet das Menü: /todo, /h1, /code, /callout, /image, /audio, /diktat, /extract …"},
		{level: 1, text: "**fett** mit `Strg+B`, *kursiv* mit `Strg+I`, Link mit `Strg+K`"},
		{typ: "h2", text: "Verlinken"},
		{level: 1, text: "`[[Notiztitel]]` verlinkt eine Notiz, z. B. [[Erste Schritte]]"},
		{level: 1, text: "Auch einzelne Punkte lassen sich verlinken: im Verlinken-Fenster nach Text suchen, gefundene Punkte stehen unter den Notizen"},
		{level: 1, text: "`#Hashtags` sammeln Fundstellen über alle Notizen, z. B. #hilfe"},
		{typ: "h2", text: "Markieren und löschen"},
		{level: 1, text: "Mit der Maus über mehrere Punkte ziehen markiert Text über Punktgrenzen; Entf löscht wie in einem Texteditor"},
		{level: 1, text: "`Strg+Z` nimmt jede eigene Änderung zurück"},
		{typ: "callout", text: "Gelöschte Notizen landen im Papierkorb unten in der Ordnerleiste. Wie lange sie dort bleiben, steht unter Kontoeinstellungen → Aufbewahrung."},
	})
	help("Zoom ausprobieren", "🔍", []seedBlock{
		{typ: "callout", text: "Klick auf einen Punkt (•) zeigt nur diesen Ast. Oben erscheint der Pfad – ein Klick darauf geht Ebene für Ebene zurück."},
		{text: "Ebene 1: Projekt „Garten neu anlegen“"},
		{level: 1, text: "Ebene 2: Beete"},
		{level: 2, text: "Ebene 3: Hochbeet am Zaun"},
		{level: 3, text: "Ebene 4: Bepflanzung"},
		{level: 4, text: "Ebene 5: Frühjahr"},
		{level: 5, text: "Ebene 6: Salat und Radieschen"},
		{level: 6, text: "Ebene 7: Sorten"},
		{level: 7, text: "Ebene 8: Pflücksalat „Lollo Rosso“"},
		{level: 8, text: "Ebene 9: Aussaat ab Mitte März"},
		{level: 9, text: "Ebene 10: alle zwei Wochen nachsäen – so gibt es den ganzen Sommer Salat 🥗"},
		{level: 7, text: "Ebene 8: Radieschen „Eiszapfen“"},
		{level: 5, text: "Ebene 6: Kräuter"},
		{level: 6, text: "Ebene 7: Schnittlauch, Petersilie, Basilikum"},
		{level: 4, text: "Ebene 5: Sommer"},
		{level: 5, text: "Ebene 6: Tomaten und Zucchini"},
		{level: 2, text: "Ebene 3: Kräuterspirale"},
		{level: 1, text: "Ebene 2: Rasen"},
		{level: 2, typ: "todo", text: "Ebene 3: Vertikutieren im April"},
	})
	help("Aufgaben & Kanban", "✅", []seedBlock{
		{typ: "h2", text: "Ansichten"},
		{level: 1, text: "**Liste** mit den Reitern Offen, Erledigt und Papierkorb; Gruppe und Sortierung stehen rechts darüber"},
		{level: 1, text: "**Kanban** mit eigenen Spalten je Aufgabenliste (Spalten anpassen: Name, Farbe, Erledigt-Spalte)"},
		{level: 1, text: "„Alle Aufgaben“ zeigt die Spalten aller Listen zusammengeführt"},
		{typ: "h2", text: "Arbeiten mit Aufgaben"},
		{level: 1, text: "Klick öffnet die Details: Priorität, Fälligkeit mit Uhrzeit, Wiederholung, Unteraufgaben, Notizen (mit Mikrofon)"},
		{level: 1, text: "Ziehen sortiert um oder wechselt die Spalte; `Strg+Z` nimmt Löschen, Verschieben und Abhaken zurück"},
		{level: 1, text: "Aufgaben und Notizen lassen sich verknüpfen – Beispiel: [[Backup-Konzept]]"},
		{typ: "h2", text: "Aufräumen"},
		{level: 1, text: "Erledigte wandern nach einer Frist in den Papierkorb, der sich später selbst leert"},
		{level: 1, text: "Die Fristen stellst du unter Kontoeinstellungen → Aufbewahrung ein"},
	})
	help("Listen & Einkauf", "🛒", []seedBlock{
		{text: "Kategorien entstehen aus Hashtags: `Hafermilch #Kühlregal` landet unter „Kühlregal“"},
		{text: "Mengen ins eigene Feld, z. B. `500 g` oder `3x`"},
		{text: "Geteilte Listen zeigen Abhaken bei allen sofort – ideal für den Wocheneinkauf"},
		{text: "Abgehakte Einträge verschwinden nach einer Woche von selbst (einstellbar unter Aufbewahrung)"},
	})
	help("Tastenkürzel", "⌨️", []seedBlock{
		{typ: "h2", text: "Überall"},
		{level: 1, text: "`C` oder `/` – Quick Dump"},
		{level: 1, text: "`Strg+K` – globale Suche über Notizen, Aufgaben und Listen"},
		{typ: "h2", text: "Triage"},
		{level: 1, text: "`H` / `←` verwerfen, `L` / `→` Aufgabe, `T` mit Termin, `D` Notiz, Leertaste später"},
		{typ: "h2", text: "Notizen"},
		{level: 1, text: "`Tab` / `Shift+Tab` ein- und ausrücken, `Strg+Z` / `Strg+Shift+Z` rückgängig und wiederholen"},
		{level: 1, text: "`Strg+Shift+F` Fokus-Modus – nur die Notiz, in Lesebreite"},
		{typ: "h2", text: "Aufgaben"},
		{level: 1, text: "`Strg+Z` nimmt Löschen, Verschieben und Abhaken zurück"},
	})
	help("Spracheingabe", "🎙️", []seedBlock{
		{text: "Mikrofone gibt es im Quick Dump, beim Anlegen von Aufgaben und Listeneinträgen, in den Detailnotizen einer Aufgabe und als `/diktat` in Notizen"},
		{text: "Am Handy: das + gedrückt halten startet sofort eine Aufnahme"},
		{text: "Mit eigenem Whisper-Server bleibt die Aufnahme auf deinem Server; unter Kontoeinstellungen → Spracheingabe wählst du Whisper oder die Erkennung des Browsers"},
		{typ: "callout", text: "In dieser Demo nutzt MindSift die Spracherkennung des Browsers."},
	})
	help("Teilen & gemeinsam bearbeiten", "🤝", []seedBlock{
		{text: "Notizen, Ordner, Aufgabenlisten und Listen lassen sich mit Personen oder Gruppen teilen – zum Bearbeiten oder nur zum Lesen"},
		{text: "In einer geteilten Notiz schreiben mehrere gleichzeitig; wer in einem Punkt tippt, hält ihn kurz für sich"},
		{level: 1, text: "Probier es aus: „Homelab 2.0“ ist mit dem Demo-Konto **user** geteilt – in einem zweiten Browser als user/user anmelden"},
		{text: "Aufgaben in geteilten Listen lassen sich Personen zuweisen und beobachten"},
	})
	help("API & Smart Home", "🔌", []seedBlock{
		{text: "Unter Kontoeinstellungen → API legst du Schlüssel mit genau den Rechten an, die ein Gerät braucht"},
		{typ: "h3", text: "Heute fällige Aufgaben abfragen"},
		{typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"https://mindsift.example.com/api/v1/tasks?due=today&status=open\""},
		{typ: "h3", text: "KI-Agenten (MCP)"},
		{text: "Claude Code, Codex und andere Agenten lesen und pflegen Aufgaben und Listen über `/api/v1/mcp`"},
		{text: "Was ein Schlüssel anlegt oder ändert, trägt eine kleine Badge mit seinem Namen"},
	})
}
