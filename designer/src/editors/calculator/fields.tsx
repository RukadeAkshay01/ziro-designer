/**
 * Shared input/output widgets and number formatting for the calculator
 * panels — the equivalent of KiCad pcb_calculator's UNIT_SELECTOR + value
 * fields, including the per-field unit dropdowns (mm/mil/inch, Hz…GHz, Ω…MΩ)
 * that convert their value in place when you switch units.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

/** Parse a user-typed number; returns NaN for empty/invalid text. */
export const parseNum = (s: string): number => {
  const t = s.trim().replace(',', '.');
  if (t === '') return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
};

/** Format a result to a sensible precision (engineering style). */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '--';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(digits - 1);
  return Number(v.toPrecision(digits)).toString();
}

/** Unit option: label + multiplier to the base SI unit. */
export interface UnitOpt {
  label: string;
  mult: number;
}

export const LEN_UNITS: UnitOpt[] = [
  { label: 'mm', mult: 1e-3 },
  { label: 'µm', mult: 1e-6 },
  { label: 'cm', mult: 1e-2 },
  { label: 'mil', mult: 25.4e-6 },
  { label: 'inch', mult: 25.4e-3 },
  { label: 'm', mult: 1 },
];

export const FREQ_UNITS: UnitOpt[] = [
  { label: 'GHz', mult: 1e9 },
  { label: 'MHz', mult: 1e6 },
  { label: 'kHz', mult: 1e3 },
  { label: 'Hz', mult: 1 },
];

export const RES_UNITS: UnitOpt[] = [
  { label: 'Ω', mult: 1 },
  { label: 'kΩ', mult: 1e3 },
  { label: 'MΩ', mult: 1e6 },
];

export const TIME_UNITS: UnitOpt[] = [
  { label: 's', mult: 1 },
  { label: 'ms', mult: 1e-3 },
  { label: 'µs', mult: 1e-6 },
  { label: 'ns', mult: 1e-9 },
  { label: 'ps', mult: 1e-12 },
];

/** Index of a unit by label (build-time convenience for defaults). */
export const unitIndex = (units: UnitOpt[], label: string): number =>
  Math.max(
    0,
    units.findIndex((u) => u.label === label),
  );

/** One labelled row: label, input (or output), plain unit text. */
export function Field({
  label,
  value,
  onChange,
  unit,
  readOnly,
  title,
  width,
}: {
  label: ReactNode;
  value: string;
  onChange?: (v: string) => void;
  unit?: ReactNode;
  readOnly?: boolean;
  title?: string;
  width?: number;
}): JSX.Element {
  return (
    <label className="calc-field" title={title}>
      <span className="calc-field-label">{label}</span>
      <input
        className={`calc-input${readOnly ? ' ro' : ''}`}
        style={width ? { width } : undefined}
        value={value}
        readOnly={readOnly}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        spellCheck={false}
      />
      {unit != null && <span className="calc-unit">{unit}</span>}
    </label>
  );
}

/**
 * Numeric field with an integrated unit dropdown. The parent owns the value in
 * base SI units (`base`); this widget shows it in the chosen unit and reports
 * edits back through `onBase`. Switching the unit converts the shown number so
 * the physical quantity is preserved (KiCad's UNIT_SELECTOR behaviour). While
 * the input is focused, the parent's value does not overwrite what you type;
 * external changes (synthesis, linked fields) refresh it when unfocused.
 */
export function NumField({
  label,
  units,
  base,
  onBase,
  defaultUnit,
  readOnly,
  title,
  digits = 5,
}: {
  label: ReactNode;
  units: UnitOpt[];
  base: number;
  onBase?: (v: number) => void;
  /** Unit label to start on (e.g. 'µm'); defaults to the first entry. */
  defaultUnit?: string;
  readOnly?: boolean;
  title?: string;
  digits?: number;
}): JSX.Element {
  const [idx, setIdx] = useState(() => (defaultUnit ? unitIndex(units, defaultUnit) : 0));
  const mult = units[idx]?.mult ?? 1;
  const derived = Number.isFinite(base) ? fmt(base / mult, digits) : readOnly ? '--' : '';
  const [text, setText] = useState(derived);
  const focused = useRef(false);

  // Refresh the text from the parent value when it changes externally and the
  // user isn't mid-edit (read-only outputs always track the value).
  useEffect(() => {
    if (readOnly || !focused.current) setText(derived);
  }, [derived, readOnly]);

  const emit = (t: string): void => {
    setText(t);
    onBase?.(parseNum(t) * mult);
  };
  const switchUnit = (nextIdx: number): void => {
    const nextMult = units[nextIdx]?.mult ?? 1;
    const cur = parseNum(text);
    setIdx(nextIdx);
    if (Number.isFinite(cur)) setText(fmt((cur * mult) / nextMult, digits));
  };

  return (
    <label className="calc-field" title={title}>
      <span className="calc-field-label">{label}</span>
      <input
        className={`calc-input${readOnly ? ' ro' : ''}`}
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onChange={readOnly ? undefined : (e) => emit(e.target.value)}
      />
      {units.length > 1 ? (
        <select
          className="calc-select calc-unit-select"
          value={idx}
          onChange={(e) => switchUnit(Number(e.target.value))}
        >
          {units.map((u, i) => (
            <option key={u.label} value={i}>
              {u.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="calc-unit">{units[0]?.label}</span>
      )}
    </label>
  );
}

/** KiCad-style titled group box. */
export function Group({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <fieldset className={`calc-group${className ? ` ${className}` : ''}`}>
      {title != null && <legend>{title}</legend>}
      {children}
    </fieldset>
  );
}

/** A lightweight in-page modal dialog (sandbox-safe; no window.prompt/alert). */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 420,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="calc-modal-backdrop" onMouseDown={onClose}>
      <div
        className="calc-modal"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="calc-modal-head">
          <span>{title}</span>
          <button type="button" className="calc-modal-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="calc-modal-body">{children}</div>
        {footer && <div className="calc-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Copy text to the clipboard with a synchronous fallback for sandboxes. */
export function copyText(text: string): boolean {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
