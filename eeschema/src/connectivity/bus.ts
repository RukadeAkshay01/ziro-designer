/**
 * Bus label parsing and member expansion. Counterparts:
 * `NET_SETTINGS::ParseBusVector` / `ParseBusGroup`
 * (common/project/net_settings.cpp) and
 * `SCH_CONNECTION::ConfigureFromLabel` (eeschema/sch_connection.cpp).
 *
 * Vector buses `PRE[m..n]SUF` expand to `PRE<i>SUF` for every index in the
 * range (equal bounds are invalid; reversed bounds swap). Group buses
 * `NAME{A B, C[0..1]}` expand each member recursively — a member may itself
 * be a vector, a group, or a defined bus-alias name (whose members expand in
 * place) — and a *named* group prefixes every member with `NAME.`.
 *
 * Formatting markers (`^{}`, `_{}`, `~{}`) follow upstream's rules: they are
 * part of a name (`~{CAS}` is a different net from `CAS`), `D_{[1..2]}`
 * treats the subscript as decorating the range (stripped), and `~{BE[0..3]}`
 * keeps the marker wrapping each member name. Quoted strings and
 * backslash-escaped spaces are honoured. (Upstream's EscapeString/CTX_NETNAME
 * re-encoding is not applied — our net names stay raw.)
 */

const isSuperSubOverbar = (c: string | undefined): boolean => c === '^' || c === '_' || c === '~';

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** True when the character at `i` is preceded by an odd run of backslashes. */
function isEscaped(s: string, i: number): boolean {
  let n = 0;
  for (let k = i - 1; k >= 0 && s[k] === '\\'; k--) n++;
  return n % 2 === 1;
}

/** NET_SETTINGS::ParseBusVector — `PRE[m..n]SUF` -> expanded members. */
export function parseBusVector(bus: string): { name: string; members: string[] } | null {
  const len = bus.length;
  let i = 0;
  let prefix = '';
  let suffix = '';
  let braceNesting = 0;
  let fmtWrapsName = false;
  let inQuotes = false;

  // Prefix (up to the range '[').
  for (; i < len; i++) {
    const c = bus[i]!;
    if (c === '"' && !isEscaped(bus, i)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (c === '\\' && i + 1 < len) prefix += bus[++i];
      else prefix += c;
      continue;
    }
    if (c === '{') {
      if (i > 0 && isSuperSubOverbar(bus[i - 1])) {
        braceNesting++;
        prefix += '{';
        continue;
      }
      return null;
    }
    if (c === '}') {
      braceNesting--;
      prefix += '}';
      continue;
    }
    if (c === '\\' && bus[i + 1] === ' ') {
      prefix += bus[++i];
      continue;
    }
    if (c === ' ' || c === ']') return null;
    if (c === '[') {
      if (braceNesting > 0) {
        const fmtStart = prefix.lastIndexOf('{');
        if (fmtStart > 0 && isSuperSubOverbar(prefix[fmtStart - 1])) {
          if (fmtStart === prefix.length - 1) {
            // '{' immediately precedes '[' (e.g. D_{[1..2]}): the formatting
            // decorates the range indices, not the name.
            prefix = prefix.slice(0, fmtStart - 1);
          } else {
            // Name characters between '{' and '[' (e.g. ~{BE[0..3]}): the
            // formatting wraps each member name.
            fmtWrapsName = true;
          }
        }
      }
      break;
    }
    prefix += c;
  }

  // Start index.
  i++;
  if (i >= len) return null;
  let tmp = '';
  let begin = 0;
  let end = 0;
  let found = false;
  for (; i < len; i++) {
    if (bus[i] === '.' && bus[i + 1] === '.') {
      begin = Number.parseInt(tmp || '0', 10);
      i += 2;
      found = true;
      break;
    }
    if (!isDigit(bus[i])) return null;
    tmp += bus[i];
  }
  if (!found || i >= len) return null;

  // End index.
  tmp = '';
  found = false;
  for (; i < len; i++) {
    if (bus[i] === ']') {
      end = Number.parseInt(tmp || '0', 10);
      i++;
      found = true;
      break;
    }
    if (!isDigit(bus[i])) return null;
    tmp += bus[i];
  }
  if (!found) return null;

  // Suffix: only a closing formatting brace and polarity markers may follow.
  for (; i < len; i++) {
    const c = bus[i]!;
    if (c === '}') {
      braceNesting--;
      if (fmtWrapsName) suffix += c;
    } else if (c === '+' || c === '-' || c === 'P' || c === 'N') {
      suffix += c;
    } else {
      return null;
    }
  }
  if (braceNesting !== 0) return null;
  if (begin === end) return null;
  if (begin > end) [begin, end] = [end, begin];

  const members: string[] = [];
  for (let idx = begin; idx <= end; idx++) members.push(`${prefix}${idx}${suffix}`);
  return { name: prefix, members };
}

/** NET_SETTINGS::ParseBusGroup — `NAME{m1 m2, m3}` -> raw member tokens
 *  (unexpanded; a token may itself be a vector, group or alias name). */
export function parseBusGroup(group: string): { name: string; members: string[] } | null {
  const len = group.length;
  let i = 0;
  let prefix = '';
  let braceNesting = 0;
  let inQuotes = false;

  // Prefix (up to the member-list '{', which is NOT preceded by ^ _ ~).
  for (; i < len; i++) {
    const c = group[i]!;
    if (c === '"' && !isEscaped(group, i)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (c === '\\' && i + 1 < len) prefix += group[++i];
      else prefix += c;
      continue;
    }
    if (c === '{') {
      if (i > 0 && isSuperSubOverbar(group[i - 1])) {
        braceNesting++;
        prefix += '{';
        continue;
      }
      break;
    }
    if (c === '}') {
      braceNesting--;
      prefix += '}';
      continue;
    }
    if (c === '\\' && group[i + 1] === ' ') {
      prefix += group[++i];
      continue;
    }
    if (c === ' ' || c === '[' || c === ']') return null;
    prefix += c;
  }
  if (braceNesting !== 0) return null;
  if (i >= len || group[i] !== '{') return null;

  // Members.
  i++;
  if (i >= len) return null;
  inQuotes = false;
  const members: string[] = [];
  let tmp = '';
  for (; i < len; i++) {
    const c = group[i]!;
    if (c === '"' && !isEscaped(group, i)) {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) {
      if (c === '\\' && i + 1 < len) tmp += group[++i];
      else tmp += c;
      continue;
    }
    if (c === '{') {
      if (i > 0 && isSuperSubOverbar(group[i - 1])) {
        braceNesting++;
        // Keep the full formatting notation (~{CAS} is distinct from CAS).
        tmp += '{';
        continue;
      }
      return null;
    }
    if (c === '}') {
      if (braceNesting > 0) {
        braceNesting--;
        tmp += '}';
        continue;
      }
      if (tmp !== '') members.push(tmp);
      return { name: prefix, members };
    }
    if (c === '\\' && group[i + 1] === ' ') {
      tmp += group[++i];
      continue;
    }
    if (c === ' ' || c === ',') {
      if (tmp !== '') members.push(tmp);
      tmp = '';
      continue;
    }
    tmp += c;
  }
  return null;
}

/** A bus label's fully expanded net members. */
export interface BusInfo {
  kind: 'vector' | 'group';
  /** The bus name/prefix ('' for an unnamed group). */
  name: string;
  /** Flat expanded member net names: group prefixes applied, aliases
   *  resolved, nested vectors/groups expanded. */
  members: string[];
}

const MAX_BUS_DEPTH = 10; // guards alias cycles, like the graph's recursion cap

/**
 * SCH_CONNECTION::ConfigureFromLabel — expand a bus label to its member net
 * names. `aliases` maps a bus-alias name to its member tokens (from Schematic
 * Setup > Bus Alias Definitions). Returns null for a plain (non-bus) label.
 */
export function expandBusLabel(
  label: string,
  aliases?: ReadonlyMap<string, readonly string[]>,
  depth = 0,
): BusInfo | null {
  if (depth > MAX_BUS_DEPTH) return null;
  const vector = parseBusVector(label);
  if (vector) return { kind: 'vector', name: vector.name, members: vector.members };

  const group = parseBusGroup(label);
  if (!group) return null;
  // A named group prefixes its members with "NAME." (upstream's net prefix).
  const prefix = group.name === '' ? '' : `${group.name}.`;
  const out: string[] = [];
  const expandToken = (token: string): void => {
    const nested = expandBusLabel(token, aliases, depth + 1);
    if (nested) {
      for (const m of nested.members) out.push(prefix + m);
    } else {
      out.push(prefix + token);
    }
  };
  for (const token of group.members) {
    const alias = aliases?.get(token);
    if (alias) {
      for (const aliasMember of alias) expandToken(aliasMember);
    } else {
      expandToken(token);
    }
  }
  return { kind: 'group', name: group.name, members: out };
}

/** SCH_CONNECTION::MightBeBusLabel equivalent: does the label parse as a bus? */
export function isBusLabel(label: string): boolean {
  return parseBusVector(label) !== null || parseBusGroup(label) !== null;
}
