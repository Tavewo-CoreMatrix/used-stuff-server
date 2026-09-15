// Standard iterative Levenshtein (edit) distance between two strings.
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1, // insertion
        prevRow[j] + 1, // deletion
        prevRow[j - 1] + cost, // substitution
      );
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// How many typo'd characters to tolerate, scaled by word length — short words
// must match closely (otherwise nearly everything fuzzy-matches everything),
// longer words can absorb one or two typos.
const maxEditDistance = (wordLength: number): number => {
  if (wordLength <= 3) return 0;
  if (wordLength <= 5) return 1;
  return 2;
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

function fuzzyWordMatch(queryWord: string, targetWords: string[]): boolean {
  return targetWords.some((tw) => {
    if (tw === queryWord) return true;
    if (tw.includes(queryWord) || queryWord.includes(tw)) return true;
    return levenshteinDistance(queryWord, tw) <= maxEditDistance(Math.min(queryWord.length, tw.length));
  });
}

/**
 * True if every significant word (length > 2) in `query` fuzzy-matches
 * somewhere in `target` — order-independent and typo-tolerant. Mirrors
 * mobile's src/lib/fuzzyMatch.ts exactly, so "would this show up in search"
 * stays consistent between the app's own search and wanted-request matching.
 */
export function fuzzySearchMatch(query: string, target: string): boolean {
  const queryWords = tokenize(query).filter((w) => w.length > 2);
  if (queryWords.length === 0) return false;
  const targetWords = tokenize(target);
  return queryWords.every((qw) => fuzzyWordMatch(qw, targetWords));
}
