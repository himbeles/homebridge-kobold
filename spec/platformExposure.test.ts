import { describe, expect, it, vi } from 'vitest';

import type { API, Logging, MatterAccessory, PlatformConfig } from 'homebridge';
import type { KoboldRobot } from 'node-kobold-control';

import type { KoboldMatterVacuumAccessory } from '../src/matterAccessory.js';
import { KoboldHomebridgePlatform } from '../src/platform.js';
import type { RobotRecord } from '../src/platform.js';

interface PlatformInternals {
  matterAvailable: boolean;
  loadRobots: () => Promise<RobotRecord[]>;
  setupMainAccessory: (robot: RobotRecord) => void;
  setupMatterAccessory: (robot: RobotRecord) => MatterAccessory;
  discoverRobots: () => Promise<void>;
  updateRobotAndAccessories: (robot: RobotRecord) => Promise<void>;
}

function createRecord(serial = 'serial-1'): RobotRecord {
  return {
    device: {
      name: 'Kobold',
      _serial: serial,
    } as KoboldRobot,
    meta: {},
    availableServices: {},
  };
}

function createPlatform(matterEnabled: boolean, externalOnly = false) {
  class FakeCharacteristic {}
  class FakeService {}

  const log = Object.assign(vi.fn(), {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    prefix: 'test',
    success: vi.fn(),
    warn: vi.fn(),
  }) as unknown as Logging;
  const matter = matterEnabled ? {
    registerPlatformAccessories: vi.fn(async () => undefined),
    unregisterPlatformAccessories: vi.fn(async () => undefined),
  } : undefined;
  const api = {
    hap: {
      Characteristic: FakeCharacteristic,
      Service: FakeService,
    },
    isMatterEnabled: () => matterEnabled,
    matter,
    on: vi.fn(),
    registerPlatformAccessories: vi.fn(),
    unregisterPlatformAccessories: vi.fn(),
  } as unknown as API;
  const config: PlatformConfig = {
    platform: 'KoboldVacuumRobot',
    token: 'token',
    ...(externalOnly ? {
      _bridge: {
        matter: {
          enabled: false,
          externalsOnly: true,
        },
      },
    } : {}),
  };

  const platform = new KoboldHomebridgePlatform(log, config, api);
  return {
    api,
    internals: platform as unknown as PlatformInternals,
    log,
    matter: matter as NonNullable<typeof matter> | undefined,
    platform,
  };
}

function stubDiscovery(platform: KoboldHomebridgePlatform, records: RobotRecord[]) {
  const internals = platform as unknown as PlatformInternals;
  internals.loadRobots = vi.fn(async () => records);
  internals.setupMainAccessory = vi.fn();
  internals.setupMatterAccessory = vi.fn(robot => {
    const accessory = {
      UUID: `matter:${robot.device._serial}`,
      displayName: robot.device.name,
    } as MatterAccessory;
    robot.matterAccessory = {
      accessory,
      syncState: vi.fn(async () => undefined),
    } as unknown as KoboldMatterVacuumAccessory;
    platform.discoveredMatterUUIDs.push(accessory.UUID);
    return accessory;
  });
  vi.spyOn(platform, 'updateRobotTimer').mockImplementation(() => undefined);
  return internals;
}

describe('bridge-controlled protocol exposure', () => {
  it('registers only the HAP accessory when Matter is disabled', async () => {
    const { internals, platform } = createPlatform(false);
    const discovery = stubDiscovery(platform, [createRecord()]);

    await internals.discoverRobots();

    expect(discovery.setupMainAccessory).toHaveBeenCalledOnce();
    expect(discovery.setupMatterAccessory).not.toHaveBeenCalled();
  });

  it('registers HAP and Matter accessories when Matter is active', async () => {
    const { internals, matter, platform } = createPlatform(true);
    const discovery = stubDiscovery(platform, [createRecord()]);

    await internals.discoverRobots();

    expect(discovery.setupMainAccessory).toHaveBeenCalledOnce();
    expect(discovery.setupMatterAccessory).toHaveBeenCalledOnce();
    expect(matter?.registerPlatformAccessories).toHaveBeenCalledOnce();
  });

  it('registers Matter accessories when only external-accessory Matter is enabled', async () => {
    // Homebridge reports external-only mode through isMatterEnabled() and
    // provides api.matter even though the aggregate Matter bridge is disabled.
    const { internals, matter, platform } = createPlatform(true, true);
    const discovery = stubDiscovery(platform, [createRecord()]);

    await internals.discoverRobots();

    expect(discovery.setupMainAccessory).toHaveBeenCalledOnce();
    expect(discovery.setupMatterAccessory).toHaveBeenCalledOnce();
    expect(matter?.registerPlatformAccessories).toHaveBeenCalledOnce();
  });

  it('does not register a restored Matter accessory as new', async () => {
    const { internals, matter, platform } = createPlatform(true);
    const cached = {
      UUID: 'matter:serial-1',
      displayName: 'Kobold',
    } as MatterAccessory;
    platform.matterAccessories.set(cached.UUID, cached);
    stubDiscovery(platform, [createRecord()]);

    await internals.discoverRobots();

    expect(matter?.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it('removes stale accessories only after successful discovery', async () => {
    const successful = createPlatform(true);
    const staleMatter = { UUID: 'stale-matter', displayName: 'Stale Matter' } as MatterAccessory;
    successful.platform.matterAccessories.set(staleMatter.UUID, staleMatter);
    const successfulDiscovery = stubDiscovery(successful.platform, []);

    await successfulDiscovery.discoverRobots();
    expect(successful.matter?.unregisterPlatformAccessories).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      [staleMatter],
    );

    const failed = createPlatform(true);
    const preservedMatter = { UUID: 'preserved-matter', displayName: 'Preserved Matter' } as MatterAccessory;
    failed.platform.matterAccessories.set(preservedMatter.UUID, preservedMatter);
    const failedInternals = failed.platform as unknown as PlatformInternals;
    failedInternals.loadRobots = vi.fn(async () => {
      throw new Error('offline');
    });

    await failedInternals.discoverRobots();
    expect(failed.matter?.unregisterPlatformAccessories).not.toHaveBeenCalled();
    expect(failed.platform.matterAccessories.get(preservedMatter.UUID)).toBe(preservedMatter);
  });

  it('retains the last state and skips accessory synchronization after a refresh error', async () => {
    const { platform } = createPlatform(false);
    const previousState = { charge: 80 };
    const updated = vi.fn();
    const syncState = vi.fn(async () => undefined);
    const record = createRecord();
    record.device.getState = vi.fn(callback => callback(new Error('offline')));
    record.lastState = previousState as RobotRecord['lastState'];
    record.mainAccessory = { updated } as unknown as RobotRecord['mainAccessory'];
    record.matterAccessory = { syncState } as unknown as RobotRecord['matterAccessory'];
    platform.robots.push(record);

    await (platform as unknown as PlatformInternals).updateRobotAndAccessories(record);

    expect(record.lastState).toBe(previousState);
    expect(record.lastUpdate).toBeUndefined();
    expect(updated).not.toHaveBeenCalled();
    expect(syncState).not.toHaveBeenCalled();
  });
});
