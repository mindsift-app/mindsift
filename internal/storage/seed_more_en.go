package storage

import "github.com/mindsift-app/mindsift/internal/domain"

// seedKnowledgeBaseEN: the English version of seed_more_de.go, the same notes in the same folders.
func (s *Store) seedKnowledgeBaseEN(user *domain.User) {
	s.seedKnowledgeBase(user, []seedNote{
		{title: "Roadmap Q1 2027", folder: "Work", tags: []string{"work", "roadmap", "project"}, outline: `
			> Goal for the first quarter: fewer new features, a stable core instead. Decisions from the [[Team meeting 10 November]]. #work
			## Focus
			  - Search performance #performance
			    - Target: under 200 ms with 50,000 entries
			    - Measured with the existing load test script
			  - Rework onboarding for new teams #onboarding
			  - Interface for calendar export
			## Schedule
			| Month | Milestone | Owner |
			| --- | --- | --- |
			| January | Performance measurements, baseline | Jana |
			| February | Search rebuilt, beta for customers | Tom |
			| March | Onboarding live, release | Everyone |
			## Risks
			  - Holiday season in February, two people away for a week
			  - Depends on the customer feedback from the [[Customer workshop Miller Ltd]]
			  - [ ] Plan a two-week buffer
		`},
		{title: "Team meeting 10 November", folder: "Work", tags: []string{"work", "meeting"}, outline: `
			## Attendees
			  - Jana, Tom, Lea, Markus and me #meeting
			## Topics
			  - Look back at the last release
			    - two hotfixes, both caused by missing test data
			    - Decision: staging gets an anonymised copy of the production data
			  - Planning for the next quarter, details in the [[Roadmap Q1 2027]]
			  - Cover during the Christmas break
			## Tasks
			  - [x] Send the invitation for the customer workshop
			  - [ ] Anonymise the staging data (Tom)
			  - [ ] Write down the sprint goals #work
			  - [ ] Find a date for the [[Retrospective sprint 42]]
		`},
		{title: "1:1 with Jana", folder: "Work", tags: []string{"work", "meeting", "feedback"}, outline: `
			- Mood good, but the load in November is high #meeting
			  - Two projects in parallel, mainly the search
			  - Suggestion: fix code reviews to two set times a day
			- Development
			  - Wants to take more responsibility for the architecture
			  - A conference talk would be a good occasion, see [[Talk on observability]]
			- Feedback for me
			  - Write down decisions from meetings sooner
			  - More context in tickets, fewer follow-up questions
			- [ ] Schedule the next 1:1 in three weeks
			- [ ] Clarify the training budget #learning
		`},
		{title: "Retrospective sprint 42", folder: "Work", tags: []string{"work", "meeting", "retro"}, outline: `
			## What went well
			  - Pair programming on the migration, hardly any rework
			  - Daily stand-ups limited to ten minutes #meeting
			## What went badly
			  - Tickets without clear acceptance criteria
			  - Too many interruptions from support requests
			## Actions
			  - [ ] Create a ticket template with acceptance criteria
			  - [ ] Support rotation: one person per week, the rest undisturbed
			  - [x] Block focus time in the morning in the calendar #routine
			> More on focus: [[Deep Work]]
		`},
		{title: "Customer workshop Miller Ltd", folder: "Work", tags: []string{"work", "customer", "meeting"}, outline: `
			## Agenda
			  1. Welcome and goals, 15 minutes #meeting
			  1. Live demo of the current version
			  1. Collecting wishes together on cards
			  1. Prioritising by dot voting
			## Results
			  - Top wish: export to Excel
			  - Second: notification when appointments change
			  - Not wanted: even more settings
			## Next steps
			  - [ ] Send the minutes to all attendees
			  - [ ] Work the wishes into the [[Roadmap Q1 2027]]
			  - [ ] Agree a follow-up date in January
			! The customer expects an answer on the price by the end of the year
		`},
		{title: "Onboarding a new colleague", folder: "Work", tags: []string{"work", "onboarding"}, outline: `
			## First week
			  - Monday: laptop, access, welcome lunch
			  - Tuesday: overview of the architecture
			  - Wednesday: first small ticket, together with Tom
			  - Friday: short feedback chat
			## Access
			  - [x] Email and calendar
			  - [x] Git repository and CI
			  - [ ] VPN certificate
			  - [ ] Access to the staging system
			## Good to know
			  - Questions are very welcome, preferably in the team chat
			  - Deployments run on Tuesdays and Thursdays #work
			  - The most important commands are in the [[Git cheat sheet]]
		`},
		{title: "Talk on observability", folder: "Work", tags: []string{"work", "talk", "learning"}, outline: `
			## Outline
			  1. Why logs alone are not enough
			  1. Metrics, traces and logs working together
			  1. An example from our operations
			  1. What we will try next
			## Material
			  - Collect screenshots of the dashboards
			  - Example: outage in summer, cause found after 20 minutes
			  - Figures from the [[Uptime check for the home servers]]
			## Organisation
			  - [ ] Submit the abstract by the end of November
			  - [ ] Prepare slides, 25 minutes plus questions #learning
			  - [ ] Rehearsal with the team
		`},
		{title: "Network inventory", folder: "Projects/Homelab", tags: []string{"homelab", "network"}, outline: `
			> All fixed addresses in the home network. If something changes it goes in here, not in my head.
			| Device | Address | VLAN | Purpose |
			| --- | --- | --- | --- |
			| Router | 10.0.0.1 | 1 | Gateway, DHCP |
			| Proxmox | 10.0.10.2 | 10 | Virtualisation |
			| MindSift | 10.0.10.21 | 10 | Notes and tasks |
			| Gitea | 10.0.10.22 | 10 | Code and registry |
			| Home Assistant | 10.0.20.5 | 20 | Home control |
			| Printer | 10.0.30.7 | 30 | Office |
			## Notes
			  - The guest Wi-Fi has its own VLAN without access to the others
			  - The Zigbee coordinator is plugged into Home Assistant over USB #homelab
			  - The move is described in [[Homelab 2.0 – moving to the new server]]
		`},
		{title: "Server maintenance checklist", folder: "Projects/Homelab", tags: []string{"homelab", "maintenance"}, outline: `
			## Monthly
			  - [ ] Apply updates for Proxmox and containers #maintenance
			  - [ ] Check the free space of the pools
			  - [ ] Test restoring one file from the backup #backup
			## Quarterly
			  - [ ] Blow the dust out of the case
			  - [ ] Test the UPS battery
			  - [ ] Check certificates and expiry dates
			## Yearly
			  - [ ] Check the hard drives' SMART values
			  - [ ] Full restore test, procedure in [[Backup plan]]
			! Always take a snapshot before bigger updates #homelab
		`},
		{title: "Smart home scenes", folder: "Projects/Homelab", tags: []string{"smarthome", "homelab"}, outline: `
			## Scenes
			  - Good morning
			    - Living-room blinds up at 6:45, kitchen light warm and dimmed #smarthome
			    - Coffee machine on a smart plug, starts at 6:40
			  - Movie night
			    - Ceiling spots at 10 %, blinds down, amplifier on
			  - All off
			    - All lights, the office sockets and the hallway heating set to away
			## Sensors
			  - Basement humidity reports to the inbox by webhook #alarm
			  - Window contacts, heating goes off when a window stays open for more than 5 minutes #smarthome
			## Ideas
			  - [ ] Use a weather station for the sun shading
			  - [ ] Presence detection through the phone
			  - Automations in detail: [[Home Assistant automations]]
		`},
		{title: "Home Assistant automations", folder: "Projects/Homelab", tags: []string{"smarthome", "homelab"}, outline: `
			- Example: remind me to air the room
			  - Trigger: bedroom window open for ten minutes and below 5 degrees outside
			  ~~~yaml
			  alias: Window open too long
			  trigger:
			    - platform: state
			      entity_id: binary_sensor.window_bedroom
			      to: "on"
			      for: "00:10:00"
			  action:
			    - service: notify.mobile_app
			      data:
			        message: "The bedroom window is still open"
			  ~~~
			- Example: webhook for the inbox
			  - Home Assistant sends a message to MindSift as soon as the basement humidity rises above 65 %
			  - Details on keys are in the help under API
			- Open
			  - [ ] Keep the automations in Git #smarthome
			  - See also [[Smart home scenes]]
		`},
		{title: "Uptime check for the home servers", folder: "Projects/Homelab", tags: []string{"homelab", "monitoring"}, outline: `
			- Every five minutes a small service checks whether the important pages answer
			  - MindSift, Gitea, Home Assistant, router interface
			- After two failures in a row a message arrives on the phone #monitoring
			- Results of the last months
			  | Service | Availability | Longest outage |
			  | --- | --- | --- |
			  | MindSift | 99.95 % | 12 minutes |
			  | Gitea | 99.90 % | 25 minutes |
			  | Home Assistant | 99.70 % | 1 hour |
			- All outages were caused by updates, not by hardware
			- [ ] Set up a status page for the family, see [[Server maintenance checklist]]
		`},
		{title: "Garden makeover 2027", folder: "Projects", tags: []string{"garden", "project"}, outline: `
			> Idea: less lawn, more beds, a place to sit in the evening.
			## Planning
			  - Raised beds made of larch along the fence
			    - three of them, 2 × 1 m each, 80 cm high
			    - Filling: branches, leaves, compost, soil
			  - Herb spiral next to the terrace
			  - Rainwater: a barrel connected to the gutter
			## Schedule
			  - [x] Draw a sketch
			  - [ ] Get a quote for the wood, comparison in [[Quotes from tradespeople]]
			  - [ ] Pick a weekend in April for building
			  - [ ] Order seeds #garden
			## Budget
			  - Wood and screws about €600
			  - Soil and compost about €250
			  - Barrel €120
			- Lettuce and radishes serve as the example in the help, see [[Try zooming]]
		`},
		{title: "Quotes from tradespeople", folder: "Projects", tags: []string{"renovation", "finance"}, outline: `
			| Trade | Company | Quote | Status |
			| --- | --- | --- | --- |
			| Kitchen electrics | Huber | €1,050 | accepted |
			| Bathroom tiling | Keller & Sons | €4,800 | open |
			| Bathroom tiling | Berger Tiles | €4,350 | open |
			| Heating service | Schmid | €180 | requested |
			| Wall structural check | Maier Engineering | €650 | accepted |
			- Prices include VAT
			- Follow-ups
			  - [ ] Berger: is the waterproofing included in the price?
			  - [ ] Keller & Sons: is a date in spring possible?
			- Overview of all the work in [[House renovation 2027]] #renovation
		`},
		{title: "Family wiki", folder: "Projects", tags: []string{"family", "ideas"}, outline: `
			> The idea in [[Idea collection]] becomes a start: everything the family needs to know in one place.
			## Contents
			  - Recipes, see [[Lentil dal]] and [[Vegetable curry]]
			  - Important numbers: paediatrician, school, caretaker
			  - Where things are in the house: fuse box, water shut-off valve
			  - Birthdays and gift ideas, see [[Gift ideas]]
			## Rules
			  - Anyone may edit, nothing is deleted without asking
			  - Photos go to the photo manager, only links here
			## Open
			  - [ ] Share the notes with the family #family
			  - [ ] Show Grandma how to use the phone for it
		`},
		{title: "Lentil dal", folder: "Personal/Recipes", tags: []string{"recipe", "cooking"}, outline: `
			> For four people, 30 minutes, cheap and filling.
			## Ingredients
			  - 250 g red lentils
			  - 1 onion, 2 cloves of garlic, 1 piece of ginger
			  - 400 ml coconut milk, 300 ml water
			  - 1 tsp turmeric, 1 tsp cumin, some chilli
			  - Juice of half a lemon, salt
			## Method
			  1. Fry the onion, garlic and ginger in oil until glassy
			  1. Toast the spices briefly
			  1. Add the lentils, coconut milk and water, simmer for 15 minutes
			  1. Season with lemon and salt
			- Serve with rice or flatbread #cooking
			- Freezes well, just like the [[Vegetable curry]] #cooking
		`},
		{title: "Sunday sourdough loaf", folder: "Personal/Recipes", tags: []string{"recipe", "baking"}, outline: `
			## Ingredients
			  - 400 g wheat flour, 100 g rye flour
			  - 100 g active sourdough starter
			  - 350 ml water, 10 g salt
			## Method
			  1. Saturday evening: knead everything, rest for 30 minutes
			  1. Stretch and fold three times, 30 minutes apart
			  1. Proof overnight in the fridge in a banneton
			  1. Sunday: bake with steam at 250 degrees, after 15 minutes lower to 220
			## Notes
			  - First loaf was too flat, the dough was too wet
			  - Next time 20 ml less water #baking
			  - Feed the starter every two days, keep the rest in the fridge
			  - Cake for the birthday: [[Apple cake for Grandma's birthday]]
		`},
		{title: "Vegetable curry", folder: "Personal/Recipes", tags: []string{"recipe", "cooking"}, outline: `
			- Same base as the [[Lentil dal]], just with vegetables instead of lentils
			- Vegetables by season
			  - Cauliflower, potatoes, chickpeas
			  - courgette and peppers in summer
			- Curry paste instead of single spices
			  - red paste, one to two tablespoons
			  - fold in spinach at the end
			- Put the ingredients straight on the shopping list #cooking
			- Kids like it milder, chilli on the table
		`},
		{title: "Apple cake for Grandma's birthday", folder: "Personal/Recipes", tags: []string{"recipe", "family"}, outline: `
			## Dough
			  - 250 g flour, 125 g butter, 100 g sugar, 1 egg, a pinch of salt
			  - Chill the dough for an hour
			## Topping
			  - 1 kg apples, peeled and cut into wedges
			  - Cinnamon, sugar and a handful of raisins
			## Baking
			  - 180 degrees fan, 45 minutes
			  - Let it cool, then dust with icing sugar
			- Grandma likes it with whipped cream #family #cooking
			- [ ] Get the apples from the farm shop
			- Gift idea to go with it: [[Gift ideas]]
		`},
		{title: "City trip to Vienna", folder: "Personal/Travel", tags: []string{"holiday"}, outline: `
			## Framework
			  - Weekend at the end of March, train from Munich
			  - Hotel in the 7th district, breakfast included
			## Programme
			  - Friday evening: Naschmarkt and dinner
			  - Saturday: Schönbrunn in the morning, coffee house in the afternoon
			  - Sunday: Belvedere, then back
			## To clarify
			  - [ ] Book train tickets with a saver fare
			  - [ ] Reserve a table at the restaurant
			  - [ ] Keep an eye on the weather #holiday
			- The packing list is similar to the one for [[Holiday in South Tyrol]], just without hiking boots
		`},
		{title: "Danube cycling tour", folder: "Personal/Travel", tags: []string{"holiday", "sport"}, outline: `
			## Route
			  - Passau to Vienna, about 320 km in six stages #holiday
			  - Stages between 45 and 65 km, plenty of time for breaks
			## Accommodation
			  - Guesthouses with a safe place for the bikes
			  - Book from February
			## Gear
			  - [ ] Check the panniers
			  - [ ] Spare tube and repair kit
			  - [ ] Rain trousers
			## Preparation
			  - Take the bike for a check first, see [[Bike maintenance]]
			  - From May two rides a week as training #sport
		`},
		{title: "Gift ideas", folder: "Personal", tags: []string{"family"}, outline: `
			- Grandma
			  - Photo book of the summer
			  - Voucher for the café
			- Parents
			  - A weekend trip together
			  - Good olive oil and a cookbook
			- Kids
			  - Experiment kit
			  - A book from the [[Reading list 2026]]
			- Friends
			  - Home-baked bread, recipe in [[Sunday sourdough loaf]] #family
			- Rule: give time rather than things
		`},
		{title: "Household budget 2026", folder: "Personal", tags: []string{"finance"}, outline: `
			| Month | Income | Spending | Savings |
			| --- | --- | --- | --- |
			| August | €4,200 | €3,350 | €850 |
			| September | €4,200 | €3,620 | €580 |
			| October | €4,200 | €3,480 | €720 |
			- Biggest items: rent and groceries, the car in third place
			- Savings goal for the renovation: €15,000 by spring, see [[House renovation 2027]]
			- [ ] Compare insurance, see [[Insurance overview]]
			- [ ] Sort the tax documents #finance
			- Settle up briefly on the first Sunday of each month
		`},
		{title: "Insurance overview", folder: "Personal", tags: []string{"finance"}, outline: `
			- Liability
			  - covers the whole family, no excess
			  - Can be cancelled at the end of the year
			- Contents and buildings
			  - Check after the renovation whether the sum still fits #renovation
			- Disability
			  - runs through the employer's pension scheme
			- Legal expenses
			  - mostly unnecessary, on the list to cancel
			- [ ] Get quotes by the end of November #finance
		`},
		{title: "Bike maintenance", folder: "Personal", tags: []string{"maintenance", "sport"}, outline: `
			## Before every season
			  - [ ] Check tyre pressure and tread
			  - [ ] Clean and oil the chain
			  - [ ] Look at the brake pads
			  - [ ] Test the lights
			## Tools
			  - Allen keys, tyre levers, chain oil, floor pump
			  - Everything is in the green box in the garage #maintenance
			## Planned
			  - New chain and sprockets before the [[Danube cycling tour]]
			  - The bike lock has already been replaced #sport
		`},
		{title: "Half marathon training plan", folder: "Personal", tags: []string{"sport", "goals"}, outline: `
			> Goal: finish in April, time does not matter. More in [[Goals 2027]].
			## Weekly plan
			  - Monday: rest
			  - Tuesday: easy run, 6 km
			  - Thursday: tempo run or intervals
			  - Saturday: long run, a bit longer every week
			## Build-up
			  | Week | Long run |
			  | --- | --- |
			  | 1 | 8 km |
			  | 4 | 12 km |
			  | 8 | 16 km |
			  | 11 | 19 km |
			## Notes
			  - The knee complains on asphalt, run more on forest paths #sport
			  - [ ] Buy new running shoes, the old ones have 800 km
		`},
		{title: "The Art of Thinking Clearly", folder: "Learning", tags: []string{"reading", "learning"}, outline: `
			> Book tip from Jonas. 52 short chapters on typical thinking errors. #reading
			## Chapters that stuck
			  - Survivorship bias: we only see the successful ones
			    - Example: founder stories, the ones who failed do not write books
			  - Sunk cost fallacy: what is already paid should not matter
			    - Fits running projects one does not want to end
			  - Confirmation bias: we look for what supports our opinion
			## What I change
			  - [x] Write down counter-arguments first when deciding
			  - [ ] End or continue projects deliberately every quarter #routine
			- A good companion: [[Deep Work]] #reading
			- Read in October, entry in the [[Reading list 2026]]
		`},
		{title: "Deep Work", folder: "Learning", tags: []string{"reading", "learning", "work"}, outline: `
			> Cal Newport on focused work without distraction. #reading #work
			## Core ideas
			  - Deep work is rare and valuable
			  - Shallow tasks (email, chat) must not fill the day
			  - Rituals help: same place, same time
			## Putting it into practice
			  - Two hours in the morning without notifications
			  - Phone in the drawer, chat on mute
			  - In the evening note down what worked today, see [[Weekly review week 46]]
			## Criticism
			  - Not every job allows long focus phases
			  - The team needs shared rules, see [[Retrospective sprint 42]]
			- Related topic: [[The Art of Thinking Clearly]]
		`},
		{title: "Learning Go", folder: "Learning", tags: []string{"learning", "programming"}, outline: `
			## Basics I have learned
			  - Errors are ordinary return values, not an exception mechanism
			  - Interfaces are implicit, there is no implements
			  - Goroutines and channels for concurrency #learning
			## My first program
			  ~~~go
			  package main

			  import "fmt"

			  func main() {
			  	for i := 1; i <= 3; i++ {
			  		fmt.Println("Hello", i)
			  	}
			  }
			  ~~~
			## Exercises
			  - [x] Work through the Tour of Go
			  - [ ] Small command line tool for the backup check, cf. [[Server maintenance checklist]]
			  - [ ] Write tests #programming
		`},
		{title: "Git cheat sheet", folder: "Learning", tags: []string{"programming", "learning"}, outline: `
			- Daily
			  ~~~bash
			  git status
			  git add -p
			  git commit -m "fix: description"
			  git pull --rebase
			  ~~~
			- Tidying up
			  ~~~bash
			  git branch --merged | xargs git branch -d
			  git stash push -m "unfinished"
			  ~~~
			- Undoing mistakes
			  - Keep the last commit's changes but drop the commit: git reset --soft HEAD~1
			  - Put a file back to its last state: git restore file
			- Commit messages in the style of feat, fix and docs #programming
			- Important for new colleagues, see [[Onboarding a new colleague]]
		`},
		{title: "Spanish vocabulary", folder: "Learning", tags: []string{"languages", "learning"}, outline: `
			| English | Spanish | Example |
			| --- | --- | --- |
			| Excuse me | perdón | Perdón, ¿dónde está la estación? |
			| the bill | la cuenta | La cuenta, por favor |
			| How much is that? | ¿Cuánto cuesta? | |
			| I would like | Quisiera | Quisiera un café |
			- Ten minutes in the app every morning #learning
			- Goal: hold simple conversations on the next holiday #learning
			- [ ] Know the numbers up to 100 for sure
		`},
		{title: "Reading list 2026", folder: "Learning", tags: []string{"reading"}, outline: `
			## Read
			  - [x] The Art of Thinking Clearly, see [[The Art of Thinking Clearly]]
			  - [x] Deep Work, see [[Deep Work]]
			  - [x] The Martian
			## Next
			  - [ ] Atomic Habits #reading
			  - [ ] A non-fiction book on networks, to go with the [[Network inventory]]
			  - [ ] A novel on holiday
			## Rules
			  - One book a month, a thinner one if in doubt
			  - Three sentences of notes after every book
		`},
		{title: "Weekly review week 45", folder: "Journal", tags: []string{"routine", "journal"}, outline: `
			## What went well
			  - The search in the project is much faster
			  - Went running twice, see [[Half marathon training plan]]
			## What did not
			  - Did not empty the inbox twice
			  - Too little sleep
			## Next week
			  - [ ] Prepare the team meeting, see [[Team meeting 10 November]]
			  - [ ] Cook dal and freeze it, [[Lentil dal]]
			  - [ ] Make time for the garden #garden
		`},
		{title: "Weekly review week 46", folder: "Journal", tags: []string{"routine", "journal"}, outline: `
			## What went well
			  - The team meeting was clear and short
			  - Kept the focus time in the morning, as described in [[Deep Work]]
			  - Bread worked out, finally not flat any more
			## What did not
			  - Invoices are still lying around #finance
			  - Went to bed too late again
			## Next week
			  - [ ] Prepare the 1:1 with Jana, see [[1:1 with Jana]]
			  - [ ] Compare the quotes from the tradespeople, [[Quotes from tradespeople]]
			  - [ ] Backup test from the [[Server maintenance checklist]]
		`},
		{title: "Journal November", folder: "Journal", tags: []string{"journal"}, outline: `
			- 3 November
			  - Fog early, sun later, a short walk before work
			  - Idea for the family wiki, see [[Family wiki]]
			- 8 November
			  - Baked bread, the house smelled of it all day
			  - Played cards with the kids in the evening #family
			- 12 November
			  - Tough meeting, then a long break in the park
			  - Decided to switch off notifications at the office
			- 15 November
			  - First run in the new running shoes, 10 km without problems
			  - Decided on the October holiday, [[Holiday in South Tyrol]] #holiday
		`},
		{title: "Goals 2027", folder: "Journal", tags: []string{"goals", "routine"}, outline: `
			## Work
			  - Deliver the roadmap, see [[Roadmap Q1 2027]]
			  - Speak at a conference once
			## Personal
			  - Run a half marathon, [[Half marathon training plan]]
			  - Rebuild the garden, [[Garden makeover 2027]] #garden
			  - Finish the renovation, [[House renovation 2027]]
			## Habits
			  - Weekly review every Sunday #routine
			  - One book a month, [[Reading list 2026]]
			  - Ten minutes of Spanish every day, [[Spanish vocabulary]]
			## Finances
			  - Raise the savings rate to 20 %, see [[Household budget 2026]]
			  - [ ] Talk through the yearly goals with the family in December #family
		`},
	})
}
