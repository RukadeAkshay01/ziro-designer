/**
 * Plugin and Content Manager dialog.
 *
 * The web port of KiCad's DIALOG_PCM. It mirrors the desktop dialog closely:
 * one tab per package type (Plugins, Fabrication, Libraries, Data Sources,
 * Colour Themes) plus Installed and Pending tabs; a repository chooser with
 * add-by-URL; a search box; and — like KiCad — a *queued* action model where
 * Install / Update / Uninstall accumulate as pending changes that are then
 * applied (or discarded) as a batch.
 *
 * Libraries and colour themes install and take effect in-app. Plugins,
 * fabrication and data-source packages need a runtime/back end the browser
 * cannot host yet, so those tabs explain that and list packages read-only.
 */

import { useMemo, useState, type JSX } from 'react';
import { settings } from '../prefs/settings.js';
import { isRuntimeKind, latestVersion, pcm, pcmThemeId, usePcmVersion } from './pcmStore.js';
import type { PackageKind, PackageState, RepoPackage, Repository } from './types.js';
import './pcm.css';

type Tab = PackageKind | 'installed' | 'pending';

const TYPE_TABS: [PackageKind, string][] = [
  ['plugin', 'Plugins'],
  ['fab', 'Fabrication'],
  ['library', 'Libraries'],
  ['datasource', 'Data Sources'],
  ['colortheme', 'Colour Themes'],
];

const KIND_LABEL: Record<PackageKind, string> = {
  plugin: 'plugins',
  fab: 'fabrication plugins',
  library: 'libraries',
  datasource: 'data sources',
  colortheme: 'colour themes',
};

/** A small swatch row previewing a theme's key colours. */
function ThemeSwatches({ pkg }: { pkg: RepoPackage }): JSX.Element | null {
  if (!pkg.theme) return null;
  const t = pkg.theme;
  const keys = ['background', 'wire', 'bus', 'symbolOutline', 'pin', 'label'] as const;
  return (
    <span className="ze-pcm-swatches" title="Theme preview">
      {keys.map((k) => (
        <span key={k} className="sw" style={{ background: t[k] }} />
      ))}
    </span>
  );
}

export function PluginManagerDialog({ onClose }: { onClose: () => void }): JSX.Element {
  usePcmVersion();
  const [tab, setTab] = useState<Tab>('library');
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [addingUrl, setAddingUrl] = useState('');
  const [repoError, setRepoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const repos = pcm.repositories();
  const activeRepo: Repository = useMemo(
    () => repos.find((r) => r.url === repoUrl) ?? repos[0]!,
    [repos, repoUrl],
  );
  const activeThemeId = settings.eeschema.appearance.color_theme;
  const pendingCount = pcm.pendingCount();

  // Packages shown in the current type tab: filtered by search, ranked.
  const typePackages = useMemo(() => {
    if (tab === 'installed' || tab === 'pending') return [];
    return activeRepo.packages
      .filter((p) => p.kind === tab)
      .map((p) => ({ p, rank: pcm.searchRank(p, search) }))
      .filter((x) => x.rank > 0)
      .sort((a, b) => b.rank - a.rank || a.p.name.localeCompare(b.p.name))
      .map((x) => x.p);
  }, [activeRepo, tab, search, pcm.version]);

  const installedPackages = useMemo(
    () => pcm.installedList().filter((p) => pcm.searchRank(p, search) > 0),
    [search, pcm.version],
  );

  const addRepo = async (): Promise<void> => {
    const url = addingUrl.trim();
    if (!url) return;
    setBusy(true);
    setRepoError(null);
    try {
      const repo = await pcm.addRepository(url);
      setRepoUrl(repo.url);
      setAddingUrl('');
      setStatus(`Added repository "${repo.name}" (${repo.packages.length} packages)`);
    } catch (err) {
      setRepoError(`Could not load repository: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // ---- queue actions (applied later as a batch) ------------------------------

  const queueInstall = (pkg: RepoPackage): void => {
    pcm.queue('install', pkg, activeRepo.name, activeRepo.url || undefined);
  };
  const queueUpdate = (pkg: RepoPackage): void => {
    if (pcm.isPinned(pkg.id) && !confirm(`"${pkg.name}" is pinned. Update it anyway?`)) return;
    pcm.queue('update', pkg, activeRepo.name, activeRepo.url || undefined);
  };
  const queueUninstall = (pkg: RepoPackage): void => {
    pcm.queue('uninstall', pkg, activeRepo.name, activeRepo.url || undefined);
  };

  const applyPending = (): void => {
    const { installed, uninstalled } = pcm.applyPending();
    // Reset the active schematic theme if it was just uninstalled.
    if (uninstalled.some((id) => activeThemeId === pcmThemeId(id)))
      settings.updateEeschema((s) => {
        s.appearance.color_theme = '_builtin_default';
      });
    setStatus(`Applied changes: ${installed.length} installed, ${uninstalled.length} uninstalled`);
  };

  // ---- immediate (non-install) actions ---------------------------------------

  const applyTheme = (pkg: RepoPackage): void => {
    settings.updateEeschema((s) => {
      s.appearance.color_theme = pcmThemeId(pkg.id);
    });
    setStatus(`"${pkg.name}" set as the active schematic colour theme`);
  };

  const togglePin = (pkg: RepoPackage): void => {
    const next = !pcm.isPinned(pkg.id);
    pcm.setPinned(pkg.id, next);
    setStatus(`${next ? 'Pinned' : 'Unpinned'} "${pkg.name}"`);
  };

  // ---- per-package action buttons (state machine → controls) -----------------

  function actionButtons(pkg: RepoPackage): JSX.Element {
    const state: PackageState = pcm.getPackageState(pkg);
    const runtime = isRuntimeKind(pkg.kind);
    const isActiveTheme = pkg.kind === 'colortheme' && activeThemeId === pcmThemeId(pkg.id);

    if (
      state === 'pending_install' ||
      state === 'pending_update' ||
      state === 'pending_uninstall'
    ) {
      const label =
        state === 'pending_uninstall'
          ? 'Uninstall queued'
          : state === 'pending_update'
            ? 'Update queued'
            : 'Install queued';
      return (
        <button
          className="ze-btn sm"
          title="Remove from pending"
          onClick={() => pcm.unqueue(pkg.id)}
        >
          {label} ✕
        </button>
      );
    }

    if (state === 'available') {
      return (
        <button
          className="ze-btn primary sm"
          disabled={runtime}
          title={runtime ? 'Requires a runtime not yet available in the browser' : 'Queue install'}
          onClick={() => queueInstall(pkg)}
        >
          Install
        </button>
      );
    }

    // installed or update_available
    return (
      <>
        {state === 'update_available' && (
          <button className="ze-btn primary sm" onClick={() => queueUpdate(pkg)}>
            Update
          </button>
        )}
        {pkg.kind === 'colortheme' && !isActiveTheme && (
          <button className="ze-btn sm" onClick={() => applyTheme(pkg)}>
            Set active
          </button>
        )}
        <button
          className={`ze-btn sm${pcm.isPinned(pkg.id) ? ' pinned' : ''}`}
          title={pcm.isPinned(pkg.id) ? 'Unpin (allow updates)' : 'Pin (hold back updates)'}
          onClick={() => togglePin(pkg)}
        >
          {pcm.isPinned(pkg.id) ? '📌 Pinned' : 'Pin'}
        </button>
        <button className="ze-btn sm" onClick={() => queueUninstall(pkg)}>
          Uninstall
        </button>
      </>
    );
  }

  // ---- one package card ------------------------------------------------------

  function card(pkg: RepoPackage): JSX.Element {
    const state = pcm.getPackageState(pkg);
    const isActiveTheme = pkg.kind === 'colortheme' && activeThemeId === pcmThemeId(pkg.id);
    const latest = latestVersion(pkg);
    const ver = pcm.installedVersion(pkg.id) ?? latest?.version ?? '—';
    const open = expanded === pkg.id;
    return (
      <div key={pkg.id} className="ze-pcm-card">
        <div className="ze-pcm-card-main">
          <div className="ze-pcm-card-title">
            <span className="name">{pkg.name}</span>
            <span className="ver">v{ver}</span>
            {latest && latest.status !== 'stable' && (
              <span className="badge status">{latest.status}</span>
            )}
            {pkg.category && <span className="chip">{pkg.category}</span>}
            {pkg.kind === 'colortheme' && <ThemeSwatches pkg={pkg} />}
            {(state === 'installed' || state === 'update_available') && (
              <span className="badge">Installed</span>
            )}
            {state === 'update_available' && (
              <span className="badge update">Update: {pcm.updateFor(pkg)}</span>
            )}
            {isActiveTheme && <span className="badge active">Active</span>}
            {pcm.isPinned(pkg.id) && <span className="badge pin">Pinned</span>}
          </div>
          <div className="ze-pcm-card-desc">{pkg.description}</div>
          <div className="ze-pcm-card-meta">
            by {pkg.author.name} · {pkg.license}
            {pkg.kind === 'library' &&
              pkg.libraries &&
              ` · ${pkg.libraries.map((l) => l.name).join(', ')}`}
            {(pkg.descriptionFull || pkg.resources || pkg.tags?.length) && (
              <>
                {' · '}
                <button className="ze-linkbtn" onClick={() => setExpanded(open ? null : pkg.id)}>
                  {open ? 'Hide details' : 'Details'}
                </button>
              </>
            )}
          </div>
          {open && (
            <div className="ze-pcm-details">
              {pkg.descriptionFull && <p>{pkg.descriptionFull}</p>}
              {latest && (
                <p className="ze-muted">
                  Requires app ≥ {latest.kicadVersion}
                  {latest.kicadVersionMax ? ` and ≤ ${latest.kicadVersionMax}` : ''}
                  {latest.installSize ? ` · ${Math.round(latest.installSize / 1024)} KB` : ''}
                  {latest.compatible === false ? ' · incompatible with this version' : ''}
                </p>
              )}
              {pkg.tags?.length ? (
                <div className="ze-pcm-tags">
                  {pkg.tags.map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              {pkg.resources &&
                Object.entries(pkg.resources).map(([k, url]) => (
                  <a key={k} href={url} target="_blank" rel="noreferrer" className="ze-pcm-reslink">
                    {k}
                  </a>
                ))}
            </div>
          )}
        </div>
        <div className="ze-pcm-card-actions">{actionButtons(pkg)}</div>
      </div>
    );
  }

  // ---- body per tab ----------------------------------------------------------

  function body(): JSX.Element {
    if (tab === 'pending') {
      const changes = pcm.pendingChanges();
      if (changes.length === 0)
        return (
          <div className="ze-pcm-empty">
            <p className="ze-muted">No pending changes. Queue installs or removals, then apply.</p>
          </div>
        );
      return (
        <div className="ze-pcm-list">
          {changes.map((c) => (
            <div key={c.pkg.id} className="ze-pcm-card">
              <div className="ze-pcm-card-main">
                <div className="ze-pcm-card-title">
                  <span className={`badge ${c.action}`}>{c.action}</span>
                  <span className="name">{c.pkg.name}</span>
                  <span className="ver">v{c.version}</span>
                </div>
                <div className="ze-pcm-card-meta">from {c.source}</div>
              </div>
              <div className="ze-pcm-card-actions">
                <button className="ze-btn sm" onClick={() => pcm.unqueue(c.pkg.id)}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (tab === 'installed') {
      if (installedPackages.length === 0)
        return (
          <div className="ze-pcm-empty">
            <p className="ze-muted">
              {search ? 'No installed packages match your search.' : 'No packages installed yet.'}
            </p>
          </div>
        );
      return <div className="ze-pcm-list">{installedPackages.map(card)}</div>;
    }

    // a type tab
    const runtime = isRuntimeKind(tab);
    return (
      <>
        {runtime && (
          <div className="ze-pcm-note">
            {tab === 'plugin'
              ? 'KiCad plugins are native Python scripts. In the browser they need a sandboxed web runtime — a separate piece of work.'
              : tab === 'fab'
                ? 'Fabrication plugins run generation scripts that need a sandboxed runtime, not available in the browser yet.'
                : 'Data-source packages connect external database libraries, which need a back end not available in the browser yet.'}{' '}
            Libraries and colour themes install and work today.
          </div>
        )}
        {typePackages.length === 0 ? (
          <div className="ze-pcm-empty">
            <p className="ze-muted">
              {search
                ? `No ${KIND_LABEL[tab]} match your search.`
                : `This repository has no ${KIND_LABEL[tab]}.`}
            </p>
          </div>
        ) : (
          <div className="ze-pcm-list">{typePackages.map(card)}</div>
        )}
      </>
    );
  }

  const allTabs: [Tab, string][] = [
    ...TYPE_TABS,
    ['installed', 'Installed'],
    ['pending', pendingCount > 0 ? `Pending (${pendingCount})` : 'Pending'],
  ];

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-pcm-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Plugin and Content Manager
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>

        {/* repository selector + add-by-URL + search (KiCad's repository chooser) */}
        <div className="ze-pcm-repobar">
          <label>
            Repository:{' '}
            <select value={activeRepo.url} onChange={(e) => setRepoUrl(e.target.value)}>
              {repos.map((r) => (
                <option key={r.url || '_default'} value={r.url}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <input
            className="ze-pcm-search"
            type="search"
            placeholder="Search packages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="ze-pcm-addrepo">
            <input
              type="text"
              placeholder="Add repository by URL…"
              value={addingUrl}
              onChange={(e) => setAddingUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addRepo()}
            />
            <button
              className="ze-btn sm"
              disabled={busy || !addingUrl.trim()}
              onClick={() => void addRepo()}
            >
              Add
            </button>
            {activeRepo.url && (
              <button
                className="ze-btn sm"
                title="Remove this repository"
                onClick={() => {
                  pcm.removeRepository(activeRepo.url);
                  setRepoUrl('');
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {repoError && <div className="ze-pcm-error">{repoError}</div>}

        {/* tabs */}
        <div className="ze-pcm-tabs">
          {allTabs.map(([id, label]) => (
            <button
              key={id}
              className={`ze-pcm-tab${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ze-modal-body ze-pcm-body">{body()}</div>

        <div className="ze-modal-footer ze-pcm-footer">
          <span className="ze-pcm-status">{status ?? ''}</span>
          {pendingCount > 0 && (
            <>
              <button className="ze-btn sm" onClick={() => pcm.discardPending()}>
                Discard Pending
              </button>
              <button className="ze-btn primary" onClick={applyPending}>
                Apply Pending Changes ({pendingCount})
              </button>
            </>
          )}
          <button type="button" className="ze-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
