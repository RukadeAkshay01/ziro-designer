import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse, serialize, tokenize, type SNode } from '../src/sexpr/index.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('tokenizer', () => {
  it('splits parens, atoms, and strings', () => {
    const toks = tokenize('(at 0 -1.27 "hi")');
    expect(toks.map((t) => t.type)).toEqual([
      'lparen', 'atom', 'atom', 'atom', 'string', 'rparen',
    ]);
    expect(toks.map((t) => t.value)).toEqual(['(', 'at', '0', '-1.27', 'hi', ')']);
  });

  it('decodes escapes in strings', () => {
    const toks = tokenize('"a\\"b\\\\c\\nd"');
    expect(toks[0]!.value).toBe('a"b\\c\nd');
  });

  it('throws on an unterminated string', () => {
    expect(() => tokenize('"oops')).toThrow(/Unterminated string/);
  });
});

describe('parser', () => {
  it('preserves the bare-atom vs quoted-string distinction', () => {
    // `1` (a pin number written bare) and `"1"` (a quoted string) must not collapse.
    const root = parse('(pin 1 "1")');
    expect(root.items[1]).toEqual({ kind: 'atom', value: '1' });
    expect(root.items[2]).toEqual({ kind: 'string', value: '1' });
  });

  it('keeps numeric atoms as exact source text', () => {
    const root = parse('(at 161.29 109.22 180)');
    expect(root.items.slice(1)).toEqual([
      { kind: 'atom', value: '161.29' },
      { kind: 'atom', value: '109.22' },
      { kind: 'atom', value: '180' },
    ]);
  });

  it('rejects trailing junk after the root list', () => {
    expect(() => parse('(a) (b)')).toThrow(/trailing content/);
  });

  it('rejects an unterminated list', () => {
    expect(() => parse('(a (b)')).toThrow(/Unterminated list/);
  });
});

describe('round-trip (losslessness)', () => {
  const semanticRoundTrip = (text: string): void => {
    const once = parse(text);
    const twice = parse(serialize(once));
    // The AST must be identical after a serialize/parse cycle: zero data loss.
    expect(twice).toEqual(once);
  };

  it('is identity over the AST for a hand-written sample', () => {
    semanticRoundTrip('(kicad_sch (version 20250114) (paper "A4") (wire (pts (xy 1 2) (xy 3 4))))');
  });

  it('is identity over the AST for a real KiCad schematic', () => {
    semanticRoundTrip(fixture('nfc-antenna.kicad_sch'));
  });

  it('does not drop any node from the real schematic', () => {
    const root = parse(fixture('nfc-antenna.kicad_sch'));
    const count = (n: SNode): number =>
      n.kind === 'list' ? 1 + n.items.reduce((s, c) => s + count(c), 0) : 1;
    const before = count(root);
    const after = count(parse(serialize(root)));
    expect(after).toBe(before);
  });
});
