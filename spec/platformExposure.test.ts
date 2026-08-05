import { describe, expect, it, vi } from 'vitest';

import type { API, Logging, PlatformConfig } from 'homebridge';

import { KoboldHomebridgePlatform } from '../src/platform.js';

interface ExposureInternals {
  exposeHomeKit: boolean;
  exposeMatter: boolean;
}

function createPlatform(exposureMode: 'homekit' | 'matter' | 'both', matterEnabled: boolean) {
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
  const api = {
    hap: {
      Characteristic: FakeCharacteristic,
      Service: FakeService,
    },
    isMatterEnabled: matterEnabled ? () => true : undefined,
    matter: matterEnabled ? {} : undefined,
    on: vi.fn(),
  } as unknown as API;
  const config = {
    platform: 'KoboldVacuumRobot',
    token: 'token',
    exposureMode,
  } as PlatformConfig;

  const platform = new KoboldHomebridgePlatform(log, config, api);
  return {
    internals: platform as unknown as ExposureInternals,
    log,
  };
}

describe('accessory exposure selection', () => {
  it('falls back to HomeKit when Matter is requested on a bridge without Matter', () => {
    const { internals, log } = createPlatform('matter', false);
    expect(internals.exposeHomeKit).toBe(true);
    expect(internals.exposeMatter).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to HomeKit'));
  });

  it('enables both adapters during migration when Matter is available', () => {
    const { internals } = createPlatform('both', true);
    expect(internals.exposeHomeKit).toBe(true);
    expect(internals.exposeMatter).toBe(true);
  });
});
