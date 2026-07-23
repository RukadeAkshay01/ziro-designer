/**
 * Net Chains panel. Counterpart:
 * `eeschema/dialogs/panel_setup_net_chains_base.cpp` (PANEL_SETUP_NET_CHAINS) — a
 * notebook with two tabs:
 *   Chains            : a grid (Name / Members / Net Chain Class / Net Class /
 *                       Colour) over a "Member Nets" list for the selected chain,
 *                       with a delete button.
 *   Net Chain Classes : a Class Name / Members grid with add / rename / delete.
 * Net chains group nets so DRC rules can target them via inNetChainClass('name').
 */

import { useState, type JSX } from 'react';
import { Icon } from '../../../../ui/icons.js';
import type { NetChain, NetChainClass, NetChainsData } from '../../schematic_settings.js';

// The data model lives in schematic_settings.ts (KiCad's data/UI split);
// re-exported here so the panel stays the import site for its slice.
export {
  defaultNetChains,
  type NetChain,
  type NetChainClass,
  type NetChainsData,
} from '../../schematic_settings.js';

interface Props {
  value: NetChainsData;
  onChange: (next: NetChainsData) => void;
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 14px',
  fontSize: 12.5,
  border: '1px solid var(--chrome-border)',
  borderBottom: active ? '1px solid var(--chrome-bg)' : '1px solid var(--chrome-border)',
  background: active ? 'var(--chrome-bg)' : 'var(--chrome-bg2)',
  borderTopLeftRadius: 4,
  borderTopRightRadius: 4,
  cursor: 'pointer',
  marginBottom: -1,
});

export function PanelSetupNetChains({ value, onChange }: Props): JSX.Element {
  const [tab, setTab] = useState<'chains' | 'classes'>('chains');
  const [chainSel, setChainSel] = useState<number | null>(value.chains.length ? 0 : null);
  const [classSel, setClassSel] = useState<number | null>(value.classes.length ? 0 : null);

  const curChain = chainSel !== null ? value.chains[chainSel] : undefined;

  const setChains = (chains: NetChain[]): void => onChange({ ...value, chains });
  const setClasses = (classes: NetChainClass[]): void => onChange({ ...value, classes });
  const setChainAt = (i: number, patch: Partial<NetChain>): void =>
    setChains(value.chains.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 3, borderBottom: '1px solid var(--chrome-border)' }}>
        <div style={tabBtn(tab === 'chains')} onClick={() => setTab('chains')}>
          Chains
        </div>
        <div style={tabBtn(tab === 'classes')} onClick={() => setTab('classes')}>
          Net Chain Classes
        </div>
      </div>

      {tab === 'chains' ? (
        <div
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 6 }}
        >
          <div style={{ flex: '1 1 60%', minHeight: 0, overflow: 'auto' }}>
            <table className="ze-grid" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Members</th>
                  <th>Net Chain Class</th>
                  <th>Net Class</th>
                  <th>Colour</th>
                </tr>
              </thead>
              <tbody>
                {value.chains.map((c, i) => (
                  <tr
                    key={i}
                    className={i === chainSel ? 'selected' : undefined}
                    onMouseDown={() => setChainSel(i)}
                  >
                    <td>
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => setChainAt(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <span className="ze-grid-input">{c.members.length}</span>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={c.chainClass}
                        onChange={(e) => setChainAt(i, { chainClass: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={c.netClass}
                        onChange={(e) => setChainAt(i, { netClass: e.target.value })}
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="color"
                        value={c.color || '#000000'}
                        style={{ width: 28, height: 18, border: 'none', background: 'none' }}
                        onChange={(e) => setChainAt(i, { color: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
                {value.chains.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '6px', color: 'var(--ze-muted, #888)' }}>
                      No net chains.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 12, margin: '6px 0 3px' }}>Member Nets</div>
          <div
            style={{
              flex: '1 1 40%',
              minHeight: 40,
              overflow: 'auto',
              border: '1px solid var(--chrome-border)',
              borderRadius: 3,
              padding: 4,
              fontSize: 12,
            }}
          >
            {curChain && curChain.members.length ? (
              curChain.members.map((m, i) => <div key={i}>{m}</div>)
            ) : (
              <span style={{ color: 'var(--ze-muted, #888)' }}>—</span>
            )}
          </div>

          <div className="ze-grid-btns">
            <button
              className="ze-gridbtn"
              title="Delete the selected committed net chain"
              disabled={chainSel === null}
              onClick={() => {
                if (chainSel === null) return;
                setChains(value.chains.filter((_, j) => j !== chainSel));
                setChainSel(
                  value.chains.length - 2 >= 0 ? Math.min(chainSel, value.chains.length - 2) : null,
                );
              }}
            >
              <Icon name="delete" />
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 6 }}
        >
          <div style={{ fontSize: 11.5, color: 'var(--ze-muted, #888)', marginBottom: 6 }}>
            Group net chains under a class label so DRC rules can target the whole group via
            inNetChainClass(&lsquo;name&rsquo;).
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <table className="ze-grid" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Class Name</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>
                {value.classes.map((c, i) => (
                  <tr
                    key={i}
                    className={i === classSel ? 'selected' : undefined}
                    onMouseDown={() => setClassSel(i)}
                  >
                    <td>
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) =>
                          setClasses(
                            value.classes.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="ze-grid-input">{c.members}</span>
                    </td>
                  </tr>
                ))}
                {value.classes.length === 0 && (
                  <tr>
                    <td colSpan={2} style={{ padding: '6px', color: 'var(--ze-muted, #888)' }}>
                      No net chain classes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="ze-grid-btns">
            <button
              className="ze-gridbtn"
              title="Add a new net chain class"
              onClick={() => {
                setClasses([...value.classes, { name: '', members: 0 }]);
                setClassSel(value.classes.length);
              }}
            >
              <Icon name="plus" />
            </button>
            <button
              className="ze-gridbtn"
              title="Delete the selected class (chains revert to no class)"
              disabled={classSel === null}
              onClick={() => {
                if (classSel === null) return;
                setClasses(value.classes.filter((_, j) => j !== classSel));
                setClassSel(
                  value.classes.length - 2 >= 0
                    ? Math.min(classSel, value.classes.length - 2)
                    : null,
                );
              }}
            >
              <Icon name="delete" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
