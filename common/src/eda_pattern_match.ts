/**
 * Search-pattern matching and weighted scoring for library/item choosers.
 * Mirrors kicad/common/eda_pattern_match.cpp (EDA_PATTERN_MATCH_* and
 * EDA_COMBINED_MATCHER with ScoreTerms).
 *
 * A combined matcher tries, in order: regular expression, wildcard (?/*) and
 * plain substring — "whatever syntax users prefer, it shall be matched"
 * (CTX_LIBITEM). The relational matcher (`pins>4`) is not ported: the web
 * library index carries no per-item numeric fields to relate against.
 */

/** One weighted search term of a tree item (upstream SEARCH_TERM, lib_tree_item.h). */
export interface SearchTerm {
  text: string;
  /** Relative weight — e.g. item name 8, LIB_ID 16, keywords 4, description 1. */
  score: number;
  /**
   * Only the item's own name/LIB_ID can promote it into the exact-match tier;
   * an incidental keyword equalling the query shouldn't tie with an item whose
   * actual name is the query.
   */
  isName?: boolean;
  /** Lazily lower-cased/trimmed on first scoring pass (upstream `Normalized`). */
  normalized?: boolean;
}

export function searchTerm(text: string, score: number, isName = false): SearchTerm {
  return { text, score, isName };
}

const NOT_FOUND = -1;

interface PatternMatcher {
  /** Position of the first match of the pattern in `candidate`, or -1. */
  find(candidate: string): number;
}

/** EDA_PATTERN_MATCH_SUBSTR: plain case-insensitive substring. */
function substrMatcher(pattern: string): PatternMatcher {
  const p = pattern.toLowerCase();
  return { find: (candidate) => candidate.toLowerCase().indexOf(p) };
}

/** EDA_PATTERN_MATCH_WILDCARD: `?` = any char, `*` = any run; null without wildcards. */
function wildcardMatcher(pattern: string): PatternMatcher | null {
  if (!/[?*]/.test(pattern)) return null;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '.')
    .replace(/\*/g, '.*');
  try {
    const re = new RegExp(escaped, 'i');
    return { find: (candidate) => candidate.search(re) };
  } catch {
    return null;
  }
}

/** EDA_PATTERN_MATCH_REGEX: the query as a regex, when it compiles. */
function regexMatcher(pattern: string): PatternMatcher | null {
  // A pattern without any regex syntax is already covered by the substring
  // matcher; compiling it here would only duplicate hits.
  if (!/[.^$*+?()[\]{}|\\]/.test(pattern)) return null;
  try {
    const re = new RegExp(pattern, 'i');
    return { find: (candidate) => candidate.search(re) };
  } catch {
    return null;
  }
}

/**
 * EDA_COMBINED_MATCHER (context CTX_LIBITEM): one search token matched through
 * every syntax the token could plausibly be.
 */
export class EdaCombinedMatcher {
  private readonly pattern: string;
  private readonly matchers: PatternMatcher[] = [];

  constructor(pattern: string) {
    this.pattern = pattern;
    const regex = regexMatcher(pattern);
    if (regex) this.matchers.push(regex);
    const wildcard = wildcardMatcher(pattern);
    if (wildcard) this.matchers.push(wildcard);
    // If the above matchers couldn't be created because the pattern syntax
    // does not match, the substring will try its best.
    this.matchers.push(substrMatcher(pattern));
  }

  getPattern(): string {
    return this.pattern;
  }

  /** Earliest match position across all matchers, or -1 when nothing fires. */
  find(candidate: string): number {
    let position = NOT_FOUND;
    for (const matcher of this.matchers) {
      const at = matcher.find(candidate);
      if (at >= 0 && (position === NOT_FOUND || at < position)) position = at;
    }
    return position;
  }

  /**
   * EDA_COMBINED_MATCHER::ScoreTerms — weigh this matcher against an item's
   * search terms: 8× for an exact term match, 2× for a match at the start,
   * 1× anywhere else. `exact` is set only when a name term equals the query.
   */
  scoreTerms(terms: SearchTerm[]): { score: number; exact: boolean } {
    let score = 0;
    let exact = false;

    for (const term of terms) {
      if (!term.normalized) {
        // Don't hang if someone accidentally pastes a whole schematic into
        // the search box.
        term.text = term.text.toLowerCase().trim().slice(0, 1000);
        term.normalized = true;
      }

      if (this.pattern === term.text) {
        score += 8 * term.score;
        if (term.isName) exact = true;
      } else {
        const at = this.find(term.text);
        if (at === 0) score += 2 * term.score;
        else if (at > 0) score += term.score;
      }
    }

    return { score, exact };
  }
}
