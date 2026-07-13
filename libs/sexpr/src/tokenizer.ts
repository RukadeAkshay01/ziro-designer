/**
 * Tokenizer for KiCad-style S-expressions.
 *
 * Grammar of tokens:
 *   - `(` and `)` delimiters
 *   - quoted strings: `"..."` with C-style escapes (\" \\ \n \r \t)
 *   - bare atoms: any run of non-whitespace, non-paren, non-quote characters
 *
 * Whitespace (space, tab, CR, LF) separates tokens and is otherwise insignificant.
 */

export type TokenType = 'lparen' | 'rparen' | 'atom' | 'string';

export interface Token {
  readonly type: TokenType;
  /** For `atom`: the raw text. For `string`: the decoded value. */
  readonly value: string;
  /** Byte offset in the source where this token starts (for error messages). */
  readonly pos: number;
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(`${message} (at offset ${pos})`);
    this.name = 'TokenizeError';
  }
}

const isWhitespace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i]!;

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    if (c === '(') {
      tokens.push({ type: 'lparen', value: '(', pos: i });
      i++;
      continue;
    }

    if (c === ')') {
      tokens.push({ type: 'rparen', value: ')', pos: i });
      i++;
      continue;
    }

    if (c === '"') {
      const start = i;
      i++; // consume opening quote
      let out = '';
      let closed = false;
      while (i < n) {
        const ch = src[i]!;
        if (ch === '\\') {
          const next = src[i + 1];
          if (next === undefined) throw new TokenizeError('Unterminated escape in string', i);
          switch (next) {
            case 'n':
              out += '\n';
              break;
            case 'r':
              out += '\r';
              break;
            case 't':
              out += '\t';
              break;
            case '\\':
              out += '\\';
              break;
            case '"':
              out += '"';
              break;
            default:
              out += next;
              break; // pass through unknown escapes literally
          }
          i += 2;
          continue;
        }
        if (ch === '"') {
          i++; // consume closing quote
          closed = true;
          break;
        }
        out += ch;
        i++;
      }
      if (!closed) throw new TokenizeError('Unterminated string', start);
      tokens.push({ type: 'string', value: out, pos: start });
      continue;
    }

    // bare atom: read until whitespace or a paren or a quote
    const start = i;
    while (i < n) {
      const ch = src[i]!;
      if (isWhitespace(ch) || ch === '(' || ch === ')' || ch === '"') break;
      i++;
    }
    tokens.push({ type: 'atom', value: src.slice(start, i), pos: start });
  }

  return tokens;
}
