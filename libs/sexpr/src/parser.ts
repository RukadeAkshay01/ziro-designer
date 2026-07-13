/**
 * Parser: token stream -> S-expression AST.
 *
 * A KiCad file is a single top-level list, e.g. `(kicad_sch ...)`. This parser
 * is deliberately format-agnostic: it knows nothing about schematics, only about
 * lists, atoms, and strings. That keeps the lossless layer decoupled from the
 * (evolving) typed document model.
 */

import { tokenize, type Token } from './tokenizer.js';
import { atom, str, type SList, type SNode } from './types.js';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(`${message} (at offset ${pos})`);
    this.name = 'ParseError';
  }
}

/** Parse a complete KiCad file into its single root list. */
export function parse(src: string): SList {
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new ParseError('Empty input: expected a top-level list', 0);

  let i = 0;

  function parseNode(): SNode {
    const tok = tokens[i];
    if (tok === undefined) throw new ParseError('Unexpected end of input', src.length);

    switch (tok.type) {
      case 'lparen':
        return parseList();
      case 'atom':
        i++;
        return atom(tok.value);
      case 'string':
        i++;
        return str(tok.value);
      case 'rparen':
        throw new ParseError("Unexpected ')'", tok.pos);
    }
  }

  function parseList(): SList {
    const open = tokens[i]!; // known lparen
    i++;
    const items: SNode[] = [];
    while (true) {
      const tok: Token | undefined = tokens[i];
      if (tok === undefined) throw new ParseError("Unterminated list: missing ')'", open.pos);
      if (tok.type === 'rparen') {
        i++;
        return { kind: 'list', items };
      }
      items.push(parseNode());
    }
  }

  const root =
    tokens[0]!.type === 'lparen'
      ? parseList()
      : (() => {
          throw new ParseError('Expected a top-level list starting with "("', tokens[0]!.pos);
        })();

  if (i < tokens.length) {
    throw new ParseError('Unexpected trailing content after top-level list', tokens[i]!.pos);
  }

  return root;
}
