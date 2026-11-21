package shell

// The few texts of the shell itself (the tray menu), in the languages of the app; everything in the window
// comes from the frontend's locale files. Keep the languages in step with internal/i18n.Supported.
var texts = map[string]map[string]string{
	"de": {"open": "MindSift öffnen", "switch": "Instanz wechseln…", "quit": "Beenden"},
	"en": {"open": "Open MindSift", "switch": "Switch instance…", "quit": "Quit"},
	"es": {"open": "Abrir MindSift", "switch": "Cambiar de instancia…", "quit": "Salir"},
	"fr": {"open": "Ouvrir MindSift", "switch": "Changer d’instance…", "quit": "Quitter"},
	"it": {"open": "Apri MindSift", "switch": "Cambia istanza…", "quit": "Esci"},
}

// Text: the shell's text for key in the system's language, English when MindSift does not speak it
func Text(key string) string {
	if t, ok := texts[SystemLanguage()]; ok {
		return t[key]
	}
	return texts["en"][key]
}
