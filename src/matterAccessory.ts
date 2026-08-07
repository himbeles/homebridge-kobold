import type {
  ClusterStateMap,
  MatterAccessory,
  MatterRequests,
  ServiceAreaState,
} from 'homebridge';
import type { KoboldMap, KoboldRobot } from 'node-kobold-control';
import { isDeepStrictEqual } from 'node:util';

import Debug from 'debug';

import {
  deriveMatterRobotState,
  MatterAreaStatus,
  MatterCleanMode,
  MatterModeTag,
  MatterOperationalState,
  MatterRunMode,
  stableMatterId,
} from './matterState.js';
import type { KoboldHomebridgePlatform, RobotRecord } from './platform.js';

const debug = Debug('homebridge-kobold:matter');
const COMMAND_TIMEOUT_MS = 30_000;

export function matterUuidSeed(serial: string): string {
  return `homebridge-kobold:matter:${serial}`;
}

const OPERATIONAL_STATES = [
  MatterOperationalState.Stopped,
  MatterOperationalState.Running,
  MatterOperationalState.Paused,
  MatterOperationalState.Error,
  MatterOperationalState.SeekingCharger,
  MatterOperationalState.Charging,
  MatterOperationalState.Docked,
];

interface NumericIdMap {
  [sourceId: string]: number;
}

export interface KoboldMatterContext {
  [key: string]: unknown;
  robotSerial: string;
  areaIds: NumericIdMap;
  mapIds: NumericIdMap;
  cleanMode: number;
  selectedAreaIds: number[];
}

interface KoboldArea {
  areaId: number;
  boundaryId: string;
  mapId: number;
  name: string;
}

export class KoboldMatterVacuumAccessory {
  public readonly accessory: MatterAccessory<KoboldMatterContext>;

  private readonly robot: KoboldRobot;
  private readonly areaById = new Map<number, KoboldArea>();
  private readonly areaByBoundaryId = new Map<string, KoboldArea>();
  private pendingBoundaryIds: string[] = [];
  private currentAreaId: number | null = null;
  private hasSeenCurrentAreaRunning = false;
  private readonly completedAreaIds = new Set<number>();
  private readonly skippedAreaIds = new Set<number>();

  constructor(
    private readonly platform: KoboldHomebridgePlatform,
    private readonly robotRecord: RobotRecord,
    cachedAccessory?: MatterAccessory,
  ) {
    this.robot = robotRecord.device;

    const context = this.normaliseContext(cachedAccessory?.context);
    this.buildAreas(context);

    this.accessory = cachedAccessory as MatterAccessory<KoboldMatterContext> | undefined ?? {
      UUID: this.platform.api.matter!.uuid.generate(matterUuidSeed(this.robot._serial)),
      displayName: this.robot.name,
      deviceType: this.platform.api.matter!.deviceTypes.RoboticVacuumCleaner,
      serialNumber: this.robot._serial,
      manufacturer: 'Vorwerk Deutschland Stiftung & Co. KG',
      model: this.modelName,
      firmwareRevision: this.firmwareRevision,
      context,
    };

    this.accessory.displayName = this.robot.name;
    this.accessory.deviceType = this.platform.api.matter!.deviceTypes.RoboticVacuumCleaner;
    this.accessory.serialNumber = this.robot._serial;
    this.accessory.manufacturer = 'Vorwerk Deutschland Stiftung & Co. KG';
    this.accessory.model = this.modelName;
    this.accessory.firmwareRevision = this.firmwareRevision;
    this.accessory.context = context;
    this.accessory.clusters = this.buildClusters();
    this.accessory.handlers = this.buildHandlers();
  }

  private get modelName(): string {
    return typeof this.robotRecord.meta.modelName === 'string'
      ? this.robotRecord.meta.modelName
      : 'Kobold Robot Vacuum';
  }

  private get firmwareRevision(): string | undefined {
    return typeof this.robotRecord.meta.firmware === 'string'
      ? this.robotRecord.meta.firmware
      : undefined;
  }

  private normaliseContext(value: MatterAccessory['context'] | undefined): KoboldMatterContext {
    const source = value && typeof value === 'object' ? value : {};
    return {
      ...source,
      robotSerial: this.robot._serial,
      areaIds: this.normaliseIdMap(source.areaIds),
      mapIds: this.normaliseIdMap(source.mapIds),
      cleanMode: source.cleanMode === MatterCleanMode.Eco
        ? MatterCleanMode.Eco
        : source.cleanMode === MatterCleanMode.Normal
          ? MatterCleanMode.Normal
          : this.robot.eco
            ? MatterCleanMode.Eco
            : MatterCleanMode.Normal,
      selectedAreaIds: Array.isArray(source.selectedAreaIds)
        ? source.selectedAreaIds.filter((id): id is number => typeof id === 'number')
        : [],
    };
  }

  private normaliseIdMap(value: unknown): NumericIdMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    );
  }

  private buildAreas(context: KoboldMatterContext): void {
    const maps = Array.isArray(this.robot.maps) ? this.robot.maps : [];
    const usedIds = new Set<number>();
    const usedNames = new Set<string>();

    maps.forEach((map, mapIndex) => {
      const mapId = this.ensureUniqueId(
        context.mapIds[map.id] ?? stableMatterId(`map:${map.id}`),
        usedIds,
      );
      context.mapIds[map.id] = mapId;

      (map.boundaries ?? [])
        .filter(boundary => boundary.type === 'polygon')
        .forEach(boundary => {
          const sourceId = `${map.id}:${boundary.id}`;
          const areaId = this.ensureUniqueId(
            context.areaIds[sourceId] ?? stableMatterId(`area:${sourceId}`),
            usedIds,
          );
          context.areaIds[sourceId] = areaId;

          const area: KoboldArea = {
            areaId,
            boundaryId: boundary.id,
            mapId,
            name: this.uniqueName(boundary.name || `Area ${areaId}`, usedNames),
          };
          this.areaById.set(areaId, area);
          this.areaByBoundaryId.set(boundary.id, area);
        });

      if (!map.boundaries?.length) {
        debug(`${this.robot.name}: map ${mapIndex + 1} has no selectable polygon boundaries`);
      }
    });

    context.selectedAreaIds = context.selectedAreaIds.filter(id => this.areaById.has(id));
  }

  private uniqueName(name: string, usedNames: Set<string>): string {
    let candidate = name;
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${name} ${suffix}`;
      suffix += 1;
    }
    usedNames.add(candidate);
    return candidate;
  }

  private ensureUniqueId(candidate: number, usedIds: Set<number>): number {
    let id = candidate >>> 0 || 1;
    while (usedIds.has(id)) {
      id = (id + 1) >>> 0 || 1;
    }
    usedIds.add(id);
    return id;
  }

  private buildClusters(): NonNullable<MatterAccessory['clusters']> {
    const state = deriveMatterRobotState(this.robot, this.robotRecord.lastState);
    const serviceArea = this.buildServiceAreaState();

    return {
      identify: {},
      rvcRunMode: {
        supportedModes: [
          { label: 'Idle', mode: MatterRunMode.Idle, modeTags: [{ value: MatterModeTag.Idle }] },
          { label: 'Cleaning', mode: MatterRunMode.Cleaning, modeTags: [{ value: MatterModeTag.Cleaning }] },
        ],
        currentMode: state.runMode,
      },
      rvcCleanMode: {
        supportedModes: [
          { label: 'Normal Vacuum', mode: MatterCleanMode.Normal, modeTags: [{ value: MatterModeTag.Vacuum }] },
          {
            label: 'Eco Vacuum',
            mode: MatterCleanMode.Eco,
            modeTags: [{ value: MatterModeTag.Vacuum }, { value: MatterModeTag.LowEnergy }],
          },
        ],
        currentMode: this.accessory.context.cleanMode,
      },
      rvcOperationalState: {
        operationalStateList: OPERATIONAL_STATES.map(operationalStateId => ({ operationalStateId })),
        operationalState: state.operationalState,
        operationalError: state.operationalError,
      },
      powerSource: {
        status: 0,
        order: 0,
        description: 'Battery',
        batPercentRemaining: state.batteryPercentRemaining,
        batChargeLevel: state.batteryChargeLevel,
        batReplaceability: 0,
        batPresent: true,
        batQuantity: 1,
        batChargeState: state.batteryChargeState,
        batFunctionalWhileCharging: false,
      },
      serviceArea,
    } as NonNullable<MatterAccessory['clusters']>;
  }

  private buildServiceAreaState(): ServiceAreaState {
    const maps = Array.isArray(this.robot.maps) ? this.robot.maps : [];
    const usedMapNames = new Set<string>();
    const supportedMaps = maps.map((map, index) => ({
      mapId: this.accessory?.context.mapIds[map.id]
        ?? this.normalisedMapId(map, index),
      name: this.uniqueName(map.name || `Map ${index + 1}`, usedMapNames),
    }));

    return {
      supportedMaps,
      supportedAreas: Array.from(this.areaById.values()).map(area => ({
        areaId: area.areaId,
        mapId: area.mapId,
        areaInfo: {
          locationInfo: {
            locationName: area.name,
            floorNumber: null,
            areaType: null,
          },
          landmarkInfo: null,
        },
      })),
      selectedAreas: this.accessory?.context.selectedAreaIds ?? [],
      currentArea: this.currentAreaId,
      progress: this.progress,
    };
  }

  private normalisedMapId(map: KoboldMap, index: number): number {
    return this.normaliseContext(this.accessory?.context).mapIds[map.id]
      ?? stableMatterId(`map:${map.id || index}`);
  }

  private get progress(): NonNullable<ServiceAreaState['progress']> {
    return this.accessory?.context.selectedAreaIds.map(areaId => ({
      areaId,
      status: this.currentAreaId === areaId
        ? MatterAreaStatus.Operating
        : this.completedAreaIds.has(areaId)
          ? MatterAreaStatus.Completed
          : this.skippedAreaIds.has(areaId)
            ? MatterAreaStatus.Skipped
            : MatterAreaStatus.Pending,
    })) ?? [];
  }

  private buildHandlers(): NonNullable<MatterAccessory['handlers']> {
    return {
      identify: {
        identify: async () => {
          await this.runCommand('identify', callback => this.robot.findMe(callback));
        },
      },
      rvcRunMode: {
        changeToMode: async request => this.changeRunMode(request),
      },
      rvcCleanMode: {
        changeToMode: async request => this.changeCleanMode(request),
      },
      rvcOperationalState: {
        pause: async () => this.pause(),
        resume: async () => this.resume(),
        goHome: async () => this.goHome(),
      },
      serviceArea: {
        selectAreas: async request => this.selectAreas(request),
        skipArea: async request => this.skipArea(request),
      },
    };
  }

  private async changeRunMode(request: MatterRequests.ChangeToMode): Promise<void> {
    await this.refreshBeforeCommand('change run mode');

    if (request.newMode === MatterRunMode.Cleaning) {
      if (this.robot.canResume) {
        await this.runCommand('resume cleaning', callback => this.robot.resumeCleaning(callback));
      } else if (this.robot.canStart) {
        await this.startSelectedCleaning();
      } else if (!this.robot.canPause) {
        throw new Error('The robot cannot start cleaning in its current state.');
      }

      await this.updateOperationalState(MatterOperationalState.Running);
      this.rememberState(this.platform.api.matter!.clusterNames.RvcRunMode, {
        currentMode: MatterRunMode.Cleaning,
      });
      this.platform.scheduleActiveRefresh(this.robot._serial);
      return;
    }

    if (request.newMode === MatterRunMode.Idle) {
      await this.goHome(false, true);
      this.rememberState(this.platform.api.matter!.clusterNames.RvcRunMode, {
        currentMode: MatterRunMode.Idle,
      });
      return;
    }

    throw new Error(`Unsupported run mode ${request.newMode}.`);
  }

  private async changeCleanMode(request: MatterRequests.ChangeToMode): Promise<void> {
    if (this.robot.canPause || this.robot.canResume) {
      throw new Error('The cleaning mode cannot be changed while a cleaning cycle is active.');
    }
    if (request.newMode === MatterCleanMode.Normal) {
      this.accessory.context.cleanMode = MatterCleanMode.Normal;
      this.robot.eco = false;
      this.rememberState(this.platform.api.matter!.clusterNames.RvcCleanMode, {
        currentMode: MatterCleanMode.Normal,
      });
      return;
    }
    if (request.newMode === MatterCleanMode.Eco) {
      this.accessory.context.cleanMode = MatterCleanMode.Eco;
      this.robot.eco = true;
      this.rememberState(this.platform.api.matter!.clusterNames.RvcCleanMode, {
        currentMode: MatterCleanMode.Eco,
      });
      return;
    }
    throw new Error(`Unsupported clean mode ${request.newMode}.`);
  }

  private async pause(): Promise<void> {
    await this.refreshBeforeCommand('pause');
    if (!this.robot.canPause) {
      throw new Error('The robot cannot be paused in its current state.');
    }
    await this.runCommand('pause cleaning', callback => this.robot.pauseCleaning(callback));
    await this.updateOperationalState(MatterOperationalState.Paused);
  }

  private async resume(): Promise<void> {
    await this.refreshBeforeCommand('resume');
    if (!this.robot.canResume) {
      throw new Error('The robot cannot be resumed in its current state.');
    }
    await this.runCommand('resume cleaning', callback => this.robot.resumeCleaning(callback));
    await this.updateOperationalState(MatterOperationalState.Running);
    this.platform.scheduleActiveRefresh(this.robot._serial);
  }

  private async goHome(preserveAreaQueue = false, stateAlreadyRefreshed = false): Promise<void> {
    if (!stateAlreadyRefreshed) {
      await this.refreshBeforeCommand('return to dock');
    }

    if (this.robot.isDocked) {
      if (!preserveAreaQueue) {
        this.cancelAreaQueue();
      }
      await this.updateOperationalState(this.robot.isCharging
        ? MatterOperationalState.Charging
        : MatterOperationalState.Docked);
      await this.updateServiceAreaState();
      return;
    }

    if (this.robot.canPause) {
      await this.runCommand('pause before returning to dock', callback => this.robot.pauseCleaning(callback));
      await this.delay(1000);
    }

    if (this.robot.canGoToBase || this.robot.canPause) {
      await this.runCommand('return to dock', callback => this.robot.sendToBase(callback));
      if (!preserveAreaQueue) {
        this.cancelAreaQueue();
      }
      await this.updateOperationalState(MatterOperationalState.SeekingCharger);
      this.platform.scheduleActiveRefresh(this.robot._serial);
      await this.updateServiceAreaState();
      return;
    }

    throw new Error('The robot cannot return to its dock in its current state.');
  }

  private cancelAreaQueue(): void {
    this.pendingBoundaryIds = [];
    if (this.currentAreaId !== null) {
      this.skippedAreaIds.add(this.currentAreaId);
    }
    this.currentAreaId = null;
    this.hasSeenCurrentAreaRunning = false;
  }

  private async selectAreas(request: MatterRequests.SelectAreas): Promise<void> {
    if (this.robot.canPause || this.robot.canResume) {
      throw new Error('Areas cannot be changed while a cleaning cycle is active.');
    }

    const unsupported = request.newAreas.find(areaId => !this.areaById.has(areaId));
    if (unsupported !== undefined) {
      throw new Error(`Unsupported area ${unsupported}.`);
    }

    this.accessory.context.selectedAreaIds = [...request.newAreas];
    this.pendingBoundaryIds = [];
    this.currentAreaId = null;
    this.completedAreaIds.clear();
    this.skippedAreaIds.clear();
    this.rememberState(this.platform.api.matter!.clusterNames.ServiceArea, {
      selectedAreas: this.accessory.context.selectedAreaIds,
    });
    // The registered Matter accessory holds this same context object. Avoid
    // updatePlatformAccessories() here because Homebridge currently drops the
    // live endpoint when updating a cached external RVC accessory.
  }

  private async skipArea(request: MatterRequests.SkipArea): Promise<void> {
    const area = this.areaById.get(request.skippedArea);
    if (!area) {
      throw new Error(`Unsupported area ${request.skippedArea}.`);
    }

    const pendingIndex = this.pendingBoundaryIds.indexOf(area.boundaryId);
    if (pendingIndex >= 0) {
      this.pendingBoundaryIds.splice(pendingIndex, 1);
      this.skippedAreaIds.add(area.areaId);
      await this.updateServiceAreaState();
      return;
    }

    if (this.currentAreaId === area.areaId) {
      this.skippedAreaIds.add(area.areaId);
      await this.goHome(true);
      return;
    }

    throw new Error(`Area ${request.skippedArea} is not part of the active cleaning cycle.`);
  }

  private async startSelectedCleaning(): Promise<void> {
    this.completedAreaIds.clear();
    this.skippedAreaIds.clear();
    const boundaryIds = this.accessory.context.selectedAreaIds
      .map(areaId => this.areaById.get(areaId)?.boundaryId)
      .filter((boundaryId): boundaryId is string => boundaryId !== undefined);

    if (boundaryIds.length === 0) {
      this.pendingBoundaryIds = [];
      this.currentAreaId = null;
      await this.startHouseCleaning();
      return;
    }

    this.pendingBoundaryIds = boundaryIds;
    await this.startNextArea();
  }

  private async startHouseCleaning(): Promise<void> {
    const eco = this.accessory.context.cleanMode === MatterCleanMode.Eco;
    const extraCare = this.robot.navigationMode === 2;
    const noGoLines = !!this.robot.noGoLines;
    await this.runCommand('start whole-home cleaning', callback => this.robot.startCleaning(
      eco,
      extraCare ? 2 : 1,
      noGoLines,
      callback,
    ));
  }

  private async startNextArea(): Promise<void> {
    const boundaryId = this.pendingBoundaryIds.shift();
    if (!boundaryId) {
      this.currentAreaId = null;
      this.hasSeenCurrentAreaRunning = false;
      await this.updateServiceAreaState();
      return;
    }

    const area = this.areaByBoundaryId.get(boundaryId);
    if (!area) {
      await this.startNextArea();
      return;
    }

    this.currentAreaId = area.areaId;
    this.hasSeenCurrentAreaRunning = false;
    await this.runCommand(`start cleaning area ${area.name}`, callback => this.robot.startCleaningBoundary(
      this.accessory.context.cleanMode === MatterCleanMode.Eco,
      this.robot.navigationMode === 2,
      boundaryId,
      callback,
    ));
    await this.updateOperationalState(MatterOperationalState.Running);
    await this.updateChangedState(this.platform.api.matter!.clusterNames.RvcRunMode, {
      currentMode: MatterRunMode.Cleaning,
    });
    this.platform.scheduleActiveRefresh(this.robot._serial);
    await this.updateServiceAreaState();
  }

  public async syncState(): Promise<void> {
    const state = deriveMatterRobotState(this.robot, this.robotRecord.lastState);
    let startedNextArea = false;

    // The Kobold API reports the parameters of the last cleaning while idle.
    // Treat the reported clean mode as authoritative only during an active
    // cleaning cycle; otherwise preserve the mode selected by the Matter
    // controller for the next run.
    if (state.runMode === MatterRunMode.Cleaning) {
      this.accessory.context.cleanMode = state.cleanMode;
    }

    const observedArea = this.robot.cleaningBoundaryId
      ? this.areaByBoundaryId.get(this.robot.cleaningBoundaryId)
      : undefined;
    if (observedArea && this.robot.canPause) {
      this.currentAreaId = observedArea.areaId;
      this.hasSeenCurrentAreaRunning = true;
    }

    if (this.currentAreaId !== null && this.robot.isDocked && this.hasSeenCurrentAreaRunning) {
      if (!this.skippedAreaIds.has(this.currentAreaId)) {
        this.completedAreaIds.add(this.currentAreaId);
      }
      this.currentAreaId = null;
      this.hasSeenCurrentAreaRunning = false;
      if (this.pendingBoundaryIds.length > 0) {
        await this.startNextArea();
        startedNextArea = true;
      }
    }

    const matter = this.platform.api.matter;
    if (!matter) {
      return;
    }

    const updates: Promise<void>[] = [
      this.updateChangedState(
        matter.clusterNames.RvcCleanMode,
        { currentMode: this.accessory.context.cleanMode },
      ),
      this.updateChangedState(
        matter.clusterNames.PowerSource,
        {
          batPercentRemaining: state.batteryPercentRemaining,
          batChargeLevel: state.batteryChargeLevel,
          batChargeState: state.batteryChargeState,
        },
      ),
      this.updateServiceAreaState(),
    ];

    // The cloud snapshot still says "docked" immediately after starting the
    // next queued room. Do not overwrite the optimistic running state emitted
    // by startNextArea() until the next refresh observes the new cleaning job.
    if (!startedNextArea) {
      updates.push(
        this.updateChangedState(
          matter.clusterNames.RvcRunMode,
          { currentMode: state.runMode },
        ),
        this.updateChangedState(
          matter.clusterNames.RvcOperationalState,
          {
            operationalState: state.operationalState,
            operationalError: state.operationalError,
          },
        ),
      );
    }

    await Promise.all(updates);
  }

  private async updateOperationalState(operationalState: number): Promise<void> {
    const matter = this.platform.api.matter;
    if (!matter) {
      return;
    }
    await this.updateChangedState(
      matter.clusterNames.RvcOperationalState,
      { operationalState },
    );
  }

  private async updateServiceAreaState(): Promise<void> {
    const matter = this.platform.api.matter;
    if (!matter) {
      return;
    }
    await this.updateChangedState(
      matter.clusterNames.ServiceArea,
      {
        selectedAreas: this.accessory.context.selectedAreaIds,
        currentArea: this.currentAreaId,
        progress: this.progress,
      },
    );
  }

  private async refreshBeforeCommand(action: string): Promise<void> {
    const refreshed = await this.platform.updateRobot(this.robot._serial, true);
    if (!refreshed) {
      throw new Error(`Cannot ${action}: the latest robot state could not be retrieved.`);
    }
  }

  private rememberState<K extends keyof ClusterStateMap>(
    cluster: K,
    attributes: Partial<ClusterStateMap[K]>,
  ): void {
    const clusters = this.accessory.clusters as Record<string, Record<string, unknown> | undefined>;
    clusters[cluster] = {
      ...(clusters[cluster] ?? {}),
      ...attributes,
    };
  }

  private async updateChangedState<K extends keyof ClusterStateMap>(
    cluster: K,
    attributes: Partial<ClusterStateMap[K]>,
  ): Promise<void> {
    const matter = this.platform.api.matter;
    if (!matter) {
      return;
    }

    const clusters = this.accessory.clusters as Record<string, Record<string, unknown> | undefined>;
    const current = clusters[cluster] ?? {};
    const changed = Object.fromEntries(
      Object.entries(attributes)
        .filter(([key, value]) => !isDeepStrictEqual(current[key], value)),
    ) as Partial<ClusterStateMap[K]>;

    if (Object.keys(changed).length === 0) {
      return;
    }

    await matter.updateAccessoryState(this.accessory.UUID, cluster, changed);
    this.rememberState(cluster, changed);
  }

  private runCommand<T = unknown>(
    action: string,
    command: (callback: (error?: unknown, result?: T) => void) => void,
  ): Promise<T | undefined> {
    this.platform.log.info(`${this.robot.name}: Matter command: ${action}`);

    return new Promise<T | undefined>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${action} timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds.`));
      }, COMMAND_TIMEOUT_MS);

      const callback = (error?: unknown, result?: T) => {
        clearTimeout(timeout);
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } else {
          resolve(result);
        }
      };

      try {
        command(callback);
      } catch (error) {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }).then(result => {
      this.platform.log.info(`${this.robot.name}: Matter command completed: ${action}`);
      return result;
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`${this.robot.name}: Matter command failed (${action}): ${message}`);
      throw error;
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
