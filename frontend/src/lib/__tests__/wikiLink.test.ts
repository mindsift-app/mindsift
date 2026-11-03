import { describe, it, expect } from 'vitest';
import { buildBlockLink, isNoteLinkOnly, parseWikiLink, wikiLinkText } from '../wikiLink';

describe('wiki links', () => {
  it('parses plain, labelled, section and bullet links', () => {
    expect(parseWikiLink('Homelab')).toEqual({ title: 'Homelab', blockId: undefined, label: undefined });
    expect(parseWikiLink('Homelab|hier')).toEqual({ title: 'Homelab', blockId: undefined, label: 'hier' });
    expect(parseWikiLink('Homelab#Abschnitt')).toEqual({ title: 'Homelab', blockId: undefined, label: undefined });
    expect(parseWikiLink('Homelab#^blk_a_1|Homelab › Backup')).toEqual({
      title: 'Homelab', blockId: 'blk_a_1', label: 'Homelab › Backup',
    });
  });

  it('builds a bullet link that parses back', () => {
    const link = buildBlockLink('Homelab [neu]', 'blk_x', 'Backups liefen bisher nur manuell – das soll sich ändern #backup');
    expect(link).toBe('[[Homelab neu#^blk_x|Homelab neu › Backups liefen bisher nur manuell – das…]]');
    const parsed = parseWikiLink(link.slice(2, -2));
    expect(parsed.blockId).toBe('blk_x');
    expect(wikiLinkText(parsed)).toBe('Homelab neu › Backups liefen bisher nur manuell – das…');
  });

  it('recognises a bullet that is only a link to a note', () => {
    expect(isNoteLinkOnly('[[Konzept: Garten]]')).toBe(true);
    expect(isNoteLinkOnly('[[Konzept: Garten]] #draußen #idee')).toBe(true);
    expect(isNoteLinkOnly('Siehe [[Konzept: Garten]]')).toBe(false);
    expect(isNoteLinkOnly('[[Konzept: Garten]] und mehr')).toBe(false);
    expect(isNoteLinkOnly('Garten')).toBe(false);
  });
});
