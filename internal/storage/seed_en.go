package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// English sample data and help notes, for every account that is not German (the demo too). Same
// structure as the German version in seed.go and seed_help.go.

func (s *Store) seedStarterEN(user *domain.User) error {
	inbox := []struct{ content, priority, source string }{
		{"Order spark plugs and an air filter for the lawn mower #garage #maintenance", "normal", "manual"},
		{"Holiday idea: book a mountain hut in South Tyrol for October #holiday #family", "high", "voice"},
		{"Basement humidity rose above 68 % – check the dehumidifier #smarthome #alarm", "urgent", "webhook"},
		{"Book tip from Jonas: “The Art of Thinking Clearly” #reading", "low", "manual"},
		{"Birthday present for Grandma – maybe a photo book of the summer? #family", "normal", "manual"},
		{"Idea: send a backup report to Discord every Monday #homelab", "normal", "voice"},
	}
	for _, t := range inbox {
		_, _ = s.CreateThought(user.ID, t.content, t.priority, t.source, "")
	}

	homelab, err := s.CreateTaskList(user.ID, "", "", "Homelab", "🖥️", "#2563eb")
	if err == nil {
		s.seedTasks(user, homelab.ID, []seedTask{
			{content: "Move the MindSift container to the new server #docker", priority: "high", due: 2, status: "in_progress",
				notes:    "Back up the `./data` volume with `sqlite3 .backup` first.",
				subtasks: []string{"Back up the database", "Adjust docker-compose.yml", "Point DNS to the new IP", "Stop the old container"}, doneSubs: 2},
			{content: "Reverse proxy: raise the nginx timeouts for long polling #nginx", priority: "normal", due: 5, status: "todo"},
			{content: "Get the UPS battery replaced #hardware", priority: "urgent", due: -1, status: "todo",
				notes: "The shop has had the spare part since Monday."},
			{content: "Waiting for delivery: second SSD for the RAID #hardware", priority: "normal", due: 7, status: "waiting"},
			{content: "Update the Gitea runner to version 0.2 #devops", priority: "low", status: "done"},
			{content: "Uptime monitoring for all services #monitoring", priority: "normal", due: 10, status: "todo",
				subtasks: []string{"Install Uptime Kuma", "Notifications via Discord", "Publish a status page"}, doneSubs: 1},
		})
	}
	house, err := s.CreateTaskList(user.ID, "", "", "House & garden", "🏡", "#16a34a")
	if err == nil {
		s.seedTasks(user, house.ID, []seedTask{
			{content: "Trim the hedge before the birds start nesting #garden", priority: "normal", due: 3, status: "todo"},
			{content: "Ask the plumber about the heating service #maintenance", priority: "high", dueToday: true, status: "in_progress"},
			{content: "Sort the tax documents for 2026 #finance", priority: "normal", due: 14, status: "todo",
				subtasks: []string{"Tradesmen's invoices", "Donation receipts", "Travel costs"}},
			{content: "Buy a new bike lock", priority: "low", status: "done"},
		})
	}

	shop, err := s.CreateList(user.ID, "Weekly groceries", "🛒", "shopping")
	if err == nil {
		items := []struct{ content, category, qty string }{
			{"Oat milk (barista edition)", "Fridge", "3x"},
			{"Greek yoghurt", "Fridge", "500 g"},
			{"Mountain cheese", "Fridge", "200 g"},
			{"Apples (Elstar)", "Fruit & veg", "1 kg"},
			{"Cherry tomatoes", "Fruit & veg", "2 punnets"},
			{"Avocados", "Fruit & veg", "3x"},
			{"Sourdough bread", "Bakery", "1x"},
			{"Espresso beans (100 % Arabica)", "Coffee & tea", "1 kg"},
			{"Peppermint tea", "Coffee & tea", "1x"},
			{"Dishwasher tablets", "Household", "1 pack"},
		}
		for i, it := range items {
			item, err := s.CreateListItem(shop.ID, it.content, it.category, it.qty, i, user.ID)
			if err == nil && (i == 1 || i == 6 || i == 8) {
				_, _ = s.ToggleListItem(item.ID, true, user.ID, user.DisplayName)
			}
		}
	}
	packing, err := s.CreateList(user.ID, "Packing list South Tyrol", "🎒", "shopping")
	if err == nil {
		for i, it := range []struct{ content, category string }{
			{"Hiking boots", "Clothes"}, {"Rain jacket", "Clothes"}, {"Fleece jumper", "Clothes"},
			{"First aid kit", "Gear"}, {"Head torch", "Gear"}, {"Water bottles", "Gear"},
			{"ID cards", "Documents"}, {"Hut sleeping bag", "Gear"},
		} {
			_, _ = s.CreateListItem(packing.ID, it.content, it.category, "", i, user.ID)
		}
	}

	_, _ = s.CreateFolder(user.ID, "Projects")
	_, _ = s.CreateFolder(user.ID, "Personal")
	_, _ = s.CreateDocument(user.ID, "", "Homelab 2.0 – moving to the new server", "🚀", "Projects", seedBlocks([]seedBlock{
		{typ: "callout", text: "Goal: by the end of the month all services run on the new mini PC – quieter, more efficient and with a real backup. The tasks for it are in the #homelab list."},
		{typ: "h2", text: "Why bother?"},
		{level: 1, text: "The old server draws 65 W at idle, the new one only 9 W"},
		{level: 2, text: "Saves about €120 a year at current power prices"},
		{level: 1, text: "Backups only ran by hand so far – that has to change #backup"},
		{level: 1, text: "Finally room for the services that have been on the wish list for months"},
		{typ: "h2", text: "Moving checklist"},
		{level: 1, typ: "todo", text: "Preparation"},
		{level: 2, typ: "todo", text: "Install Proxmox and apply updates", checked: true},
		{level: 2, typ: "todo", text: "Network: fixed IP and a VLAN for services", checked: true},
		{level: 2, typ: "todo", text: "Create a ZFS pool with two SSDs"},
		{level: 1, typ: "todo", text: "Move the services"},
		{level: 2, typ: "todo", text: "MindSift (all data lives in one SQLite file)", checked: true},
		{level: 2, typ: "todo", text: "Gitea with runner and container registry"},
		{level: 2, typ: "todo", text: "Home Assistant including the Zigbee stick"},
		{level: 1, typ: "todo", text: "Wipe the old server securely and sell it"},
		{typ: "h2", text: "Services & ports"},
		{level: 1, text: "**MindSift** – notes, tasks and lists for the whole family #mindsift"},
		{level: 2, text: "runs behind nginx, WebSocket upgrade and long polling are allowed"},
		{level: 2, text: "demo accounts only on the test system, never public"},
		{level: 1, text: "**Gitea** – code, CI and images, e.g. `git.example.com` #devops"},
		{level: 1, text: "**Home Assistant** – sensors send alarms by webhook straight into the MindSift inbox #smarthome"},
		{level: 2, text: "Example: basement humidity above 65 % → a thought with priority “urgent”"},
		{typ: "h3", text: "Compose snippet"},
		{level: 1, typ: "code", lang: "yaml", text: "services:\n  mindsift:\n    image: ghcr.io/mindsift-app/mindsift:v0.2\n    restart: unless-stopped\n    volumes: [\"./data:/data\"]\n    environment:\n      - JWT_SECRET=${JWT_SECRET}"},
		{typ: "h2", text: "Open questions"},
		{level: 1, text: "Is one UPS enough for router and server together?"},
		{level: 1, text: "Offsite backup: Hetzner Storage Box or a hard drive at my parents'? See [[Idea collection]]"},
	}), []string{"homelab", "project"}, true)

	_, _ = s.CreateDocument(user.ID, "", "Holiday in South Tyrol", "🏔️", "Personal", seedBlocks([]seedBlock{
		{typ: "h2", text: "October travel plan"},
		{level: 1, text: "Arrive Saturday, leave early because of the Brenner traffic"},
		{level: 1, text: "Hut near Villnöß – confirmation comes by email"},
		{level: 2, text: "Half board, dogs welcome"},
		{typ: "h2", text: "Hike ideas"},
		{level: 1, typ: "todo", text: "Adolf Munkel Trail below the Geisler peaks", checked: true},
		{level: 1, typ: "todo", text: "Seceda by cable car, high trail at the top"},
		{level: 1, typ: "todo", text: "Rainy day: Ötzi museum in Bolzano #family"},
		{typ: "callout", text: "The packing list is under Lists → Packing list South Tyrol."},
	}), []string{"holiday"}, false)

	// Deeply nested on purpose: clicking a bullet zooms into its branch, the breadcrumb leads back out
	_, _ = s.CreateDocument(user.ID, "", "House renovation 2027", "🏡", "Personal", seedBlocks([]seedBlock{
		{typ: "callout", text: "Tip: click a bullet (•) to zoom into its branch; the bar at the top leads back level by level."},
		{text: "Ground floor"},
		{level: 1, text: "Kitchen"},
		{level: 2, text: "Planning with the kitchen studio"},
		{level: 3, text: "Meeting 1: measurements and first drafts"},
		{level: 4, typ: "todo", text: "Bring the floor plan with measurements", checked: true},
		{level: 4, typ: "todo", text: "Take photos of the water and power connections", checked: true},
		{level: 3, text: "Meeting 2: discuss the quote"},
		{level: 4, text: "Options"},
		{level: 5, text: "A: row with island – €14,800"},
		{level: 6, text: "The island needs its own circuit, ask the electrician"},
		{level: 7, text: "Electrician Huber, appointment in March"},
		{level: 8, text: "What he needs to know"},
		{level: 9, text: "7.4 kW hob → three-phase power (400 V) at the island"},
		{level: 9, text: "Sockets on both sides of the island, one of them with USB"},
		{level: 9, typ: "todo", text: "Photograph the sub-distribution board and send it in advance"},
		{level: 8, text: "Costs"},
		{level: 9, text: "Estimate €900–1,200, depending on the floor build-up"},
		{level: 6, text: "Hob with built-in extractor, no wall cabinet needed"},
		{level: 7, text: "Recirculation or extraction?"},
		{level: 8, text: "Extraction needs a hole through the outside wall"},
		{level: 8, text: "Recirculation: change the filter every 12 months #maintenance"},
		{level: 5, text: "B: L-shape without island – €11,200"},
		{level: 6, text: "more storage, but the dining area gets smaller"},
		{level: 4, typ: "todo", text: "Get a counter-offer from a second studio #renovation"},
		{level: 2, text: "Floor"},
		{level: 3, text: "Tiles 60×60, anthracite"},
		{level: 4, text: "Sample tiles are in the basement"},
		{level: 4, typ: "todo", text: "Have the underfloor heating checked first"},
		{level: 1, text: "Living room"},
		{level: 2, typ: "todo", text: "Wall to the hallway: load-bearing? Ask the structural engineer"},
		{level: 2, text: "Lighting"},
		{level: 3, text: "Dimmable ceiling spots in two groups"},
		{level: 4, text: "controlled through Home Assistant #smarthome"},
		{text: "Upper floor"},
		{level: 1, text: "Bathroom"},
		{level: 2, text: "Walk-in shower instead of a bathtub"},
		{level: 3, text: "Slope and waterproofing"},
		{level: 4, typ: "todo", text: "Quote from the tiler"},
		{level: 4, typ: "todo", text: "Decide: channel drain or point drain"},
		{level: 1, text: "Kids' room"},
		{level: 2, typ: "todo", text: "Let the kids pick the wall colour 🎨 #family", checked: true},
		{text: "Budget"},
		{level: 1, text: "Total €45,000, 10 % of it as a buffer"},
		{level: 2, text: "The kitchen is the biggest item, see Ground floor → Kitchen"},
	}), []string{"renovation"}, false)

	_, _ = s.CreateDocument(user.ID, "", "Idea collection", "💡", "", seedBlocks([]seedBlock{
		{text: "Encrypted offsite backup with restic #backup"},
		{level: 1, text: "Upside: snapshots, deduplication, works with any target"},
		{text: "A family wiki instead of the group chat for recipes and dates #family"},
		{text: "Weekly review every Sunday: empty the inbox, plan the tasks for the week #routine"},
	}), []string{"ideas"}, false)

	listID := ""
	if homelab != nil {
		listID = homelab.ID
	}
	s.seedLinkedTodos(user, listID, "Backup plan", "Projects", "homelab", seedBlocks([]seedBlock{
		{typ: "callout", text: "The checkbox “Put the backup plan into practice” is linked to a task in the Homelab list (badge “Expanded”). The checkboxes right below it are its subtasks: tick them here or in the task – both sides stay the same."},
		{typ: "todo", text: "Put the backup plan into practice #backup"},
		{level: 1, typ: "todo", text: "Create a restic repository on the storage box", checked: true},
		{level: 1, typ: "todo", text: "Nightly run with a systemd timer"},
		{level: 1, typ: "todo", text: "Test a full restore once"},
		{level: 1, text: "Plain bullets don't belong to the task – room for thoughts about the process"},
		{level: 2, text: "Retention: 7 daily, 4 weekly, 6 monthly snapshots"},
		{typ: "h3", text: "How it works"},
		{level: 1, text: "Turn a checkbox into a task via “Expand” (menu at the checkbox)"},
		{level: 1, text: "New checkboxes one level below automatically become subtasks"},
		{level: 1, text: "The other way round: “Deepen into note” in the tasks – see the note for the task “Uptime monitoring”"},
	}))
	s.seedHelpNotesEN(user)
	return nil
}

// seedHelpNotesEN: a short guide to MindSift as notes, so the demo explains itself while showing the
// block types (headings, callouts, numbered lists, code, links to notes).
func (s *Store) seedHelpNotesEN(user *domain.User) {
	const folder = "MindSift help"
	_, _ = s.CreateFolder(user.ID, folder)
	help := func(title, icon string, spec []seedBlock) {
		_, _ = s.CreateDocument(user.ID, "", title, icon, folder, seedBlocks(spec), []string{"help"}, false)
	}
	help("Getting started", "👋", []seedBlock{
		{typ: "callout", text: "Welcome! These notes explain MindSift. Everything here is sample content – changing, moving and deleting it is very much allowed. #help"},
		{typ: "h2", text: "The idea in three steps"},
		{typ: "numbered", text: "**Capture:** whatever comes to mind goes straight into the bar at the top (quick dump) – key `C` or `/`, the + on your phone."},
		{typ: "numbered", text: "**Sort:** later you go through your thoughts in triage: discard, task, note or list item."},
		{typ: "numbered", text: "**Go deeper:** tasks get subtasks and due dates, notes become outlines, lists are shared with your family."},
		{typ: "h2", text: "Read on"},
		{level: 1, text: "[[Notes & outliner]] – bullets, levels, zoom and links"},
		{level: 1, text: "[[Try zooming]] – an outline ten levels deep"},
		{level: 1, text: "[[Tasks & kanban]] – lists, columns, trash"},
		{level: 1, text: "[[Lists & groceries]] – shop and pack together"},
		{level: 1, text: "[[Keyboard shortcuts]] – work faster"},
		{level: 1, text: "[[Voice input]] – dictate instead of typing"},
		{level: 1, text: "[[Sharing & editing together]]"},
		{level: 1, text: "[[API & smart home]] – connect Home Assistant and AI agents"},
	})
	help("Notes & outliner", "📝", []seedBlock{
		{typ: "h2", text: "Bullets and levels"},
		{level: 1, text: "`Enter` adds a new bullet, `Tab` indents, `Shift+Tab` outdents"},
		{level: 1, text: "Bullets with children can be expanded and collapsed (arrow on the left when hovering)"},
		{level: 1, text: "Dragging the bullet (•) moves the whole branch"},
		{level: 1, text: "Clicking the bullet (•) **zooms** into the branch – try it in [[Try zooming]]"},
		{typ: "h2", text: "Formatting"},
		{level: 1, text: "At the start of a line: `- ` bullet, `1. ` number, `[] ` checkbox, `# ` heading"},
		{level: 1, text: "`/` opens the menu: /todo, /h1, /code, /callout, /warn, /fail, /image, /audio, /diktat, /extract …"},
		{level: 1, text: "**bold** with `Ctrl+B`, *italic* with `Ctrl+I`, link with `Ctrl+K`"},
		{typ: "h2", text: "Linking"},
		{level: 1, text: "`[[Note title]]` links a note, e.g. [[Getting started]]"},
		{level: 1, text: "Single bullets can be linked too: search for text in the link dialog, matching bullets are listed below the notes"},
		{level: 1, text: "`#hashtags` collect mentions across all notes, e.g. #help"},
		{typ: "h2", text: "Selecting and deleting"},
		{level: 1, text: "Dragging the mouse across several bullets selects text across bullet borders; Delete removes it like in a text editor"},
		{level: 1, text: "`Ctrl+Z` undoes every change of your own"},
		{typ: "callout", text: "Deleted notes go to the trash at the bottom of the folder bar. How long they stay there is set under Account settings → Retention."},
	})
	help("Try zooming", "🔍", []seedBlock{
		{typ: "callout", text: "Clicking a bullet (•) shows only that branch. The path appears at the top – clicking it goes back level by level."},
		{text: "Level 1: project “New garden”"},
		{level: 1, text: "Level 2: beds"},
		{level: 2, text: "Level 3: raised bed by the fence"},
		{level: 3, text: "Level 4: planting"},
		{level: 4, text: "Level 5: spring"},
		{level: 5, text: "Level 6: lettuce and radishes"},
		{level: 6, text: "Level 7: varieties"},
		{level: 7, text: "Level 8: loose-leaf lettuce “Lollo Rosso”"},
		{level: 8, text: "Level 9: sow from mid-March"},
		{level: 9, text: "Level 10: sow again every two weeks – lettuce all summer long 🥗"},
		{level: 7, text: "Level 8: radish “Icicle”"},
		{level: 5, text: "Level 6: herbs"},
		{level: 6, text: "Level 7: chives, parsley, basil"},
		{level: 4, text: "Level 5: summer"},
		{level: 5, text: "Level 6: tomatoes and courgettes"},
		{level: 2, text: "Level 3: herb spiral"},
		{level: 1, text: "Level 2: lawn"},
		{level: 2, typ: "todo", text: "Level 3: scarify in April"},
	})
	help("Tasks & kanban", "✅", []seedBlock{
		{typ: "h2", text: "Views"},
		{level: 1, text: "**List** with the tabs Open, Done and Trash; grouping and sorting are above it on the right"},
		{level: 1, text: "**Kanban** with your own columns per task list (customize columns: name, colour, done column)"},
		{level: 1, text: "“All tasks” shows the columns of all lists merged"},
		{typ: "h2", text: "Working with tasks"},
		{level: 1, text: "A click opens the details: priority, due date with time, repeat, subtasks, notes (with microphone)"},
		{level: 1, text: "Dragging reorders or changes the column; `Ctrl+Z` undoes deleting, moving and ticking off"},
		{level: 1, text: "Tasks and notes can be linked – example: [[Backup plan]]"},
		{typ: "h2", text: "Tidying up"},
		{level: 1, text: "Completed tasks move to the trash after a while, and the trash empties itself later"},
		{level: 1, text: "Set the periods under Account settings → Retention"},
	})
	help("Lists & groceries", "🛒", []seedBlock{
		{text: "Categories come from hashtags: `oat milk #fridge` ends up under “fridge”"},
		{text: "Quantities go into their own field, e.g. `500 g` or `3x`"},
		{text: "Shared lists show ticked items for everyone right away – perfect for the weekly shop"},
		{text: "Ticked items disappear by themselves after a week (adjustable under Retention)"},
	})
	help("Keyboard shortcuts", "⌨️", []seedBlock{
		{typ: "h2", text: "Everywhere"},
		{level: 1, text: "`C` or `/` – quick dump"},
		{level: 1, text: "`Ctrl+K` – global search across notes, tasks and lists"},
		{typ: "h2", text: "Triage"},
		{level: 1, text: "`H` / `←` discard, `L` / `→` task, `T` with due date, `D` note, space for later"},
		{typ: "h2", text: "Notes"},
		{level: 1, text: "`Tab` / `Shift+Tab` indent and outdent, `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo"},
		{level: 1, text: "`Ctrl+Shift+F` focus mode – just the note, at reading width"},
		{typ: "h2", text: "Tasks"},
		{level: 1, text: "`Ctrl+Z` undoes deleting, moving and ticking off"},
	})
	help("Voice input", "🎙️", []seedBlock{
		{text: "Microphones are in the quick dump, when adding tasks and list items, in a task's notes and as `/diktat` in notes"},
		{text: "On the phone: holding the + starts a recording right away"},
		{text: "With your own Whisper server the recording stays on your server; under Account settings → Voice input you choose Whisper or the browser's recognition"},
		{typ: "callout", text: "In this demo MindSift uses the browser's speech recognition."},
	})
	help("Sharing & editing together", "🤝", []seedBlock{
		{text: "Notes, folders, task lists and lists can be shared with people or groups – for editing or read-only"},
		{text: "Several people write in a shared note at the same time; whoever types in a bullet holds it for a moment"},
		{level: 1, text: "Try it: “Homelab 2.0” is shared with the demo account **user** – sign in as user/user in a second browser"},
		{text: "Tasks in shared lists can be assigned to people and watched"},
	})
	help("API & smart home", "🔌", []seedBlock{
		{text: "Under Account settings → API you create keys with exactly the permissions a device needs"},
		{typ: "h3", text: "Get the tasks due today"},
		{typ: "code", lang: "bash", text: "curl -H \"X-API-Key: mindsift_sec_…\" \\\n  \"https://mindsift.example.com/api/v1/tasks?due=today&status=open\""},
		{typ: "h3", text: "AI agents (MCP)"},
		{text: "Claude Code, Codex and other agents read and manage tasks, lists and notes through `/api/v1/mcp`"},
		{text: "Whatever a key creates or changes carries a small badge with its name"},
	})
}
