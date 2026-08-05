import { describe, expect, it, vi } from 'vitest';

import type { MatterAccessory } from 'homebridge';
import type { KoboldRobot } from 'node-kobold-control';

import { KoboldMatterVacuumAccessory } from '../src/matterAccessory.js';
import { MatterOperationalState, MatterRunMode } from '../src/matterState.js';
import type { KoboldHomebridgePlatform, RobotRecord } from '../src/platform.js';

function createHarness() {
  const startBoundary = vi.fn((
    _eco: boolean,
    _extraCare: boolean,
    _boundaryId: string,
    callback: (error?: unknown, result?: unknown) => void,
  ) => callback(undefined, 'ok'));
  const startCleaning = vi.fn((
    _eco: boolean,
    _care: number,
    _noGoLines: boolean,
    callback: (error?: unknown, result?: unknown) => void,
  ) => callback(undefined, 'ok'));

  const robot = {
    name: 'Kobold',
    _serial: 'serial-1',
    charge: 80,
    canStart: true,
    eco: false,
    navigationMode: 1,
    noGoLines: false,
    maps: [
      {
        id: 'map-1',
        name: 'Home',
        boundaries: [
          { id: 'kitchen', name: 'Room', type: 'polygon' },
          { id: 'bedroom', name: 'Room', type: 'polygon' },
          { id: 'line', name: 'NoGo', type: 'line' },
        ],
      },
      {
        id: 'map-2',
        name: 'Home',
        boundaries: [],
      },
    ],
    startCleaning,
    startCleaningBoundary: startBoundary,
    pauseCleaning: vi.fn((callback: (error?: unknown, result?: unknown) => void) => callback(undefined, 'ok')),
    resumeCleaning: vi.fn((callback: (error?: unknown, result?: unknown) => void) => callback(undefined, 'ok')),
    sendToBase: vi.fn((callback: (error?: unknown, result?: unknown) => void) => callback(undefined, 'ok')),
    findMe: vi.fn((callback: (error?: unknown, result?: unknown) => void) => callback(undefined, 'ok')),
  } as unknown as KoboldRobot;

  const updateAccessoryState = vi.fn(async () => undefined);
  const updatePlatformAccessories = vi.fn(async () => undefined);
  const platform = {
    api: {
      matter: {
        uuid: { generate: (seed: string) => `uuid:${seed}` },
        deviceTypes: { RoboticVacuumCleaner: {} },
        clusterNames: {
          RvcRunMode: 'rvcRunMode',
          RvcCleanMode: 'rvcCleanMode',
          RvcOperationalState: 'rvcOperationalState',
          PowerSource: 'powerSource',
          ServiceArea: 'serviceArea',
        },
        updateAccessoryState,
        updatePlatformAccessories,
      },
    },
    updateRobot: vi.fn(async () => undefined),
    scheduleActiveRefresh: vi.fn(),
  } as unknown as KoboldHomebridgePlatform;

  const record: RobotRecord = {
    device: robot,
    meta: { modelName: 'VR300', firmware: '4.6.1' },
    availableServices: {},
  };

  const handler = new KoboldMatterVacuumAccessory(platform, record);
  return {
    handler,
    platform,
    record,
    robot,
    startBoundary,
    startCleaning,
    updateAccessoryState,
    updatePlatformAccessories,
  };
}

describe('Kobold Matter accessory', () => {
  it('publishes polygon boundaries as stable, uniquely named service areas', () => {
    const first = createHarness();
    const areas = first.handler.accessory.clusters?.serviceArea?.supportedAreas ?? [];
    expect(areas).toHaveLength(2);
    expect(areas.map(area => area.areaInfo.locationInfo?.locationName)).toEqual(['Room', 'Room 2']);
    expect(first.handler.accessory.clusters?.serviceArea?.supportedMaps?.map(map => map.name))
      .toEqual(['Home', 'Home 2']);

    const cached = {
      ...first.handler.accessory,
      context: structuredClone(first.handler.accessory.context),
    } as MatterAccessory;
    const second = createHarness();
    const restored = new KoboldMatterVacuumAccessory(second.platform, second.record, cached);
    expect(restored.accessory.clusters?.serviceArea?.supportedAreas?.map(area => area.areaId))
      .toEqual(areas.map(area => area.areaId));
  });

  it('starts a whole-home clean when no areas are selected', async () => {
    const harness = createHarness();
    await harness.handler.accessory.handlers?.rvcRunMode?.changeToMode?.({ newMode: MatterRunMode.Cleaning });
    expect(harness.startCleaning).toHaveBeenCalledOnce();
    expect(harness.startBoundary).not.toHaveBeenCalled();
  });

  it('persists selected areas and queues multiple Kobold boundary cleans', async () => {
    const harness = createHarness();
    const areas = harness.handler.accessory.clusters?.serviceArea?.supportedAreas ?? [];
    const selected = areas.map(area => area.areaId);

    await harness.handler.accessory.handlers?.serviceArea?.selectAreas?.({ newAreas: selected });
    expect(harness.handler.accessory.context.selectedAreaIds).toEqual(selected);
    expect(harness.updatePlatformAccessories).toHaveBeenCalledOnce();

    await harness.handler.accessory.handlers?.rvcRunMode?.changeToMode?.({ newMode: MatterRunMode.Cleaning });
    expect(harness.startBoundary).toHaveBeenCalledTimes(1);
    expect(harness.startBoundary.mock.calls[0][2]).toBe('kitchen');

    harness.robot.canStart = false;
    harness.robot.canPause = true;
    harness.robot.cleaningBoundaryId = 'kitchen';
    await harness.handler.syncState();

    harness.robot.canPause = false;
    harness.robot.isDocked = true;
    harness.robot.cleaningBoundaryId = undefined;
    await harness.handler.syncState();
    expect(harness.startBoundary).toHaveBeenCalledTimes(2);
    expect(harness.startBoundary.mock.calls[1][2]).toBe('bedroom');

    const runModeUpdates = harness.updateAccessoryState.mock.calls
      .filter(call => call[1] === 'rvcRunMode');
    const operationalUpdates = harness.updateAccessoryState.mock.calls
      .filter(call => call[1] === 'rvcOperationalState');
    expect(runModeUpdates.at(-1)?.[2]).toEqual({ currentMode: MatterRunMode.Cleaning });
    expect(operationalUpdates.at(-1)?.[2]).toEqual({ operationalState: MatterOperationalState.Running });
  });

  it('cancels the remaining area queue when sent home explicitly', async () => {
    const harness = createHarness();
    const selected = harness.handler.accessory.clusters?.serviceArea?.supportedAreas?.map(area => area.areaId) ?? [];
    await harness.handler.accessory.handlers?.serviceArea?.selectAreas?.({ newAreas: selected });
    await harness.handler.accessory.handlers?.rvcRunMode?.changeToMode?.({ newMode: MatterRunMode.Cleaning });

    harness.robot.canStart = false;
    harness.robot.canPause = true;
    harness.robot.cleaningBoundaryId = 'kitchen';
    await harness.handler.syncState();

    harness.robot.canPause = false;
    harness.robot.canGoToBase = true;
    await harness.handler.accessory.handlers?.rvcOperationalState?.goHome?.({});

    harness.robot.canGoToBase = false;
    harness.robot.isDocked = true;
    harness.robot.cleaningBoundaryId = undefined;
    await harness.handler.syncState();
    expect(harness.startBoundary).toHaveBeenCalledOnce();
  });
});
