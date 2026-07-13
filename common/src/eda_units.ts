/**
 * Coordinate units.
 *
 * Grounded in KiCad: schematic internal units (IU) are integers of 100 nm, i.e.
 * `SCH_IU_PER_MM = 1e4` (see KiCad `include/base_units.h`). Files store millimetres
 * as decimals (`161.29`); KiCad converts on load with `round(mm * 10000)` and works
 * in integer IU thereafter (`VECTOR2I`).
 *
 * ZiroEDA mirrors this exactly. We deliberately do NOT keep coordinates as floating
 * point millimetres: integer IU is what makes grid snapping, hit-testing, and point
 * equality exact and drift-free. Floats here would be the shortcut that breaks
 * connectivity later.
 */

/** Schematic internal units per millimetre. 1 IU = 100 nm. */
export const SCH_IU_PER_MM = 1e4;

/** Convert a millimetre value (as found in a file) to integer internal units. */
export function mmToIU(mm: number): number {
  // Matches KiCad's KiROUND: round half away from zero.
  return mm < 0 ? Math.ceil(mm * SCH_IU_PER_MM - 0.5) : Math.floor(mm * SCH_IU_PER_MM + 0.5);
}

/** Convert integer internal units back to millimetres. */
export function iuToMM(iu: number): number {
  return iu / SCH_IU_PER_MM;
}
