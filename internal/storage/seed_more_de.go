package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// seedKnowledgeBaseDE: the German sample notes beyond the help and project notes in seed.go. Titles that
// other notes link to must stay as written; seed_more_test.go checks that every link finds its note.
func (s *Store) seedKnowledgeBaseDE(user *domain.User) {
	s.seedKnowledgeBase(user, []seedNote{
		{title: "Roadmap Q1 2027", folder: "Arbeit", tags: []string{"arbeit", "roadmap", "projekt"}, outline: `
			> Ziel für das erste Quartal: weniger neue Funktionen, dafür ein stabiler Kern. Entscheidungen aus dem [[Teammeeting 10. November]]. #arbeit
			## Schwerpunkte
			  - Performance der Suche #performance
			    - Zielwert: unter 200 ms bei 50.000 Einträgen
			    - Messung mit dem vorhandenen Lasttest-Skript
			  - Onboarding für neue Teams überarbeiten #onboarding
			  - Schnittstelle für Kalenderexport
			## Zeitplan
			| Monat | Meilenstein | Verantwortlich |
			| --- | --- | --- |
			| Januar | Performance-Messungen, Baseline | Jana |
			| Februar | Suche umgebaut, Beta für Kunden | Tom |
			| März | Onboarding live, Release | Alle |
			## Risiken
			  - Urlaubszeit im Februar, zwei Leute fehlen eine Woche
			  - Abhängigkeit vom Kundenfeedback aus dem [[Kundenworkshop Müller GmbH]]
			  - [ ] Puffer von zwei Wochen einplanen
		`},
		{title: "Teammeeting 10. November", folder: "Arbeit", tags: []string{"arbeit", "meeting"}, outline: `
			## Teilnehmer
			  - Jana, Tom, Lea, Markus und ich #meeting
			## Themen
			  - Rückblick auf den letzten Release
			    - zwei Hotfixes, beide wegen fehlender Testdaten
			    - Entscheidung: Staging bekommt eine anonymisierte Kopie der Produktivdaten
			  - Planung für das nächste Quartal, Details in der [[Roadmap Q1 2027]]
			  - Urlaubsvertretung über Weihnachten
			## Aufgaben
			  - [x] Einladung für den Kundenworkshop verschicken
			  - [ ] Staging-Daten anonymisieren (Tom)
			  - [ ] Sprint-Ziele aufschreiben #arbeit
			  - [ ] Termin für die [[Retrospektive Sprint 42]] finden
		`},
		{title: "1:1 mit Jana", folder: "Arbeit", tags: []string{"arbeit", "meeting", "feedback"}, outline: `
			- Stimmung gut, Belastung im November aber hoch #meeting
			  - Zwei Projekte parallel, vor allem die Suche
			  - Vorschlag: Code-Reviews auf zwei feste Zeiten am Tag legen
			- Entwicklung
			  - Möchte mehr Verantwortung für die Architektur übernehmen
			  - Konferenzvortrag wäre ein guter Anlass, siehe [[Vortrag Observability]]
			- Feedback an mich
			  - Entscheidungen im Meeting schneller schriftlich festhalten
			  - Mehr Kontext in Tickets, weniger Rückfragen
			- [ ] Nächstes 1:1 in drei Wochen ansetzen
			- [ ] Weiterbildungsbudget klären #lernen
		`},
		{title: "Retrospektive Sprint 42", folder: "Arbeit", tags: []string{"arbeit", "meeting", "retro"}, outline: `
			## Was lief gut
			  - Pair Programming bei der Migration, kaum Nacharbeit
			  - Tägliche Stand-ups auf zehn Minuten begrenzt #meeting
			## Was lief schlecht
			  - Tickets ohne klare Abnahmekriterien
			  - Zu viele Unterbrechungen durch Support-Anfragen
			## Maßnahmen
			  - [ ] Vorlage für Tickets mit Abnahmekriterien anlegen
			  - [ ] Support-Rotation: eine Person pro Woche, Rest ungestört
			  - [x] Fokuszeit am Vormittag im Kalender blocken #routine
			> Weiterlesen zum Thema Fokus: [[Deep Work]]
		`},
		{title: "Kundenworkshop Müller GmbH", folder: "Arbeit", tags: []string{"arbeit", "kunde", "meeting"}, outline: `
			## Ablauf
			  1. Begrüßung und Ziele, 15 Minuten #meeting
			  1. Live-Demo der aktuellen Version
			  1. Gemeinsames Sammeln von Wünschen auf Karten
			  1. Priorisierung per Punktevergabe
			## Ergebnisse
			  - Wichtigster Wunsch: Export nach Excel
			  - Zweitwichtigster: Benachrichtigung bei Terminänderungen
			  - Nicht gewünscht: noch mehr Einstellungen
			## Nächste Schritte
			  - [ ] Protokoll an alle Teilnehmer schicken
			  - [ ] Wünsche in die [[Roadmap Q1 2027]] einarbeiten
			  - [ ] Folgetermin im Januar vereinbaren
			! Kunde erwartet bis Ende des Jahres eine Rückmeldung zum Preis
		`},
		{title: "Onboarding neue Kollegin", folder: "Arbeit", tags: []string{"arbeit", "onboarding"}, outline: `
			## Erste Woche
			  - Montag: Laptop, Zugänge, Willkommens-Mittagessen
			  - Dienstag: Überblick über die Architektur
			  - Mittwoch: erstes kleines Ticket, gemeinsam mit Tom
			  - Freitag: kurzes Feedback-Gespräch
			## Zugänge
			  - [x] E-Mail und Kalender
			  - [x] Git-Repository und CI
			  - [ ] VPN-Zertifikat
			  - [ ] Zugang zum Staging-System
			## Gut zu wissen
			  - Fragen sind ausdrücklich erwünscht, am besten im Team-Chat
			  - Deployments laufen dienstags und donnerstags #arbeit
			  - Die wichtigsten Befehle stehen im [[Git-Spickzettel]]
		`},
		{title: "Vortrag Observability", folder: "Arbeit", tags: []string{"arbeit", "vortrag", "lernen"}, outline: `
			## Gliederung
			  1. Warum Logs allein nicht reichen
			  1. Metriken, Traces und Logs im Zusammenspiel
			  1. Beispiel aus unserem Betrieb
			  1. Was wir als Nächstes ausprobieren
			## Material
			  - Screenshots der Dashboards sammeln
			  - Beispiel: Ausfall im Sommer, Ursache nach 20 Minuten gefunden
			  - Messwerte aus dem [[Uptime-Check der Heimserver]]
			## Organisation
			  - [ ] Abstract bis Ende November einreichen
			  - [ ] Folien erstellen, 25 Minuten plus Fragen #lernen
			  - [ ] Probevortrag im Team
		`},
		{title: "Netzwerk-Inventar", folder: "Projekte/Homelab", tags: []string{"homelab", "netzwerk"}, outline: `
			> Alle festen Adressen im Heimnetz. Ändert sich etwas, kommt es hier hinein, nicht in den Kopf.
			| Gerät | Adresse | VLAN | Aufgabe |
			| --- | --- | --- | --- |
			| Router | 10.0.0.1 | 1 | Gateway, DHCP |
			| Proxmox | 10.0.10.2 | 10 | Virtualisierung |
			| MindSift | 10.0.10.21 | 10 | Notizen und Aufgaben |
			| Gitea | 10.0.10.22 | 10 | Code und Registry |
			| Home Assistant | 10.0.20.5 | 20 | Haussteuerung |
			| Drucker | 10.0.30.7 | 30 | Büro |
			## Hinweise
			  - Gäste-WLAN hat ein eigenes VLAN ohne Zugriff auf die anderen
			  - Zigbee-Koordinator hängt per USB an Home Assistant #homelab
			  - Die Umstellung steht in [[Homelab 2.0 – Umzug auf den neuen Server]]
		`},
		{title: "Server-Wartung Checkliste", folder: "Projekte/Homelab", tags: []string{"homelab", "wartung"}, outline: `
			## Monatlich
			  - [ ] Updates für Proxmox und Container einspielen #wartung
			  - [ ] Speicherplatz der Pools prüfen
			  - [ ] Wiederherstellung einer Datei aus dem Backup testen #backup
			## Vierteljährlich
			  - [ ] Staub aus dem Gehäuse blasen
			  - [ ] Batterie der USV testen
			  - [ ] Zertifikate und Ablaufdaten prüfen
			## Jährlich
			  - [ ] Festplatten auf SMART-Werte prüfen
			  - [ ] Kompletten Restore-Test, Ablauf siehe [[Backup-Konzept]]
			! Vor größeren Updates immer erst einen Snapshot anlegen #homelab
		`},
		{title: "Smart-Home-Szenen", folder: "Projekte/Homelab", tags: []string{"smarthome", "homelab"}, outline: `
			## Szenen
			  - Guten Morgen
			    - Rollläden im Wohnzimmer um 6:45 auf, Küchenlicht warm und gedimmt
			    - Kaffeemaschine an einer Steckdose, startet um 6:40
			  - Filmabend
			    - Deckenspots auf 10 %, Rollläden zu, Verstärker an
			  - Alles aus
			    - Alle Lichter, Steckdosen im Büro und die Heizung im Flur auf Abwesend
			## Sensoren
			  - Feuchtigkeit im Keller meldet per Webhook an die Inbox #alarm
			  - Fensterkontakte, Heizung geht aus, wenn ein Fenster länger als 5 Minuten offen ist #smarthome
			## Ideen
			  - [ ] Wetterstation für Sonnenschutz nutzen
			  - [ ] Anwesenheitserkennung über das Telefon
			  - Automationen im Detail: [[Home Assistant Automationen]]
		`},
		{title: "Home Assistant Automationen", folder: "Projekte/Homelab", tags: []string{"smarthome", "homelab"}, outline: `
			- Beispiel: Lüften erinnern
			  - Trigger: Fenster im Schlafzimmer seit zehn Minuten offen und draußen unter 5 Grad
			  ~~~yaml
			  alias: Fenster zu lange offen
			  trigger:
			    - platform: state
			      entity_id: binary_sensor.fenster_schlafzimmer
			      to: "on"
			      for: "00:10:00"
			  action:
			    - service: notify.mobile_app
			      data:
			        message: "Schlafzimmerfenster ist noch offen"
			  ~~~
			- Beispiel: Webhook für die Inbox
			  - Home Assistant schickt eine Nachricht an MindSift, sobald die Kellerfeuchtigkeit über 65 % steigt
			  - Details zu Schlüsseln stehen in der Hilfe unter API
			- Offen
			  - [ ] Automationen in Git ablegen #smarthome
			  - Siehe auch [[Smart-Home-Szenen]]
		`},
		{title: "Uptime-Check der Heimserver", folder: "Projekte/Homelab", tags: []string{"homelab", "monitoring"}, outline: `
			- Alle fünf Minuten prüft ein kleiner Dienst, ob die wichtigen Seiten antworten
			  - MindSift, Gitea, Home Assistant, Router-Oberfläche
			- Bei zwei Fehlern hintereinander kommt eine Nachricht aufs Telefon #monitoring
			- Auswertung der letzten Monate
			  | Dienst | Verfügbarkeit | Längster Ausfall |
			  | --- | --- | --- |
			  | MindSift | 99,95 % | 12 Minuten |
			  | Gitea | 99,90 % | 25 Minuten |
			  | Home Assistant | 99,70 % | 1 Stunde |
			- Alle Ausfälle lagen an Updates, nicht an Hardware
			- [ ] Statusseite für die Familie einrichten, siehe [[Server-Wartung Checkliste]]
		`},
		{title: "Gartenumbau 2027", folder: "Projekte", tags: []string{"garten", "projekt"}, outline: `
			> Idee: weniger Rasen, mehr Beete, ein Platz zum Sitzen am Abend.
			## Planung
			  - Hochbeete aus Lärchenholz entlang des Zauns
			    - drei Stück, je 2 × 1 m, Höhe 80 cm
			    - Füllung: Äste, Laub, Kompost, Erde
			  - Kräuterspirale neben der Terrasse
			  - Regenwasser: Tonne mit Anschluss an die Dachrinne
			## Zeitplan
			  - [x] Skizze zeichnen
			  - [ ] Angebot Holz einholen, Vergleich in [[Angebote Handwerker]]
			  - [ ] Wochenende im April fürs Aufbauen festlegen
			  - [ ] Saatgut bestellen #garten
			## Budget
			  - Holz und Schrauben ca. 600 €
			  - Erde und Kompost ca. 250 €
			  - Tonne 120 €
			- Salat und Radieschen laufen als Beispiel in der Hilfe, siehe [[Zoom ausprobieren]]
		`},
		{title: "Angebote Handwerker", folder: "Projekte", tags: []string{"renovierung", "finanzen"}, outline: `
			| Gewerk | Firma | Angebot | Status |
			| --- | --- | --- | --- |
			| Elektrik Küche | Huber | 1.050 € | angenommen |
			| Fliesen Bad | Keller & Söhne | 4.800 € | offen |
			| Fliesen Bad | Fliesen Berger | 4.350 € | offen |
			| Heizungswartung | Schmid | 180 € | angefragt |
			| Statik Wand | Büro Maier | 650 € | angenommen |
			- Preise inklusive Mehrwertsteuer
			- Nachfragen
			  - [ ] Berger: ist die Abdichtung im Preis enthalten?
			  - [ ] Keller & Söhne: Termin im Frühjahr möglich?
			- Gesamtübersicht der Arbeiten in [[Hausrenovierung 2027]] #renovierung
		`},
		{title: "Familien-Wiki", folder: "Projekte", tags: []string{"familie", "ideen"}, outline: `
			> Aus der Idee in [[Ideen-Sammlung]] wird ein Anfang: alles, was die Familie wissen muss, an einem Ort.
			## Inhalt
			  - Rezepte, siehe [[Linsen-Dal]] und [[Gemüsecurry]]
			  - Wichtige Nummern: Kinderarzt, Schule, Hausmeister
			  - Wo liegt was im Haus: Sicherungskasten, Wasserabsperrhahn
			  - Geburtstage und Geschenkideen, siehe [[Geschenkideen]]
			## Regeln
			  - Jeder darf ändern, nichts wird gelöscht ohne Rückfrage
			  - Fotos kommen in die Fotoverwaltung, hier nur Links
			## Offen
			  - [ ] Notizen mit der Familie teilen #familie
			  - [ ] Oma zeigen, wie man das Handy dafür benutzt
		`},
		{title: "Linsen-Dal", folder: "Privat/Rezepte", tags: []string{"rezept", "kochen"}, outline: `
			> Für vier Personen, 30 Minuten, günstig und sättigend.
			## Zutaten
			  - 250 g rote Linsen
			  - 1 Zwiebel, 2 Knoblauchzehen, 1 Stück Ingwer
			  - 400 ml Kokosmilch, 300 ml Wasser
			  - 1 TL Kurkuma, 1 TL Kreuzkümmel, etwas Chili
			  - Saft einer halben Zitrone, Salz
			## Zubereitung
			  1. Zwiebel, Knoblauch und Ingwer in Öl glasig anbraten
			  1. Gewürze kurz mitrösten
			  1. Linsen, Kokosmilch und Wasser dazugeben, 15 Minuten köcheln
			  1. Mit Zitrone und Salz abschmecken
			- Dazu Reis oder Fladenbrot #kochen
			- Lässt sich gut einfrieren, ähnlich wie das [[Gemüsecurry]] #kochen
		`},
		{title: "Sonntagsbrot mit Sauerteig", folder: "Privat/Rezepte", tags: []string{"rezept", "backen"}, outline: `
			## Zutaten
			  - 400 g Weizenmehl 1050, 100 g Roggenmehl
			  - 100 g aktiver Sauerteig
			  - 350 ml Wasser, 10 g Salz
			## Ablauf
			  1. Samstagabend: alles verkneten, 30 Minuten ruhen lassen
			  1. Dehnen und falten, dreimal im Abstand von 30 Minuten
			  1. Über Nacht im Kühlschrank in einem Gärkorb gehen lassen
			  1. Sonntag: bei 250 Grad mit Dampf anbacken, nach 15 Minuten auf 220 Grad
			## Notizen
			  - Erstes Brot war zu flach, Teig war zu nass
			  - Beim nächsten Mal 20 ml weniger Wasser #backen
			  - Sauerteig füttern: alle zwei Tage, Rest im Kühlschrank
			  - Kuchen zum Geburtstag: [[Apfelkuchen für Omas Geburtstag]]
		`},
		{title: "Gemüsecurry", folder: "Privat/Rezepte", tags: []string{"rezept", "kochen"}, outline: `
			- Basis wie beim [[Linsen-Dal]], nur mit Gemüse statt Linsen
			- Gemüse nach Saison
			  - Blumenkohl, Kartoffeln, Kichererbsen
			  - im Sommer Zucchini und Paprika
			- Currypaste statt einzelner Gewürze
			  - rote Paste, ein bis zwei Esslöffel
			  - zum Schluss Spinat unterheben
			- Zutaten gleich auf die Einkaufsliste setzen #kochen
			- Kinder mögen es milder, Chili extra am Tisch
		`},
		{title: "Apfelkuchen für Omas Geburtstag", folder: "Privat/Rezepte", tags: []string{"rezept", "familie"}, outline: `
			## Teig
			  - 250 g Mehl, 125 g Butter, 100 g Zucker, 1 Ei, 1 Prise Salz
			  - Teig eine Stunde kühlen
			## Belag
			  - 1 kg Äpfel, geschält und in Spalten
			  - Zimt, Zucker und eine Handvoll Rosinen
			## Backen
			  - 180 Grad Umluft, 45 Minuten
			  - Auskühlen lassen, dann mit Puderzucker bestäuben
			- Oma mag ihn mit Schlagsahne #familie #kochen
			- [ ] Äpfel beim Hofladen holen
			- Geschenkidee dazu: [[Geschenkideen]]
		`},
		{title: "Städtetrip Wien", folder: "Privat/Reisen", tags: []string{"urlaub"}, outline: `
			## Rahmen
			  - Wochenende Ende März, Zug ab München
			  - Hotel im 7. Bezirk, Frühstück inklusive
			## Programm
			  - Freitagabend: Naschmarkt und Abendessen
			  - Samstag: Schönbrunn am Vormittag, nachmittags Kaffeehaus
			  - Sonntag: Belvedere, dann zurück
			## Zu klären
			  - [ ] Zugtickets mit Sparpreis buchen
			  - [ ] Tisch im Restaurant reservieren
			  - [ ] Wetter im Blick behalten #urlaub
			- Die Packliste ähnelt der von [[Urlaub Südtirol]], nur ohne Wanderschuhe
		`},
		{title: "Radtour Donau", folder: "Privat/Reisen", tags: []string{"urlaub", "sport"}, outline: `
			## Strecke
			  - Passau bis Wien, rund 320 km in sechs Etappen #urlaub
			  - Etappen zwischen 45 und 65 km, genug Zeit für Pausen
			## Übernachtung
			  - Pensionen mit sicherem Fahrradraum
			  - Buchung ab Februar
			## Ausrüstung
			  - [ ] Satteltaschen prüfen
			  - [ ] Ersatzschlauch und Flickzeug
			  - [ ] Regenhose
			## Vorbereitung
			  - Fahrrad vorher zum Check, siehe [[Fahrradwartung]]
			  - Ab Mai zwei Touren pro Woche zum Trainieren #sport
		`},
		{title: "Geschenkideen", folder: "Privat", tags: []string{"familie"}, outline: `
			- Oma
			  - Fotobuch vom Sommer
			  - Gutschein fürs Café
			- Eltern
			  - Gemeinsamer Wochenendausflug
			  - Gutes Olivenöl und ein Kochbuch
			- Kinder
			  - Experimentierkasten
			  - Ein Buch aus der [[Leseliste 2026]]
			- Freunde
			  - Selbst gebackenes Brot, Rezept in [[Sonntagsbrot mit Sauerteig]] #familie
			- Regel: lieber Zeit als Dinge verschenken
		`},
		{title: "Haushaltsbuch 2026", folder: "Privat", tags: []string{"finanzen"}, outline: `
			| Monat | Einnahmen | Ausgaben | Sparen |
			| --- | --- | --- | --- |
			| August | 4.200 € | 3.350 € | 850 € |
			| September | 4.200 € | 3.620 € | 580 € |
			| Oktober | 4.200 € | 3.480 € | 720 € |
			- Größte Posten: Miete und Lebensmittel, Auto auf Platz drei
			- Sparziel für die Renovierung: 15.000 € bis Frühjahr, siehe [[Hausrenovierung 2027]]
			- [ ] Versicherungen vergleichen, siehe [[Versicherungen im Überblick]]
			- [ ] Steuerunterlagen sortieren #finanzen
			- Jeden ersten Sonntag im Monat kurz abrechnen
		`},
		{title: "Versicherungen im Überblick", folder: "Privat", tags: []string{"finanzen"}, outline: `
			- Haftpflicht
			  - gilt für die ganze Familie, keine Selbstbeteiligung
			  - Kündigung zum Jahresende möglich
			- Hausrat und Gebäude
			  - Nach dem Umbau prüfen, ob die Summe noch passt #renovierung
			- Berufsunfähigkeit
			  - läuft über die Rentenversicherung des Arbeitgebers
			- Rechtsschutz
			  - eher unnötig, steht auf der Streichliste
			- [ ] Angebote bis Ende November einholen #finanzen
		`},
		{title: "Fahrradwartung", folder: "Privat", tags: []string{"wartung", "sport"}, outline: `
			## Vor jeder Saison
			  - [ ] Reifendruck und Profil prüfen
			  - [ ] Kette reinigen und ölen
			  - [ ] Bremsbeläge ansehen
			  - [ ] Licht testen
			## Werkzeug
			  - Inbusschlüssel, Reifenheber, Kettenöl, Standpumpe
			  - Alles liegt in der Garage im grünen Kasten #wartung
			## Geplant
			  - Neue Kette und Ritzel vor der [[Radtour Donau]]
			  - Fahrradschloss ist schon ersetzt #sport
		`},
		{title: "Laufplan Halbmarathon", folder: "Privat", tags: []string{"sport", "ziele"}, outline: `
			> Ziel: im April ins Ziel kommen, Zeit egal. Mehr dazu in [[Ziele 2027]].
			## Wochenplan
			  - Montag: Pause
			  - Dienstag: lockerer Lauf, 6 km
			  - Donnerstag: Tempolauf oder Intervalle
			  - Samstag: langer Lauf, jede Woche etwas länger
			## Aufbau
			  | Woche | Langer Lauf |
			  | --- | --- |
			  | 1 | 8 km |
			  | 4 | 12 km |
			  | 8 | 16 km |
			  | 11 | 19 km |
			## Notizen
			  - Knie meldet sich bei Asphalt, mehr auf Waldwegen laufen #sport
			  - [ ] Neue Laufschuhe kaufen, die alten haben 800 km
		`},
		{title: "Die Kunst des klaren Denkens", folder: "Lernen", tags: []string{"lesen", "lernen"}, outline: `
			> Buchtipp von Jonas. 52 kurze Kapitel über typische Denkfehler. #lesen
			## Kapitel, die hängen geblieben sind
			  - Survivorship Bias: wir sehen nur die Erfolgreichen
			    - Beispiel: Gründergeschichten, die Gescheiterten schreiben keine Bücher
			  - Sunk Cost Fallacy: was schon bezahlt ist, sollte keine Rolle spielen
			    - Passt zu laufenden Projekten, die man nicht beenden will
			  - Bestätigungsfehler: wir suchen, was unsere Meinung stützt
			## Was ich ändere
			  - [x] Bei Entscheidungen erst Gegenargumente aufschreiben
			  - [ ] Projekte quartalsweise bewusst beenden oder fortsetzen #routine
			- Gute Ergänzung: [[Deep Work]] #lesen
			- Gelesen im Oktober, Eintrag in der [[Leseliste 2026]]
		`},
		{title: "Deep Work", folder: "Lernen", tags: []string{"lesen", "lernen", "arbeit"}, outline: `
			> Cal Newport über konzentriertes Arbeiten ohne Ablenkung. #lesen #arbeit
			## Kernideen
			  - Tiefe Arbeit ist selten und wertvoll
			  - Flache Aufgaben (E-Mail, Chat) dürfen nicht den Tag füllen
			  - Rituale helfen: gleicher Ort, gleiche Zeit
			## Umsetzung
			  - Zwei Stunden am Vormittag ohne Benachrichtigungen
			  - Handy in der Schublade, Chat auf stumm
			  - Abends kurz festhalten, was heute gelungen ist, siehe [[Wochenrückblick KW 46]]
			## Kritik
			  - Nicht jeder Job lässt lange Fokusphasen zu
			  - Für das Team braucht es gemeinsame Regeln, siehe [[Retrospektive Sprint 42]]
			- Verwandtes Thema: [[Die Kunst des klaren Denkens]]
		`},
		{title: "Go lernen", folder: "Lernen", tags: []string{"lernen", "programmieren"}, outline: `
			## Grundlagen, die ich gelernt habe
			  - Fehler sind normale Rückgabewerte, kein Ausnahmemechanismus
			  - Schnittstellen sind implizit, es gibt kein implements
			  - Goroutinen und Kanäle für Nebenläufigkeit #lernen
			## Mein erstes Programm
			  ~~~go
			  package main

			  import "fmt"

			  func main() {
			  	for i := 1; i <= 3; i++ {
			  		fmt.Println("Hallo", i)
			  	}
			  }
			  ~~~
			## Übungen
			  - [x] Tour of Go durcharbeiten
			  - [ ] Kleines Kommandozeilenwerkzeug für die Backup-Prüfung, vgl. [[Server-Wartung Checkliste]]
			  - [ ] Tests schreiben #programmieren
		`},
		{title: "Git-Spickzettel", folder: "Lernen", tags: []string{"programmieren", "lernen"}, outline: `
			- Täglich
			  ~~~bash
			  git status
			  git add -p
			  git commit -m "fix: Beschreibung"
			  git pull --rebase
			  ~~~
			- Aufräumen
			  ~~~bash
			  git branch --merged | xargs git branch -d
			  git stash push -m "unfertig"
			  ~~~
			- Fehler rückgängig machen
			  - Letzten Commit behalten, Änderungen lassen: git reset --soft HEAD~1
			  - Datei auf den letzten Stand zurücksetzen: git restore datei
			- Commit-Nachrichten im Stil von feat, fix und docs #programmieren
			- Wichtig für neue Kollegen, siehe [[Onboarding neue Kollegin]]
		`},
		{title: "Spanisch Vokabeln", folder: "Lernen", tags: []string{"sprachen", "lernen"}, outline: `
			| Deutsch | Spanisch | Beispiel |
			| --- | --- | --- |
			| Entschuldigung | perdón | Perdón, ¿dónde está la estación? |
			| die Rechnung | la cuenta | La cuenta, por favor |
			| Wie viel kostet das? | ¿Cuánto cuesta? | |
			| Ich hätte gern | Quisiera | Quisiera un café |
			- Jeden Morgen zehn Minuten in der App #lernen
			- Ziel: im nächsten Urlaub einfache Gespräche führen #lernen
			- [ ] Zahlen bis 100 sicher können
		`},
		{title: "Leseliste 2026", folder: "Lernen", tags: []string{"lesen"}, outline: `
			## Gelesen
			  - [x] Die Kunst des klaren Denkens, siehe [[Die Kunst des klaren Denkens]]
			  - [x] Deep Work, siehe [[Deep Work]]
			  - [x] Der Marsianer
			## Als Nächstes
			  - [ ] Atomic Habits #lesen
			  - [ ] Ein Sachbuch über Netzwerke, passend zum [[Netzwerk-Inventar]]
			  - [ ] Einen Roman im Urlaub
			## Regeln
			  - Pro Monat ein Buch, im Zweifel ein dünneres
			  - Nach jedem Buch drei Sätze Notizen
		`},
		{title: "Wochenrückblick KW 45", folder: "Journal", tags: []string{"routine", "journal"}, outline: `
			## Was ging gut
			  - Suche im Projekt läuft deutlich schneller
			  - Zweimal laufen gewesen, siehe [[Laufplan Halbmarathon]]
			## Was nicht
			  - Inbox zweimal nicht geleert
			  - Zu wenig geschlafen
			## Nächste Woche
			  - [ ] Teammeeting vorbereiten, siehe [[Teammeeting 10. November]]
			  - [ ] Dal kochen und einfrieren, [[Linsen-Dal]]
			  - [ ] Zeit für den Garten einplanen #garten
		`},
		{title: "Wochenrückblick KW 46", folder: "Journal", tags: []string{"routine", "journal"}, outline: `
			## Was ging gut
			  - Teammeeting war klar und kurz
			  - Fokuszeiten am Vormittag eingehalten, wie in [[Deep Work]] beschrieben
			  - Brot gelungen, endlich nicht mehr flach
			## Was nicht
			  - Rechnungen liegen noch rum #finanzen
			  - Wieder zu spät ins Bett
			## Nächste Woche
			  - [ ] 1:1 mit Jana vorbereiten, siehe [[1:1 mit Jana]]
			  - [ ] Handwerkerangebote vergleichen, [[Angebote Handwerker]]
			  - [ ] Backup-Test aus der [[Server-Wartung Checkliste]]
		`},
		{title: "Tagebuch November", folder: "Journal", tags: []string{"journal"}, outline: `
			- 3. November
			  - Früh Nebel, später Sonne, kurzer Spaziergang vor der Arbeit
			  - Idee fürs Familien-Wiki, siehe [[Familien-Wiki]]
			- 8. November
			  - Brot gebacken, das Haus roch den ganzen Tag danach
			  - Abends mit den Kindern Karten gespielt #familie
			- 12. November
			  - Zähes Meeting, danach lange Pause im Park
			  - Beschlossen, Benachrichtigungen im Büro auszuschalten
			- 15. November
			  - Erste Tour mit den neuen Laufschuhen, 10 km ohne Probleme
			  - Entscheidung zum Urlaub im Oktober getroffen, [[Urlaub Südtirol]] #urlaub
		`},
		{title: "Ziele 2027", folder: "Journal", tags: []string{"ziele", "routine"}, outline: `
			## Beruflich
			  - Roadmap umsetzen, siehe [[Roadmap Q1 2027]]
			  - Einmal auf einer Konferenz sprechen
			## Privat
			  - Halbmarathon laufen, [[Laufplan Halbmarathon]]
			  - Garten umbauen, [[Gartenumbau 2027]] #garten
			  - Renovierung abschließen, [[Hausrenovierung 2027]]
			## Gewohnheiten
			  - Wochenrückblick jeden Sonntag #routine
			  - Ein Buch pro Monat, [[Leseliste 2026]]
			  - Jeden Tag zehn Minuten Spanisch, [[Spanisch Vokabeln]]
			## Finanzen
			  - Sparquote auf 20 % erhöhen, siehe [[Haushaltsbuch 2026]]
			  - [ ] Jahresziele im Dezember mit der Familie besprechen #familie
		`},
	})
}
