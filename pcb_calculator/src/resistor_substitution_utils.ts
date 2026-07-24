/**
 * Resistor-substitution search: approximate a required resistance with 2–4
 * E-series resistors combined in series/parallel.
 * Exact port of KiCad `pcb_calculator/resistor_substitution_utils.cpp`
 * (RES_EQUIV_CALC): full sorted 2R buffer + binary-search complement lookups,
 * so the search is exhaustive like upstream, with the same tie-breaking
 * (fewest distinct values, then fewest parts, then lexicographic name).
 */

import { ESeriesId, eseriesValues } from './eseries.js';

/** Search-space bounds, as in KiCad (`RES_EQUIV_CALC_FIRST/LAST_VALUE`). */
export const RES_EQUIV_FIRST_VALUE = 10;
export const RES_EQUIV_LAST_VALUE = 1e6;

/** Absolute float-equality epsilon, as in KiCad. */
const EPSILON = 1e-12;

export interface Resistance {
  /** Achieved value, Ω. */
  value: number;
  /** KiCad-notation formula, e.g. "2K2 + (330R | 4K7)". */
  name: string;
  /** The individual resistor values used, Ω. */
  parts: readonly number[];
}

export interface ResEquivResults {
  /** Best 2-resistor combination (always present). */
  s2r: Resistance;
  /** Best 3R combination; absent when 2R already hits the value exactly. */
  s3r?: Resistance;
  /** Best 4R combination; absent when 3R (or 2R) already hits it exactly. */
  s4r?: Resistance;
}

// "330R" / "2K2" / "1M" notation (KiCad strValue: 1 mantissa digit, ≤E24).
function strValue(v: number): string {
  if (v < 1000) return `${Math.trunc(v)}R`;
  let div = 1e3;
  let unit = 'K';
  if (v >= 1e6) {
    div = 1e6;
    unit = 'M';
  }
  const x = v / div;
  const intPart = Math.trunc(x);
  let result = `${intPart}${unit}`;
  const mantissa = x - intPart;
  if (mantissa > 0) result += `${Math.round(mantissa * 10)}`;
  return result;
}

// Parenthesize aText when it contains aRequiredSymbol outside parentheses.
function maybeEmbrace(text: string, requiredSymbol: string): string {
  let parenLevel = 0;
  let shouldEmbrace = false;
  for (const c of text) {
    if (c === '(') parenLevel++;
    else if (c === ')') parenLevel--;
    else if (c === requiredSymbol && parenLevel === 0) shouldEmbrace = true;
  }
  return shouldEmbrace ? `(${text})` : text;
}

const serialValue = (r1: number, r2: number): number => r1 + r2;
const parallelValue = (r1: number, r2: number): number => (r1 * r2) / (r1 + r2);

function serialResistance(r1: Resistance, r2: Resistance): Resistance {
  return {
    value: serialValue(r1.value, r2.value),
    name: `${maybeEmbrace(r1.name, '|')} + ${maybeEmbrace(r2.name, '|')}`,
    parts: [...r1.parts, ...r2.parts],
  };
}

function parallelResistance(r1: Resistance, r2: Resistance): Resistance {
  return {
    value: parallelValue(r1.value, r2.value),
    name: `${maybeEmbrace(r1.name, '+')} | ${maybeEmbrace(r2.name, '+')}`,
    parts: [...r1.parts, ...r2.parts],
  };
}

// "Simple" variants skip the parenthesis scan (both operands are single values).
function serialResistanceSimple(r1: Resistance, r2: Resistance): Resistance {
  return {
    value: serialValue(r1.value, r2.value),
    name: `${r1.name} + ${r2.name}`,
    parts: [...r1.parts, ...r2.parts],
  };
}

function parallelResistanceSimple(r1: Resistance, r2: Resistance): Resistance {
  return {
    value: parallelValue(r1.value, r2.value),
    name: `${r1.name} | ${r2.name}`,
    parts: [...r1.parts, ...r2.parts],
  };
}

function uniqueCount(res: Resistance): number {
  const parts = [...res.parts].sort((a, b) => a - b);
  let count = 0;
  let last = 0;
  let first = true;
  for (const v of parts) {
    if (first || Math.abs(v - last) > EPSILON) {
      count++;
      last = v;
      first = false;
    }
  }
  return count;
}

function betterCandidate(cand: Resistance, best: Resistance): boolean {
  const candUnique = uniqueCount(cand);
  const bestUnique = uniqueCount(best);
  if (candUnique !== bestUnique) return candUnique < bestUnique;
  if (cand.parts.length !== best.parts.length) return cand.parts.length < best.parts.length;
  return cand.name < best.name;
}

/**
 * Collects candidate combinations and keeps the one with the best deviation;
 * the (costly) formula string is only built when a candidate improves or ties.
 */
class SolutionCollector {
  private bestDeviation = Infinity;
  private bestSolution: Resistance | null = null;

  constructor(private readonly target: number) {}

  add2RLookupResults(
    results: readonly [Resistance, Resistance],
    valueFunc: (foundValue: number) => number,
    resultFunc: (found: Resistance) => Resistance,
  ): void {
    this.considerSolution(valueFunc(results[0].value), results[0], resultFunc);
    this.considerSolution(valueFunc(results[1].value), results[1], resultFunc);
  }

  getBest(): Resistance {
    if (!this.bestSolution) throw new Error('Empty solution collector');
    return this.bestSolution;
  }

  private considerSolution(
    value: number,
    found: Resistance,
    resultFunc: (found: Resistance) => Resistance,
  ): void {
    const deviation = Math.abs(value - this.target);
    if (deviation + EPSILON < this.bestDeviation) {
      this.bestDeviation = deviation;
      this.bestSolution = resultFunc(found);
    } else if (Math.abs(deviation - this.bestDeviation) < EPSILON) {
      const candidate = resultFunc(found);
      if (!this.bestSolution || betterCandidate(candidate, this.bestSolution)) {
        this.bestSolution = candidate;
      }
    }
  }
}

// Per-series value tables (10 Ω … 1 MΩ), built once and cached.
const seriesCache = new Map<ESeriesId, Resistance[]>();

function seriesData(id: ESeriesId): Resistance[] {
  const cached = seriesCache.get(id);
  if (cached) return cached;

  const base = eseriesValues(id); // first-decade floats, base[0] === 1.0
  const list: Resistance[] = [];
  outer: for (let decade = RES_EQUIV_FIRST_VALUE; ; decade *= 10) {
    for (const v of base) {
      // All E1–E24 values are integers in [10, 1e6]; round away float noise.
      const value = Math.round((decade * v) / (base[0] ?? 1));
      list.push({ value, name: strValue(value), parts: [value] });
      if (value >= RES_EQUIV_LAST_VALUE) break outer;
    }
  }
  seriesCache.set(id, list);
  return cached ?? list;
}

/**
 * Exhaustive search for the best 2R/3R/4R equivalents of `targetOhm`,
 * mirroring KiCad's RES_EQUIV_CALC::Calculate. `excludeOhms` values (in Ω)
 * are removed from the pool when they match a series value exactly.
 * Only E1…E24 are supported (as in KiCad). Returns null when the pool is
 * empty or the series id is out of range.
 */
export function resEquivCalc(
  targetOhm: number,
  serieId: ESeriesId,
  excludeOhms: readonly number[] = [],
): ResEquivResults | null {
  if (serieId > ESeriesId.E24 || !Number.isFinite(targetOhm)) return null;

  const series = seriesData(serieId);
  const excluded = new Set<number>();
  for (const e of excludeOhms) {
    if (Number.isNaN(e)) continue;
    // KiCad matches by |value - e| < epsilon via lower_bound; values are
    // integers, so an exact-rounded match is equivalent.
    const v = Math.round(e);
    if (Math.abs(v - e) < EPSILON && series.some((r) => r.value === v)) excluded.add(v);
  }

  const buffer1R = series.filter((r) => !excluded.has(r.value));
  if (buffer1R.length === 0) return null;

  // 2R buffer: every serial and parallel pair (i1 ≤ i2), sorted by value.
  const buffer2R: Resistance[] = [];
  for (let i1 = 0; i1 < buffer1R.length; i1++) {
    for (let i2 = i1; i2 < buffer1R.length; i2++) {
      buffer2R.push(serialResistanceSimple(buffer1R[i1]!, buffer1R[i2]!));
      buffer2R.push(parallelResistanceSimple(buffer1R[i1]!, buffer1R[i2]!));
    }
  }
  buffer2R.sort((a, b) => a.value - b.value);

  const findIn2RBuffer = (target: number): [Resistance, Resistance] => {
    if (Number.isNaN(target)) return [buffer2R[0]!, buffer2R[0]!];
    const front = buffer2R[0]!;
    const back = buffer2R[buffer2R.length - 1]!;
    if (target <= front.value || target >= back.value) return [front, back];

    // lower_bound: first index whose value is not less than target.
    let lo = 0;
    let hi = buffer2R.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (buffer2R[mid]!.value < target) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return [buffer2R[0]!, buffer2R[0]!];
    if (lo === buffer2R.length) return [buffer2R[lo - 1]!, buffer2R[lo - 1]!];
    return [buffer2R[lo - 1]!, buffer2R[lo]!];
  };

  const calculate2RSolution = (): Resistance => {
    const solution = new SolutionCollector(targetOhm);
    solution.add2RLookupResults(
      findIn2RBuffer(targetOhm),
      (v) => v,
      (found) => found,
    );
    return solution.getBest();
  };

  const calculate3RSolution = (): Resistance => {
    const solution = new SolutionCollector(targetOhm);
    for (const r of buffer1R) {
      // r + 2R
      solution.add2RLookupResults(
        findIn2RBuffer(targetOhm - r.value),
        (v) => serialValue(v, r.value),
        (found) => serialResistance(found, r),
      );
      // r | 2R
      solution.add2RLookupResults(
        findIn2RBuffer((targetOhm * r.value) / (r.value - targetOhm)),
        (v) => parallelValue(v, r.value),
        (found) => parallelResistance(found, r),
      );
    }
    return solution.getBest();
  };

  const calculate4RSolution = (): Resistance => {
    const solution = new SolutionCollector(targetOhm);
    for (const rr of buffer2R) {
      // 2R + 2R
      solution.add2RLookupResults(
        findIn2RBuffer(targetOhm - rr.value),
        (v) => serialValue(v, rr.value),
        (found) => serialResistance(found, rr),
      );
      // 2R | 2R
      solution.add2RLookupResults(
        findIn2RBuffer((targetOhm * rr.value) / (rr.value - targetOhm)),
        (v) => parallelValue(v, rr.value),
        (found) => parallelResistance(found, rr),
      );
    }
    for (const r1 of buffer1R) {
      for (const r2 of buffer1R) {
        // r1 + (r2 | 2R)
        solution.add2RLookupResults(
          findIn2RBuffer(((targetOhm - r1.value) * r2.value) / (r1.value + r2.value - targetOhm)),
          (v) => serialValue(r1.value, parallelValue(r2.value, v)),
          (found) => serialResistance(r1, parallelResistance(r2, found)),
        );
        // r1 | (r2 + 2R)
        solution.add2RLookupResults(
          findIn2RBuffer((targetOhm * r1.value) / (r1.value - targetOhm) - r2.value),
          (v) => parallelValue(r1.value, serialValue(r2.value, v)),
          (found) => parallelResistance(r1, serialResistance(r2, found)),
        );
      }
    }
    return solution.getBest();
  };

  const s2r = calculate2RSolution();
  const results: ResEquivResults = { s2r };

  if (Math.abs(s2r.value - targetOhm) > EPSILON) {
    const s3r = calculate3RSolution();
    results.s3r = s3r;
    if (Math.abs(s3r.value - targetOhm) > EPSILON) results.s4r = calculate4RSolution();
  }

  return results;
}
