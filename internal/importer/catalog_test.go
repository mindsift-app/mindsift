package importer

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/i18n/i18ncheck"
)

// Every German server text has a translation in every catalog. Checked here as well as in internal/i18n:
// the importer's reasons for skipping a file reach people in the preview, and a change of them is tested
// with this package while working.
func TestCatalogsCoverServerTexts(t *testing.T) {
	i18ncheck.CatalogsCoverServerTexts(t)
}
