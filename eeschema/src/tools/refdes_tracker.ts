/**
 * Reference-designator tracker. Counterpart: `eeschema/refdes_tracker.cpp`
 * (REFDES_TRACKER) — remembers every designator ever assigned so that, with
 * "reuse designators" off, annotation never re-issues a freed number. The
 * state persists as `schematic.used_designators` in the project file via
 * Serialize/Deserialize (compact `R1-R4,R7,U1` ranges with `\`-escaping of
 * `\`, `,` and `-`; a prefix-only entry marks a bare prefix as used).
 *
 * The C++ thread-safety mutex and the next-free-number caches are omitted:
 * the caches are a lookup optimisation (annotate's first-free loop plays that
 * role here), not semantics.
 */

interface PrefixData {
  /** Used numbers; 0 marks a prefix-only entry, like upstream. */
  usedNumbers: Set<number>;
}

export class RefDesTracker {
  /** m_reuseRefDes: when true, previously-used-but-freed numbers may be
   *  reassigned (the PARAM default, reuse_designators). */
  reuseRefDes = true;

  private prefixData = new Map<string, PrefixData>();
  private allRefDes = new Set<string>();

  /** REFDES_TRACKER::parseRefDes: split on the trailing run of digits so any
   *  non-digit prefix (including '#' for power/flag symbols) is preserved. */
  private parseRefDes(refDes: string): [string, number] {
    if (refDes === '') return ['', 0];
    let pos = refDes.length;
    while (pos > 0 && refDes[pos - 1]! >= '0' && refDes[pos - 1]! <= '9') pos--;
    if (pos === 0) return [refDes, 0];
    if (pos === refDes.length) return [refDes, 0];
    return [refDes.slice(0, pos), Number.parseInt(refDes.slice(pos), 10)];
  }

  /** REFDES_TRACKER::Insert — false when already present. */
  insert(refDes: string): boolean {
    if (this.allRefDes.has(refDes)) return false;
    const [prefix, number] = this.parseRefDes(refDes);
    this.allRefDes.add(refDes);
    return this.insertNumber(prefix, number);
  }

  private insertNumber(prefix: string, number: number): boolean {
    let data = this.prefixData.get(prefix);
    if (!data) {
      data = { usedNumbers: new Set() };
      this.prefixData.set(prefix, data);
    }
    if (data.usedNumbers.has(number)) return false;
    data.usedNumbers.add(number);
    return true;
  }

  /** REFDES_TRACKER::Contains. */
  contains(refDes: string): boolean {
    return this.allRefDes.has(refDes);
  }

  clear(): void {
    this.prefixData.clear();
    this.allRefDes.clear();
  }

  get size(): number {
    return this.allRefDes.size;
  }

  /** escapeForSerialization: backslash-escape `\`, `,` and `-`. */
  private static escape(s: string): string {
    let out = '';
    for (const c of s) {
      if (c === '\\' || c === ',' || c === '-') out += '\\';
      out += c;
    }
    return out;
  }

  /** unescapeFromSerialization. */
  private static unescape(s: string): string {
    let out = '';
    let escaped = false;
    for (const c of s) {
      if (escaped) {
        out += c;
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else {
        out += c;
      }
    }
    return out;
  }

  /** splitString: delimiter-split that honours `\`-escapes (the escape stays
   *  in the part, for unescape to consume). */
  private static split(s: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let escaped = false;
    for (const c of s) {
      if (escaped) {
        current += c;
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
        current += c;
      } else if (c === delimiter) {
        result.push(current);
        current = '';
      } else {
        current += c;
      }
    }
    if (current !== '') result.push(current);
    return result;
  }

  /** REFDES_TRACKER::Serialize — sorted prefixes (std::map order), each with
   *  its consecutive numbers collapsed to `start-end` ranges, prefix-only
   *  entries last per prefix. */
  serialize(): string {
    const parts: string[] = [];
    const prefixes = [...this.prefixData.keys()].sort();
    for (const prefix of prefixes) {
      const data = this.prefixData.get(prefix)!;
      const escapedPrefix = RefDesTracker.escape(prefix);
      const numbers = [...data.usedNumbers].filter((n) => n > 0).sort((a, b) => a - b);
      const hasPrefix = data.usedNumbers.has(0);
      if (numbers.length === 0 && !hasPrefix) continue;

      const ranges: [number, number][] = [];
      if (numbers.length > 0) {
        let start = numbers[0]!;
        let end = numbers[0]!;
        for (let i = 1; i < numbers.length; i++) {
          if (numbers[i] === end + 1) {
            end = numbers[i]!;
          } else {
            ranges.push([start, end]);
            start = end = numbers[i]!;
          }
        }
        ranges.push([start, end]);
      }
      for (const [start, end] of ranges) {
        parts.push(start === end ? `${escapedPrefix}${start}` : `${escapedPrefix}${start}-${end}`);
      }
      if (hasPrefix) parts.push(escapedPrefix);
    }
    return parts.join(',');
  }

  /** REFDES_TRACKER::Deserialize — malformed input clears and returns false,
   *  never throws. The prefix regexes anchor on the final non-digit before
   *  the trailing digit run, so prefixes may embed digits (e.g. "U1U2"). */
  deserialize(data: string): boolean {
    this.clear();
    if (data === '') return true;

    const rangePattern = /^(.*\D)(\d+)-(\d+)$/;
    const numberedPattern = /^(.*\D)(\d+)$/;
    const parsePositiveInt = (s: string): number | null => {
      const v = Number.parseInt(s, 10);
      return Number.isFinite(v) && String(v) === s && v > 0 ? v : null;
    };

    for (const part of RefDesTracker.split(data, ',')) {
      const unescaped = RefDesTracker.unescape(part);
      let m = rangePattern.exec(unescaped);
      if (m) {
        const start = parsePositiveInt(m[2]!);
        const end = parsePositiveInt(m[3]!);
        if (start === null || end === null) {
          this.clear();
          return false;
        }
        for (let i = start; i <= end; i++) this.insert(`${m[1]}${i}`);
        continue;
      }
      m = numberedPattern.exec(unescaped);
      if (m) {
        const number = parsePositiveInt(m[2]!);
        if (number === null) {
          this.clear();
          return false;
        }
        this.insert(`${m[1]}${number}`);
        continue;
      }
      if (unescaped.length > 0) {
        this.insert(unescaped);
        continue;
      }
      this.clear();
      return false;
    }
    return true;
  }
}
