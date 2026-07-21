/**
 * The Layers manager panel — GerbView's GERBER_LAYER_WIDGET
 * (`gerbview/widgets/layer_widget.cpp` + `gerbview/widgets/gbr_layer_box_selector`).
 * It lists every loaded layer with a visibility toggle, a colour swatch (click
 * to recolour), the layer/file name, and an active-layer radio (the active
 * layer is drawn on top and receives DCode selection). Below the list is the
 * "Items" section mirroring GerbView's render tab: grid, DCode numbers,
 * negative objects, worksheet and background visibility toggles.
 */

import { useRef, type JSX } from 'react';

export interface LayerInfo {
  index: number;
  name: string;
  color: string;
  visible: boolean;
  hasContent: boolean;
  function?: string;
}

export function LayerManager({
  layers,
  activeLayer,
  onSetActive,
  onToggleVisible,
  onSetColor,
  onShowAll,
  onHideAll,
  onDelete,
  onMoveUp,
  onMoveDown,
  renderToggles,
  onRenderToggle,
}: {
  layers: LayerInfo[];
  activeLayer: number;
  onSetActive: (index: number) => void;
  onToggleVisible: (index: number) => void;
  onSetColor: (index: number, color: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onDelete: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  renderToggles: Record<string, boolean>;
  onRenderToggle: (id: string) => void;
}): JSX.Element {
  const colorInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const renderRows: { id: string; label: string }[] = [
    { id: 'grid', label: 'Grid' },
    { id: 'dcodes', label: 'DCodes' },
    { id: 'negativeObjects', label: 'Negative objects' },
    { id: 'background', label: 'Show background' },
  ];

  return (
    <div className="ze-gbr-layers">
      <div className="ze-gbr-layers-head">
        <span>Layers</span>
        <span className="ze-gbr-layers-actions">
          <button title="Show all layers" onClick={onShowAll}>
            👁
          </button>
          <button title="Hide all layers" onClick={onHideAll}>
            🚫
          </button>
        </span>
      </div>

      <div className="ze-gbr-layer-list">
        {layers.length === 0 && <div className="ze-gbr-empty">No layers loaded</div>}
        {layers.map((layer) => (
          <div
            key={layer.index}
            className={`ze-gbr-layer-row${layer.index === activeLayer ? ' active' : ''}`}
            onClick={() => onSetActive(layer.index)}
            title={layer.function ? `${layer.name} — ${layer.function}` : layer.name}
          >
            <input
              type="radio"
              className="ze-gbr-active"
              checked={layer.index === activeLayer}
              onChange={() => onSetActive(layer.index)}
              title="Active layer (drawn on top)"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="ze-gbr-vis"
              title={layer.visible ? 'Hide layer' : 'Show layer'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible(layer.index);
              }}
            >
              {layer.visible ? '👁' : '·'}
            </button>
            <button
              className="ze-gbr-swatch"
              style={{ background: layer.color }}
              title="Change layer colour"
              onClick={(e) => {
                e.stopPropagation();
                colorInputs.current[layer.index]?.click();
              }}
            >
              <input
                ref={(el) => {
                  colorInputs.current[layer.index] = el;
                }}
                type="color"
                value={layer.color}
                onChange={(e) => onSetColor(layer.index, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}
              />
            </button>
            <span className="ze-gbr-name">{layer.name}</span>
            <span className="ze-gbr-row-tools">
              <button
                title="Move layer up"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp(layer.index);
                }}
              >
                ▲
              </button>
              <button
                title="Move layer down"
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown(layer.index);
                }}
              >
                ▼
              </button>
              <button
                title="Delete layer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(layer.index);
                }}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="ze-gbr-layers-head">Items</div>
      <div className="ze-gbr-render-list">
        {renderRows.map((r) => (
          <label key={r.id} className="ze-gbr-render-row">
            <input
              type="checkbox"
              checked={renderToggles[r.id] ?? false}
              onChange={() => onRenderToggle(r.id)}
            />
            {r.label}
          </label>
        ))}
      </div>
    </div>
  );
}
