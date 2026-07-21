/**
 * Plugin and Content Manager (PCM) — data model.
 *
 * The web port of KiCad's Plugin and Content Manager (kicad/pcm/). This mirrors
 * KiCad's `pcm_data.h` structures — PCM_PACKAGE, PACKAGE_VERSION, PCM_CONTACT,
 * PCM_REPOSITORY — and the `pcm.v1` repository JSON schema, so real KiCad
 * repositories and package metadata map across with minimal translation.
 *
 * The difference from desktop KiCad is where a package's *payload* lives:
 * KiCad downloads an archive from `download_url` and unpacks it into the user's
 * `3rdparty` directory; here a package can instead carry its payload inline
 * (a colour `theme` object, or `.kicad_sym` `libraries`) so it installs with no
 * network and keeps working when its origin repository is offline. `download_*`
 * metadata is still modelled for interop with repositories that host archives.
 */

import type { Theme } from '../editors/schematic/theme.js';

/** PCM_PACKAGE_TYPE (pcm_data.h): the content categories the manager handles. */
export type PackageKind = 'plugin' | 'fab' | 'library' | 'datasource' | 'colortheme';

/** PCM_PACKAGE_VERSION_STATUS (pcm_data.h): a version's maturity. */
export type PackageVersionStatus = 'stable' | 'testing' | 'development' | 'deprecated';

/** PCM_PACKAGE_RUNTIME (pcm_data.h): the runtime a plugin package needs. */
export type PackageRuntime = 'swig' | 'ipc';

/** Kinds whose payload runs code / needs a backend, unavailable in the browser. */
export const RUNTIME_KINDS: readonly PackageKind[] = ['plugin', 'fab', 'datasource'];

/** PCM_CONTACT (pcm_data.h): a named contact plus arbitrary contact links. */
export interface Contact {
  name: string;
  /** e.g. { web: "https://…", email: "…", github: "…" }. */
  contact?: Record<string, string>;
}

/** One `.kicad_sym` library shipped inside a library package. */
export interface LibraryPayload {
  /** Library nickname (the tree name / sym-lib-table nickname). */
  name: string;
  /** The full `.kicad_sym` S-expression text. */
  text: string;
}

/** PACKAGE_VERSION (pcm_data.h): one advertised version of a package. */
export interface PackageVersion {
  version: string;
  /** version_epoch: bumped to force ordering when the version string can't. */
  versionEpoch?: number;
  /** Archive location (for repositories that host a downloadable payload). */
  downloadUrl?: string;
  /** SHA256 of the archive (VerifyHash) or of an inline payload. */
  downloadSha256?: string;
  downloadSize?: number;
  installSize?: number;
  status: PackageVersionStatus;
  /** Supported platforms; empty/undefined means all (KiCad "platforms"). */
  platforms?: string[];
  /** Minimum compatible app version (KiCad "kicad_version"). */
  kicadVersion: string;
  /** Maximum compatible app version (KiCad "kicad_version_max"). */
  kicadVersionMax?: string;
  keepOnUpdate?: string[];
  runtime?: PackageRuntime;
  /** Filled by PreparePackage: [major, minor, patch, epoch] for comparison. */
  parsedVersion?: [number, number, number, number];
  /** Filled by PreparePackage: whether this version runs on the current app. */
  compatible?: boolean;
}

/**
 * A package as advertised by a repository (PCM_PACKAGE). Inline `theme` /
 * `libraries` payloads travel with the metadata so an installed package keeps
 * working even when its origin repository is offline.
 */
export interface RepoPackage {
  /** Stable identifier, KiCad-style reverse-DNS (KiCad "identifier"). */
  id: string;
  kind: PackageKind;
  name: string;
  description: string;
  /** Long form shown in the details pane (KiCad "description_full"). */
  descriptionFull?: string;
  author: Contact;
  maintainer?: Contact;
  license: string;
  /** Free-form grouping shown as a chip (KiCad plugin "category"). */
  category?: string;
  tags?: string[];
  keepOnUpdate?: string[];
  /** Named links: homepage, documentation, etc. (KiCad "resources"). */
  resources?: Record<string, string>;
  /** Small inline icon (data: URL or asset URL) shown on the card. */
  icon?: string;
  /** Advertised versions, newest first (KiCad "versions"). */
  versions: PackageVersion[];
  /** Colour-theme payload (present when kind === 'colortheme'). */
  theme?: Theme;
  /** Symbol-library payload (present when kind === 'library'). */
  libraries?: LibraryPayload[];
}

/** A resource reference in a repository index (PCM_RESOURCE_REFERENCE). */
export interface ResourceReference {
  url: string;
  sha256?: string;
  updateTimestamp?: number;
}

/** A repository (PCM_REPOSITORY): a named catalog of packages. */
export interface Repository {
  /** Fetch URL of the index; empty string identifies the bundled default. */
  url: string;
  name: string;
  /** KiCad repository index schema version (PCM_REPOSITORY.schema_version). */
  schemaVersion?: number;
  maintainer?: Contact;
  packages: RepoPackage[];
}

/**
 * An installed package (PCM_INSTALLATION_ENTRY): the package plus install
 * bookkeeping. Extends RepoPackage so payload accessors keep working directly.
 */
export interface InstalledPackage extends RepoPackage {
  /** install_timestamp. */
  installedAt: number;
  /** The installed version (KiCad "current_version"). */
  currentVersion: string;
  /** Name of the repository it came from (KiCad "repository_name"). */
  source: string;
  /** Id of the repository it came from (KiCad "repository_id"). */
  repositoryId?: string;
  /** Held back from updates (KiCad "pinned"). */
  pinned: boolean;
}

/** A queued, not-yet-applied change (DIALOG_PCM m_pendingActions). */
export type PendingAction = 'install' | 'uninstall' | 'update';

export interface PendingChange {
  action: PendingAction;
  pkg: RepoPackage;
  /** Repository the package is being (re)installed from. */
  source: string;
  repositoryId?: string;
  /** Target version for install/update. */
  version: string;
}

/**
 * Package state for the UI (PCM_PACKAGE_STATE, GetPackageState): available to
 * install, installed, an update is available, or a change is queued.
 */
export type PackageState =
  | 'available'
  | 'installed'
  | 'update_available'
  | 'pending_install'
  | 'pending_uninstall'
  | 'pending_update';
