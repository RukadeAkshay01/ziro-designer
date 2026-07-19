/**
 * Plugin and Content Manager store.
 *
 * The web port of KiCad's PLUGIN_CONTENT_MANAGER (kicad/pcm/pcm.cpp): it owns
 * the installed packages and the configured repositories, computes per-package
 * state and available updates, holds a pending-changes queue applied as a batch
 * (DIALOG_PCM's "Apply Pending Changes"), verifies payload hashes, and persists
 * everything to localStorage — the web equivalent of KiCad's
 * `installed_packages.json` plus the repository cache. Subscribers re-render
 * through useSyncExternalStore.
 *
 * This module is intentionally free of app/settings imports so it can be read
 * from anywhere (e.g. the Symbol Editor bootstrap) without an import cycle.
 */

import { useSyncExternalStore } from 'react';
import type { Theme } from '../editors/schematic/theme.js';
import { DEFAULT_REPOSITORY } from './defaultRepo.js';
import { RUNTIME_KINDS } from './types.js';
import type {
  Contact,
  InstalledPackage,
  LibraryPayload,
  PackageState,
  PackageVersion,
  PendingAction,
  PendingChange,
  Repository,
  RepoPackage,
} from './types.js';

/** The running application's KiCad-compatibility version (kicad_version check). */
export const APP_KICAD_VERSION = '9.0.0';

const INSTALLED_KEY = 'ziroeda.pcm.installed';
const REPOS_KEY = 'ziroeda.pcm.repos';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function storeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — installs simply don't persist */
  }
}

// ---- version helpers (PreparePackage) ----------------------------------------

/** Parse a "major.minor.patch" string into a numeric tuple (missing = 0). */
function versionParts(v: string): [number, number, number] {
  const m = /(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?/.exec(v);
  if (!m) return [0, 0, 0];
  return [Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Parsed [major, minor, patch, epoch] tuple used for ordering. */
export function parsedVersion(pv: PackageVersion): [number, number, number, number] {
  const [maj, min, patch] = versionParts(pv.version);
  return [maj, min, patch, pv.versionEpoch ?? 0];
}

/** Compare parsed version tuples; epoch dominates, then major/minor/patch. */
function compareParsed(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  // epoch first (index 3), then major, minor, patch.
  return a[3] - b[3] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Whether a version runs on the current app (kicad_version[_max] window). */
function isCompatible(pv: PackageVersion): boolean {
  const app = versionParts(APP_KICAD_VERSION);
  if (compareParsed([...versionParts(pv.kicadVersion), 0], [...app, 0]) > 0) return false;
  if (pv.kicadVersionMax) {
    if (compareParsed([...app, 0], [...versionParts(pv.kicadVersionMax), 0]) > 0) return false;
  }
  return true;
}

/** Fill parsedVersion + compatible and sort versions newest-first (in place). */
export function preparePackage(pkg: RepoPackage): RepoPackage {
  for (const v of pkg.versions) {
    v.parsedVersion = parsedVersion(v);
    v.compatible = isCompatible(v);
  }
  pkg.versions.sort((a, b) => compareParsed(b.parsedVersion!, a.parsedVersion!));
  return pkg;
}

/** The newest compatible, non-deprecated version of a package, if any. */
export function latestVersion(pkg: RepoPackage): PackageVersion | undefined {
  return (
    pkg.versions.find((v) => v.compatible && v.status !== 'deprecated') ??
    pkg.versions.find((v) => v.compatible)
  );
}

// ---- repository JSON normalisation (KiCad pcm.v1 → our model) -----------------

function normalizeContact(raw: unknown): Contact {
  if (typeof raw === 'string') return { name: raw };
  const r = (raw ?? {}) as { name?: string; contact?: Record<string, string> };
  return { name: r.name ?? 'Unknown', contact: r.contact };
}

/** Map a KiCad-schema (snake_case) or native (camelCase) version object. */
function normalizeVersion(raw: Record<string, unknown>): PackageVersion {
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k] as T;
    return undefined;
  };
  return {
    version: String(pick('version') ?? '0'),
    versionEpoch: pick<number>('versionEpoch', 'version_epoch'),
    downloadUrl: pick<string>('downloadUrl', 'download_url'),
    downloadSha256: pick<string>('downloadSha256', 'download_sha256'),
    downloadSize: pick<number>('downloadSize', 'download_size'),
    installSize: pick<number>('installSize', 'install_size'),
    status: (pick<string>('status') as PackageVersion['status']) ?? 'stable',
    platforms: pick<string[]>('platforms'),
    kicadVersion: String(pick('kicadVersion', 'kicad_version') ?? '0'),
    kicadVersionMax: pick<string>('kicadVersionMax', 'kicad_version_max'),
    keepOnUpdate: pick<string[]>('keepOnUpdate', 'keep_on_update'),
    runtime: pick<PackageVersion['runtime']>('runtime'),
  };
}

/** Map a KiCad-schema (snake_case) or native package object to a RepoPackage. */
function normalizePackage(raw: Record<string, unknown>): RepoPackage {
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k] as T;
    return undefined;
  };
  const versions = (pick<Record<string, unknown>[]>('versions') ?? []).map(normalizeVersion);
  return preparePackage({
    id: String(pick('id', 'identifier') ?? ''),
    kind: (pick<string>('kind', 'type') as RepoPackage['kind']) ?? 'plugin',
    name: String(pick('name') ?? ''),
    description: String(pick('description') ?? ''),
    descriptionFull: pick<string>('descriptionFull', 'description_full'),
    author: normalizeContact(pick('author')),
    maintainer: raw.maintainer !== undefined ? normalizeContact(raw.maintainer) : undefined,
    license: String(pick('license') ?? 'Unknown'),
    category: pick<string>('category'),
    tags: pick<string[]>('tags'),
    keepOnUpdate: pick<string[]>('keepOnUpdate', 'keep_on_update'),
    resources: pick<Record<string, string>>('resources'),
    icon: pick<string>('icon'),
    versions,
    theme: pick('theme'),
    libraries: pick<LibraryPayload[]>('libraries'),
  });
}

/** SHA256 hex of a UTF-8 string (the web equivalent of PCM VerifyHash). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type Listener = () => void;

/** A configured third-party repository (its packages are fetched, then cached). */
interface CustomRepo {
  url: string;
  name: string;
}

class PcmStore {
  /** Installed packages by id. */
  private installed: Record<string, InstalledPackage> = loadJson(INSTALLED_KEY, {});
  /** URLs of third-party repositories added by the user. */
  private customRepos: CustomRepo[] = loadJson(REPOS_KEY, []);
  /** Fetched third-party repositories this session (url -> Repository). */
  private fetched = new Map<string, Repository>();
  /** Queued, not-yet-applied changes by package id (DIALOG_PCM pending grid). */
  private pending = new Map<string, PendingChange>();

  private listeners = new Set<Listener>();
  /** Monotonic snapshot id for useSyncExternalStore. */
  version = 0;

  constructor() {
    // Compute parsedVersion + compatibility for the bundled default packages
    // (fetched repositories are prepared in normalizePackage).
    for (const p of DEFAULT_REPOSITORY.packages) preparePackage(p);

    // Older installs (before pinning / current_version) get sane defaults.
    let migrated = false;
    for (const p of Object.values(this.installed)) {
      if (p.pinned === undefined) {
        p.pinned = false;
        migrated = true;
      }
      if (!p.currentVersion) {
        p.currentVersion = (p as unknown as { version?: string }).version ?? '0';
        migrated = true;
      }
      if (!Array.isArray(p.versions)) {
        p.versions = [{ version: p.currentVersion, status: 'stable', kicadVersion: '0' }];
        migrated = true;
      }
    }
    if (migrated) storeJson(INSTALLED_KEY, this.installed);
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---- repositories ----------------------------------------------------------

  /** All repositories: the bundled default first, then any added by URL. */
  repositories(): Repository[] {
    const repos: Repository[] = [DEFAULT_REPOSITORY];
    for (const r of this.customRepos) {
      repos.push(this.fetched.get(r.url) ?? { url: r.url, name: r.name, packages: [] });
    }
    return repos;
  }

  /**
   * Add and fetch a third-party repository. Follows KiCad's two-level layout:
   * the index document points at a separate packages resource
   * (`{ name, packages: { url, sha256? } }`), which is fetched and — when a
   * sha256 is given — verified before use. A flat `{ name, packages: [...] }`
   * document is also accepted for convenience. Throws on network/parse/hash
   * errors.
   */
  async addRepository(url: string): Promise<Repository> {
    const index = (await fetchJson(url)) as {
      name?: string;
      schema_version?: number;
      maintainer?: unknown;
      packages?: { url?: string; sha256?: string } | Record<string, unknown>[];
    };

    let rawPackages: Record<string, unknown>[];
    if (Array.isArray(index.packages)) {
      // Flat form: packages inline in the index.
      rawPackages = index.packages;
    } else if (index.packages?.url) {
      // KiCad form: index → separate packages resource (verified if hashed).
      const pkgUrl = new URL(index.packages.url, url).toString();
      const pkgText = await fetchText(pkgUrl);
      if (index.packages.sha256) {
        const got = await sha256Hex(pkgText);
        if (got.toLowerCase() !== index.packages.sha256.toLowerCase())
          throw new Error('packages checksum mismatch');
      }
      const doc = JSON.parse(pkgText) as { packages?: Record<string, unknown>[] };
      rawPackages = Array.isArray(doc.packages) ? doc.packages : [];
    } else {
      throw new Error('no packages in repository index');
    }

    const repo: Repository = {
      url,
      name: index.name || url,
      schemaVersion: index.schema_version,
      maintainer: index.maintainer !== undefined ? normalizeContact(index.maintainer) : undefined,
      packages: rawPackages.map(normalizePackage).filter((p) => p.id),
    };
    this.fetched.set(url, repo);
    if (!this.customRepos.some((r) => r.url === url)) {
      this.customRepos = [...this.customRepos, { url, name: repo.name }];
      storeJson(REPOS_KEY, this.customRepos);
    }
    this.notify();
    return repo;
  }

  removeRepository(url: string): void {
    this.customRepos = this.customRepos.filter((r) => r.url !== url);
    this.fetched.delete(url);
    storeJson(REPOS_KEY, this.customRepos);
    this.notify();
  }

  // ---- install / uninstall ---------------------------------------------------

  isInstalled(id: string): boolean {
    return id in this.installed;
  }

  installedVersion(id: string): string | undefined {
    return this.installed[id]?.currentVersion;
  }

  private doInstall(
    pkg: RepoPackage,
    source: string,
    version: string,
    repositoryId?: string,
  ): void {
    const prev = this.installed[pkg.id];
    this.installed = {
      ...this.installed,
      [pkg.id]: {
        ...pkg,
        installedAt: prev?.installedAt ?? Date.now(),
        currentVersion: version,
        source,
        repositoryId,
        pinned: prev?.pinned ?? false,
      },
    };
    storeJson(INSTALLED_KEY, this.installed);
  }

  /** Install (or reinstall) a package immediately at its latest version. */
  install(pkg: RepoPackage, source: string, repositoryId?: string): void {
    this.doInstall(pkg, source, latestVersion(pkg)?.version ?? '0', repositoryId);
    this.notify();
  }

  private doUninstall(id: string): void {
    if (!(id in this.installed)) return;
    const next = { ...this.installed };
    delete next[id];
    this.installed = next;
    storeJson(INSTALLED_KEY, this.installed);
  }

  /** Uninstall a package immediately. */
  uninstall(id: string): void {
    this.doUninstall(id);
    this.notify();
  }

  installedList(): InstalledPackage[] {
    return Object.values(this.installed).sort((a, b) => b.installedAt - a.installedAt);
  }

  // ---- updates (GetPackageUpdateVersion) -------------------------------------

  /**
   * The version string an installed package can be updated to (a newer,
   * compatible version than the one installed), or undefined if up to date.
   * `pkg` is the repository's advertised package for the same id.
   */
  updateFor(pkg: RepoPackage): string | undefined {
    const cur = this.installed[pkg.id];
    if (!cur) return undefined;
    const latest = latestVersion(pkg);
    if (!latest?.parsedVersion) return undefined;
    const curParsed: [number, number, number, number] = [...versionParts(cur.currentVersion), 0];
    return compareParsed(latest.parsedVersion, curParsed) > 0 ? latest.version : undefined;
  }

  // ---- pinning (SetPinned / IsPackagePinned) ---------------------------------

  isPinned(id: string): boolean {
    return this.installed[id]?.pinned ?? false;
  }

  setPinned(id: string, pinned: boolean): void {
    const p = this.installed[id];
    if (!p) return;
    this.installed = { ...this.installed, [id]: { ...p, pinned } };
    storeJson(INSTALLED_KEY, this.installed);
    this.notify();
  }

  // ---- pending-changes queue (DIALOG_PCM m_pendingActions) -------------------

  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  pendingChange(id: string): PendingChange | undefined {
    return this.pending.get(id);
  }

  pendingChanges(): PendingChange[] {
    return [...this.pending.values()];
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /** Queue a change (or toggle it off if the same action is already queued). */
  queue(
    action: PendingAction,
    pkg: RepoPackage,
    source: string,
    repositoryId?: string,
    version?: string,
  ): void {
    const existing = this.pending.get(pkg.id);
    if (existing && existing.action === action) {
      this.pending.delete(pkg.id);
    } else {
      this.pending.set(pkg.id, {
        action,
        pkg,
        source,
        repositoryId,
        version: version ?? latestVersion(pkg)?.version ?? '0',
      });
    }
    this.notify();
  }

  unqueue(id: string): void {
    if (this.pending.delete(id)) this.notify();
  }

  discardPending(): void {
    if (this.pending.size === 0) return;
    this.pending.clear();
    this.notify();
  }

  /**
   * Apply every queued change as a batch (PCM_TASK_MANAGER.RunQueue). Returns
   * the ids that were uninstalled so callers can react (e.g. reset a colour
   * theme that is no longer installed) without this module importing settings.
   */
  applyPending(): { installed: string[]; uninstalled: string[] } {
    const result = { installed: [] as string[], uninstalled: [] as string[] };
    for (const change of this.pending.values()) {
      if (change.action === 'uninstall') {
        this.doUninstall(change.pkg.id);
        result.uninstalled.push(change.pkg.id);
      } else {
        this.doInstall(change.pkg, change.source, change.version, change.repositoryId);
        result.installed.push(change.pkg.id);
      }
    }
    this.pending.clear();
    this.notify();
    return result;
  }

  // ---- state (GetPackageState) -----------------------------------------------

  /** The UI state of a package as advertised by a repository. */
  getPackageState(pkg: RepoPackage): PackageState {
    const p = this.pending.get(pkg.id);
    if (p) {
      if (p.action === 'install') return 'pending_install';
      if (p.action === 'uninstall') return 'pending_uninstall';
      return 'pending_update';
    }
    if (this.isInstalled(pkg.id)) {
      return this.updateFor(pkg) ? 'update_available' : 'installed';
    }
    return 'available';
  }

  // ---- search ranking (GetPackageSearchRank) ---------------------------------

  /** Relevance of a package to a search term (0 = no match). */
  searchRank(pkg: RepoPackage, term: string): number {
    const q = term.trim().toLowerCase();
    if (!q) return 1;
    let rank = 0;
    const name = pkg.name.toLowerCase();
    if (name === q) rank += 200;
    else if (name.startsWith(q)) rank += 100;
    else if (name.includes(q)) rank += 60;
    if (pkg.id.toLowerCase().includes(q)) rank += 40;
    if (pkg.description.toLowerCase().includes(q)) rank += 20;
    if (pkg.descriptionFull?.toLowerCase().includes(q)) rank += 10;
    for (const tag of pkg.tags ?? []) if (tag.toLowerCase().includes(q)) rank += 15;
    if (pkg.author.name.toLowerCase().includes(q)) rank += 10;
    return rank;
  }

  // ---- payload accessors (consumed by the rest of the app) -------------------

  /** Installed colour themes keyed by their PCM theme id ("pcm:<packageId>"). */
  installedThemes(): { id: string; name: string; theme: Theme }[] {
    return this.installedList()
      .filter((p) => p.kind === 'colortheme' && p.theme)
      .map((p) => ({ id: pcmThemeId(p.id), name: p.name, theme: p.theme as Theme }));
  }

  /** Resolve a colour theme by its PCM theme id, or undefined if not installed. */
  themeById(pcmId: string): Theme | undefined {
    const pkgId = pcmId.startsWith('pcm:') ? pcmId.slice(4) : pcmId;
    const p = this.installed[pkgId];
    return p?.kind === 'colortheme' ? p.theme : undefined;
  }

  /** All symbol libraries contributed by installed library packages. */
  installedLibraries(): LibraryPayload[] {
    const libs: LibraryPayload[] = [];
    for (const p of this.installedList()) {
      if (p.kind === 'library') libs.push(...(p.libraries ?? []));
    }
    return libs;
  }
}

/** A payload kind runs code / needs a backend that the browser cannot host. */
export function isRuntimeKind(kind: RepoPackage['kind']): boolean {
  return RUNTIME_KINDS.includes(kind);
}

/** The PCM theme id used in settings for an installed theme package. */
export function pcmThemeId(packageId: string): string {
  return `pcm:${packageId}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url));
}

export const pcm = new PcmStore();

// ---- React bindings ----------------------------------------------------------

export function usePcmVersion(): number {
  return useSyncExternalStore(pcm.subscribe, () => pcm.version);
}
