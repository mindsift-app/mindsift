// A hashtag starts the text or follows whitespace or "(". Fragments in links (example.com/blog#ueberschrift)
// and words like "C#" are not tags. Same rule as the server (domain.ExtractTags).
const HASHTAG = /(?:^|[\s(])#([a-zA-Z0-9äöüÄÖÜß_-]+)/g;

/** All hashtags in a text, lower case, in order of appearance (with duplicates). */
export function extractHashtags(text: string | undefined | null): string[] {
  if (!text) return [];
  return Array.from(text.matchAll(HASHTAG), (m) => m[1].toLowerCase());
}
