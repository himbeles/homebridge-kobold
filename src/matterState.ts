import type { KoboldRobot, KoboldRobotState } from 'node-kobold-control';

export const MatterRunMode = {
  Idle: 0,
  Cleaning: 1,
} as const;

export const MatterCleanMode = {
  Normal: 0,
  Eco: 1,
} as const;

export const MatterModeTag = {
  LowEnergy: 4,
  Idle: 16384,
  Cleaning: 16385,
  Vacuum: 16385,
} as const;

export const MatterOperationalState = {
  Stopped: 0,
  Running: 1,
  Paused: 2,
  Error: 3,
  SeekingCharger: 64,
  Charging: 65,
  Docked: 66,
} as const;

export const MatterOperationalError = {
  NoError: 0,
  DustBinFull: 67,
} as const;

export const MatterAreaStatus = {
  Pending: 0,
  Operating: 1,
  Skipped: 2,
  Completed: 3,
} as const;

export const MatterBatteryChargeLevel = {
  Ok: 0,
  Warning: 1,
  Critical: 2,
} as const;

export const MatterBatteryChargeState = {
  Unknown: 0,
  IsCharging: 1,
  IsAtFullCharge: 2,
  IsNotCharging: 3,
} as const;

export interface MatterRobotState {
  operationalState: number;
  operationalError: {
    errorStateId: number;
    errorStateDetails?: string;
  };
  runMode: number;
  cleanMode: number;
  batteryPercentRemaining: number;
  batteryChargeLevel: number;
  batteryChargeState: number;
}

export function clampBatteryPercentage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

export function batteryChargeLevel(percent: number): number {
  if (percent <= 10) {
    return MatterBatteryChargeLevel.Critical;
  }
  if (percent <= 20) {
    return MatterBatteryChargeLevel.Warning;
  }
  return MatterBatteryChargeLevel.Ok;
}

export function deriveOperationalState(robot: KoboldRobot, state?: KoboldRobotState): number {
  if (robot.isBinFull) {
    return MatterOperationalState.Error;
  }
  if (robot.isCharging) {
    return MatterOperationalState.Charging;
  }
  if (robot.isDocked) {
    return MatterOperationalState.Docked;
  }
  // Neato/Vorwerk action 4 represents docking.
  if (state?.action === 4) {
    return MatterOperationalState.SeekingCharger;
  }
  if (robot.canPause) {
    return MatterOperationalState.Running;
  }
  if (robot.canResume) {
    return MatterOperationalState.Paused;
  }
  return MatterOperationalState.Stopped;
}

export function deriveMatterRobotState(robot: KoboldRobot, state?: KoboldRobotState): MatterRobotState {
  const percent = clampBatteryPercentage(robot.charge);
  const operationalState = deriveOperationalState(robot, state);
  const isCleaning = operationalState === MatterOperationalState.Running
    || operationalState === MatterOperationalState.Paused;

  return {
    operationalState,
    operationalError: robot.isBinFull
      ? {
        errorStateId: MatterOperationalError.DustBinFull,
        errorStateDetails: 'The robot reports that its dust bin is full.',
      }
      : { errorStateId: MatterOperationalError.NoError },
    runMode: isCleaning ? MatterRunMode.Cleaning : MatterRunMode.Idle,
    cleanMode: robot.eco ? MatterCleanMode.Eco : MatterCleanMode.Normal,
    batteryPercentRemaining: percent * 2,
    batteryChargeLevel: batteryChargeLevel(percent),
    batteryChargeState: robot.isCharging
      ? MatterBatteryChargeState.IsCharging
      : robot.isDocked && percent >= 100
        ? MatterBatteryChargeState.IsAtFullCharge
        : MatterBatteryChargeState.IsNotCharging,
  };
}

/**
 * Produce a deterministic positive uint32 suitable for Matter map and area IDs.
 */
export function stableMatterId(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0) || 1;
}
