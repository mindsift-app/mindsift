package api

import (
	"errors"
	"regexp"
	"strings"
)

// Code bullets for MCP: the language ids of the editor's language menu and the short names it accepts
// after /code or ``` (frontend/src/features/workspace/codeLanguages.json, which the editor reads). A test
// (mcp_code_test.go) fails when these lists or the tool description differ from that file.

// mcpCodeLanguages: the editor's language ids
var mcpCodeLanguages = map[string]bool{
	"yaml": true, "json": true, "toml": true, "ini": true, "properties": true, "docker": true, "nginx": true, "apacheconf": true, "hcl": true,
	"xml": true, "csv": true, "graphql": true, "protobuf": true, "dns-zone-file": true, "iptables": true, "nftables": true,
	"bash": true, "powershell": true, "makefile": true, "systemd": true, "vim": true, "diff": true, "git": true, "ignore": true, "log": true,
	"javascript": true, "typescript": true, "jsx": true, "tsx": true, "markup": true, "html": true, "css": true, "scss": true,
	"python": true, "php": true, "ruby": true, "lua": true, "perl": true,
	"go": true, "rust": true, "sql": true, "c": true, "cpp": true, "csharp": true, "java": true, "kotlin": true, "swift": true, "dart": true, "zig": true, "elixir": true, "scala": true, "haskell": true,
	"markdown": true, "latex": true, "regex": true, "text": true,
}

// mcpCodeAliases: other names of these languages
var mcpCodeAliases = map[string]string{
	"yml": "yaml", "sh": "bash", "shell": "bash", "zsh": "bash", "js": "javascript", "mjs": "javascript", "cjs": "javascript",
	"ts": "typescript", "mts": "typescript", "cts": "typescript", "py": "python", "rb": "ruby", "rs": "rust",
	"cs": "csharp", "c#": "csharp", "dotnet": "csharp", "c++": "cpp", "cxx": "cpp", "cc": "cpp", "hpp": "cpp", "h": "c",
	"kt": "kotlin", "kts": "kotlin", "hs": "haskell", "md": "markdown", "tex": "latex", "dockerfile": "docker", "containerfile": "docker",
	"htm": "html", "svg": "xml", "proto": "protobuf", "ps1": "powershell", "pwsh": "powershell", "make": "makefile", "gql": "graphql",
	"tf": "hcl", "terraform": "hcl", "ex": "elixir", "exs": "elixir", "pl": "perl", "conf": "ini", "golang": "go",
	"plaintext": "text", "plain": "text", "txt": "text",
	"ip6tables": "iptables", "iptables-save": "iptables", "nft": "nftables", "apache": "apacheconf", "htaccess": "apacheconf",
	"zone": "dns-zone-file", "gitignore": "ignore", "dockerignore": "ignore",
}

// mcpCodeLabel: another name a code block may carry as its language, like the editor's free entry in the
// language menu and ```name in a bullet (codeLanguages.ts, isCodeLanguageLabel)
var mcpCodeLabel = regexp.MustCompile(`^[A-Za-z0-9+\-_.#]{1,40}$`)

// errMCPCodeLanguage: a language name the code block could not show as one
var errMCPCodeLanguage = errors.New("'language': 1 bis 40 Zeichen, nur Buchstaben, Ziffern und + - _ . #")

// mcpCodeLanguage: the editor's id for a language name; an empty one is plain code (""), any other name is
// kept as written: the code block shows it as its language, without highlighting
func mcpCodeLanguage(name string) (string, error) {
	name = strings.TrimSpace(name)
	key := strings.ToLower(name)
	if key == "" || mcpCodeLanguages[key] {
		return key, nil
	}
	if id, ok := mcpCodeAliases[key]; ok {
		return id, nil
	}
	if !mcpCodeLabel.MatchString(name) {
		return "", errMCPCodeLanguage
	}
	return name, nil
}

// mcpCodeHelp: how code and dividers are written, for the tool descriptions
const mcpCodeHelp = "type code: text is the code as it is (several lines, no Markdown fence; [[…]] stays plain text), " +
	"language its language for highlighting: yaml, json, toml, ini, properties, docker, nginx, apacheconf, hcl, xml, csv, graphql, protobuf, dns-zone-file, iptables, nftables, " +
	"bash, powershell, makefile, systemd, vim, diff, git, ignore, log, " +
	"javascript, typescript, jsx, tsx, markup, html, css, scss, python, php, ruby, lua, perl, go, rust, sql, c, cpp, csharp, java, kotlin, swift, dart, zig, elixir, scala, haskell, markdown, latex, regex, text " +
	"(short names like js, ts, py, sh, yml, c++ work too). Any other name (1-40 letters, digits or + - _ . #, e.g. pf or ufw) is kept as written: " +
	"the block shows it as its language, without highlighting; a missing one shows plain code. " +
	"A code block keeps no hidden value: a {{secret:…}} written into it becomes a placeholder. " +
	"type divider: a horizontal line; it has no text (text is ignored). "
