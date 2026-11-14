// Lint rules for the frontend (FLAW-19): real mistakes are errors, style is left to the code.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import i18next from 'eslint-plugin-i18next';
import { readFileSync } from 'node:fs';

// lucide-react's old names for renamed icons ("TriangleAlert as AlertTriangle"), read from its type exports so
// the list follows the installed version; the app uses the canonical names only. "X as XIcon" and
// "X as LucideX" are the same icon under its own name and stay allowed.
function lucideAliasNames() {
  const types = readFileSync(new URL('./node_modules/lucide-react/dist/lucide-react.d.ts', import.meta.url), 'utf8');
  const exportList = types.match(/^export \{([^}]*)\}/m)?.[1] ?? '';
  const aliases = new Set();
  for (const [, name, alias] of exportList.matchAll(/(\w+) as (\w+)/g)) {
    if (alias !== `${name}Icon` && alias !== `Lucide${name}`) aliases.add(alias);
  }
  return [...aliases].sort();
}

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    // react-hooks: the rules of hooks plus the React Compiler's checks (refs, effects, purity …)
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // Caught errors are unknown (errorMessage reads them), browser APIs without types get a small interface
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              importNames: lucideAliasNames(),
              message: "Old lucide name of a renamed icon; import the icon's current name (lucide.dev/icons).",
            },
          ],
        },
      ],
    },
  },
  // Texts shown to people come from the language files (src/locales); no new fixed text in JSX
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/__tests__/**', 'src/features/help/content/**'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          // jsx-only: the text between tags, the attributes people read (placeholder, tooltip, screen reader,
          // image text; every other attribute is code) and strings in JSX expressions ({x ? 'a' : 'b'}).
          // jsx-text-only would skip attributes altogether.
          mode: 'jsx-only',
          'jsx-attributes': { include: ['placeholder', 'title', 'aria-label', 'alt'], exclude: ['.*'] },
          // Names and code that read the same in every language: the product, services and tools, keys, MCP
          // tools, the demo logins, example addresses, and anything without letters (symbols, numbers).
          // In expressions also values for code: single words in lower case or camelCase (ids, keys,
          // Intl options), lists of CSS classes, colours.
          words: {
            exclude: [
              '^\\s*(MindSift|OAuth|Discord|Webhook|Push|Live|Tab|Esc|Enter|⌘K|Hashtags|To-Dos|Kanban)\\s*$',
              '^(Claude Code|OpenAI Codex|Claude Desktop / Cursor|claude\\.ai / ChatGPT)$',
              '^[a-z]+(_[a-z]+)+$',
              '^(search|admin / admin|user / user)$',
              '^[^A-Za-zÄÖÜäöüß]*$',
              '^[a-z0-9][a-zA-Z0-9_.:/-]*$',
              '^(?=.*\\S-\\S)[a-z0-9:/\\[\\]().%!-]+( [a-z0-9:/\\[\\]().%!-]+)*$',
              '^#[0-9a-fA-F]{3,8}$',
              '^[A-Z]$',
              '^T\\d\\d:\\d\\d$',
              '^https://example\\.com$',
              // Placeholders that show a format: the setup code, a hashtag, custom CSS
              '^(MS-X+|\\+ #hashtag)$',
              '^:root\\[data-theme=.*$',
            ],
          },
        },
      ],
    },
  },
  // Dropdowns, dates and times in the app's look (Doku/ui-patterns.md); only the fields themselves use the
  // browser's inputs, for the system pickers on touch screens
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/__tests__/**', 'src/components/DateField.tsx', 'src/components/TimeField.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "JSXOpeningElement[name.name='select']", message: 'Use SelectMenu instead of <select> (Doku/ui-patterns.md).' },
        {
          selector: "JSXAttribute[name.name='type'][value.value=/^(date|time|datetime-local)$/]",
          message: 'Use DateField or TimeField instead of the browser picker (Doku/ui-patterns.md).',
        },
      ],
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
    extends: [js.configs.recommended],
  },
);
