package importer

import (
	"strings"

	"github.com/mindsift-app/mindsift/internal/i18n"
)

// The layout of MindSift's Markdown archive and backup ZIP: the export (storage) writes it, the import
// reads it.

// BackupFileName is the JSON inside the backup ZIP.
const BackupFileName = "mindsift-backup.json"

// BackupVaultDir holds the Markdown vault inside the backup ZIP: Obsidian (or any editor) opens it as it is,
// without MindSift. Its attachments/ are also the media of the backup.
const BackupVaultDir = "Obsidian"

// VaultAttachmentDir holds images and recordings in the Markdown archive.
const VaultAttachmentDir = "attachments"

// Folders of the archive for tasks and lists and the file of tasks without a list, in the language of
// the one exporting; the import knows them in every language.
const (
	VaultTasks  = "Aufgaben"
	VaultLists  = "Listen"
	VaultNoList = "Ohne Liste"
)

// IsVaultDir: name is the folder or file german (VaultTasks, VaultLists, VaultNoList) in one of the
// supported languages.
func IsVaultDir(name, german string) bool {
	for _, lang := range i18n.Supported {
		if name == i18n.T(lang, german) {
			return true
		}
	}
	return false
}

// Segment makes one path part safe on Windows, macOS and Linux and never "." or "..".
func Segment(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(s))
	s = strings.Trim(s, ". ")
	if len([]rune(s)) > 100 {
		s = string([]rune(s)[:100])
	}
	return s
}
