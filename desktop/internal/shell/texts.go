package shell

// The few texts of the shell itself (the tray menu, the folder dialog's title), in the languages of the
// app; everything in the window comes from the frontend's locale files. Keep the languages in step with
// internal/i18n.Supported.
var texts = map[string]map[string]string{
	"de": {"open": "MindSift öffnen", "switch": "Instanz wechseln…", "quit": "Beenden", "pickFolder": "Ordner für die Backups wählen", "pickFolderButton": "Auswählen", "openTask": "Öffnen"},
	"en": {"open": "Open MindSift", "switch": "Switch instance…", "quit": "Quit", "pickFolder": "Choose the backup folder", "pickFolderButton": "Select", "openTask": "Open"},
	"es": {"open": "Abrir MindSift", "switch": "Cambiar de instancia…", "quit": "Salir", "pickFolder": "Elegir la carpeta de las copias de seguridad", "pickFolderButton": "Seleccionar", "openTask": "Abrir"},
	"fr": {"open": "Ouvrir MindSift", "switch": "Changer d’instance…", "quit": "Quitter", "pickFolder": "Choisir le dossier des sauvegardes", "pickFolderButton": "Sélectionner", "openTask": "Ouvrir"},
	"it": {"open": "Apri MindSift", "switch": "Cambia istanza…", "quit": "Esci", "pickFolder": "Scegli la cartella dei backup", "pickFolderButton": "Seleziona", "openTask": "Apri"},
}

// Text: the shell's text for key in the system's language, English when MindSift does not speak it
func Text(key string) string {
	if t, ok := texts[SystemLanguage()]; ok {
		return t[key]
	}
	return texts["en"][key]
}
