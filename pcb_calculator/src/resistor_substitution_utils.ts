/**
 * Resistor-substitution search: approximate a required resistance with 1–4
 * E-series resistors combined in series/parallel.
 * Counterpart: KiCad `pcb_calculator/resistor_substitution_utils.cpp`.
 */

import { type ESeriesId, eseriesInRange } from './eseries.js';

export interface ResistorSolution {
  /** Achieved resistance in ohms. */
  value: number;
  /** Human-readable network, e.g. "8.2k + (2.2k | 4.7k)". */
  formula: string;
  /** Relative deviation from the target, in percent (signed). */
  deviationPct: number;
  /** Number of resistors used. */
  count: number;
}

export interface ResistorCalcResult {
  /** Best single resistor. */
  r1: ResistorSolution;
  /** Best network of up to 2 resistors. */
  r2: ResistorSolution;
  /** Best network of up to 3 resistors. */
  r3: ResistorSolution;
  /** Best network of up to 4 resistors. */
  r4: ResistorSolution;
}

interface Node {
  value: number;
  formula: string;
  count: number;
}

const fmtOhms = (v: number): string => {
  if (v >= 1e6) return `${trim(v / 1e6)}M`;
  if (v >= 1e3) return `${trim(v / 1e3)}k`;
  if (v >= 1) return trim(v);
  return `${trim(v * 1000)}m`;
};
const trim = (v: number): string => Number(v.toPrecision(6)).toString();

const series = (a: Node, b: Node): Node => ({
  value: a.value + b.value,
  formula: `${a.formula} + ${b.formula}`,
  count: a.count + b.count,
});

const parallel = (a: Node, b: Node): Node => ({
  value: (a.value * b.value) / (a.value + b.value),
  formula: `${wrap(a)} | ${wrap(b)}`,
  count: a.count + b.count,
});

const wrap = (n: Node): string => (n.count > 1 ? `(${n.formula})` : n.formula);

/**
 * Search 1R/2R/3R/4R networks built from `serieId` values around the target's
 * decade. 3R = (2R network) ∘ 1R, 4R = (2R network) ∘ (2R network), matching
 * the upstream search space.
 */
export function calculateResistorSubstitution(
  target: number,
  serieId: ESeriesId,
  exclude: readonly number[] = [],
): ResistorCalcResult | null {
  if (!(target > 0) || !Number.isFinite(target)) return null;

  const dec = Math.floor(Math.log10(target));
  // Values the user does not stock: drop them (and their decade multiples,
  // matched on the normalised mantissa) from the pool — like KiCad's
  // "Exclude value" fields.
  const excludedMantissas = new Set(
    exclude
      .filter((e) => e > 0 && Number.isFinite(e))
      .map((e) => (e / 10 ** Math.floor(Math.log10(e))).toPrecision(4)),
  );
  const isExcluded = (val: number): boolean =>
    excludedMantissas.has((val / 10 ** Math.floor(Math.log10(val))).toPrecision(4));

  // Base pool: two decades below to one above covers every series/parallel
  // combination that can reach the target with meaningful contribution.
  const pool: Node[] = eseriesInRange(serieId, dec - 2, dec + 1)
    .filter((v) => !isExcluded(v))
    .map((v) => ({
      value: v,
      formula: fmtOhms(v),
      count: 1,
    }));
  if (pool.length === 0) return null;

  const better = (best: Node | null, cand: Node): Node | null => {
    if (!best) return cand;
    const be = Math.abs(best.value - target);
    const ce = Math.abs(cand.value - target);
    // Prefer accuracy; on (near-exact) ties prefer fewer parts.
    if (ce < be - target * 1e-12) return cand;
    if (Math.abs(ce - be) <= target * 1e-12 && cand.count < best.count) return cand;
    return best;
  };

  let best1: Node | null = null;
  for (const n of pool) best1 = better(best1, n);

  // All 2R composites (kept for building 3R/4R), plus the best of them.
  let best2: Node | null = best1;
  const pairs: Node[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i; j < pool.length; j++) {
      const a = pool[i]!;
      const b = pool[j]!;
      const s = series(a, b);
      const p = parallel(a, b);
      pairs.push(s, p);
      best2 = better(better(best2, s), p);
    }
  }

  // Keep only the most promising pairs to bound the 3R/4R search.
  const keep = 400;
  pairs.sort((a, b) => Math.abs(a.value - target) - Math.abs(b.value - target));
  const top = pairs.slice(0, keep);
  // Pairs useful as *components* of a bigger network are those below the
  // target (series partner) or above it (parallel partner) — near-target pairs
  // alone would miss e.g. small trim resistors, so include a value-spread set.
  const spread = pairs.filter((_, i) => i % Math.ceil(pairs.length / keep) === 0);
  const parts = dedupe([...top, ...spread]);

  let best3: Node | null = best2;
  for (const pair of parts) {
    for (const r of pool) {
      best3 = better(best3, series(pair, r));
      best3 = better(best3, parallel(pair, r));
    }
  }

  let best4: Node | null = best3;
  const quadParts = parts.slice(0, 150);
  for (let i = 0; i < quadParts.length; i++) {
    for (let j = i; j < quadParts.length; j++) {
      const a = quadParts[i]!;
      const b = quadParts[j]!;
      best4 = better(best4, series(a, b));
      best4 = better(best4, parallel(a, b));
    }
  }

  const sol = (n: Node): ResistorSolution => ({
    value: n.value,
    formula: n.formula,
    deviationPct: ((n.value - target) / target) * 100,
    count: n.count,
  });
  if (!best1 || !best2 || !best3 || !best4) return null;
  return { r1: sol(best1), r2: sol(best2), r3: sol(best3), r4: sol(best4) };
}

function dedupe(nodes: Node[]): Node[] {
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const n of nodes) {
    const key = n.value.toPrecision(9);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}
