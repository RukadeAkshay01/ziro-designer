/**
 * EDA_ANGLE — a faithful TypeScript port of KiCad's angle class
 * (libs/kimath/include/geometry/eda_angle.h). Angles are stored internally in
 * degrees. This is the first file of the file-by-file KiCad port; see the
 * `kicad-faithful-port` note.
 *
 * C++ uses operator overloading (a + b, a == b, -a); TypeScript has none, so
 * those become methods: add / sub / negate / multiply / divide / equals / lt /
 * gt / le / ge. Everything else keeps KiCad's names and semantics exactly.
 */

export enum EDA_ANGLE_T {
  TENTHS_OF_A_DEGREE_T,
  DEGREES_T,
  RADIANS_T,
}

const DEGREES_TO_RADIANS = Math.PI / 180.0;

export class EDA_ANGLE {
  /** Internal value, always in degrees (KiCad m_value). */
  private m_value: number;

  /** `EDA_ANGLE( value, type )` — type defaults to degrees (KiCad's explicit
   *  double ctor). */
  constructor(value = 0, angleType: EDA_ANGLE_T = EDA_ANGLE_T.DEGREES_T) {
    switch (angleType) {
      case EDA_ANGLE_T.RADIANS_T:
        this.m_value = value / DEGREES_TO_RADIANS;
        break;
      case EDA_ANGLE_T.TENTHS_OF_A_DEGREE_T:
        this.m_value = value / 10.0;
        break;
      default:
        this.m_value = value;
        break;
    }
  }

  /** `EDA_ANGLE( const VECTOR2D& )` — the angle of a vector, cardinal-exact. */
  static fromVector(v: { x: number; y: number }): EDA_ANGLE {
    if (v.x === 0 && v.y === 0) return new EDA_ANGLE(0);
    if (v.y === 0) return new EDA_ANGLE(v.x < 0 ? -180.0 : 0.0);
    if (v.x === 0) return new EDA_ANGLE(v.y > 0 ? 90.0 : -90.0);
    if (v.x === v.y) return new EDA_ANGLE(v.x < 0 ? -180.0 + 45.0 : 45.0);
    if (v.x === -v.y) return new EDA_ANGLE(v.x < 0 ? 180.0 - 45.0 : -45.0);
    return new EDA_ANGLE(Math.atan2(v.y, v.x), EDA_ANGLE_T.RADIANS_T);
  }

  AsDegrees(): number {
    return this.m_value;
  }
  AsTenthsOfADegree(): number {
    return Math.round(this.m_value * 10.0);
  }
  AsRadians(): number {
    return this.m_value * DEGREES_TO_RADIANS;
  }

  IsZero(): boolean {
    return this.m_value === 0.0;
  }
  IsHorizontal(): boolean {
    return this.m_value === 0.0 || this.m_value === 180.0;
  }
  IsVertical(): boolean {
    return this.m_value === 90.0 || this.m_value === 270.0;
  }
  IsCardinal90(): boolean {
    const n = this.Normalized().AsDegrees();
    return n === 0.0 || n === 90.0 || n === 180.0 || n === 270.0;
  }

  Sin(): number {
    const v = this.Normalized().AsDegrees();
    if (v === 0.0 || v === 180.0) return 0.0;
    if (v === 45.0 || v === 135.0) return Math.SQRT1_2;
    if (v === 225.0 || v === 315.0) return -Math.SQRT1_2;
    if (v === 90.0) return 1.0;
    if (v === 270.0) return -1.0;
    return Math.sin(this.AsRadians());
  }

  Cos(): number {
    const v = this.Normalized().AsDegrees();
    if (v === 0.0) return 1.0;
    if (v === 180.0) return -1.0;
    if (v === 90.0 || v === 270.0) return 0.0;
    if (v === 45.0 || v === 315.0) return Math.SQRT1_2;
    if (v === 135.0 || v === 225.0) return -Math.SQRT1_2;
    return Math.cos(this.AsRadians());
  }

  Tan(): number {
    return Math.tan(this.AsRadians());
  }

  static Arccos(x: number): EDA_ANGLE {
    return new EDA_ANGLE(Math.acos(x), EDA_ANGLE_T.RADIANS_T);
  }
  static Arcsin(x: number): EDA_ANGLE {
    return new EDA_ANGLE(Math.asin(x), EDA_ANGLE_T.RADIANS_T);
  }
  static Arctan(x: number): EDA_ANGLE {
    return new EDA_ANGLE(Math.atan(x), EDA_ANGLE_T.RADIANS_T);
  }
  static Arctan2(y: number, x: number): EDA_ANGLE {
    return new EDA_ANGLE(Math.atan2(y, x), EDA_ANGLE_T.RADIANS_T);
  }

  Invert(): EDA_ANGLE {
    return new EDA_ANGLE(-this.m_value);
  }

  // ---- in-place normalizers (KiCad mutates and returns *this) ---------------
  Normalize(): EDA_ANGLE {
    while (this.m_value < -0.0) this.m_value += 360.0;
    while (this.m_value >= 360.0) this.m_value -= 360.0;
    return this;
  }
  NormalizeNegative(): EDA_ANGLE {
    while (this.m_value <= -360.0) this.m_value += 360.0;
    while (this.m_value > 0.0) this.m_value -= 360.0;
    return this;
  }
  Normalize90(): EDA_ANGLE {
    while (this.m_value < -90.0) this.m_value += 180.0;
    while (this.m_value > 90.0) this.m_value -= 180.0;
    return this;
  }
  Normalize180(): EDA_ANGLE {
    while (this.m_value <= -180.0) this.m_value += 360.0;
    while (this.m_value > 180.0) this.m_value -= 360.0;
    return this;
  }
  Normalize720(): EDA_ANGLE {
    while (this.m_value < -360.0) this.m_value += 360.0;
    while (this.m_value >= 360.0) this.m_value -= 360.0;
    return this;
  }
  /** Non-mutating Normalize (KiCad Normalized()). */
  Normalized(): EDA_ANGLE {
    return this.Clone().Normalize();
  }

  Clone(): EDA_ANGLE {
    return new EDA_ANGLE(this.m_value);
  }

  // ---- operator replacements ------------------------------------------------
  /** a += b  →  a.add(b) returns a new angle (a + b). */
  add(o: EDA_ANGLE): EDA_ANGLE {
    return new EDA_ANGLE(this.m_value + o.m_value);
  }
  sub(o: EDA_ANGLE): EDA_ANGLE {
    return new EDA_ANGLE(this.m_value - o.m_value);
  }
  negate(): EDA_ANGLE {
    return new EDA_ANGLE(-this.m_value);
  }
  multiply(k: number): EDA_ANGLE {
    return new EDA_ANGLE(this.m_value * k);
  }
  divide(k: number): EDA_ANGLE {
    return new EDA_ANGLE(this.m_value / k);
  }

  equals(o: EDA_ANGLE): boolean {
    return this.m_value === o.m_value;
  }
  lt(o: EDA_ANGLE): boolean {
    return this.m_value < o.m_value;
  }
  gt(o: EDA_ANGLE): boolean {
    return this.m_value > o.m_value;
  }
  le(o: EDA_ANGLE): boolean {
    return this.m_value <= o.m_value;
  }
  ge(o: EDA_ANGLE): boolean {
    return this.m_value >= o.m_value;
  }
}

// Global angle constants (eda_angle.h).
export const ANGLE_0 = new EDA_ANGLE(0);
export const ANGLE_45 = new EDA_ANGLE(45);
export const ANGLE_90 = new EDA_ANGLE(90);
export const ANGLE_180 = new EDA_ANGLE(180);
export const ANGLE_270 = new EDA_ANGLE(270);
export const ANGLE_360 = new EDA_ANGLE(360);
