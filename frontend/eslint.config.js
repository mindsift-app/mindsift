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

// Dropdowns, dates and times in the app's look (Doku/ui-patterns.md)
const uiPatternSyntax = [
  { selector: "JSXOpeningElement[name.name='select']", message: 'Use SelectMenu instead of <select> (Doku/ui-patterns.md).' },
  {
    selector: "JSXAttribute[name.name='type'][value.value=/^(date|time|datetime-local)$/]",
    message: 'Use DateField or TimeField instead of the browser picker (Doku/ui-patterns.md).',
  },
];

// The attributes people read (placeholder, tooltip, screen reader, image text) take no fixed text, written
// directly (title="…") or as a string in braces (title={'…'}); every other attribute is code. Values without
// letters (symbols, numbers) are no text, nor are the product's name and placeholders that show a format: an
// address, the setup code, a recovery code, a hashtag, custom CSS (esquery regex: no "/" inside).
const readAttribute = "[name.name=/^(placeholder|title|aria-label|alt)$/]";
const hasLetter = '/^(?!MindSift$|https?:|MS-X+$|[a-z]{5}-[a-z]{5}$|\\+ #hashtag$|:root\\[).*[A-Za-zÄÖÜäöüß]/';
const literalAttributeMessage = "Text people read comes from the language files: t('…') (src/locales).";
const literalAttributeSyntax = [
  { selector: `JSXAttribute${readAttribute}[value.type='Literal'][value.value=${hasLetter}]`, message: literalAttributeMessage },
  {
    selector: `JSXAttribute${readAttribute}[value.expression.type='Literal'][value.expression.value=${hasLetter}]`,
    message: literalAttributeMessage,
  },
];

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
  // Texts shown to people come from the language files (src/locales); no new fixed text between tags
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/__tests__/**', 'src/features/help/content/**'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-text-only',
          // Names and code that read the same in every language: the product, services, keys, MCP tools,
          // the demo logins, and anything without letters (symbols, numbers)
          words: {
            exclude: [
              '^\\s*(MindSift|OAuth|Discord|Webhook|Push|Live|Tab|Esc|Enter|⌘K|Hashtags|To-Dos)\\s*$',
              '^[a-z]+(_[a-z]+)+$',
              '^(search|admin / admin|user / user)$',
              '^[^A-Za-zÄÖÜäöüß]*$',
            ],
          },
        },
      ],
      'no-restricted-syntax': ['error', ...uiPatternSyntax, ...literalAttributeSyntax],
    },
  },
  // The date and time fields themselves use the browser's inputs, for the system pickers on touch screens
  {
    files: ['src/components/DateField.tsx', 'src/components/TimeField.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...literalAttributeSyntax] },
  },
  // The help pages are written per language (features/help/content/<code>.tsx)
  {
    files: ['src/features/help/content/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...uiPatternSyntax] },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
    extends: [js.configs.recommended],
  },
);
