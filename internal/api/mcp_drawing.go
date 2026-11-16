package api

import (
	"context"
	"encoding/json"

	"github.com/mindsift-app/mindsift/internal/storage"
)

// Drawings over MCP: the tool descriptions only name the Mermaid kinds (some clients cut long descriptions
// off); drawing_help returns the full guide, the JSON model and examples when an agent needs them.

// mcpDrawingHelp: how drawings are written, for the tool descriptions
const mcpDrawingHelp = "type drawing: text is Mermaid, laid out automatically: flowchart/graph, mindmap, sequenceDiagram, stateDiagram-v2 or gitGraph; " +
	"give start, end, decisions and groups their own colour (style/classDef). For the JSON drawing model or Mermaid details call drawing_help."

// mcpDrawingGuide is what drawing_help returns
type mcpDrawingGuide struct {
	Mermaid  mcpMermaidGuide   `json:"mermaid"`
	Model    string            `json:"model"`
	Colors   string            `json:"colors"`
	Examples mcpDrawingSamples `json:"examples"`
}

type mcpMermaidGuide struct {
	General   string `json:"general"`
	Flowchart string `json:"flowchart"`
	Mindmap   string `json:"mindmap"`
	Sequence  string `json:"sequenceDiagram"`
	State     string `json:"stateDiagram"`
	GitGraph  string `json:"gitGraph"`
}

type mcpDrawingSamples struct {
	Flowchart string `json:"flowchart"`
	Sequence  string `json:"sequenceDiagram"`
	State     string `json:"stateDiagram"`
	GitGraph  string `json:"gitGraph"`
	Model     string `json:"model"`
}

var mcpDrawingHelpText = mcpDrawingGuide{
	Mermaid: mcpMermaidGuide{
		General: "Send a drawing as Mermaid: as the text of a drawing bullet (add_note_bullet or update_note_bullet with type drawing; " +
			"a ```mermaid fence around it is fine) or as a ```mermaid block in create_note's content. The server lays it out once; the result " +
			"is an ordinary drawing the user can edit (arrows stay docked when a box moves). Lines it cannot read are skipped; a diagram with " +
			"nothing readable is an error. Colours in style/classDef/rect/box may be CSS names, #hex or rgb(); each becomes the nearest theme " +
			"colour, white or none means no fill. Use colour: start and end, decisions, warnings and groups of related boxes with their own fill " +
			"read much faster than all boxes alike. Keep labels to a few words; <br> breaks a line.",
		Flowchart: "flowchart or graph, then TD|TB|LR|BT|RL. Nodes: A[box], B(rounded), C([stadium]), D{decision}, E((circle)), F{{hexagon}} (a diamond), " +
			"G[\"text with [brackets]\"]. Links: --> arrow, --- line, -.-> dashed, ==> bold, <--> both ends; labels -->|yes| or -- yes -->; " +
			"chains A --> B --> C; groups A & B --> C. Colours: style A fill:#9f9,stroke:#333; classDef ok fill:green plus class A,B ok or A:::ok; " +
			"linkStyle 0 stroke:red. subgraph/end and click are ignored (their nodes stay). Laid out in layers with right-angled lines.",
		Mindmap: "mindmap: one node per line, children indented deeper than their parent, the first line is the root; root((text)) round, " +
			"[text] box, (text) rounded, {{text}} diamond. Each main branch gets its own colour; ::icon and classes are ignored.",
		Sequence: "sequenceDiagram: participant A as Anna, actor K as Kundin (an ellipse), in the order written (others appear where first used). " +
			"Messages A->>B: text (arrow), A-->>B: dashed reply, A->B / A-->B without head, A-xB / A--xB lost (red), A-)B async, A<<->>B both ways; " +
			"A->>A: text loops back. Note right of A: text, Note left of A: …, Note over A,B: … (orange boxes). loop/alt/else/opt/par/and/critical/break … end " +
			"become frames with their condition; rect rgb(200, 230, 255) … end a coloured band; box Aqua Team … end a group behind participants. " +
			"autonumber numbers the messages; activate/deactivate and +/- are ignored. Participants stand at the top and the bottom, joined by dashed lifelines.",
		State: "stateDiagram-v2 or stateDiagram: [*] --> A starts at a dot, A --> [*] ends at a ring; A --> B : label is a transition. " +
			"state \"Long name\" as A; A : description (several such lines add up); state X <<choice>> a small diamond, <<fork>>/<<join>> a bar; " +
			"state X { … } a composite state: its inner start becomes a dashed arrow from X, its inner end a ring of its own. " +
			"note right of A : text (or note left of A … end note over several lines) is an orange box beside A. direction LR; " +
			"classDef/class/:::/style colours as in flowcharts. Laid out like a flowchart.",
		GitGraph: "gitGraph (left to right; gitGraph TB: or BT: runs down or up): commit [id: \"text\"] [tag: \"v1.0\"] [type: NORMAL|HIGHLIGHT|REVERSE], " +
			"branch name [order: n], checkout or switch name, merge name [id: …] [tag: …], cherry-pick id: \"text\". Every commit has a column of its own, " +
			"every branch a lane in its own colour (main first) with its name at the start; ids and tags stand beside the commits (commits without id " +
			"stay unlabelled), merges are rings, HIGHLIGHT a square, REVERSE red, a cherry-pick a dashed line from the picked commit. " +
			"Branch colours are chosen automatically.",
	},
	Model: "Instead of Mermaid, text may be the drawing itself: {\"v\":1,\"els\":[…]}, in pixels (x to the right, y down). " +
		"Shapes {\"id\",\"t\":\"rect|ellipse|diamond\",\"x\",\"y\" (top left corner),\"w\",\"h\",\"txt\" (wraps inside),\"fs\" (font size: 14, 18 default, 28)," +
		"\"s\" (outline and text colour),\"f\" (fill colour or \"none\"),\"sw\" (line width 1-12, usually 2),\"r\":true (round corners),\"dash\":true}. " +
		"Text {\"id\",\"t\":\"text\",\"x\",\"y\" (top left),\"txt\",\"fs\",\"s\"}. " +
		"Arrows {\"id\",\"t\":\"arrow\",\"from\",\"to\" (ids of the shapes it docks to; it follows them when they move),\"a\":[x,y],\"b\":[x,y] " +
		"(start and end; for docked ends a point on the shape's edge),\"route\":\"straight|curve|elbow\",\"bend\" (curves: how far the middle bends, " +
		"as a share of the length, e.g. 0.25),\"via\":[[x,y],…] (corner points of an elbow),\"head\":0 none|1 start|2 end|3 both,\"txt\" (label)," +
		"\"fs\",\"s\",\"sw\",\"dash\"}. Freehand {\"id\",\"t\":\"draw\",\"pts\":[x0,y0,x1,y1,…],\"s\",\"sw\"}. " +
		"ids are short unique strings; fills are drawn light, so text in a filled shape stays readable. " +
		"Optional \"frame\":{\"x\",\"y\",\"w\",\"h\"} is the section the note shows. At most 100 000 bytes. get_note describes drawings in words, it never returns this model.",
	Colors: "main (text colour), muted (grey), accent (the theme's accent colour), red, orange, green, blue, purple. They follow the user's theme, " +
		"light or dark, so a drawing never uses fixed colours.",
	Examples: mcpDrawingSamples{
		Flowchart: "flowchart TD\n  A([Antrag eingegangen]) --> B{Vollständig?}\n  B -->|ja| C[Prüfen]\n  B -->|nein| D[Nachfordern] -.-> A\n" +
			"  C --> E([Bescheid])\n  classDef start fill:#9f9\n  classDef frage fill:orange\n  class A,E start\n  class B frage",
		Sequence: "sequenceDiagram\n  actor K as Kundin\n  participant S as Shop\n  K->>S: Bestellung\n  alt bezahlt\n    S-->>K: Bestätigung\n" +
			"  else abgelehnt\n    S--xK: Fehler\n  end\n  Note over K,S: Ende",
		State: "stateDiagram-v2\n  [*] --> Offen\n  Offen --> InArbeit : starten\n  InArbeit --> Erledigt : abschließen\n  Erledigt --> [*]\n" +
			"  classDef fertig fill:green\n  class Erledigt fertig",
		GitGraph: "gitGraph\n  commit id: \"Start\"\n  branch feature\n  commit id: \"Idee\"\n  checkout main\n  merge feature tag: \"v1.0\"",
		Model: `{"v":1,"els":[{"id":"a","t":"rect","x":0,"y":0,"w":140,"h":56,"txt":"Start","s":"green","f":"green","sw":2,"r":true},` +
			`{"id":"b","t":"diamond","x":220,"y":-10,"w":140,"h":76,"txt":"OK?","s":"orange","f":"orange","sw":2},` +
			`{"id":"c","t":"arrow","from":"a","to":"b","a":[144,28],"b":[216,28],"route":"straight","head":2,"txt":"weiter","s":"main","sw":2},` +
			`{"id":"d","t":"text","x":220,"y":90,"txt":"Hinweis","fs":14,"s":"muted"}]}`,
	},
}

var mcpDrawingTools = []mcpTool{
	{
		Name: "drawing_help",
		Description: "How to write drawings (type drawing bullets, ```mermaid blocks in create_note): the supported Mermaid syntax per diagram kind " +
			"(flowchart, mindmap, sequenceDiagram, stateDiagram, gitGraph), the JSON drawing model, the colours and examples. Read-only, changes nothing.",
		// Useful to whoever may write a drawing
		Scope:    storage.ScopeNotesWrite,
		AltScope: storage.ScopeNotesCreate,
		Schema:   schema(nil, map[string]any{}),
		run: func(_ context.Context, _ *Server, _ string, _ *apiActor, _ json.RawMessage) (any, error) {
			return mcpDrawingHelpText, nil
		},
	},
}
