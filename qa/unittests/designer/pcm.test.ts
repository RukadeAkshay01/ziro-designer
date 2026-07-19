/**
 * Plugin and Content Manager store: the web port of KiCad's
 * PLUGIN_CONTENT_MANAGER. These exercise the version/compatibility logic
 * (PreparePackage), search ranking (GetPackageSearchRank), the package-state
 * machine (GetPackageState), the pending-changes queue (DIALOG_PCM applies
 * changes as a batch), update detection, pinning, and payload hashing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_REPOSITORY } from '@ziroeda/designer/src/pcm/defaultRepo.js';
import {
  APP_KICAD_VERSION,
  isRuntimeKind,
  latestVersion,
  parsedVersion,
  pcm,
  preparePackage,
  sha256Hex,
} from '@ziroeda/designer/src/pcm/pcmStore.js';
import type { PackageVersion, RepoPackage } from '@ziroeda/designer/src/pcm/types.js';

function pkg(id: string, versions: PackageVersion[], over: Partial<RepoPackage> = {}): RepoPackage {
  return preparePackage({
    id,
    kind: 'library',
    name: id,
    description: '',
    author: { name: 'tester' },
    license: 'MIT',
    versions,
    ...over,
  });
}
const V = (
  version: string,
  kicadVersion = '7.0',
  over: Partial<PackageVersion> = {},
): PackageVersion => ({
  version,
  status: 'stable',
  kicadVersion,
  ...over,
});

// Keep the shared singleton clean between tests.
afterEach(() => {
  pcm.discardPending();
  for (const p of pcm.installedList()) pcm.uninstall(p.id);
});

describe('APP_KICAD_VERSION sanity', () => {
  it('is at least KiCad 7 so the bundled packages are compatible', () => {
    expect(Number.parseInt(APP_KICAD_VERSION, 10)).toBeGreaterThanOrEqual(7);
  });
});

describe('preparePackage / version compatibility', () => {
  it('sorts versions newest-first and marks the compatibility window', () => {
    const p = pkg('t.sort', [V('1.0.0'), V('2.0.0'), V('1.5.0', '999.0')]);
    expect(p.versions.map((v) => v.version)).toEqual(['2.0.0', '1.5.0', '1.0.0']);
    expect(p.versions.find((v) => v.version === '1.5.0')?.compatible).toBe(false);
    expect(p.versions.find((v) => v.version === '2.0.0')?.compatible).toBe(true);
  });

  it('honours kicad_version_max', () => {
    const p = pkg('t.max', [V('1.0.0', '1.0', { kicadVersionMax: '8.0' })]);
    // App is 9.x, above the 8.0 ceiling → incompatible.
    expect(p.versions[0]?.compatible).toBe(false);
  });

  it('parsedVersion encodes [major, minor, patch, epoch]', () => {
    expect(parsedVersion(V('2.3.4'))).toEqual([2, 3, 4, 0]);
    expect(parsedVersion(V('1.0', '0', { versionEpoch: 2 }))).toEqual([1, 0, 0, 2]);
  });
});

describe('latestVersion', () => {
  it('skips newer-but-incompatible versions', () => {
    const p = pkg('t.compat', [V('3.0.0', '999.0'), V('2.0.0')]);
    expect(latestVersion(p)?.version).toBe('2.0.0');
  });

  it('skips deprecated versions when a stable one exists', () => {
    const p = pkg('t.depr', [V('2.0.0', '7.0', { status: 'deprecated' }), V('1.0.0')]);
    expect(latestVersion(p)?.version).toBe('1.0.0');
  });
});

describe('searchRank (GetPackageSearchRank)', () => {
  const p = pkg('com.foo.resistor', [V('1.0.0')], { name: 'Resistor Library', tags: ['passive'] });
  it('ranks a name hit above a tag hit', () => {
    expect(pcm.searchRank(p, 'resistor')).toBeGreaterThan(pcm.searchRank(p, 'passive'));
  });
  it('returns 0 for no match and 1 for an empty query', () => {
    expect(pcm.searchRank(p, 'zzz')).toBe(0);
    expect(pcm.searchRank(p, '')).toBe(1);
  });
});

describe('pending-changes queue (DIALOG_PCM batch apply)', () => {
  it('queues an install, then applies it as a batch', () => {
    const p = pkg('t.install', [V('1.0.0')]);
    expect(pcm.getPackageState(p)).toBe('available');
    pcm.queue('install', p, 'test');
    expect(pcm.isPending(p.id)).toBe(true);
    expect(pcm.getPackageState(p)).toBe('pending_install');

    const res = pcm.applyPending();
    expect(res.installed).toContain(p.id);
    expect(pcm.isInstalled(p.id)).toBe(true);
    expect(pcm.installedVersion(p.id)).toBe('1.0.0');
    expect(pcm.getPackageState(p)).toBe('installed');
    expect(pcm.pendingCount()).toBe(0);
  });

  it('toggles a queued action off when re-queued, and discards the queue', () => {
    const p = pkg('t.toggle', [V('1.0.0')]);
    pcm.queue('install', p, 'test');
    pcm.queue('install', p, 'test');
    expect(pcm.isPending(p.id)).toBe(false);

    pcm.queue('install', p, 'test');
    pcm.discardPending();
    expect(pcm.pendingCount()).toBe(0);
  });

  it('queues and applies an uninstall', () => {
    const p = pkg('t.uninstall', [V('1.0.0')]);
    pcm.install(p, 'test');
    pcm.queue('uninstall', p, 'test');
    const res = pcm.applyPending();
    expect(res.uninstalled).toContain(p.id);
    expect(pcm.isInstalled(p.id)).toBe(false);
  });
});

describe('update detection (GetPackageUpdateVersion) + state', () => {
  it('reports an available update and clears it once uninstalled', () => {
    pcm.install(pkg('t.upd', [V('1.0.0')]), 'test');
    const newer = pkg('t.upd', [V('2.0.0'), V('1.0.0')]);
    expect(pcm.updateFor(newer)).toBe('2.0.0');
    expect(pcm.getPackageState(newer)).toBe('update_available');

    pcm.uninstall('t.upd');
    expect(pcm.updateFor(newer)).toBeUndefined();
    expect(pcm.getPackageState(newer)).toBe('available');
  });
});

describe('pinning (SetPinned / IsPackagePinned)', () => {
  it('round-trips the pinned flag on an installed package', () => {
    const p = pkg('t.pin', [V('1.0.0')]);
    pcm.install(p, 'test');
    expect(pcm.isPinned(p.id)).toBe(false);
    pcm.setPinned(p.id, true);
    expect(pcm.isPinned(p.id)).toBe(true);
  });
});

describe('payload hashing (VerifyHash) + runtime kinds', () => {
  it('computes the SHA-256 of a UTF-8 string', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('flags the code/back-end package kinds', () => {
    expect(isRuntimeKind('plugin')).toBe(true);
    expect(isRuntimeKind('fab')).toBe(true);
    expect(isRuntimeKind('datasource')).toBe(true);
    expect(isRuntimeKind('library')).toBe(false);
    expect(isRuntimeKind('colortheme')).toBe(false);
  });
});

describe('bundled default repository', () => {
  it('prepares every bundled package with a compatible latest version', () => {
    expect(DEFAULT_REPOSITORY.packages.length).toBeGreaterThan(0);
    for (const p of DEFAULT_REPOSITORY.packages) {
      expect(latestVersion(p), `${p.id} has no compatible version`).toBeDefined();
    }
  });
});
