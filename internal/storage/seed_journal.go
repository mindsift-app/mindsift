package storage

import (
	"time"

	"github.com/mindsift-app/mindsift/internal/domain"
	"github.com/mindsift-app/mindsift/internal/i18n"
)

// seedJournalEntry is one filled day of the demo's journal: how many days before the seed time it lies and
// its outline in the form seedOutline reads. The texts avoid weekdays and dates, because the days move with
// every reset of the demo.
type seedJournalEntry struct {
	daysAgo int
	outline string
}

// seedDemoJournal fills the journal of a demo account with entries for most of the last three weeks, counted
// back from now (the demo is reset every few minutes, so the journal always looks current). Today stays
// empty and so do two days of the last week, the way a real journal has gaps. Every entry is an ordinary
// note titled with the long date, tied to its day in journal_days like the ones the app creates. The notes
// belong to user; the others (the demo user) get the same days, so their journal shows the same entries (the
// notes themselves reach them through seedDemoShares, which therefore has to run afterwards).
func (s *Store) seedDemoJournal(user *domain.User, lang string, now time.Time, others ...*domain.User) {
	entries := seedJournalEN
	if lang == "de" {
		entries = seedJournalDE
	}
	for _, e := range entries {
		day := now.AddDate(0, 0, -e.daysAgo)
		date := day.Format("2006-01-02")
		title := i18n.LongDate(lang, time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC))
		doc, err := s.CreateDocument(user.ID, "", title, "📅", "", seedBlocks(seedOutline(e.outline)), nil, false)
		if err != nil || doc == nil {
			continue
		}
		_ = s.SetJournalDay(user.ID, date, doc.ID)
		for _, o := range others {
			_ = s.SetJournalDay(o.ID, date, doc.ID)
		}
	}
	s.LinkWikiTitles(user.ID)
}

// Days 2 and 5 are left out on purpose: e2e/screenshots.mjs writes into them.
var seedJournalDE = []seedJournalEntry{
	{1, `
		  - Standup: Umzug auf den neuen Server liegt im Plan, die Datenbank ist als Nächstes dran #homelab
		  - [x] Backup-Test mit restic durchgelaufen, die Wiederherstellung hat geklappt
		  - [ ] Wartungsfenster für Samstag mit der Familie abstimmen #familie
		  - Notizen dazu in [[Homelab 2.0 – Umzug auf den neuen Server]]
		  - Abends 5 km gelaufen, die Beine fühlen sich gut an #sport
	`},
	{3, `
		  - Retro zu Sprint 42, die Zusammenfassung steht in [[Retrospektive Sprint 42]] #arbeit
		  - [x] Folien für den Vortrag fertig gegliedert
		    - Grundlage: [[Vortrag Observability]]
		  - [x] Rechnung an den Kunden raus
		  - Idee: Dashboard für die Latenzen als Beispiel in den Vortrag aufnehmen
		  - Sehr müde, früh ins Bett
	`},
	{4, `
		  - Kundenworkshop vorbereitet, Agenda geschickt #arbeit
		    - Material: [[Kundenworkshop Müller GmbH]]
		  - [x] Fragen für die Priorisierung gesammelt
		  - [ ] Raum und Beamer für Donnerstag buchen
		  - Mittags mit Lea spazieren, über die [[Roadmap Q1 2027]] gesprochen
		  - Abends [[Gemüsecurry]] gekocht, diesmal mit weniger Chili #kochen
	`},
	{6, `
		  - Garten: Beete umgegraben, die Himbeeren bekommen einen neuen Platz #garten
		  - Angebot vom Gartenbauer ist da, deutlich teurer als gedacht
		    - Vergleich in [[Angebote Handwerker]]
		  - [x] Kompost umgesetzt
		  - [ ] Zwei weitere Angebote einholen
		  - Die Kinder haben im Wald eine Hütte gebaut #familie
	`},
	{7, `
		  - Kapitel 3 von [[Deep Work]] gelesen, die Idee mit festen Fokuszeiten gefällt mir #lesen
		  - [x] Zwei Stunden ohne Benachrichtigungen gearbeitet, hat funktioniert #arbeit
		  - Nachmittags Meeting zur Roadmap, Entscheidungen in [[Teammeeting 10. November]]
		  - Ideen:
		    - Fokuszeiten im Kalender blocken
		    - Chat nur zu festen Zeiten öffnen
		  - [ ] Kalender-Einladung für die Fokuszeiten anlegen
	`},
	{8, `
		  - Server-Wartung gemacht: Updates eingespielt, Neustart ohne Probleme #homelab
		    - Ablauf nach [[Server-Wartung Checkliste]]
		  - [x] Festplatten-Gesundheit geprüft
		  - [x] Zertifikate laufen noch 60 Tage
		  - Der Uptime-Check hat einen kurzen Ausfall gemeldet, siehe [[Uptime-Check der Heimserver]]
		  - [ ] Benachrichtigung bei Ausfall aufs Handy legen
	`},
	{10, `
		  - Eltern besucht, die Planung für Omas Geburtstag besprochen #familie
		  - [x] Rezept für den Kuchen ausgesucht: [[Apfelkuchen für Omas Geburtstag]]
		  - [ ] Zutaten einkaufen
		  - Mein Bruder bringt die Torte, ich kümmere mich um Kaffee und Deko
		  - Rückfahrt im Regen, Radio gehört, die Ruhe genossen
	`},
	{11, `
		  - Zwei Wochen Spanisch am Stück, 15 Minuten pro Tag #lernen
		    - Vokabeln unter [[Spanisch Vokabeln]]
		  - [x] Lektion über Verben im Perfekt
		  - Laufen: 8 km locker, der [[Laufplan Halbmarathon]] liegt im Plan #sport
		  - [ ] Neue Laufschuhe anschauen
		  - Abends Sauerteig angesetzt für morgen
	`},
	{13, `
		  - Onboarding von Kim: Zugänge eingerichtet, das erste Gespräch war gut #arbeit
		    - Ablauf: [[Onboarding neue Kollegin]]
		  - [x] Willkommensmail verschickt
		  - [x] Patenschaft mit Tom abgesprochen
		  - Frage von Kim: Wo liegen die alten Entscheidungsnotizen? Verlinkung in die Roadmap ergänzen
		  - [ ] Nächste Woche ein 1:1 mit Kim einplanen
	`},
	{14, `
		  - Haushaltsbuch aktualisiert, die Ausgaben für Energie sind gestiegen #finanzen
		    - Zahlen in [[Haushaltsbuch 2026]]
		  - [x] Versicherungen verglichen, die Hausratversicherung ist zu teuer: [[Versicherungen im Überblick]]
		  - [ ] Kündigungsfrist notieren und Alternativen anfragen
		  - Abends Brettspiele mit der Familie #familie
	`},
	{15, `
		  - Smart Home: Die Szene "Abend" läuft jetzt automatisch mit dem Sonnenuntergang #smarthome
		    - Details: [[Smart-Home-Szenen]] und [[Home Assistant Automationen]]
		  - [x] Bewegungsmelder im Flur neu angelernt
		  - Das [[Netzwerk-Inventar]] um drei neue Geräte ergänzt #homelab
		  - [ ] Gäste-WLAN mit Zeitlimit einrichten
	`},
	{17, `
		  - Wochenrückblick geschrieben, Inbox geleert, Aufgaben für die Woche geplant #routine
		  - 1:1 mit Jana, Notizen unter [[1:1 mit Jana]] #arbeit
		    - Sie möchte mehr Verantwortung für die Suche übernehmen
		  - [x] Feedback zum Konzept eingearbeitet
		  - Idee: ein Monatsrückblick als Vorlage, kommt in die [[Ideen-Sammlung]]
		  - [ ] Termin für das nächste Planungsgespräch finden
	`},
	{19, `
		  - Die [[Radtour Donau]] weiter geplant: erste Etappe steht, Unterkünfte angefragt #urlaub
		  - [x] Fahrrad zur Inspektion gebracht, [[Fahrradwartung]] aktualisiert
		  - [ ] Packliste prüfen
		  - Noch zwei Kapitel aus [[Die Kunst des klaren Denkens]] gelesen #lesen
		  - Ein guter Abend auf dem Balkon
	`},
	{20, `
		  - Erster Entwurf für die Roadmap fertig, die Schwerpunkte sind Suche und Onboarding #arbeit
		    - Stand: [[Roadmap Q1 2027]]
		  - [x] Mit Tom den Zeitplan für Februar durchgesprochen
		  - [ ] Risiken rund um die Urlaubszeit ergänzen
		  - Go-Übung: kleinen HTTP-Server geschrieben, die Tests laufen durch #lernen
		    - Notizen in [[Go lernen]]
		  - Nach der Arbeit eine Runde Schwimmen #sport
	`},
}

var seedJournalEN = []seedJournalEntry{
	{1, `
		  - Standup: the move to the new server is on schedule, the database is next #homelab
		  - [x] Backup test with restic went through, the restore worked
		  - [ ] Agree on a maintenance window for Saturday with the family #family
		  - Notes on this in [[Homelab 2.0 – moving to the new server]]
		  - Ran 5 km in the evening, my legs feel good #sport
	`},
	{3, `
		  - Retro for sprint 42, the summary is in [[Retrospective sprint 42]] #work
		  - [x] Outline of the slides for the talk is done
		    - Based on [[Talk on observability]]
		  - [x] Sent the invoice to the customer
		  - Idea: use a latency dashboard as an example in the talk
		  - Very tired, early night
	`},
	{4, `
		  - Prepared the customer workshop, sent out the agenda #work
		    - Material: [[Customer workshop Miller Ltd]]
		  - [x] Collected questions for the prioritisation
		  - [ ] Book the room and the projector for Thursday
		  - Walk with Lea at lunch, talked about the [[Roadmap Q1 2027]]
		  - Cooked the [[Vegetable curry]] in the evening, with less chilli this time #cooking
	`},
	{6, `
		  - Garden: dug over the beds, the raspberries get a new spot #garden
		  - The landscaper's quote has arrived, much more expensive than expected
		    - Comparison in [[Quotes from tradespeople]]
		  - [x] Turned the compost heap
		  - [ ] Ask for two more quotes
		  - The kids built a hut in the woods #family
	`},
	{7, `
		  - Read chapter 3 of [[Deep Work]], I like the idea of fixed focus times #reading
		  - [x] Two hours of work without notifications, it worked #work
		  - Roadmap meeting in the afternoon, decisions in [[Team meeting 10 November]]
		  - Ideas:
		    - Block focus times in the calendar
		    - Open the chat only at fixed times
		  - [ ] Create the calendar invitation for the focus times
	`},
	{8, `
		  - Did the server maintenance: installed updates, the reboot went fine #homelab
		    - Steps from [[Server maintenance checklist]]
		  - [x] Checked the health of the disks
		  - [x] Certificates are valid for another 60 days
		  - The uptime check reported a short outage, see [[Uptime check for the home servers]]
		  - [ ] Send the outage alert to my phone
	`},
	{10, `
		  - Visited my parents, talked about Grandma's birthday #family
		  - [x] Picked a recipe for the cake: [[Apple cake for Grandma's birthday]]
		  - [ ] Buy the ingredients
		  - My brother brings the layer cake, I take care of the coffee and the decorations
		  - Drove home in the rain, listened to the radio, enjoyed the quiet
	`},
	{11, `
		  - Two weeks of Spanish in a row, 15 minutes a day #learning
		    - Words in [[Spanish vocabulary]]
		  - [x] Lesson on the perfect tense
		  - Running: 8 km easy, the [[Half marathon training plan]] is on track #sport
		  - [ ] Look at new running shoes
		  - Started the sourdough in the evening for tomorrow
	`},
	{13, `
		  - Onboarding Kim: accounts set up, the first talk went well #work
		    - Steps: [[Onboarding a new colleague]]
		  - [x] Sent the welcome mail
		  - [x] Agreed with Tom that he is the buddy
		  - Question from Kim: where are the old decision notes? Add a link in the roadmap
		  - [ ] Plan a 1:1 with Kim next week
	`},
	{14, `
		  - Updated the household budget, energy costs went up #finance
		    - Numbers in [[Household budget 2026]]
		  - [x] Compared insurances, the home contents policy is too expensive: [[Insurance overview]]
		  - [ ] Note the notice period and ask for alternatives
		  - Board games with the family in the evening #family
	`},
	{15, `
		  - Smart home: the "evening" scene now runs automatically at sunset #smarthome
		    - Details: [[Smart home scenes]] and [[Home Assistant automations]]
		  - [x] Re-paired the motion sensor in the hallway
		  - Added three new devices to the [[Network inventory]] #homelab
		  - [ ] Set up a guest Wi-Fi with a time limit
	`},
	{17, `
		  - Wrote the weekly review, emptied the inbox, planned the tasks for the week #routine
		  - 1:1 with Jana, notes in [[1:1 with Jana]] #work
		    - She wants to take more responsibility for the search
		  - [x] Worked in the feedback on the concept
		  - Idea: a monthly review template, goes into the [[Idea collection]]
		  - [ ] Find a date for the next planning talk
	`},
	{19, `
		  - Kept planning the [[Danube cycling tour]]: first stage is set, asked for rooms #holiday
		  - [x] Took the bike in for its service, updated [[Bike maintenance]]
		  - [ ] Check the packing list
		  - Read two more chapters of [[The Art of Thinking Clearly]] #reading
		  - A good evening on the balcony
	`},
	{20, `
		  - First draft of the roadmap is done, the focus is search and onboarding #work
		    - Status: [[Roadmap Q1 2027]]
		  - [x] Went through the schedule for February with Tom
		  - [ ] Add the risks around the holiday season
		  - Go exercise: wrote a small HTTP server, the tests pass #learning
		    - Notes in [[Learning Go]]
		  - A swim after work #sport
	`},
}
