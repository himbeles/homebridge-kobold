declare module 'node-kobold-control' {
  export interface KoboldMapBoundary {
    id: string;
    name: string;
    type: string;
  }

  export interface KoboldMap {
    id: string;
    name?: string;
    boundaries?: KoboldMapBoundary[];
  }

  export interface KoboldRobotState {
    state?: number;
    action?: number;
    error?: string;
    alert?: string;
    meta?: Record<string, unknown>;
    availableServices?: Record<string, unknown>;
    cleaning?: {
      category?: number;
      mode?: number;
      modifier?: number;
      navigationMode?: number;
      boundaryId?: string;
    };
    details?: {
      isCharging?: boolean;
      isDocked?: boolean;
      isScheduleEnabled?: boolean;
      dockHasBeenSeen?: boolean;
      charge?: number;
    };
    availableCommands?: {
      start?: boolean;
      stop?: boolean;
      pause?: boolean;
      resume?: boolean;
      goToBase?: boolean;
    };
  }

  export interface KoboldRobot {
    name: string;
    _serial: string;
    maps?: KoboldMap[];
    // state properties populated via getState
    availableServices?: Record<string, unknown>;
    isBinFull?: boolean;
    isCharging?: boolean;
    isDocked?: boolean;
    isScheduleEnabled?: boolean;
    dockHasBeenSeen?: boolean;
    charge?: number;
    canStart?: boolean;
    canStop?: boolean;
    canPause?: boolean;
    canResume?: boolean;
    canGoToBase?: boolean;
    eco?: boolean;
    noGoLines?: boolean;
    navigationMode?: number;
    spotWidth?: number;
    spotHeight?: number;
    spotRepeat?: boolean;
    cleaningBoundaryId?: string;
    meta?: Record<string, unknown>;

    getState(callback: (error: unknown, state: KoboldRobotState) => void): void;
    getPersistentMaps(callback: (error: unknown, maps: KoboldMap[]) => void): void;
    getMapBoundaries(mapId: string, callback: (error: unknown, result: { boundaries: KoboldMapBoundary[] }) => void): void;

    startCleaning(eco: boolean, care: number, noGoLines: boolean, callback: (error?: unknown, result?: unknown) => void): void;
    startCleaningBoundary(eco: boolean, extraCare: boolean, boundaryId: string, callback: (error?: unknown, result?: unknown) => void): void;
    startSpotCleaning(
      eco: boolean,
      width: number,
      height: number,
      repeat: boolean,
      extraCare: number,
      callback: (error?: unknown, result?: unknown) => void
    ): void;
    resumeCleaning(callback: (error?: unknown, result?: unknown) => void): void;
    pauseCleaning(callback: (error?: unknown, result?: unknown) => void): void;
    sendToBase(callback: (error?: unknown, result?: unknown) => void): void;
    enableSchedule(callback: (error?: unknown, result?: unknown) => void): void;
    disableSchedule(callback: (error?: unknown, result?: unknown) => void): void;
    findMe(callback: (error?: unknown, result?: unknown) => void): void;
  }

  export class Client {
    authorize(token: string, callback: (error?: unknown) => void): void;
    getRobots(callback: (error: unknown, robots: KoboldRobot[]) => void): void;
  }

  const control: {
    Client: typeof Client;
  };

  export default control;
}
