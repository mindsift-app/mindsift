package i18n_test

import (
	"testing"

	"github.com/mindsift-app/mindsift/internal/i18n/i18ncheck"
)

// Every German server text has a translation in every catalog (also checked in internal/api and
// internal/storage, see i18ncheck).
func TestCatalogsCoverServerTexts(t *testing.T) {
	i18ncheck.CatalogsCoverServerTexts(t)
}
