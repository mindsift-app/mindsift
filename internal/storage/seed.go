package storage

import (
	"strings"
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// seedBlock describes one outliner bullet of the sample notes: nesting level, block type and text.
type seedBlock struct {
	level   int
	typ     string
	text    string
	checked bool
	lang    string
}

// seedNetworkDrawing: the sample drawing in the homelab note (block type "drawing"), a small network plan
// with filled boxes, straight, elbowed and one dashed curved arrow, and free text. Docked arrow ends carry
// their points too, for the SVG of the Markdown export.
func seedNetworkDrawing(router, note string) string {
	return strings.NewReplacer("{router}", router, "{note}", note).Replace(`{"v":1,"els":[` +
		`{"id":"inet","ver":1,"t":"ellipse","x":0,"y":80,"w":140,"h":60,"s":"muted","f":"none","sw":2,"txt":"Internet"},` +
		`{"id":"rtr","ver":1,"t":"rect","x":200,"y":80,"w":170,"h":60,"s":"main","f":"none","sw":2,"r":true,"txt":"{router}"},` +
		`{"id":"ngx","ver":1,"t":"rect","x":440,"y":80,"w":140,"h":60,"s":"accent","f":"accent","sw":2,"r":true,"txt":"Nginx"},` +
		`{"id":"ms","ver":1,"t":"rect","x":660,"y":0,"w":150,"h":56,"s":"blue","f":"blue","sw":2,"r":true,"txt":"MindSift"},` +
		`{"id":"git","ver":1,"t":"rect","x":660,"y":90,"w":150,"h":56,"s":"purple","f":"purple","sw":2,"r":true,"txt":"Gitea"},` +
		`{"id":"ha","ver":1,"t":"rect","x":660,"y":180,"w":150,"h":56,"s":"green","f":"green","sw":2,"r":true,"txt":"Home Assistant"},` +
		`{"id":"a1","ver":1,"t":"arrow","a":[144,110],"b":[196,110],"from":"inet","to":"rtr","route":"straight","head":2,"s":"main","sw":2},` +
		`{"id":"a2","ver":1,"t":"arrow","a":[374,110],"b":[436,110],"from":"rtr","to":"ngx","route":"straight","head":2,"s":"main","sw":2},` +
		`{"id":"a3","ver":1,"t":"arrow","a":[584,110],"b":[656,28],"from":"ngx","to":"ms","route":"elbow","head":2,"s":"main","sw":2},` +
		`{"id":"a4","ver":1,"t":"arrow","a":[584,110],"b":[656,118],"from":"ngx","to":"git","route":"elbow","head":2,"s":"main","sw":2},` +
		`{"id":"a5","ver":1,"t":"arrow","a":[584,110],"b":[656,208],"from":"ngx","to":"ha","route":"elbow","head":2,"s":"main","sw":2},` +
		`{"id":"a6","ver":1,"t":"arrow","a":[785,176],"b":[785,60],"from":"ha","to":"ms","route":"curve","head":2,"bend":0.9,"s":"orange","sw":2,"dash":true},` +
		`{"id":"t1","ver":1,"t":"text","x":850,"y":108,"txt":"Webhook","s":"orange","sw":2,"fs":14},` +
		`{"id":"t2","ver":1,"t":"text","x":200,"y":160,"txt":"{note}","s":"muted","sw":2,"fs":14}]}`)
}

func seedBlocks(spec []seedBlock) []domain.DocumentBlock {
	out := make([]domain.DocumentBlock, len(spec))
	for i, b := range spec {
		typ := b.typ
		if typ == "" {
			typ = "bullet"
		}
		out[i] = domain.DocumentBlock{ID: domain.NewID("blk"), Type: typ, Content: b.text, Checked: b.checked, Lang: b.lang, Level: b.level}
	}
	return out
}

type seedTask struct {
	content  string
	priority string
	due      int // days from today; 0 = no due date unless dueToday
	dueToday bool
	status   string // kanban column
	notes    string
	subtasks []string
	doneSubs int
}

// SeedStarterContent fills a new account with realistic sample data (optional at setup, always in demo mode):
// inbox thoughts, two task lists with Kanban states, shopping and packing lists and a few linked notes.
// German accounts get it in German, all others in English (seed_en.go).
func (s *Store) SeedStarterContent(user *domain.User) error {
	if s.MessageLanguage(user.ID) == "de" {
		return s.seedStarterDE(user)
	}
	return s.seedStarterEN(user)
}

// seedDay: a due date offset days from today
func seedDay(offset int) string { return time.Now().AddDate(0, 0, offset).Format("2006-01-02") }

// seedTasks adds sample tasks to a task list, with their Kanban state, notes and subtasks.
func (s *Store) seedTasks(user *domain.User, listID string, tasks []seedTask) {
	for _, t := range tasks {
		due := ""
		if t.due != 0 || t.dueToday {
			due = seedDay(t.due)
		}
		th, err := s.CreateThoughtWithDetails(user.ID, t.content, t.priority, "manual", due, listID, t.status, "")
		if err != nil {
			continue
		}
		if _, err := s.UpdateThoughtTriage(user.ID, th.ID, "keep", "task", "", due, listID); err != nil {
			continue
		}
		subs := make([]domain.SubTask, len(t.subtasks))
		for i, title := range t.subtasks {
			subs[i] = domain.SubTask{ID: domain.NewID("sub"), Title: title, IsCompleted: i < t.doneSubs, CreatedAt: domain.NowISO()}
		}
		done := t.status == "done"
		status, notes := t.status, t.notes
		_, _ = s.UpdateThoughtDetails(user.ID, th.ID, nil, &done, nil, nil, nil, &status, &notes, &subs, nil)
	}
}

func (s *Store) seedStarterDE(user *domain.User) error {
	inbox := []struct{ content, priority, source string }{
		{"Zündkerzen und Luftfilter für den Rasenmäher bestellen #garage #wartung", "normal", "manual"},
		{"Urlaubsidee: Wanderhütte in Südtirol für Oktober buchen #urlaub #familie", "high", "voice"},
		{"Kellerfeuchtigkeit über 68 % gestiegen – Entfeuchter prüfen #smarthome #alarm", "urgent", "webhook"},
		{"Buchtipp von Jonas: „Die Kunst des klaren Denkens“ #lesen", "low", "manual"},
		{"Geburtstagsgeschenk für Oma – vielleicht ein Fotobuch vom Sommer? #familie", "normal", "manual"},
		{"Idee: Backup-Report jeden Montag per Discord schicken #homelab", "normal", "voice"},
	}
	for _, t := range inbox {
		_, _ = s.CreateThought(user.ID, t.content, t.priority, t.source, "")
	}

	homelab, err := s.CreateTaskList(user.ID, "", "", "Homelab", "🖥️", "#2563eb")
	if err == nil {
		s.seedTasks(user, homelab.ID, []seedTask{
			{content: "MindSift-Container auf den neuen Server umziehen #docker", priority: "high", due: 2, status: "in_progress",
				notes:    "Volume `./data` vorher mit `sqlite3 .backup` sichern.",
				subtasks: []string{"Backup der Datenbank ziehen", "docker-compose.yml anpassen", "DNS auf neue IP umstellen", "Alten Container stoppen"}, doneSubs: 2},
			{content: "Reverse-Proxy: Nginx-Timeouts für Long-Polling erhöhen #nginx", priority: "normal", due: 5, status: "todo"},
			{content: "USV-Batterie tauschen lassen #hardware", priority: "urgent", due: -1, status: "todo",
				notes: "Händler hat das Ersatzteil seit Montag da."},
			{content: "Wartet auf Lieferung: zweite SSD für das RAID #hardware", priority: "normal", due: 7, status: "waiting"},
			{content: "Gitea-Runner auf Version 0.2 aktualisieren #devops", priority: "low", status: "done"},
			{content: "Uptime-Monitoring für alle Dienste einrichten #monitoring", priority: "normal", due: 10, status: "todo",
				subtasks: []string{"Uptime Kuma installieren", "Benachrichtigung per Discord", "Statusseite veröffentlichen"}, doneSubs: 1},
		})
	}
	house, err := s.CreateTaskList(user.ID, "", "", "Haus & Garten", "🏡", "#16a34a")
	if err == nil {
		s.seedTasks(user, house.ID, []seedTask{
			{content: "Hecke schneiden, bevor die Vögel brüten #garten", priority: "normal", due: 3, status: "todo"},
			{content: "Heizungswartung beim Installateur anfragen #wartung", priority: "high", dueToday: true, status: "in_progress"},
			{content: "Steuerunterlagen für 2026 sortieren #finanzen", priority: "normal", due: 14, status: "todo",
				subtasks: []string{"Handwerkerrechnungen", "Spendenquittungen", "Fahrtkosten"}},
			{content: "Fahrradschloss nachkaufen", priority: "low", status: "done"},
		})
	}

	shop, err := s.CreateList(user.ID, "Wocheneinkauf", "🛒", "shopping")
	if err == nil {
		items := []struct{ content, category, qty string }{
			{"Hafermilch (Barista Edition)", "Kühlregal", "3x"},
			{"Griechischer Joghurt", "Kühlregal", "500 g"},
			{"Bergkäse", "Kühlregal", "200 g"},
			{"Äpfel (Elstar)", "Obst & Gemüse", "1 kg"},
			{"Cherrytomaten", "Obst & Gemüse", "2 Schalen"},
			{"Avocados", "Obst & Gemüse", "3x"},
			{"Bauernbrot", "Backwaren", "1x"},
			{"Espressobohnen (100 % Arabica)", "Kaffee & Tee", "1 kg"},
			{"Pfefferminztee", "Kaffee & Tee", "1x"},
			{"Spülmaschinentabs", "Drogerie", "1 Pack"},
		}
		for i, it := range items {
			item, err := s.CreateListItem(shop.ID, it.content, it.category, it.qty, i, user.ID)
			if err == nil && (i == 1 || i == 6 || i == 8) {
				_, _ = s.ToggleListItem(item.ID, true, user.ID, user.DisplayName)
			}
		}
	}
	packing, err := s.CreateList(user.ID, "Packliste Südtirol", "🎒", "shopping")
	if err == nil {
		for i, it := range []struct{ content, category string }{
			{"Wanderschuhe", "Kleidung"}, {"Regenjacke", "Kleidung"}, {"Fleecepullover", "Kleidung"},
			{"Erste-Hilfe-Set", "Ausrüstung"}, {"Stirnlampe", "Ausrüstung"}, {"Trinkflaschen", "Ausrüstung"},
			{"Personalausweise", "Dokumente"}, {"Hüttenschlafsack", "Ausrüstung"},
		} {
			_, _ = s.CreateListItem(packing.ID, it.content, it.category, "", i, user.ID)
		}
	}

	_, _ = s.CreateFolder(user.ID, "Projekte")
	_, _ = s.CreateFolder(user.ID, "Privat")
	_, _ = s.CreateDocument(user.ID, "", "Homelab 2.0 – Umzug auf den neuen Server", "🚀", "Projekte", seedBlocks([]seedBlock{
		{typ: "callout", text: "Ziel: Bis Ende des Monats laufen alle Dienste auf dem neuen Mini-PC – leiser, sparsamer und mit echtem Backup. Aufgaben dazu stehen in der Liste #homelab."},
		{typ: "h2", text: "Warum überhaupt?"},
		{level: 1, text: "Der alte Server zieht 65 W im Leerlauf, der neue nur 9 W"},
		{level: 2, text: "Ersparnis ca. 120 € im Jahr bei aktuellem Strompreis"},
		{level: 1, text: "Backups liefen bisher nur manuell – das soll sich ändern #backup"},
		{level: 1, text: "Endlich Platz für die Dienste, die seit Monaten auf der Wunschliste stehen"},
		{typ: "h2", text: "Checkliste Umzug"},
		{level: 1, typ: "todo", text: "Vorbereitung"},
		{level: 2, typ: "todo", text: "Proxmox installieren und Updates einspielen", checked: true},
		{level: 2, typ: "todo", text: "Netzwerk: feste IP und VLAN für Dienste", checked: true},
		{level: 2, typ: "todo", text: "ZFS-Pool mit zwei SSDs anlegen"},
		{level: 1, typ: "todo", text: "Dienste umziehen"},
		{level: 2, typ: "todo", text: "MindSift (Daten liegen komplett in einer SQLite-Datei)", checked: true},
		{level: 2, typ: "todo", text: "Gitea mit Runner und Container-Registry"},
		{level: 2, typ: "todo", text: "Home Assistant inklusive Zigbee-Stick"},
		{level: 1, typ: "todo", text: "Alten Server sicher löschen und verkaufen"},
		{typ: "h2", text: "Dienste & Ports"},
		{level: 1, text: "**MindSift** – Notizen, Aufgaben und Listen für die ganze Familie #mindsift"},
		{level: 2, text: "läuft hinter Nginx, WebSocket-Upgrade und Long-Polling sind freigegeben"},
		{level: 2, text: "Demo-Konten nur im Testsystem, nie öffentlich"},
		{level: 1, text: "**Gitea** – Code, CI und Images, z. B. `git.example.com` #devops"},
		{level: 1, text: "**Home Assistant** – Sensoren melden Alarme per Webhook direkt in die MindSift-Inbox #smarthome"},
		{level: 2, text: "Beispiel: Kellerfeuchtigkeit über 65 % → Gedanke mit Priorität „dringend“"},
		{typ: "h3", text: "Compose-Ausschnitt"},
		{level: 1, typ: "code", lang: "yaml", text: "services:\n  mindsift:\n    image: ghcr.io/mindsift-app/mindsift:v0.2\n    restart: unless-stopped\n    volumes: [\"./data:/data\"]\n    environment:\n      - JWT_SECRET=${JWT_SECRET}"},
		{typ: "h2", text: "Netzplan"},
		{level: 1, typ: "drawing", text: seedNetworkDrawing("Router / Firewall", "Nur 80 und 443 offen")},
		{typ: "h2", text: "Offene Fragen"},
		{level: 1, text: "Reicht eine USV für Router und Server zusammen?"},
		{level: 1, text: "Offsite-Backup: Hetzner Storage Box oder Festplatte bei den Eltern? Siehe [[Ideen-Sammlung]]"},
	}), []string{"homelab", "projekt"}, true)

	_, _ = s.CreateDocument(user.ID, "", "Urlaub Südtirol", "🏔️", "Privat", seedBlocks([]seedBlock{
		{typ: "h2", text: "Reiseplan Oktober"},
		{level: 1, text: "Anreise Samstag, früh los wegen Brenner-Stau"},
		{level: 1, text: "Hütte bei Villnöß – Bestätigung kommt per Mail"},
		{level: 2, text: "Halbpension, Hunde erlaubt"},
		{typ: "h2", text: "Touren-Ideen"},
		{level: 1, typ: "todo", text: "Adolf-Munkel-Weg unter den Geislerspitzen", checked: true},
		{level: 1, typ: "todo", text: "Seceda mit der Seilbahn, oben Höhenweg"},
		{level: 1, typ: "todo", text: "Regentag: Ötzi-Museum in Bozen #familie"},
		{typ: "callout", text: "Packliste liegt unter Listen → Packliste Südtirol."},
	}), []string{"urlaub"}, false)

	// Deeply nested on purpose: clicking a bullet zooms into its branch, the breadcrumb leads back out
	_, _ = s.CreateDocument(user.ID, "", "Hausrenovierung 2027", "🏡", "Privat", seedBlocks([]seedBlock{
		{typ: "callout", text: "Tipp: Klick auf einen Punkt (•) zoomt in diesen Ast, die Leiste oben führt Ebene für Ebene zurück."},
		{text: "Erdgeschoss"},
		{level: 1, text: "Küche"},
		{level: 2, text: "Planung mit dem Küchenstudio"},
		{level: 3, text: "Termin 1: Aufmaß und erste Entwürfe"},
		{level: 4, typ: "todo", text: "Grundriss mit Maßen mitbringen", checked: true},
		{level: 4, typ: "todo", text: "Fotos der Wasser- und Stromanschlüsse machen", checked: true},
		{level: 3, text: "Termin 2: Angebot besprechen"},
		{level: 4, text: "Varianten"},
		{level: 5, text: "A: Zeile mit Insel – 14.800 €"},
		{level: 6, text: "Insel braucht eigenen Stromkreis, Elektriker fragen"},
		{level: 7, text: "Elektriker Huber, Termin im März"},
		{level: 8, text: "Was er wissen muss"},
		{level: 9, text: "Kochfeld 7,4 kW → Starkstrom (400 V) an der Insel"},
		{level: 9, text: "Steckdosen auf beiden Seiten der Insel, eine davon mit USB"},
		{level: 9, typ: "todo", text: "Unterverteilung fotografieren und vorab schicken"},
		{level: 8, text: "Kosten"},
		{level: 9, text: "Schätzung 900–1.200 €, abhängig vom Bodenaufbau"},
		{level: 6, text: "Kochfeld mit integriertem Abzug, kein Hängeschrank nötig"},
		{level: 7, text: "Umluft oder Abluft?"},
		{level: 8, text: "Abluft braucht einen Mauerdurchbruch in der Außenwand"},
		{level: 8, text: "Umluft: Filter alle 12 Monate tauschen #wartung"},
		{level: 5, text: "B: L-Form ohne Insel – 11.200 €"},
		{level: 6, text: "mehr Stauraum, aber der Essplatz wird kleiner"},
		{level: 4, typ: "todo", text: "Gegenangebot vom zweiten Studio einholen #renovierung"},
		{level: 2, text: "Boden"},
		{level: 3, text: "Fliesen 60×60, anthrazit"},
		{level: 4, text: "Musterplatten liegen im Keller"},
		{level: 4, typ: "todo", text: "Fußbodenheizung vorher prüfen lassen"},
		{level: 1, text: "Wohnzimmer"},
		{level: 2, typ: "todo", text: "Wand zum Flur: tragend? Statiker fragen"},
		{level: 2, text: "Beleuchtung"},
		{level: 3, text: "Deckenspots dimmbar, in zwei Gruppen"},
		{level: 4, text: "über Home Assistant steuern #smarthome"},
		{text: "Obergeschoss"},
		{level: 1, text: "Bad"},
		{level: 2, text: "Dusche bodengleich statt Wanne"},
		{level: 3, text: "Gefälle und Abdichtung"},
		{level: 4, typ: "todo", text: "Angebot Fliesenleger"},
		{level: 4, typ: "todo", text: "Rinne oder Punktablauf entscheiden"},
		{level: 1, text: "Kinderzimmer"},
		{level: 2, typ: "todo", text: "Wandfarbe aussuchen lassen 🎨 #familie", checked: true},
		{text: "Budget"},
		{level: 1, text: "Gesamtrahmen 45.000 €, davon 10 % Puffer"},
		{level: 2, text: "Küche ist der größte Posten, siehe Erdgeschoss → Küche"},
	}), []string{"renovierung"}, false)

	_, _ = s.CreateDocument(user.ID, "", "Ideen-Sammlung", "💡", "", seedBlocks([]seedBlock{
		{text: "Offsite-Backup verschlüsselt mit restic #backup"},
		{level: 1, text: "Vorteil: Snapshots, Deduplizierung, läuft auf jedem Ziel"},
		{text: "Familien-Wiki statt WhatsApp-Gruppe für Rezepte und Termine #familie"},
		{text: "Wochenrückblick jeden Sonntag: Inbox leeren, Aufgaben für die Woche planen #routine"},
	}), []string{"ideen"}, false)

	s.seedLinkedTodosDE(user, homelab)
	s.seedHelpNotesDE(user)
	return nil
}

// seedDemoShares shares part of the admin's sample data with the demo user, so both demo accounts can try
// out editing a note, a task list and a shopping list together.
func (s *Store) seedDemoShares(admin, member *domain.User) {
	var docID, taskListID, listID string
	_ = s.db.QueryRow(`SELECT id FROM documents WHERE user_id = ? AND title LIKE 'Homelab 2.0%'`, admin.ID).Scan(&docID)
	_ = s.db.QueryRow(`SELECT id FROM task_lists WHERE user_id = ? AND title = 'Homelab'`, admin.ID).Scan(&taskListID)
	_ = s.db.QueryRow(`SELECT id FROM lists WHERE user_id = ? AND title IN ('Wocheneinkauf', 'Weekly groceries')`, admin.ID).Scan(&listID)
	if docID != "" {
		_, _ = s.CreateDocShare(admin.ID, docID, member.ID, "write")
	}
	if taskListID != "" {
		_, _ = s.AddTaskListShare(taskListID, "user", member.ID, "editor", admin.ID)
	}
	if listID != "" {
		_, _ = s.AddListShare(admin.ID, listID, "user", member.ID, "editor")
	}
}
