import { describe, it, expect } from 'vitest';
import {
  EdaCombinedMatcher,
  searchTerm,
  type SearchTerm,
} from '@ziroeda/common/src/eda_pattern_match.js';

// Weighted terms as LIB_SYMBOL::cacheSearchTerms builds them for Device:R.
function deviceR(): SearchTerm[] {
  return [
    searchTerm('Device', 4),
    searchTerm('R', 8, true),
    searchTerm('Device:R', 16, true),
    searchTerm('R', 4), // keyword token
    searchTerm('res resistor', 1),
    searchTerm('Resistor', 1),
  ];
}

describe('EdaCombinedMatcher', () => {
  it('finds plain substrings case-insensitively', () => {
    const m = new EdaCombinedMatcher('resist');
    expect(m.find('Resistor')).toBe(0);
    expect(m.find('photoresistor')).toBe(5);
    expect(m.find('capacitor')).toBe(-1);
  });

  it('matches wildcard patterns', () => {
    const m = new EdaCombinedMatcher('74ls*4');
    expect(m.find('74ls04')).toBe(0);
    expect(m.find('74hc04')).toBe(-1);
  });

  it('matches regex patterns', () => {
    const m = new EdaCombinedMatcher('^cap.*tor$');
    expect(m.find('capacitor')).toBe(0);
  });

  it('scores an exact name match into the exact tier', () => {
    const m = new EdaCombinedMatcher('r');
    const { score, exact } = m.scoreTerms(deviceR());
    expect(exact).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it('weights matches at the start above matches elsewhere', () => {
    const m = new EdaCombinedMatcher('res');
    const atStart = m.scoreTerms([searchTerm('res resistor', 1)]);
    const inside = m.scoreTerms([searchTerm('thermal res', 1)]);
    expect(atStart.score).toBeGreaterThan(inside.score);
    expect(atStart.exact).toBe(false);
  });

  it('does not mark a keyword equalling the query as exact', () => {
    const m = new EdaCombinedMatcher('resistor');
    const { exact } = m.scoreTerms([searchTerm('resistor', 4, false)]);
    expect(exact).toBe(false);
  });

  it('returns zero when nothing matches', () => {
    const m = new EdaCombinedMatcher('zzz');
    expect(m.scoreTerms(deviceR()).score).toBe(0);
  });
});
