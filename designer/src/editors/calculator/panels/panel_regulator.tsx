/**
 * "Regulators" panel — adjustable-regulator divider with min/typ/max
 * worst-case analysis. Counterpart: KiCad `calculator_panels/panel_regulator.cpp`.
 *
 * The regulator library plays the role of KiCad's regulators data file: it
 * lives in the browser and can be imported/exported ("Browse" / "Export") as
 * JSON. Add/Edit use an in-page dialog (no blocked window.prompt), so every
 * button works in a sandboxed frame too.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  BUILTIN_REGULATORS,
  type RegulatorData,
  RegulatorSolve,
  RegulatorType,
  solveRegulator,
} from '@ziroeda/pcb_calculator';
import { Field, Group, Modal, copyText, fmt, parseNum } from '../fields.js';

const STORAGE_KEY = 'ziro.calculator.regulators';

interface Stored {
  regulators: RegulatorData[];
  selected: string;
}

const DEFAULT_REG = BUILTIN_REGULATORS[0]!;

function loadRegulators(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      if (Array.isArray(s.regulators) && s.regulators.length) return s;
    }
  } catch {
    /* fresh defaults */
  }
  return { regulators: [...BUILTIN_REGULATORS], selected: DEFAULT_REG.name };
}

function saveRegulators(s: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/** Divider schematic like the KiCad panel drawing. */
function RegulatorDrawing({ type }: { type: RegulatorType }): JSX.Element {
  const three = type === RegulatorType.THREE_TERMINAL;
  return (
    <svg className="calc-svg" width="300" height="240" viewBox="0 0 300 240">
      <g stroke="#4a86c5" fill="none" strokeWidth="1.5">
        <rect x="70" y="30" width="120" height="80" />
        <circle cx="20" cy="40" r="4" />
        <line x1="24" y1="40" x2="70" y2="40" />
        <line x1="190" y1="40" x2="250" y2="40" />
        <circle cx="254" cy="40" r="4" />
        <line x1="130" y1="110" x2="130" y2="130" />
        <line x1="130" y1="130" x2="215" y2="130" />
        <line x1="215" y1="40" x2="215" y2="55" />
        <path d="M215 55 l6 5 l-12 8 l12 8 l-12 8 l12 8 l-6 5" />
        <line x1="215" y1="97" x2="215" y2="155" />
        <path d="M215 155 l6 5 l-12 8 l12 8 l-12 8 l12 8 l-6 5" />
        <line x1="215" y1="197" x2="215" y2="210" />
        <line x1="200" y1="210" x2="230" y2="210" />
        <line x1="206" y1="215" x2="224" y2="215" />
        <line x1="212" y1="220" x2="218" y2="220" />
      </g>
      <g fill="#e6e6e6" fontSize="13" fontFamily="system-ui">
        <text x="80" y="52">
          Vin
        </text>
        <text x="150" y="52">
          Vout
        </text>
        <text x="112" y="102">
          {three ? 'ADJ' : 'FB'}
        </text>
        <text x="232" y="80">
          R1
        </text>
        <text x="232" y="180">
          R2
        </text>
      </g>
    </svg>
  );
}

/** Editable form state for the Add/Edit dialog (strings, µA for Iadj). */
interface RegForm {
  original: string | null; // name being edited, or null when adding
  name: string;
  type: RegulatorType;
  vrefMin: string;
  vrefTyp: string;
  vrefMax: string;
  iadjTyp: string;
  iadjMax: string;
}

const formFrom = (r: RegulatorData | null): RegForm => ({
  original: r?.name ?? null,
  name: r?.name ?? '',
  type: r?.type ?? RegulatorType.THREE_TERMINAL,
  vrefMin: String(r?.vrefMin ?? 1.2),
  vrefTyp: String(r?.vrefTyp ?? 1.25),
  vrefMax: String(r?.vrefMax ?? 1.3),
  iadjTyp: String((r?.iadjTyp ?? 50e-6) * 1e6),
  iadjMax: String((r?.iadjMax ?? 100e-6) * 1e6),
});

export function PanelRegulator(): JSX.Element {
  const [store, setStore] = useState<Stored>(loadRegulators);
  const [type, setType] = useState<RegulatorType>(RegulatorType.THREE_TERMINAL);
  const [solve, setSolve] = useState<RegulatorSolve>(RegulatorSolve.R1);
  const [r1, setR1] = useState('0.240'); // kΩ
  const [r2, setR2] = useState('0.720'); // kΩ
  const [vout, setVout] = useState('5');
  const [vrefMin, setVrefMin] = useState('1.20');
  const [vrefTyp, setVrefTyp] = useState('1.25');
  const [vrefMax, setVrefMax] = useState('1.30');
  const [iadjTyp, setIadjTyp] = useState('50'); // µA
  const [iadjMax, setIadjMax] = useState('100');
  const [resTol, setResTol] = useState('1');
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<ReturnType<typeof solveRegulator> | null>(null);

  // Dialog / feedback state (in-page, sandbox-safe).
  const [form, setForm] = useState<RegForm | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => saveRegulators(store), [store]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const current = store.regulators.find((r) => r.name === store.selected) ?? null;

  const applyRegulator = (reg: RegulatorData): void => {
    setType(reg.type);
    setVrefMin(String(reg.vrefMin));
    setVrefTyp(String(reg.vrefTyp));
    setVrefMax(String(reg.vrefMax));
    setIadjTyp(String(reg.iadjTyp * 1e6));
    setIadjMax(String(reg.iadjMax * 1e6));
    setResult(null);
  };

  const calculate = (): void => {
    setResult(
      solveRegulator({
        type,
        solve,
        r1Typ: parseNum(r1) * 1000,
        r2Typ: parseNum(r2) * 1000,
        voutTyp: parseNum(vout),
        vrefMin: parseNum(vrefMin),
        vrefTyp: parseNum(vrefTyp),
        vrefMax: parseNum(vrefMax),
        iadjTyp: parseNum(iadjTyp) * 1e-6,
        iadjMax: parseNum(iadjMax) * 1e-6,
        resTolPct: parseNum(resTol),
      }),
    );
  };

  const rows = useMemo(() => {
    const r = result;
    const kk = (v: number): string => fmt(v / 1000);
    return {
      r1: {
        min: r ? kk(r.r1.min) : '',
        typ: solve === RegulatorSolve.R1 && r ? kk(r.r1.typ) : r1,
        max: r ? kk(r.r1.max) : '',
      },
      r2: {
        min: r ? kk(r.r2.min) : '',
        typ: solve === RegulatorSolve.R2 && r ? kk(r.r2.typ) : r2,
        max: r ? kk(r.r2.max) : '',
      },
      vout: {
        min: r ? fmt(r.vout.min) : '',
        typ: solve === RegulatorSolve.VOUT && r ? fmt(r.vout.typ) : vout,
        max: r ? fmt(r.vout.max) : '',
      },
    };
  }, [result, solve, r1, r2, vout]);

  const saveForm = (): void => {
    if (!form?.name.trim()) {
      setToast('Enter a regulator name.');
      return;
    }
    const reg: RegulatorData = {
      name: form.name.trim(),
      type: form.type,
      vrefMin: parseNum(form.vrefMin),
      vrefTyp: parseNum(form.vrefTyp),
      vrefMax: parseNum(form.vrefMax),
      iadjTyp: parseNum(form.iadjTyp) * 1e-6,
      iadjMax: parseNum(form.iadjMax) * 1e-6,
    };
    setStore((s) => {
      const rest = s.regulators.filter((r) => r.name !== (form.original ?? reg.name));
      return {
        regulators: [...rest, reg].sort((a, b) => a.name.localeCompare(b.name)),
        selected: reg.name,
      };
    });
    applyRegulator(reg);
    setForm(null);
    setToast(form.original ? `Updated '${reg.name}'.` : `Added '${reg.name}'.`);
  };

  const removeRegulator = (): void => {
    if (!confirmRemove) return;
    setStore((s) => {
      const rest = s.regulators.filter((r) => r.name !== confirmRemove);
      return { regulators: rest, selected: rest[0]?.name ?? '' };
    });
    setToast(`Removed '${confirmRemove}'.`);
    setConfirmRemove(null);
  };

  const resetDefaults = (): void => {
    setStore({ regulators: [...BUILTIN_REGULATORS], selected: DEFAULT_REG.name });
    applyRegulator(DEFAULT_REG);
    setR1('0.240');
    setR2('0.720');
    setVout('5');
    setResTol('1');
    setSolve(RegulatorSolve.R1);
    setComment('');
    setToast('Reset to defaults.');
  };

  const copyComment = (): void => {
    const r = result;
    const text =
      comment ||
      (r && !r.error
        ? `Vout = ${fmt(r.vout.typ)} V (${fmt(r.tolNegPct, 3)}% … +${fmt(
            r.tolPosPct,
            3,
          )}%), R1 = ${fmt(r.r1.typ)} Ω, R2 = ${fmt(r.r2.typ)} Ω`
        : '');
    if (!text) {
      setToast('Nothing to copy yet — press Calculate first.');
      return;
    }
    setToast(copyText(text) ? 'Copied to clipboard.' : 'Copy failed.');
  };

  const exportData = (): void => {
    const blob = new Blob([JSON.stringify(store.regulators, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'regulators.json';
    a.click();
    URL.revokeObjectURL(url);
    setToast('Exported regulators.json.');
  };

  const importData = (file: File): void => {
    void file.text().then((txt) => {
      try {
        const parsed = JSON.parse(txt) as RegulatorData[];
        if (!Array.isArray(parsed) || !parsed.length) throw new Error('empty');
        const clean = parsed.filter(
          (r) => typeof r.name === 'string' && Number.isFinite(r.vrefTyp),
        );
        if (!clean.length) throw new Error('no valid entries');
        setStore({ regulators: clean, selected: clean[0]!.name });
        applyRegulator(clean[0]!);
        setToast(`Loaded ${clean.length} regulator(s).`);
      } catch {
        setToast('Could not read that file (expected a regulators JSON array).');
      }
    });
  };

  const radioRow = (
    id: RegulatorSolve,
    label: string,
    row: { min: string; typ: string; max: string },
    setTyp: (v: string) => void,
    unit: string,
  ): JSX.Element => (
    <div className="reg-mtm-row">
      <label className="calc-radio">
        <input
          type="radio"
          name="reg-solve"
          checked={solve === id}
          onChange={() => {
            setSolve(id);
            setResult(null);
          }}
        />
        {label}
      </label>
      <input className="calc-input ro" readOnly value={row.min} />
      <input
        className={`calc-input${solve === id ? ' ro' : ''}`}
        value={row.typ}
        readOnly={solve === id && result != null}
        onChange={(e) => {
          setTyp(e.target.value);
          setResult(null);
        }}
      />
      <input className="calc-input ro" readOnly value={row.max} />
      <span className="calc-unit">{unit}</span>
    </div>
  );

  const formField = (label: string, key: keyof RegForm, unit: string): JSX.Element => (
    <Field
      label={label}
      value={String(form?.[key] ?? '')}
      onChange={(v) => setForm((f) => (f ? { ...f, [key]: v } : f))}
      unit={unit}
      width={90}
    />
  );

  return (
    <div>
      <div className="calc-row">
        <div className="calc-col" style={{ maxWidth: 340 }}>
          <label className="calc-field">
            <span className="calc-field-label">Type:</span>
            <select
              className="calc-select"
              value={type}
              onChange={(e) => {
                setType(Number(e.target.value) as RegulatorType);
                setResult(null);
              }}
            >
              <option value={RegulatorType.THREE_TERMINAL}>3 Terminal Type</option>
              <option value={RegulatorType.STANDARD}>Standard Type</option>
            </select>
          </label>
          <RegulatorDrawing type={type} />
          <Group title="Formula">
            <div className="calc-formula">
              {type === RegulatorType.THREE_TERMINAL
                ? 'Vout = Vref * (R1 + R2) / R1 + Iadj * R2'
                : 'Vout = Vref * (R1 + R2) / R2'}
            </div>
          </Group>
        </div>

        <div className="calc-col" style={{ flex: 1 }}>
          <Group title="Regulator">
            <div className="calc-field">
              <select
                className="calc-select"
                style={{ flex: 1 }}
                value={store.selected}
                onChange={(e) => {
                  const reg = store.regulators.find((r) => r.name === e.target.value);
                  setStore((s) => ({ ...s, selected: e.target.value }));
                  if (reg) applyRegulator(reg);
                }}
              >
                <option value="" />
                {store.regulators.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="calc-field">
              <span className="calc-field-label">Regulators data file:</span>
              <button type="button" className="calc-btn" onClick={() => fileRef.current?.click()}>
                Browse…
              </button>
              <button type="button" className="calc-btn" onClick={exportData}>
                Export…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importData(f);
                  e.target.value = '';
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="calc-btn"
                disabled={!current}
                onClick={() => setForm(formFrom(current))}
              >
                Edit Regulator
              </button>
              <button type="button" className="calc-btn" onClick={() => setForm(formFrom(null))}>
                Add Regulator
              </button>
              <button
                type="button"
                className="calc-btn"
                disabled={!current}
                onClick={() => setConfirmRemove(current?.name ?? null)}
              >
                Remove Regulator
              </button>
            </div>
          </Group>

          <div className="reg-mtm-header">
            <span />
            <span>min</span>
            <span>typ</span>
            <span>max</span>
            <span />
          </div>
          {radioRow(RegulatorSolve.R1, 'R1:', rows.r1, setR1, 'kΩ')}
          {radioRow(RegulatorSolve.R2, 'R2:', rows.r2, setR2, 'kΩ')}
          {radioRow(RegulatorSolve.VOUT, 'Vout:', rows.vout, setVout, 'V')}

          <div className="reg-mtm-row">
            <span style={{ textAlign: 'right' }}>Vref:</span>
            <input
              className="calc-input"
              value={vrefMin}
              onChange={(e) => {
                setVrefMin(e.target.value);
                setResult(null);
              }}
            />
            <input
              className="calc-input"
              value={vrefTyp}
              onChange={(e) => {
                setVrefTyp(e.target.value);
                setResult(null);
              }}
            />
            <input
              className="calc-input"
              value={vrefMax}
              onChange={(e) => {
                setVrefMax(e.target.value);
                setResult(null);
              }}
            />
            <span className="calc-unit">V</span>
          </div>
          {type === RegulatorType.THREE_TERMINAL && (
            <div className="reg-mtm-row">
              <span style={{ textAlign: 'right' }}>Iadj:</span>
              <span />
              <input
                className="calc-input"
                value={iadjTyp}
                onChange={(e) => {
                  setIadjTyp(e.target.value);
                  setResult(null);
                }}
              />
              <input
                className="calc-input"
                value={iadjMax}
                onChange={(e) => {
                  setIadjMax(e.target.value);
                  setResult(null);
                }}
              />
              <span className="calc-unit">µA</span>
            </div>
          )}
          <div className="reg-mtm-row">
            <span style={{ textAlign: 'right' }}>Overall tolerance:</span>
            <input
              className="calc-input ro"
              readOnly
              value={result && !result.error ? fmt(result.tolNegPct, 3) : ''}
            />
            <span />
            <input
              className="calc-input ro"
              readOnly
              value={result && !result.error ? `+${fmt(result.tolPosPct, 3)}` : ''}
            />
            <span className="calc-unit">%</span>
          </div>

          <Field
            label="Resistor tolerance:"
            value={resTol}
            onChange={(v) => {
              setResTol(v);
              setResult(null);
            }}
            unit="%"
            width={70}
          />
          <div className="calc-field">
            <span className="calc-field-label">Power Comment:</span>
            <input
              className="calc-input"
              style={{ flex: 1 }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button type="button" className="calc-btn" onClick={copyComment}>
              Copy to Clipboard
            </button>
          </div>

          {result?.error && <div className="calc-error">{result.error}</div>}

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center' }}>
            <button type="button" className="calc-btn primary" onClick={calculate}>
              Calculate
            </button>
            {toast && <span className="calc-toast">{toast}</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="calc-btn" onClick={resetDefaults}>
          Reset to Defaults
        </button>
      </div>

      {form && (
        <Modal
          title={form.original ? `Edit Regulator — ${form.original}` : 'Add Regulator'}
          onClose={() => setForm(null)}
          footer={
            <>
              <button type="button" className="calc-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="button" className="calc-btn primary" onClick={saveForm}>
                Save
              </button>
            </>
          }
        >
          <Field
            label="Name:"
            value={form.name}
            onChange={(v) => setForm((f) => (f ? { ...f, name: v } : f))}
            width={160}
          />
          <label className="calc-field">
            <span className="calc-field-label">Type:</span>
            <select
              className="calc-select"
              value={form.type}
              onChange={(e) =>
                setForm((f) => (f ? { ...f, type: Number(e.target.value) as RegulatorType } : f))
              }
            >
              <option value={RegulatorType.THREE_TERMINAL}>3 Terminal (uses Iadj)</option>
              <option value={RegulatorType.STANDARD}>Standard</option>
            </select>
          </label>
          {formField('Vref min:', 'vrefMin', 'V')}
          {formField('Vref typ:', 'vrefTyp', 'V')}
          {formField('Vref max:', 'vrefMax', 'V')}
          {form.type === RegulatorType.THREE_TERMINAL && (
            <>
              {formField('Iadj typ:', 'iadjTyp', 'µA')}
              {formField('Iadj max:', 'iadjMax', 'µA')}
            </>
          )}
        </Modal>
      )}

      {confirmRemove && (
        <Modal
          title="Remove Regulator"
          onClose={() => setConfirmRemove(null)}
          footer={
            <>
              <button type="button" className="calc-btn" onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
              <button type="button" className="calc-btn primary" onClick={removeRegulator}>
                Remove
              </button>
            </>
          }
        >
          Remove regulator &lsquo;{confirmRemove}&rsquo; from the library?
        </Modal>
      )}
    </div>
  );
}
