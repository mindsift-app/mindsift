package api

import "strings"

// Code bullets for MCP: the language ids of the editor's language menu and the short names it accepts
// after /code or ``` (frontend/src/features/workspace/CodeBlockEditor.tsx, CODE_LANGUAGE_GROUPS and
// LANGUAGE_ALIASES). Keep both lists in step with the editor.

// mcpCodeLanguages: the editor's language ids
var mcpCodeLanguages = map[string]bool{
	"yaml": true, "json": true, "toml": true, "ini": true, "docker": true, "nginx": true, "hcl": true, "xml": true, "csv": true, "graphql": true, "protobuf": true,
	"bash": true, "powershell": true, "makefile": true, "systemd": true, "vim": true, "diff": true, "git": true, "log": true,
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
}

// mcpCodeLanguage: the editor's id for a language name; an unknown or empty one is plain code ("")
func mcpCodeLanguage(name string) string {
	key := strings.ToLower(strings.TrimSpace(name))
	if mcpCodeLanguages[key] {
		return key
	}
	return mcpCodeAliases[key]
}

// mcpCodeHelp: how code and dividers are written, for the tool descriptions
const mcpCodeHelp = "type code: text is the code as it is (several lines, no Markdown fence; [[…]] stays plain text), " +
	"language its language for highlighting: yaml, json, toml, ini, docker, nginx, hcl, xml, csv, graphql, protobuf, bash, powershell, makefile, systemd, vim, diff, git, log, " +
	"javascript, typescript, jsx, tsx, html, css, scss, python, php, ruby, lua, perl, go, rust, sql, c, cpp, csharp, java, kotlin, swift, dart, zig, elixir, scala, haskell, markdown, latex, regex, text " +
	"(short names like js, ts, py, sh, yml, c++ work too; an unknown or missing one shows plain code). " +
	"A code block keeps no hidden value: a {{secret:…}} written into it becomes a placeholder. " +
	"type divider: a horizontal line; it has no text (text is ignored). "
