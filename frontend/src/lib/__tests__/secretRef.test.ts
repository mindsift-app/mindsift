import { describe, it, expect, afterEach } from 'vitest';
import type { DocumentBlock } from '../types';
import { addTexts, messageLanguage, setMessageLanguage, FALLBACK_LANGUAGE } from '../../i18n';
import en from '../../locales/en';
import { codeBlockText, secretPlaceholder, secretRef } from '../secretRef';
import { diffFlat } from '../docSync/diff';
import { applyOp, emptyDoc, Doc } from '../docSync/model';
import { buildStep } from '../docSync/undo';

const VALUE = 'sec0123456789abcdef01234567';
const OLD_VALUE = 'sec_0123456789abcdef01234567';
const DE = '(versteckter Wert nicht übernommen)';

let opSeq = 0;
const nextOp = () => `op${++opSeq}`;

function build(blocks: DocumentBlock[]): Doc {
  const d = emptyDoc();
  for (const op of diffFlat(d, blocks, nextOp)) applyOp(d, op);
  return d;
}

const block = (content: string, type: DocumentBlock['type'] = 'bullet'): DocumentBlock => ({ id: 'a', level: 0, content, type });

afterEach(() => setMessageLanguage(FALLBACK_LANGUAGE));

describe('codeBlockText', () => {
  it('replaces references to values, keeps text that only looks like one', () => {
    expect(codeBlockText(`a ${secretRef(VALUE)} b ${secretRef(OLD_VALUE)}`, '(P)')).toBe('a (P) b (P)');
    expect(codeBlockText('{{secret:id}} {{secret:sec123}}', '(P)')).toBe('{{secret:id}} {{secret:sec123}}');
    expect(codeBlockText(secretRef(VALUE), 'x'.repeat(100))).toBe('');
    expect(codeBlockText(secretRef(VALUE))).toBe(DE);
  });
});

describe('message language', () => {
  it('follows the account, else the server, never the browser', () => {
    expect(messageLanguage('fr', 'en')).toBe('fr');
    expect(messageLanguage('', 'en')).toBe('en');
    expect(messageLanguage(undefined, undefined)).toBe('de');
  });

  it('writes the placeholder in the message language, not in the language the app shows', () => {
    addTexts('en', en);
    setMessageLanguage('en');
    expect(secretPlaceholder()).toBe('(hidden value not included)');
    setMessageLanguage('de');
    expect(secretPlaceholder()).toBe(DE);
  });
});

describe('a bullet with a hidden value becomes a code block', () => {
  it('sends the placeholder before the type, and undo brings the reference back', () => {
    const withRef = `IP ${secretRef(VALUE)}`;
    const d = build([block(withRef)]);
    const ops = diffFlat(d, [block(withRef, 'code')], nextOp);
    expect(ops.map((o) => o.kind)).toEqual(['set_content', 'set_props']);
    expect(ops[0].content).toBe(`IP ${DE}`);

    const step = buildStep(d, ops, 0)!;
    expect(step.inverse.map((o) => o.kind)).toEqual(['set_props', 'set_content']);
    expect(step.inverse[0].patch?.type).toBe('bullet');
    expect(step.inverse[1].content).toBe(withRef);
  });

  it('a new code block and text written into one get the placeholder', () => {
    const d = build([block('x', 'code')]);
    const [op] = diffFlat(d, [block(`token=${secretRef(VALUE)}`, 'code')], nextOp);
    expect(op.content).toBe(`token=${DE}`);
    const inserted = diffFlat(emptyDoc(), [block(secretRef(VALUE), 'code')], nextOp);
    expect(inserted[0].content).toBe(DE);
    // The field still showing the reference is no change
    const after = build([block(`token=${DE}`, 'code')]);
    expect(diffFlat(after, [block(`token=${secretRef(VALUE)}`, 'code')], nextOp)).toEqual([]);
  });
});
