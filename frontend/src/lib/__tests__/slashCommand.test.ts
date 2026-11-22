import { describe, it, expect } from 'vitest';
import { matchSlashQuery, removeSlashQuery, slashCommandFitsText } from '../slashCommand';

describe('matchSlashQuery', () => {
  it('opens at the start of the bullet, also in front of existing text', () => {
    expect(matchSlashQuery('/code', 5)).toEqual({ query: 'code', slashStart: 0 });
    expect(matchSlashQuery('/codeHallo Welt', 5)).toEqual({ query: 'code', slashStart: 0 });
    expect(matchSlashQuery('/', 1)).toEqual({ query: '', slashStart: 0 });
  });

  it('opens after whitespace in the middle and at the end', () => {
    expect(matchSlashQuery('Hallo /codeWelt', 11)).toEqual({ query: 'code', slashStart: 6 });
    expect(matchSlashQuery('Hallo Welt /h1', 14)).toEqual({ query: 'h1', slashStart: 11 });
    expect(matchSlashQuery('Zeile\n/todo', 11)).toEqual({ query: 'todo', slashStart: 6 });
  });

  it('takes a code language along', () => {
    expect(matchSlashQuery('/code py', 8)).toEqual({ query: 'code py', slashStart: 0 });
  });

  it('does not open for addresses, units or a slash inside a word', () => {
    expect(matchSlashQuery('https://a.de/b', 14)).toBeNull();
    expect(matchSlashQuery('100 km/h', 8)).toBeNull();
    expect(matchSlashQuery('und/oder', 8)).toBeNull();
  });

  it('only looks at the text up to the cursor', () => {
    // cursor behind "Hallo": no slash there
    expect(matchSlashQuery('Hallo /code', 5)).toBeNull();
    // a query with a space is no query (except a code language)
    expect(matchSlashQuery('/to do', 6)).toBeNull();
  });
});

describe('removeSlashQuery', () => {
  it('removes a command typed at the start', () => {
    expect(removeSlashQuery('/codeHallo Welt', 0, 5)).toMatchObject({ text: 'Hallo Welt', caret: 0 });
    expect(removeSlashQuery('/code Hallo Welt', 0, 5)).toMatchObject({ text: 'Hallo Welt', caret: 0 });
  });

  it('removes a command typed in the middle without a double space', () => {
    expect(removeSlashQuery('Hallo /code Welt', 6, 11)).toMatchObject({ text: 'Hallo Welt', caret: 6 });
    expect(removeSlashQuery('Hallo /codeWelt', 6, 11)).toMatchObject({ text: 'Hallo Welt', caret: 6 });
  });

  it('removes a command typed at the end', () => {
    expect(removeSlashQuery('Hallo Welt /code', 11, 16)).toMatchObject({ text: 'Hallo Welt', caret: 10 });
  });

  it('leaves the rest of the text exactly as it was', () => {
    const text = 'a  b\n  eingerückt  /code\n\tTab';
    const start = text.indexOf('/');
    expect(removeSlashQuery(text, start, start + 5).text).toBe('a  b\n  eingerückt\n\tTab');
    expect(removeSlashQuery('x  y /h1', 5, 8).text).toBe('x  y');
  });

  it('hands back the raw text around the command', () => {
    expect(removeSlashQuery('Vorher /link Nachher', 7, 12)).toMatchObject({ before: 'Vorher ', after: ' Nachher', text: 'Vorher Nachher', caret: 7 });
  });

  it('leaves an empty bullet when only the command was typed', () => {
    expect(removeSlashQuery('/image', 0, 6)).toMatchObject({ text: '', caret: 0 });
  });
});

describe('slashCommandFitsText', () => {
  it('lets type changes take the text along', () => {
    for (const t of ['h1', 'h2', 'h3', 'todo', 'numbered', 'callout', 'warning', 'error', 'bullet', 'code', 'table', 'link', 'secret']) {
      expect(slashCommandFitsText(t, 'Hallo Welt')).toBe(true);
      expect(slashCommandFitsText(t, '')).toBe(true);
    }
  });

  it('keeps divider and media for empty bullets', () => {
    for (const t of ['divider', 'image', 'audio', 'drawing']) {
      expect(slashCommandFitsText(t, 'Hallo')).toBe(false);
      expect(slashCommandFitsText(t, '  ')).toBe(true);
    }
  });

  it('extracts only a bullet with text', () => {
    expect(slashCommandFitsText('extract', 'Hallo')).toBe(true);
    expect(slashCommandFitsText('extract', '')).toBe(false);
  });
});
