import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  MatterAccessory,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import Debug from 'debug';
import control from 'node-kobold-control';
import type { KoboldRobot, KoboldMap, KoboldRobotState, KoboldMapBoundary } from 'node-kobold-control';

import { buildSpotCharacteristics, type SpotCharacteristicConstructors } from './customCharacteristics.js';
import { KoboldMatterVacuumAccessory, matterUuidSeed } from './matterAccessory.js';
import { KoboldVacuumAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

const debug = Debug('homebridge-kobold');

export interface KoboldPlatformConfig extends PlatformConfig {
  token?: string;
  language?: string;
  refresh?: string | number;
  hidden?: string[] | string;
  disabled?: string[] | string;
}

export interface KoboldBoundary {
  id: string;
  name: string;
  type?: string;
}

export interface RobotRecord {
  device: KoboldRobot;
  meta: Record<string, unknown>;
  availableServices: Record<string, unknown>;
  mainAccessory?: KoboldVacuumAccessory;
  matterAccessory?: KoboldMatterVacuumAccessory;
  timer?: NodeJS.Timeout;
  lastUpdate?: Date;
  lastState?: KoboldRobotState;
  updatePromise?: Promise<boolean>;
}

type RefreshSetting = number | 'auto';

export class KoboldHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  public readonly matterAccessories: Map<string, MatterAccessory> = new Map();
  public readonly discoveredMatterUUIDs: string[] = [];

  public readonly robots: RobotRecord[] = [];
  public nextRoom: string | null = null;
  public readonly language: string;
  public readonly hiddenServices: string[] | string;
  public readonly refresh: RefreshSetting;
  public readonly spotCharacteristics: SpotCharacteristicConstructors;

  private readonly token: string;
  private readonly matterAvailable: boolean;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.spotCharacteristics = buildSpotCharacteristics(this.api);

    const platformConfig = (config ?? {}) as KoboldPlatformConfig;
    this.token = platformConfig.token ?? '';
    // Homebridge reports external-only mode as enabled here as well. In that
    // mode the aggregate bridge server is suppressed, but api.matter remains
    // available so plugins can publish their own external Matter accessories.
    this.matterAvailable = this.api.isMatterEnabled?.() === true && this.api.matter !== undefined;

    this.log.info(`Matter exposure is ${this.matterAvailable ? 'enabled' : 'disabled'} for this bridge.`);
    this.language = ['en', 'de', 'fr'].includes(platformConfig.language ?? '')
      ? platformConfig.language!
      : 'en';

    let hiddenServices: string[] | string = [];
    if (platformConfig.disabled !== undefined) {
      hiddenServices = platformConfig.disabled;
    }
    if (platformConfig.hidden !== undefined) {
      hiddenServices = platformConfig.hidden;
    }
    this.hiddenServices = hiddenServices;

    this.refresh = this.parseRefresh(platformConfig);
    this.log(`Refresh is set to: ${this.refresh}${this.refresh !== 'auto' ? ' seconds' : ''}`);

    if (!this.token) {
      this.log.error('No Kobold token configured. Please update your config and restart Homebridge.');
    }

    this.api.on('didFinishLaunching', () => {
      debug('Executed didFinishLaunching callback');
      void this.discoverRobots();
    });

    this.api.on('shutdown', () => {
      this.robots.forEach(robot => clearTimeout(robot.timer));
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  configureMatterAccessory(accessory: MatterAccessory) {
    this.matterAccessories.set(accessory.UUID, accessory);
  }

  public isServiceHidden(key: string): boolean {
    if (Array.isArray(this.hiddenServices)) {
      return this.hiddenServices.includes(key);
    }

    if (typeof this.hiddenServices === 'string') {
      return this.hiddenServices.indexOf(key) !== -1;
    }

    return false;
  }

  private parseRefresh(config: KoboldPlatformConfig): RefreshSetting {
    if ('refresh' in config && config.refresh !== undefined && config.refresh !== 'auto') {
      const parsed = parseInt(String(config.refresh), 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        return 60;
      }
      if (parsed > 0 && parsed < 60) {
        this.log.warn('Minimum refresh time is 60 seconds to not overload the Vorwerk servers');
        return 60;
      }
      if (parsed === 0) {
        return 0;
      }
      return parsed;
    }

    return 'auto';
  }

  private async discoverRobots(): Promise<void> {
    if (!this.token) {
      return;
    }

    this.discoveredCacheUUIDs.length = 0;
    this.discoveredMatterUUIDs.length = 0;

    try {
      const robots = await this.loadRobots();
      this.robots.length = 0;
      robots.forEach(robot => {
        this.robots.push(robot);
      });

      const newMatterAccessories: MatterAccessory[] = [];
      this.robots.forEach((robot, index) => {
        this.log.info(
          `Found robot #${index + 1} named "${robot.device.name}" with serial "${robot.device._serial.substring(0, 9)}XXXXXXXXXXXX"`,
        );
        this.setupMainAccessory(robot);
        if (this.matterAvailable) {
          const matterAccessory = this.setupMatterAccessory(robot);
          if (!this.matterAccessories.has(matterAccessory.UUID)) {
            newMatterAccessories.push(matterAccessory);
          }
          this.matterAccessories.set(matterAccessory.UUID, matterAccessory);
        }
      });

      if (newMatterAccessories.length > 0) {
        await this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newMatterAccessories);
      }

      if (this.matterAvailable) {
        // RVC accessories are published as external Matter servers. Homebridge
        // currently replaces its registered internal accessory (including the
        // live endpoint) when updatePlatformAccessories() is called for a cached
        // external accessory. Send state updates directly instead.
        await Promise.all(this.robots.map(robot => robot.matterAccessory?.syncState()));
      }

      this.robots.forEach(robot => this.updateRobotTimer(robot.device._serial));

      // Only cleanup accessories if discovery was successful
      this.cleanupAccessories();
      await this.cleanupMatterAccessories();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to discover robots: ${message}`);
      // Don't cleanup accessories if discovery failed - preserve existing accessories
      // for when the robot comes back online
    }
  }

  private async loadRobots(): Promise<RobotRecord[]> {
    debug('Loading your robots');
    const client = new control.Client();

    await new Promise<void>((resolve, reject) => {
      client.authorize(this.token, (err: unknown) => {
        if (err) {
          this.log.error(
            `Can't log on to Vorwerk cloud. Please check your internet connection and your token. Try again later if the Vorwerk servers have issues: ${err}`,
          );
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const robots = await new Promise<KoboldRobot[]>((resolve, reject) => {
      client.getRobots((error: unknown, robotList: KoboldRobot[]) => {
        if (error) {
          this.log.error(`Successful login but can't connect to your Vorwerk robot: ${error}`);
          reject(error);
        } else {
          resolve(robotList);
        }
      });
    });

    if (!robots.length) {
      this.log.error('Successful login but no robots associated with your account.');
      return [];
    }

    const robotRecords: RobotRecord[] = [];

    for (const robot of robots) {
      const state = await new Promise<KoboldRobotState>((resolve, reject) => {
        robot.getState((error: unknown, result: KoboldRobotState) => {
          if (error) {
            this.log.error(`Error getting robot meta information: ${error}: ${result}`);
            reject(error);
          } else {
            resolve(result);
          }
        });
      });

      const record: RobotRecord = {
        device: robot,
        meta: state.meta ?? {},
        availableServices: state.availableServices ?? {},
        lastState: state,
      };

      const maps = await new Promise<KoboldMap[]>((resolve, reject) => {
        robot.getPersistentMaps((error: unknown, robotMaps: KoboldMap[]) => {
          if (error) {
            this.log.error(`Error updating persistent maps: ${error}: ${robotMaps}`);
            reject(error);
          } else {
            resolve(robotMaps || []);
          }
        });
      });

      if (!maps.length) {
        robot.maps = [];
      } else {
        await Promise.all(
          maps.map(
            (map: KoboldMap) =>
              new Promise<void>(resolve => {
                robot.getMapBoundaries(map.id, (error: unknown, result: { boundaries: KoboldMapBoundary[] }) => {
                  if (error) {
                    this.log.error(`Error getting boundaries: ${error}: ${result}`);
                  } else {
                    map.boundaries = result.boundaries;
                  }
                  resolve();
                });
              }),
          ),
        );
        robot.maps = maps;
      }

      robotRecords.push(record);
    }

    return robotRecords;
  }

  private setupMainAccessory(robot: RobotRecord) {
    const uuid = this.api.hap.uuid.generate(robot.device._serial);
    const displayName = robot.device.name;
    const accessory = this.prepareAccessory(uuid, displayName);

    accessory.context.robotSerial = robot.device._serial;
    accessory.context.boundaryId = null;
    accessory.context.boundaryName = null;

    const handler = new KoboldVacuumAccessory(this, accessory, robot);
    robot.mainAccessory = handler;

    this.discoveredCacheUUIDs.push(uuid);
  }

  private setupMatterAccessory(robot: RobotRecord): MatterAccessory {
    const uuid = this.api.matter!.uuid.generate(matterUuidSeed(robot.device._serial));
    const cachedAccessory = this.matterAccessories.get(uuid);
    const handler = new KoboldMatterVacuumAccessory(this, robot, cachedAccessory);
    robot.matterAccessory = handler;
    this.discoveredMatterUUIDs.push(uuid);
    return handler.accessory;
  }

  private prepareAccessory(uuid: string, name: string): PlatformAccessory {
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      existingAccessory.displayName = name;
      this.api.updatePlatformAccessories([existingAccessory]);
      this.accessories.set(uuid, existingAccessory);
      return existingAccessory;
    }

    const accessory = new this.api.platformAccessory(name, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.set(uuid, accessory);
    return accessory;
  }

  private cleanupAccessories(): void {
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private async cleanupMatterAccessories(): Promise<void> {
    const matter = this.api.matter;
    if (!this.matterAvailable || !matter) {
      return;
    }

    const staleAccessories = Array.from(this.matterAccessories.entries())
      .filter(([uuid]) => !this.discoveredMatterUUIDs.includes(uuid));
    if (staleAccessories.length === 0) {
      return;
    }

    staleAccessories.forEach(([, accessory]) => {
      this.log.info('Removing existing Matter accessory from cache:', accessory.displayName);
    });
    await matter.unregisterPlatformAccessories(
      PLUGIN_NAME,
      PLATFORM_NAME,
      staleAccessories.map(([, accessory]) => accessory),
    );
    staleAccessories.forEach(([uuid]) => this.matterAccessories.delete(uuid));
  }

  public getRobot(serial: string): RobotRecord | undefined {
    return this.robots.find(robot => robot.device._serial === serial);
  }

  public async updateRobot(serial: string, force = false): Promise<boolean> {
    const robot = this.getRobot(serial);
    if (!robot) {
      return false;
    }

    if (robot.updatePromise) {
      return robot.updatePromise;
    }

    if (!force && robot.lastUpdate && new Date().getTime() - robot.lastUpdate.getTime() < 2000) {
      return true;
    }

    debug(`${robot.device.name}: ++ Updating robot state`);
    robot.updatePromise = new Promise<boolean>(resolve => {
      robot.device.getState((error: unknown, state: KoboldRobotState) => {
        if (error) {
          this.log.error('Cannot update robot. Check if robot is online. ' + error);
          resolve(false);
        } else if (state) {
          robot.lastState = state;
          robot.lastUpdate = new Date();
          resolve(true);
        } else {
          this.log.error('Cannot update robot. The robot returned no state.');
          resolve(false);
        }
      });
    });

    try {
      return await robot.updatePromise;
    } finally {
      robot.updatePromise = undefined;
    }
  }

  public updateRobotTimer(serial: string): void {
    const robot = this.getRobot(serial);
    if (!robot) {
      return;
    }

    void this.updateRobotAndAccessories(robot).finally(() => {
      clearTimeout(robot.timer);

      if (this.refresh !== 'auto' && this.refresh !== 0) {
        debug(`${robot.device.name}: ++ Next background update in ${this.refresh} seconds`);
        robot.timer = setTimeout(() => this.updateRobotTimer(serial), this.refresh * 1000);
      } else if (this.refresh === 'auto' && robot.device.canPause) {
        debug(`${robot.device.name}: ++ Next background update in 60 seconds while cleaning (auto mode)`);
        robot.timer = setTimeout(() => this.updateRobotTimer(serial), 60 * 1000);
      } else if (this.refresh === 'auto' && robot.matterAccessory) {
        debug(`${robot.device.name}: ++ Next Matter background update in 120 seconds`);
        robot.timer = setTimeout(() => this.updateRobotTimer(serial), 120 * 1000);
      } else {
        debug(`${robot.device.name}: ++ Stopped background updates`);
      }
    });
  }

  public scheduleActiveRefresh(serial: string): void {
    const robot = this.getRobot(serial);
    if (!robot || this.refresh === 0) {
      return;
    }
    clearTimeout(robot.timer);
    robot.timer = setTimeout(() => this.updateRobotTimer(serial), 60 * 1000);
  }

  private async updateRobotAndAccessories(robot: RobotRecord): Promise<void> {
    const updated = await this.updateRobot(robot.device._serial);
    if (!updated) {
      return;
    }
    robot.mainAccessory?.updated();
    try {
      await robot.matterAccessory?.syncState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`${robot.device.name}: Cannot update Matter state: ${message}`);
    }
  }
}
