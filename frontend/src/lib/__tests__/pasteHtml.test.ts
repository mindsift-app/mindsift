import { describe, it, expect } from 'vitest';
import { htmlHasCodeBlock, htmlToMarkdown } from '../pasteHtml';
import { parsePastedLines } from '../pasteOutline';
import { codeLanguageOf } from '../codeLanguage';

const paste = (md: string) => parsePastedLines(md.split('\n')).map((i) => [i.type, i.content, i.indent, i.lang]);

// What the browser puts on the clipboard for a selected answer (shortened, classes as on the pages)
const CHATGPT_HTML = `<meta charset="utf-8"><div class="markdown prose dark:prose-invert w-full break-words light"><p data-start="0" data-end="52">So richtest du einen <strong>Cronjob</strong> für das Backup ein:</p>
<ol data-start="54" data-end="160">
<li data-start="54" data-end="98"><p data-start="57" data-end="98">Skript anlegen unter <code>/usr/local/bin</code></p></li>
<li data-start="99" data-end="160"><p data-start="102" data-end="160">Ausführbar machen</p></li>
</ol>
<pre class="overflow-visible!" data-start="162" data-end="260"><div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9 bg-token-sidebar-surface-primary select-none rounded-t-2xl">bash</div><div class="sticky top-9"><div class="absolute end-0 bottom-0 flex h-9 items-center pe-2"><div class="bg-token-bg-elevated-secondary text-token-text-secondary flex items-center gap-4 rounded-sm px-2 font-sans text-xs"><button class="flex gap-1 items-center select-none py-1" aria-label="Copy"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0"></path></svg>Code kopieren</button></div></div></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-bash"><span><span class="hljs-meta">#!/bin/sh</span><span>
tar czf /backup/home-</span><span class="hljs-subst">$(date +%F)</span><span>.tgz /home
</span></span></code></div></div></pre>
<p data-start="262" data-end="300">Danach mit <code>crontab -e</code> eintragen.</p>
<ul data-start="302" data-end="360">
<li data-start="302" data-end="330"><p>täglich um 3 Uhr</p></li>
<li data-start="331" data-end="360"><p>Log nach <code>/var/log/backup.log</code></p></li>
</ul></div>`;

const CLAUDE_HTML = `<div class="grid-cols-1 grid gap-2.5 [&amp;_&gt;_*]:min-w-0 standard-markdown"><p class="whitespace-normal break-words">Hier ist eine kleine Funktion in Python:</p><div class="relative group/copy bg-bg-000/50 border-0.5 border-border-400 rounded-lg"><div class="sticky opacity-0 group-hover/copy:opacity-100 top-2 py-2 h-12 w-0 float-right"><div class="absolute right-0 h-8 px-2 items-center inline-flex z-10"><button class="inline-flex items-center justify-center" type="button" aria-label="Copy to clipboard"><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"></path></svg></button></div></div><div class="text-text-500 font-small p-3.5 pb-0">python</div><div class=""><pre class="code-block__code !my-0 !rounded-lg !text-sm !leading-relaxed" style="background: transparent;"><code class="language-python" style="white-space: pre;"><span><span class="token keyword">def</span><span> </span><span class="token function">gruss</span><span class="token punctuation">(</span><span>name</span><span class="token punctuation">)</span><span class="token punctuation">:</span><span>
</span></span><span><span>    </span><span class="token keyword">return</span><span> </span><span class="token string-interpolation token string">f"Hallo </span><span class="token string-interpolation token interpolation token punctuation">{</span><span>name</span><span class="token string-interpolation token interpolation token punctuation">}</span><span class="token string-interpolation token string">"</span></span></code></pre></div></div><p class="whitespace-normal break-words">Wichtig dabei:</p><ul class="[&amp;:not(:last-child)_ul]:pb-1 [&amp;:not(:last-child)_ol]:pb-1 list-disc space-y-1.5 pl-7"><li class="whitespace-normal break-words">Die Einrückung ist Teil der Syntax</li><li class="whitespace-normal break-words"><code class="bg-text-200/5 border border-0.5 border-border-300 text-danger-000 whitespace-pre-wrap rounded-[0.4rem] px-1 py-px text-[0.9rem]">f-Strings</code> gibt es ab Python 3.6</li></ul></div>`;

describe('htmlToMarkdown', () => {
  it('only takes HTML with code blocks', () => {
    expect(htmlHasCodeBlock('<p>Nur Text</p><ul><li>Punkt</li></ul>')).toBe(false);
    expect(htmlHasCodeBlock(CHATGPT_HTML)).toBe(true);
    expect(htmlHasCodeBlock('<PRE class="x">a</PRE>')).toBe(true);
  });

  it('a ChatGPT answer: paragraphs and lists as bullets, the code block with its language, no header or button', () => {
    const md = htmlToMarkdown(CHATGPT_HTML);
    expect(md).not.toContain('Code kopieren');
    expect(paste(md)).toEqual([
      ['text', 'So richtest du einen **Cronjob** für das Backup ein:', 0, undefined],
      ['numbered', 'Skript anlegen unter `/usr/local/bin`', 1, undefined],
      ['numbered', 'Ausführbar machen', 1, undefined],
      ['code', '#!/bin/sh\ntar czf /backup/home-$(date +%F).tgz /home', 0, 'bash'],
      ['text', 'Danach mit `crontab -e` eintragen.', 0, undefined],
      ['text', 'täglich um 3 Uhr', 1, undefined],
      ['text', 'Log nach `/var/log/backup.log`', 1, undefined],
    ]);
  });

  it('a Claude answer: the language label above the code is no bullet, the indentation of the code stays', () => {
    const md = htmlToMarkdown(CLAUDE_HTML);
    expect(paste(md)).toEqual([
      ['text', 'Hier ist eine kleine Funktion in Python:', 0, undefined],
      ['code', 'def gruss(name):\n    return f"Hallo {name}"', 0, 'python'],
      ['text', 'Wichtig dabei:', 0, undefined],
      ['text', 'Die Einrückung ist Teil der Syntax', 1, undefined],
      ['text', '`f-Strings` gibt es ab Python 3.6', 1, undefined],
    ]);
  });

  it('a headed documentation page: headings, a table, Prism and GitHub language classes, <br> lines', () => {
    const html =
      '<h2>Installation</h2><div class="highlight highlight-source-shell"><pre>apt install nginx</pre></div>' +
      '<h4>Konfiguration</h4><pre class="language-nginx"><code>server {<br>  listen 80;<br>}</code></pre>' +
      '<table><tr><th>Option</th><th>Wert</th></tr><tr><td>a|b</td><td>1</td></tr></table>';
    expect(paste(htmlToMarkdown(html))).toEqual([
      ['h2', 'Installation', 0, undefined],
      ['code', 'apt install nginx', 1, 'bash'],
      ['h3', 'Konfiguration', 1, undefined],
      ['code', 'server {\n  listen 80;\n}', 2, 'nginx'],
      ['table', '| Option | Wert |\n| --- | --- |\n| a\\|b | 1 |', 2, undefined],
    ]);
  });

  it('code with a fence of its own gets a longer one; a code block in a list item stays in the item', () => {
    const html = '<ul><li>Beispiel:<pre><code class="language-markdown">```js\nx()\n```</code></pre></li><li>Weiter</li></ul>';
    expect(paste(htmlToMarkdown(html))).toEqual([
      ['text', 'Beispiel:', 0, undefined],
      ['code', '```js\nx()\n```', 1, 'markdown'],
      ['text', 'Weiter', 0, undefined],
    ]);
  });

  it('an unknown language is kept as written, an unusable one gives plain code', () => {
    expect(paste(htmlToMarkdown('<pre><code class="language-OpenBSD-pf">pass in</code></pre>'))[0][3]).toBe('OpenBSD-pf');
    expect(paste(htmlToMarkdown('<pre><code class="language-plaintext">x</code></pre>'))[0][3]).toBe('text');
    expect(paste(htmlToMarkdown(`<pre><code class="language-${'a'.repeat(41)}">x</code></pre>`))[0][3]).toBe('');
  });
});

describe('pasted Markdown fences', () => {
  it('become code bullets with the editor id of their language', () => {
    const md = ['Vorher', '', '```JS', 'const a = 1;', '', 'a++;', '```', '', '~~~yml title="x.yml"', 'a: 1', '~~~', 'Nachher'].join('\n');
    expect(paste(md)).toEqual([
      ['text', 'Vorher', 0, undefined],
      ['code', 'const a = 1;\n\na++;', 0, 'javascript'],
      ['code', 'a: 1', 0, 'yaml'],
      ['text', 'Nachher', 0, undefined],
    ]);
  });

  it('a fence nested in a list keeps the item level and loses only its own indentation', () => {
    const md = ['- Server', '  - Dienst', '    ```python', '    def f():', '        pass', '    ```', '- Ende'].join('\n');
    expect(paste(md)).toEqual([
      ['text', 'Server', 0, undefined],
      ['text', 'Dienst', 1, undefined],
      ['code', 'def f():\n    pass', 2, 'python'],
      ['text', 'Ende', 0, undefined],
    ]);
  });

  it('closes only on a fence at least as long, runs to the end without one', () => {
    expect(paste(['````md', '```', 'innen', '```', '````'].join('\n'))).toEqual([['code', '```\ninnen\n```', 0, 'markdown']]);
    expect(paste(['```', 'offen', 'weiter'].join('\n'))).toEqual([['code', 'offen\nweiter', 0, '']]);
  });

  it('inline code on one line is no fence', () => {
    expect(paste('```ls -la``` zeigt alles')).toEqual([['text', '```ls -la``` zeigt alles', 0, undefined]]);
  });
});

describe('codeLanguageOf', () => {
  it('maps short names, keeps free names, drops unusable ones', () => {
    expect(codeLanguageOf('py')).toBe('python');
    expect(codeLanguageOf('C++')).toBe('cpp');
    expect(codeLanguageOf('OpenBSD-pf')).toBe('OpenBSD-pf');
    expect(codeLanguageOf('a'.repeat(40))).toBe('a'.repeat(40));
    expect(codeLanguageOf('a'.repeat(41))).toBe('');
    expect(codeLanguageOf('mein lang')).toBe('');
    expect(codeLanguageOf('')).toBe('');
  });
});
