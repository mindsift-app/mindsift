import { describe, expect, it } from 'vitest';
import { enterWithIndent, indentUnit } from '../codeIndent';

// Enter at the end of the text (or at the "|" marker)
const enter = (text: string, lang?: string) => {
  const at = text.includes('|') ? text.indexOf('|') : text.length;
  const code = text.replace('|', '');
  const r = enterWithIndent(code, at, at, lang);
  return r.value.slice(0, r.caret) + '|' + r.value.slice(r.caret);
};

describe('codeIndent', () => {
  it('keeps the indentation of the line', () => {
    expect(enter('services:\n  web:\n    image: nginx', 'yaml')).toBe('services:\n  web:\n    image: nginx\n    |');
  });

  it('goes one step deeper after a YAML key without value', () => {
    expect(enter('services:\n  web:', 'yaml')).toBe('services:\n  web:\n    |');
    // "|" is the YAML block scalar here, not the caret marker
    expect(enterWithIndent('script: |', 9, 9, 'yaml')).toEqual({ value: 'script: |\n  ', caret: 12 });
  });

  it('uses the indentation of the code, never tabs in YAML', () => {
    expect(indentUnit('a:\n    b: 1', 'yaml')).toBe('    ');
    expect(indentUnit('a:\n\tb: 1', 'yaml')).toBe('  ');
    expect(indentUnit('if x {\n\ty()\n}', 'go')).toBe('\t');
    expect(indentUnit('', 'python')).toBe('    ');
    expect(indentUnit('', 'bash')).toBe('  ');
  });

  it('puts a closing bracket right after the caret on its own line', () => {
    expect(enter('function a() {|}', 'javascript')).toBe('function a() {\n  |\n}');
    expect(enter('  const x = [|]', 'javascript')).toBe('  const x = [\n    |\n  ]');
  });

  it('goes deeper after an opening bracket without its closing one', () => {
    expect(enter('if (x) {', 'javascript')).toBe('if (x) {\n  |');
  });

  it('splits a line in the middle with the indentation of its start', () => {
    expect(enter('  key: va|lue', 'yaml')).toBe('  key: va\n  |lue');
  });

  it('replaces a selection', () => {
    const r = enterWithIndent('  abc', 3, 5, 'yaml');
    expect(r.value).toBe('  a\n  ');
    expect(r.caret).toBe(r.value.length);
  });
});
