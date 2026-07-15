/**
 * IEC 60664-1:2020 insulation-coordination calculator: clearance, creepage,
 * minimum groove width and rated impulse withstand voltage.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/iec60664.cpp`.
 *
 * The lookup tables live in `iec60664_tables.ts` (mechanically extracted from
 * the KiCad source so the values are identical); this module reproduces the
 * KiCad compute flow that consumes them. Voltage units follow KiCad: transient
 * and peak in kV, RMS in V, altitude in m; all distances out in mm.
 */

import {
  IEC_ALTITUDE,
  IEC_CREEPAGE,
  IEC_PEAKS,
  IEC_RATED_IMPULSE,
  IEC_TRANSIENT,
  type IecRow,
} from './iec60664_tables.js';

export type PollutionDegree = 1 | 2 | 3 | 4;
export type OvervoltageCategory = 1 | 2 | 3 | 4;
export type MaterialGroup = 'I' | 'II' | 'IIIa' | 'IIIb';
export type InsulationType = 'functional' | 'basic' | 'reinforced';
export type Field = 'inhomogeneous' | 'homogeneous';

export interface Iec60664Params {
  /** Rated (system) voltage, V — for the rated impulse withstand lookup. */
  ratedVoltageV: number;
  overvoltageCategory: OvervoltageCategory;
  pollutionDegree: PollutionDegree;
  materialGroup: MaterialGroup;
  insulationType: InsulationType;
  field: Field;
  /** Printed-board material (allows the tighter PCB creepage table). */
  pcbMaterial: boolean;
  altitudeM: number;
  /** Working RMS voltage, V (creepage). */
  rmsVoltageV: number;
  /** Peak working voltage, kV (clearance). */
  peakVoltageKv: number;
  /** Transient overvoltage, kV (clearance). */
  transientVoltageKv: number;
}

export interface Iec60664Result {
  /** Clearance distance, mm (−1 = out of range). */
  clearanceMm: number;
  /** Creepage distance, mm. */
  creepageMm: number;
  /** Minimum groove/trench width, mm (−1 = N/A). */
  grooveWidthMm: number;
}

/** First row (in source order) whose guards pass and value ≥ threshold. */
function lookup(rows: readonly IecRow[], v: number, pass: (r: IecRow) => boolean): number {
  for (const r of rows) {
    if (!pass(r)) continue;
    if (v <= r.thr) return r.div ? v / r.div : (r.val ?? -1);
  }
  return -1;
}

/** Rated impulse withstand voltage (V) — IEC 60664-1 Table F.1. */
export function ratedImpulseWithstandVoltageV(
  ratedVoltageV: number,
  ov: OvervoltageCategory,
): number {
  return lookup(IEC_RATED_IMPULSE, ratedVoltageV, (r) => r.ov === ov);
}

function altitudeCorrection(altitudeM: number): number {
  return lookup(IEC_ALTITUDE, altitudeM, () => true);
}

/** Clearance to withstand the transient overvoltage (kV) — Table F.2. */
function clearanceForTransient(vKv: number, pd: PollutionDegree, field: Field): number {
  return lookup(IEC_TRANSIENT, vKv, (r) => {
    if (r.field !== field) return false;
    if (r.pd4 != null) return pd >= 4;
    if (r.pdLe != null) return pd <= r.pdLe;
    return true;
  });
}

/** Clearance to withstand recurring peak voltage (kV) — Table F.8. */
function clearanceForPeaks(vKv: number, field: Field): number {
  return lookup(IEC_PEAKS, vKv, (r) => r.field === field);
}

/** Basic creepage distance (mm) — Table F.5. */
function basicCreepage(
  rmsVoltageV: number,
  pd: PollutionDegree,
  mg: MaterialGroup,
  pcbMaterial: boolean,
): number {
  // PCB-material eligibility (KiCad: only for lower voltage / cleaner env).
  let isPcb = pcbMaterial;
  if (rmsVoltageV > 1000) isPcb = false;
  if (pd >= 3) isPcb = false;
  if (pd >= 2 && mg === 'IIIb') isPcb = false;

  return lookup(IEC_CREEPAGE, rmsVoltageV, (r) => {
    if (r.pcb && !isPcb) return false;
    if (r.pdEq != null && r.pdEq !== pd) return false;
    if (r.mg && !r.mg.includes(mg)) return false;
    return true;
  });
}

function computeClearance(p: Iec60664Params): number {
  let transient = p.transientVoltageKv;
  if (p.insulationType === 'reinforced') {
    // Preferred-series step-up for reinforced insulation (IEC 60664-1 §5.2.5).
    const table: Record<string, number> = {
      '0.33': 0.5,
      '0.5': 0.8,
      '0.8': 1.5,
      '1.5': 2.5,
      '2.5': 4,
      '4': 6,
      '6': 8,
      '8': 12,
    };
    const key = String(transient);
    transient = key in table ? table[key]! : transient * 1.6;
  }

  const c1 = clearanceForTransient(transient, p.pollutionDegree, p.field);
  const peak = p.insulationType === 'reinforced' ? p.peakVoltageKv * 1.6 : p.peakVoltageKv;
  const c2 = clearanceForPeaks(peak, p.field);

  if (c1 === -1 || c2 === -1) return -1;
  return Math.max(c1, c2) * altitudeCorrection(p.altitudeM);
}

function computeCreepage(p: Iec60664Params): number {
  let creepage = basicCreepage(p.rmsVoltageV, p.pollutionDegree, p.materialGroup, p.pcbMaterial);
  if (creepage !== -1 && p.insulationType === 'reinforced') creepage *= 2;
  return creepage;
}

/** Minimum groove/trench width — IEC 60664-1 §6.8. */
function grooveWidth(pd: PollutionDegree, distIso: number): number {
  if (distIso <= 0) return -1;
  if (Math.abs(distIso) < 3) return distIso / 3;
  if (pd === 1) return 0.25;
  if (pd === 2) return 1.0;
  if (pd === 3) return 1.5;
  return -1;
}

export function iec60664(p: Iec60664Params): Iec60664Result {
  const clearanceMm = computeClearance(p);
  let creepageMm = computeCreepage(p);
  // Creepage can never be smaller than the clearance.
  if (creepageMm < clearanceMm || clearanceMm <= 0) creepageMm = clearanceMm;
  const grooveWidthMm = grooveWidth(p.pollutionDegree, clearanceMm);
  return { clearanceMm, creepageMm, grooveWidthMm };
}
