/**
 * RF attenuator synthesis: PI, Tee, bridged Tee and resistive splitter.
 * Counterpart: KiCad `pcb_calculator/attenuators/attenuator_classes.cpp`.
 *
 * With L = 10^(dB/10) (power ratio) and K = 10^(dB/20) (voltage ratio):
 *   PI  : R2 = (L−1)/2 · sqrt(Zin·Zout/L)
 *         R1 = 1 / ( (L+1)/(Zin·(L−1)) − 1/R2 ),  R3 likewise with Zout
 *   Tee : R2 = 2·sqrt(L·Zin·Zout)/(L−1)   (centre shunt)
 *         R1 = Zin·(L+1)/(L−1) − R2,  R3 = Zout·(L+1)/(L−1) − R2
 *   Bridged Tee (Zin=Zout=Z): R1 = Z·(K−1),  R2 = Z/(K−1)
 *   Splitter (Zin=Zout=Z):    R1 = R2 = R3 = Z/3, attenuation fixed 6 dB
 */

export enum AttenuatorType {
  PI = 0,
  TEE = 1,
  BRIDGED_TEE = 2,
  SPLITTER = 3,
}

export interface AttenuatorInfo {
  type: AttenuatorType;
  name: string;
  /** Whether Zout is an independent input. */
  hasZout: boolean;
  /** Whether attenuation is an input (splitter is fixed). */
  hasAttenuation: boolean;
  resistorLabels: string[];
}

export const ATTENUATORS: readonly AttenuatorInfo[] = [
  {
    type: AttenuatorType.PI,
    name: 'PI',
    hasZout: true,
    hasAttenuation: true,
    resistorLabels: ['R1 (shunt, in)', 'R2 (series)', 'R3 (shunt, out)'],
  },
  {
    type: AttenuatorType.TEE,
    name: 'Tee',
    hasZout: true,
    hasAttenuation: true,
    resistorLabels: ['R1 (series, in)', 'R2 (series, out)', 'R3 (shunt)'],
  },
  {
    type: AttenuatorType.BRIDGED_TEE,
    name: 'Bridged Tee',
    hasZout: false,
    hasAttenuation: true,
    resistorLabels: ['R1 (bridge)', 'R2 (shunt)'],
  },
  {
    type: AttenuatorType.SPLITTER,
    name: 'Resistive Splitter',
    hasZout: false,
    hasAttenuation: false,
    resistorLabels: ['R1', 'R2', 'R3'],
  },
];

export interface AttenuatorResult {
  /** Resistor values, ohms, in the order of `resistorLabels`. */
  resistors: number[];
  /** Attenuation actually used (dB) — relevant for the splitter. */
  attenuationDb: number;
  /** Minimum realisable attenuation for the given Zin/Zout, dB. */
  minAttenuationDb: number;
  error?: string;
}

/** Minimum attenuation of a purely resistive matcher when Zin ≠ Zout. */
export function minAttenuationDb(zin: number, zout: number): number {
  if (zin === zout) return 0;
  const zh = Math.max(zin, zout);
  const zl = Math.min(zin, zout);
  const ratio = zh / zl;
  const lmin = 2 * ratio - 1 + 2 * Math.sqrt(ratio * (ratio - 1));
  return 10 * Math.log10(lmin);
}

export function calculateAttenuator(
  type: AttenuatorType,
  attenuationDb: number,
  zin: number,
  zout: number,
): AttenuatorResult {
  const fail = (msg: string, minDb = 0): AttenuatorResult => ({
    resistors: [],
    attenuationDb,
    minAttenuationDb: minDb,
    error: msg,
  });
  if (!(zin > 0) || !(zout > 0)) return fail('Impedances must be positive.');

  switch (type) {
    case AttenuatorType.PI: {
      const minDb = minAttenuationDb(zin, zout);
      if (!(attenuationDb > 0)) return fail('Attenuation must be positive.', minDb);
      if (attenuationDb < minDb - 1e-9)
        return fail(
          `Attenuation must be at least ${minDb.toFixed(3)} dB for this Zin/Zout.`,
          minDb,
        );
      const l = 10 ** (attenuationDb / 10);
      const r2 = ((l - 1) / 2) * Math.sqrt((zin * zout) / l);
      const r1 = 1 / ((l + 1) / (zin * (l - 1)) - 1 / r2);
      const r3 = 1 / ((l + 1) / (zout * (l - 1)) - 1 / r2);
      if (![r1, r2, r3].every((r) => Number.isFinite(r) && r > 0))
        return fail('No resistive solution for these values.', minDb);
      return { resistors: [r1, r2, r3], attenuationDb, minAttenuationDb: minDb };
    }
    case AttenuatorType.TEE: {
      const minDb = minAttenuationDb(zin, zout);
      if (!(attenuationDb > 0)) return fail('Attenuation must be positive.', minDb);
      if (attenuationDb < minDb - 1e-9)
        return fail(
          `Attenuation must be at least ${minDb.toFixed(3)} dB for this Zin/Zout.`,
          minDb,
        );
      // KiCad convention: R1 = series in, R2 = centre shunt, R3 = series out.
      const l = 10 ** (attenuationDb / 10);
      const r2 = (2 * Math.sqrt(l * zin * zout)) / (l - 1);
      const r1 = (zin * (l + 1)) / (l - 1) - r2;
      const r3 = (zout * (l + 1)) / (l - 1) - r2;
      if (![r1, r2, r3].every((r) => Number.isFinite(r) && r > 0))
        return fail('No resistive solution for these values.', minDb);
      return { resistors: [r1, r2, r3], attenuationDb, minAttenuationDb: minDb };
    }
    case AttenuatorType.BRIDGED_TEE: {
      if (!(attenuationDb > 0)) return fail('Attenuation must be positive.');
      const k = 10 ** (attenuationDb / 20);
      return {
        resistors: [zin * (k - 1), zin / (k - 1)],
        attenuationDb,
        minAttenuationDb: 0,
      };
    }
    case AttenuatorType.SPLITTER: {
      // KiCad reports the split attenuation as a flat 6.0 dB.
      const z3 = zin / 3;
      return { resistors: [z3, z3, z3], attenuationDb: 6.0, minAttenuationDb: 6.0 };
    }
  }
}
