import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { OutlinerTree } from '../OutlinerTree';
import type { BlockLock } from '../OutlinerBlock';
import { DocumentBlock } from '../../../lib/types';
import { OUTLINE_CLIPBOARD_TYPE } from '../../../lib/outlineMarkdown';

// Holds the latest block state rendered by the harness
let live: DocumentBlock[] = [];

let lockedNotices: string[] = [];
let lockedOwn: boolean[] = [];

const Harness: React.FC<{ initial: DocumentBlock[]; locked?: Map<string, BlockLock> }> = ({ initial, locked }) => {
  const [blocks, setBlocks] = useState(initial);
  // The test reads the blocks of the harness's last render
  // eslint-disable-next-line react-hooks/globals
  live = blocks;
  return (
    <OutlinerTree
      docId="d1"
      blocks={blocks}
      lockedBlocks={locked}
      onLockedAction={(l) => {
        lockedNotices.push(l.name);
        lockedOwn.push(!!l.own);
      }}
      canEdit
      onUpdateBlock={(b) => setBlocks((p) => p.map((x) => (x.id === b.id ? b : x)))}
      onUpdateBlocks={(u) => setBlocks((p) => p.map((x) => u.find((y) => y.id === x.id) || x))}
      onCreateBlock={(nb, after) =>
        setBlocks((p) => {
          const i = p.findIndex((x) => x.id === after);
          return i < 0 ? [...p, nb] : [...p.slice(0, i + 1), nb, ...p.slice(i + 1)];
        })
      }
      onDeleteBlock={(id) => setBlocks((p) => p.filter((x) => x.id !== id))}
      onMoveBlock={() => {}}
    />
  );
};

// '' as type: legacy blocks stored without one
const mk = (id: string, content: string, level = 0, type: DocumentBlock['type'] | '' = 'bullet'): DocumentBlock =>
  ({ id, type, content, level, position: 1 }) as DocumentBlock;

const area = (text: string) => screen.getAllByDisplayValue(text)[0] as HTMLTextAreaElement;

const backspaceAt = async (ta: HTMLTextAreaElement, pos = 0) => {
  ta.focus();
  ta.setSelectionRange(pos, pos);
  await act(async () => {
    fireEvent.keyDown(ta, { key: 'Backspace' });
  });
};

describe('Backspace at the start of a bullet', () => {
  it('appends its text to the previous bullet', async () => {
    render(<Harness initial={[mk('a', 'Hallo '), mk('b', 'Welt')]} />);
    await backspaceAt(area('Welt'));
    expect(live.map((b) => b.content)).toEqual(['Hallo Welt']);
  });

  it('works for legacy blocks without a type', async () => {
    render(<Harness initial={[mk('a', 'A', 0, undefined), mk('b', 'B', 0, '')]} />);
    await backspaceAt(area('B'));
    expect(live.map((b) => b.content)).toEqual(['AB']);
  });

  it('moves children up under the previous bullet', async () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B'), mk('c', 'C', 1)]} />);
    await backspaceAt(area('B'));
    expect(live.map((b) => [b.content, b.level])).toEqual([
      ['AB', 0],
      ['C', 1],
    ]);
  });

  it('does nothing when the caret is not at the start', async () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'BB')]} />);
    await backspaceAt(area('BB'), 1);
    expect(live).toHaveLength(2);
  });

  it('does not merge the first bullet', async () => {
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B')]} />);
    await backspaceAt(area('A'));
    expect(live).toHaveLength(2);
  });

  it('does not merge into a code block', async () => {
    render(<Harness initial={[mk('a', 'x = 1', 0, 'code'), mk('b', 'B')]} />);
    await backspaceAt(area('B'));
    expect(live).toHaveLength(2);
  });
});

describe('blocks locked by someone else', () => {
  it('are read-only and show who edits them', () => {
    render(<Harness initial={[mk('a', 'Frei'), mk('b', 'Gesperrt')]} locked={new Map([['b', { userId: 'u-Anna', name: 'Anna' }]])} />);
    expect(area('Gesperrt').readOnly).toBe(true);
    expect(area('Frei').readOnly).toBe(false);
    expect(screen.getByTitle('Anna bearbeitet diesen Punkt gerade')).toBeTruthy();
  });

  it('merging into a locked bullet is not started at all', async () => {
    lockedNotices = [];
    render(<Harness initial={[mk('a', 'Oben'), mk('b', 'Unten')]} locked={new Map([['a', { userId: 'u-Anna', name: 'Anna' }]])} />);
    await backspaceAt(area('Unten'));
    expect(live.map((b) => b.content)).toEqual(['Oben', 'Unten']);
    expect(lockedNotices).toEqual(['Anna']);
  });

  it('a branch with a locked child cannot be merged away', async () => {
    lockedNotices = [];
    render(<Harness initial={[mk('a', 'A'), mk('b', 'B'), mk('c', 'C', 1)]} locked={new Map([['c', { userId: 'u-Ben', name: 'Ben' }]])} />);
    await backspaceAt(area('B'));
    expect(live.map((b) => b.content)).toEqual(['A', 'B', 'C']);
    expect(lockedNotices).toEqual(['Ben']);
  });

  it('held by oneself elsewhere do not name oneself', async () => {
    lockedOwn = [];
    render(<Harness initial={[mk('a', 'Oben'), mk('b', 'Unten')]} locked={new Map([['a', { userId: 'u-Ich', name: 'Ich', own: true }]])} />);
    expect(screen.getByTitle('Wird gerade auf einem anderen Gerät oder in einem anderen Tab bearbeitet')).toBeTruthy();
    expect(screen.queryByTitle('Ich bearbeitet diesen Punkt gerade')).toBeNull();
    await backspaceAt(area('Unten'));
    expect(lockedOwn).toEqual([true]);
  });
});

describe('Enter on a locked bullet', () => {
  for (const [label, pos] of [
    ['at the end', 8],
    ['in the middle', 3],
  ] as const) {
    it(`${label} adds a new bullet below and never splits the locked one`, async () => {
      render(<Harness initial={[mk('a', 'Gesperrt')]} locked={new Map([['a', { userId: 'u-Anna', name: 'Anna' }]])} />);
      const ta = area('Gesperrt');
      ta.focus();
      ta.setSelectionRange(pos, pos);
      await act(async () => {
        fireEvent.keyDown(ta, { key: 'Enter' });
      });
      expect(live.map((b) => b.content)).toEqual(['Gesperrt', '']);
    });
  }
});

describe('Enter at the end of a bullet with children', () => {
  const enterAtEnd = async (text: string) => {
    const ta = area(text);
    ta.focus();
    ta.setSelectionRange(text.length, text.length);
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
  };

  it('adds the new bullet as the first child', async () => {
    render(<Harness initial={[mk('a', 'Eltern'), mk('b', 'Kind 1', 1), mk('c', 'Kind 2', 1), mk('d', 'Danach')]} />);
    await enterAtEnd('Eltern');
    expect(live.map((b) => [b.content, b.level])).toEqual([
      ['Eltern', 0],
      ['', 1],
      ['Kind 1', 1],
      ['Kind 2', 1],
      ['Danach', 0],
    ]);
  });

  it('stays on the same level without children', async () => {
    render(<Harness initial={[mk('a', 'Eins'), mk('b', 'Zwei')]} />);
    await enterAtEnd('Eins');
    expect(live.map((b) => [b.content, b.level])).toEqual([
      ['Eins', 0],
      ['', 0],
      ['Zwei', 0],
    ]);
  });

  it('stays on the same level when the bullet is collapsed', async () => {
    render(<Harness initial={[{ ...mk('a', 'Zu'), collapsed: true }, mk('b', 'Kind', 1)]} />);
    await enterAtEnd('Zu');
    expect(live[1]).toMatchObject({ content: '', level: 0 });
  });
});

describe('Enter in a to-do', () => {
  const enterAt = async (text: string, pos = text.length) => {
    const ta = area(text);
    ta.focus();
    ta.setSelectionRange(pos, pos);
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' });
    });
  };
  const todo = (id: string, content: string, level = 0, extra: Partial<DocumentBlock> = {}) =>
    ({ ...mk(id, content, level, 'todo'), checked: false, ...extra }) as DocumentBlock;

  it('at the end adds an unticked to-do without a task below', async () => {
    render(<Harness initial={[todo('a', 'Milch kaufen', 1, { checked: true, taskId: 't1' })]} />);
    await enterAt('Milch kaufen');
    expect(live.map((b) => [b.content, b.type, b.level, !!b.checked, b.taskId || ''])).toEqual([
      ['Milch kaufen', 'todo', 1, true, 't1'],
      ['', 'todo', 1, false, ''],
    ]);
  });

  it('in the middle splits it into two to-dos', async () => {
    render(<Harness initial={[todo('a', 'Brot Butter')]} />);
    await enterAt('Brot Butter', 4);
    expect(live.map((b) => [b.content, b.type])).toEqual([
      ['Brot', 'todo'],
      [' Butter', 'todo'],
    ]);
  });

  it('in an empty to-do turns it into a plain bullet on the same level', async () => {
    render(<Harness initial={[todo('a', 'Eins', 1), todo('b', '', 1)]} />);
    await enterAt('');
    expect(live.map((b) => [b.content, b.type, b.level])).toEqual([
      ['Eins', 'todo', 1],
      ['', 'text', 1],
    ]);
  });

  it('then in the empty plain bullet outdents it as before', async () => {
    render(<Harness initial={[todo('a', 'Eins', 1), todo('b', '', 1)]} />);
    await enterAt('');
    await enterAt('');
    expect(live.map((b) => [b.type, b.level])).toEqual([
      ['todo', 1],
      ['text', 0],
    ]);
  });

  it('keeps plain bullets plain', async () => {
    render(<Harness initial={[mk('a', 'Text')]} />);
    await enterAt('Text');
    expect(live[1]).toMatchObject({ type: 'text', content: '' });
  });
});

describe('Pasting bullets copied from a note', () => {
  const paste = async (ta: HTMLTextAreaElement, data: Record<string, string>) => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    await act(async () => {
      fireEvent.paste(ta, { clipboardData: { getData: (type: string) => data[type] ?? (type === 'text' ? data['text/plain'] ?? '' : '') } });
    });
  };

  it('takes the references of hidden values from the app\'s own format, not the masked text', async () => {
    render(<Harness initial={[mk('a', 'Ziel')]} />);
    await paste(area('Ziel'), {
      'text/plain': 'Zugang ••••\n- PIN ••••',
      [OUTLINE_CLIPBOARD_TYPE]: 'Zugang {{secret:sec1}}\n- PIN {{secret:sec2}}',
    });
    expect(live.map((b) => [b.content, b.level])).toEqual([
      ['ZielZugang {{secret:sec1}}', 0],
      ['PIN {{secret:sec2}}', 1],
    ]);
  });

  it('puts a single line of the own format into the bullet', async () => {
    render(<Harness initial={[mk('a', 'Ziel')]} />);
    await paste(area('Ziel'), { 'text/plain': 'PIN ••••', [OUTLINE_CLIPBOARD_TYPE]: 'PIN {{secret:sec2}}' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(live.map((b) => b.content)).toEqual(['ZielPIN {{secret:sec2}}']);
  });
});

describe('Pasting code from other pages', () => {
  const paste = async (ta: HTMLTextAreaElement, data: Record<string, string>) => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    await act(async () => {
      fireEvent.paste(ta, { clipboardData: { getData: (type: string) => data[type] ?? (type === 'text' ? data['text/plain'] ?? '' : '') } });
    });
  };

  it('a Markdown fence becomes a code block; the text before the cursor stays in its bullet', async () => {
    render(<Harness initial={[mk('a', 'Ziel')]} />);
    await paste(area('Ziel'), { 'text/plain': '```sh\nls -la\n```\nDanach' });
    expect(live.map((b) => [b.type, b.content, b.lang ?? ''])).toEqual([
      ['bullet', 'Ziel', ''],
      ['code', 'ls -la', 'bash'],
      ['text', 'Danach', ''],
    ]);
  });

  it('takes the code blocks of an answer copied from a chat page from its HTML, not the plain text', async () => {
    render(<Harness initial={[mk('a', '')]} />);
    await paste(area(''), {
      'text/plain': 'So geht es:\n\nyaml\nCode kopieren\nport: 80\n',
      'text/html':
        '<p>So geht es:</p><pre><div>yaml</div><div><button>Code kopieren</button></div><div><code class="language-yaml">port: 80\n</code></div></pre>',
    });
    expect(live.map((b) => [b.type, b.content, b.lang ?? ''])).toEqual([
      ['text', 'So geht es:', ''],
      ['code', 'port: 80', 'yaml'],
    ]);
  });

  it('HTML without code blocks keeps the plain text', async () => {
    render(<Harness initial={[mk('a', '')]} />);
    await paste(area(''), { 'text/plain': 'Eins\n\nZwei', 'text/html': '<p>Eins</p><p><b>Zwei</b></p>' });
    expect(live.map((b) => b.content)).toEqual(['Eins', 'Zwei']);
  });
});
