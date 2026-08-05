import { describe, expect, it } from 'vitest';

import type { KoboldRobot, KoboldRobotState } from 'node-kobold-control';

import {
  batteryChargeLevel,
  clampBatteryPercentage,
  deriveMatterRobotState,
  deriveOperationalState,
  MatterBatteryChargeLevel,
  MatterBatteryChargeState,
  MatterCleanMode,
  MatterOperationalError,
  MatterOperationalState,
  MatterRunMode,
  stableMatterId,
} from '../src/matterState.js';

function robot(overrides: Partial<KoboldRobot> = {}): KoboldRobot {
  return {
    name: 'Kobold',
    _serial: 'serial-1',
    charge: 50,
    ...overrides,
  } as KoboldRobot;
}

describe('Matter state mapping', () => {
  it('maps the Kobold capability flags to operational states in priority order', () => {
    expect(deriveOperationalState(robot({ isCharging: true, isDocked: true }))).toBe(MatterOperationalState.Charging);
    expect(deriveOperationalState(robot({ isDocked: true }))).toBe(MatterOperationalState.Docked);
    expect(deriveOperationalState(robot(), { action: 4 } as KoboldRobotState)).toBe(MatterOperationalState.SeekingCharger);
    expect(deriveOperationalState(robot({ canPause: true }))).toBe(MatterOperationalState.Running);
    expect(deriveOperationalState(robot({ canResume: true }))).toBe(MatterOperationalState.Paused);
    expect(deriveOperationalState(robot())).toBe(MatterOperationalState.Stopped);
  });

  it('reports a full dust bin as a Matter operational error', () => {
    const state = deriveMatterRobotState(robot({ isBinFull: true }));
    expect(state.operationalState).toBe(MatterOperationalState.Error);
    expect(state.operationalError.errorStateId).toBe(MatterOperationalError.DustBinFull);
  });

  it('maps running and eco state to run and clean modes', () => {
    const state = deriveMatterRobotState(robot({ canPause: true, eco: true }));
    expect(state.runMode).toBe(MatterRunMode.Cleaning);
    expect(state.cleanMode).toBe(MatterCleanMode.Eco);
  });

  it('encodes battery percentage in Matter half-percent units', () => {
    const state = deriveMatterRobotState(robot({ charge: 73, isCharging: true }));
    expect(state.batteryPercentRemaining).toBe(146);
    expect(state.batteryChargeState).toBe(MatterBatteryChargeState.IsCharging);
  });

  it('clamps battery values and assigns warning levels', () => {
    expect(clampBatteryPercentage(-5)).toBe(0);
    expect(clampBatteryPercentage(101)).toBe(100);
    expect(clampBatteryPercentage(Number.NaN)).toBe(0);
    expect(batteryChargeLevel(10)).toBe(MatterBatteryChargeLevel.Critical);
    expect(batteryChargeLevel(20)).toBe(MatterBatteryChargeLevel.Warning);
    expect(batteryChargeLevel(21)).toBe(MatterBatteryChargeLevel.Ok);
  });

  it('generates deterministic non-zero uint32 IDs', () => {
    const first = stableMatterId('area:map-1:kitchen');
    expect(first).toBe(stableMatterId('area:map-1:kitchen'));
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(0xffffffff);
    expect(first).not.toBe(stableMatterId('area:map-1:bedroom'));
  });
});
