/**
 * Wavelength/period conversions in vacuum and in a medium.
 * Counterpart: KiCad `pcb_calculator/calculator_panels/panel_wavelength.cpp`.
 */

const C0 = 299792458; // speed of light, m/s (exported from transline/transline.js)

export interface WavelengthState {
  frequencyHz: number;
  periodS: number;
  wavelengthVacuumM: number;
  wavelengthMediumM: number;
  /** Phase velocity in the medium, m/s. */
  speedM: number;
  epsilonR: number;
  muR: number;
}

/** Recompute everything from a frequency and the medium properties. */
export function fromFrequency(frequencyHz: number, epsilonR: number, muR: number): WavelengthState {
  const n = Math.sqrt(epsilonR * muR);
  const speedM = C0 / n;
  return {
    frequencyHz,
    periodS: 1 / frequencyHz,
    wavelengthVacuumM: C0 / frequencyHz,
    wavelengthMediumM: speedM / frequencyHz,
    speedM,
    epsilonR,
    muR,
  };
}

export const fromPeriod = (periodS: number, er: number, mur: number): WavelengthState =>
  fromFrequency(1 / periodS, er, mur);

export const fromWavelengthVacuum = (lambdaM: number, er: number, mur: number): WavelengthState =>
  fromFrequency(C0 / lambdaM, er, mur);

export const fromWavelengthMedium = (lambdaM: number, er: number, mur: number): WavelengthState =>
  fromFrequency(C0 / Math.sqrt(er * mur) / lambdaM, er, mur);
