import { describe, it, expect } from 'vitest';
import {
  buildBlockLink,
  buildNoteLink,
  isNoteLinkOnly,
  parseWikiLink,
  retargetWikiLinks,
  unlinkWikiLinks,
  wikiLinkText,
} from '../wikiLink';

describe('wiki links', () => {
  it('parses links with the id of the note, with and without a bullet and own text', () => {
    expect(parseWikiLink('Homelab#doc_8f3a')).toEqual({ title: 'Homelab', docId: 'doc_8f3a', blockId: undefined, label: undefined });
    expect(parseWikiLink('Homelab#doc_8f3a|siehe hier')).toEqual({ title: 'Homelab', docId: 'doc_8f3a', blockId: undefined, label: 'siehe hier' });
    expect(parseWikiLink('Homelab#doc_8f3a^blk_1_x')).toEqual({ title: 'Homelab', docId: 'doc_8f3a', blockId: 'blk_1_x', label: undefined });
    expect(parseWikiLink('Homelab#doc_8f3a^doc_8f3a-b0|Text')).toEqual({ title: 'Homelab', docId: 'doc_8f3a', blockId: 'doc_8f3a-b0', label: 'Text' });
  });

  it('still reads the older forms', () => {
    expect(parseWikiLink('Homelab')).toEqual({ title: 'Homelab', docId: undefined, blockId: undefined, label: undefined });
    expect(parseWikiLink('Homelab|hier')).toEqual({ title: 'Homelab', docId: undefined, blockId: undefined, label: 'hier' });
    expect(parseWikiLink('Homelab#Abschnitt')).toEqual({ title: 'Homelab', docId: undefined, blockId: undefined, label: undefined });
    expect(parseWikiLink('Homelab#^blk_a_1|Homelab › Backup')).toEqual({
      title: 'Homelab', docId: undefined, blockId: 'blk_a_1', label: 'Homelab › Backup',
    });
  });

  it('shows the current title unless the link has its own text', () => {
    const target = { title: 'Homelab 2.0', blockContent: 'Backups liefen bisher nur manuell – das soll sich ändern #backup' };
    expect(wikiLinkText(parseWikiLink('Homelab#doc_1'), target)).toBe('Homelab 2.0');
    expect(wikiLinkText(parseWikiLink('Homelab#doc_1|hier'), target)).toBe('hier');
    expect(wikiLinkText(parseWikiLink('Homelab#doc_1'), null)).toBe('Homelab');
    expect(wikiLinkText(parseWikiLink('Homelab#doc_1^blk_2'), target)).toBe('Homelab 2.0 › Backups liefen bisher nur manuell – das…');
    expect(wikiLinkText(parseWikiLink('Homelab#doc_1^blk_2'), null)).toBe('Homelab »');
  });

  it('builds links that parse back', () => {
    expect(buildNoteLink('Homelab [neu]', 'doc_1')).toBe('[[Homelab neu#doc_1]]');
    expect(buildNoteLink('Homelab', 'doc_1', 'siehe | hier')).toBe('[[Homelab#doc_1|siehe hier]]');
    const link = buildBlockLink('Homelab #1', 'doc_1', 'blk_x');
    expect(link).toBe('[[Homelab 1#doc_1^blk_x]]');
    expect(parseWikiLink(link.slice(2, -2))).toEqual({ title: 'Homelab 1', docId: 'doc_1', blockId: 'blk_x', label: undefined });
  });

  it('turns links to a missing note into plain text, by id or by title', () => {
    expect(unlinkWikiLinks('[[Garten (2)]] #draußen', { title: 'garten (2)' })).toBe('Garten (2) #draußen');
    expect(unlinkWikiLinks('Siehe [[Garten|hier]] und [[Garten#^blk_a|Garten › Beete]], nicht [[Zaun]]', { title: 'Garten' })).toBe(
      'Siehe hier und Garten › Beete, nicht [[Zaun]]'
    );
    // Same title, other note: stays a link
    expect(unlinkWikiLinks('[[Garten#doc_1]] und [[Garten#doc_2]]', { title: 'Garten', docId: 'doc_1' })).toBe('Garten und [[Garten#doc_2]]');
  });

  it('points links at a note created for them', () => {
    expect(retargetWikiLinks('Siehe [[Garten|hier]] und [[Zaun]]', { title: 'Garten' }, 'doc_9', 'Garten')).toBe(
      'Siehe [[Garten#doc_9|hier]] und [[Zaun]]'
    );
  });

  it('recognises a bullet that is only a link to a note', () => {
    expect(isNoteLinkOnly('[[Konzept: Garten]]')).toBe(true);
    expect(isNoteLinkOnly('[[Konzept: Garten#doc_1]] #draußen #idee')).toBe(true);
    // A link to one bullet is not a link to the whole note: bringing it back would take the whole note
    expect(isNoteLinkOnly('[[Konzept: Garten#^blk_1|Konzept: Garten › Beete]]')).toBe(false);
    expect(isNoteLinkOnly('[[Konzept: Garten#doc_1^blk_1]]')).toBe(false);
    expect(isNoteLinkOnly('Siehe [[Konzept: Garten]]')).toBe(false);
    expect(isNoteLinkOnly('[[Konzept: Garten]] und mehr')).toBe(false);
    expect(isNoteLinkOnly('Garten')).toBe(false);
  });
});
