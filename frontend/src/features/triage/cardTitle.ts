// Cards show at most this many characters of a task's text, cut at a word where possible
export const CARD_TITLE_MAX = 140;

export function cardTitle(text: string): string {
  if (text.length <= CARD_TITLE_MAX) return text;
  const cut = text.slice(0, CARD_TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > CARD_TITLE_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…';
}
