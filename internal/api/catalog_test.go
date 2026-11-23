package api

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/i18n/i18ncheck"
)

// Every German server text has a translation in every catalog. Checked here as well as in internal/i18n:
// a change of the API's texts is tested with this package while working, and a missing translation used
// to show up only in the image build, which tests every package.
func TestCatalogsCoverServerTexts(t *testing.T) {
	t.Parallel()
	i18ncheck.CatalogsCoverServerTexts(t)
}
