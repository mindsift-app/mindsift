package blockfmt

import (
	"regexp"
	"strings"

	"github.com/mindsift-app/mindsift/internal/domain"
)

// SecretRefRe matches a reference in block text; group 1 is the id.
var SecretRefRe = regexp.MustCompile(`\{\{secret:([A-Za-z0-9_]+)\}\}`)

// SecretRef is the reference to the hidden value id in block text.
func SecretRef(id string) string { return "{{secret:" + id + "}}" }

// NewSecretID: the id is known before encrypting, so the ciphertext can be bound to it. Without "_",
// so "_" in the text around a reference cannot be read as Markdown italics reaching into it.
func NewSecretID() string { return strings.Replace(domain.NewID("sec"), "_", "", 1) }
