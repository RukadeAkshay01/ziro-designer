/**
 * Annotate Schematic dialog. Counterpart: `eeschema/dialogs/dialog_annotate.cpp`
 * (DIALOG_ANNOTATE) — the same sections in the same order: Scope, Order,
 * Keep/Reset existing, Numbering, and the Clear Annotation / Annotate buttons.
 * "Recurse into subsheets" is shown but disabled until hierarchical annotation
 * across screens is wired.
 */
import { useState, type JSX } from 'react';
import type { AnnotateOptions } from '@ziroeda/eeschema';

interface Props {
  hasSelection: boolean;
  onAnnotate: (opts: AnnotateOptions) => void;
  onClear: (scope: AnnotateOptions['scope']) => void;
  onClose: () => void;
}

export function DialogAnnotate({ hasSelection, onAnnotate, onClear, onClose }: Props): JSX.Element {
  const [scope, setScope] = useState<AnnotateOptions['scope']>('all');
  const [order, setOrder] = useState<AnnotateOptions['order']>('x');
  const [reset, setReset] = useState(false);
  const [algo, setAlgo] = useState<AnnotateOptions['algo']>('incremental');
  const [startNumber, setStartNumber] = useState(0);

  const opts: AnnotateOptions = {
    scope,
    order,
    algo,
    resetExisting: reset,
    startNumber,
    sheetNumber: 1,
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-annotate-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Annotate Schematic
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-annotate-body">
          <fieldset>
            <legend>Scope</legend>
            <label>
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
              Entire schematic
            </label>
            <label>
              <input
                type="radio"
                checked={scope === 'current_sheet'}
                onChange={() => setScope('current_sheet')}
              />
              Current sheet only
            </label>
            <label className={hasSelection ? '' : 'disabled'}>
              <input
                type="radio"
                checked={scope === 'selection'}
                disabled={!hasSelection}
                onChange={() => setScope('selection')}
              />
              Selection
            </label>
            <label className="disabled">
              <input type="checkbox" disabled />
              Recurse into subsheets
            </label>
          </fieldset>

          <fieldset>
            <legend>Order</legend>
            <label>
              <input type="radio" checked={order === 'x'} onChange={() => setOrder('x')} />
              Sort symbols by X position
            </label>
            <label>
              <input type="radio" checked={order === 'y'} onChange={() => setOrder('y')} />
              Sort symbols by Y position
            </label>
          </fieldset>

          <fieldset>
            <legend>Options</legend>
            <label>
              <input type="radio" checked={!reset} onChange={() => setReset(false)} />
              Keep existing annotations
            </label>
            <label>
              <input type="radio" checked={reset} onChange={() => setReset(true)} />
              Reset existing annotations
            </label>
          </fieldset>

          <fieldset>
            <legend>Numbering</legend>
            <label>
              <input
                type="radio"
                checked={algo === 'incremental'}
                onChange={() => setAlgo('incremental')}
              />
              Use first free number after:
              <input
                type="number"
                className="ze-search start-num"
                value={startNumber}
                min={0}
                onChange={(e) => setStartNumber(Number(e.target.value) || 0)}
                onFocus={() => setAlgo('incremental')}
              />
            </label>
            <label>
              <input
                type="radio"
                checked={algo === 'sheet_100'}
                onChange={() => setAlgo('sheet_100')}
              />
              First free after sheet number × 100
            </label>
            <label>
              <input
                type="radio"
                checked={algo === 'sheet_1000'}
                onChange={() => setAlgo('sheet_1000')}
              />
              First free after sheet number × 1000
            </label>
          </fieldset>
        </div>
        <div className="ze-modal-footer">
          <button type="button" onClick={() => onClear(scope)}>
            Clear Annotation
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={() => onAnnotate(opts)}>
            Annotate
          </button>
        </div>
      </div>
    </div>
  );
}
