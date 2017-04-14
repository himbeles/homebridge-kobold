import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import Debug from 'debug';
import control from 'node-kobold-control';

import { buildSpotCharacteristics, type SpotCharacteristicConstructors } from './customCharacteristics.js';
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
  device: any;
  meta: Record<string, unknown>;
  availableServices: Record<string, unknown>;
  boundary?: KoboldBoundary;
  mainAccessory?: KoboldVacuumAccessory;
  roomAccessories: KoboldVacuumAccessory[];
  timer?: NodeJS.Timeout;
  lastUpdate?: Date;
}

type RefreshSetting = number | 'auto';

export class KoboldHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  public readonly robots: RobotRecord[] = [];
  public boundaryNames: string[] = [];
  public nextRoom: string | null = null;
  public readonly language: string;
  public readonly hiddenServices: string[] | string;
  public readonly refresh: RefreshSetting;
  public readonly spotCharacteristics: SpotCharacteristicConstructors;

  private readonly token: string;

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
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.accessories.set(accessory.UUID, accessory);
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

    this.boundaryNames = [];
    this.discoveredCacheUUIDs.length = 0;

    try {
      const robots = await this.loadRobots();
      this.robots.length = 0;
      robots.forEach(robot => {
        robot.roomAccessories = [];
        this.robots.push(robot);
      });

      this.robots.forEach((robot, index) => {
        this.log.info(
          `Found robot #${index + 1} named "${robot.device.name}" with serial "${robot.device._serial.substring(0, 9)}XXXXXXXXXXXX"`,
        );
        this.setupMainAccessory(robot);
        this.setupBoundaryAccessories(robot);
        this.updateRobotTimer(robot.device._serial);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`Failed to discover robots: ${message}`);
    }

    this.cleanupAccessories();
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

    const robots = await new Promise<any[]>((resolve, reject) => {
      client.getRobots((error: unknown, robotList: any[]) => {
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
      const state = await new Promise<any>((resolve, reject) => {
        robot.getState((error: unknown, result: any) => {
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
        roomAccessories: [],
      };

      const maps = await new Promise<any[]>((resolve, reject) => {
        robot.getPersistentMaps((error: unknown, robotMaps: any[]) => {
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
            (map: any) =>
              new Promise<void>(resolve => {
                robot.getMapBoundaries(map.id, (error: unknown, result: any) => {
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

  private setupBoundaryAccessories(robot: RobotRecord) {
    if (!robot.device.maps) {
      return;
    }

    robot.device.maps.forEach((map: any) => {
      if (!map.boundaries) {
        return;
      }

      map.boundaries.forEach((boundary: KoboldBoundary) => {
        if (boundary.type !== 'polygon') {
          return;
        }

        const uuid = this.api.hap.uuid.generate(`${robot.device._serial}:${boundary.id}`);
        const accessory = this.prepareAccessory(uuid, `${robot.device.name} - ${boundary.name}`);

        accessory.context.robotSerial = robot.device._serial;
        accessory.context.boundaryId = boundary.id;
        accessory.context.boundaryName = boundary.name;

        robot.boundary = boundary;
        const handler = new KoboldVacuumAccessory(this, accessory, robot, boundary);
        robot.roomAccessories.push(handler);

        this.discoveredCacheUUIDs.push(uuid);
      });
    });
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

  public getRobot(serial: string): RobotRecord | undefined {
    return this.robots.find(robot => robot.device._serial === serial);
  }

  public async updateRobot(serial: string): Promise<void> {
    const robot = this.getRobot(serial);
    if (!robot) {
      return;
    }

    if (robot.lastUpdate && new Date().getTime() - robot.lastUpdate.getTime() < 2000) {
      return;
    }

    debug(`${robot.device.name}: ++ Updating robot state`);
    robot.lastUpdate = new Date();
    await new Promise<void>(resolve => {
      robot.device.getState((error: unknown) => {
        if (error) {
          this.log.error('Cannot update robot. Check if robot is online. ' + error);
        }
        resolve();
      });
    });
  }

  public updateRobotTimer(serial: string): void {
    const robot = this.getRobot(serial);
    if (!robot) {
      return;
    }

    void this.updateRobot(serial).finally(() => {
      clearTimeout(robot.timer);

      robot.mainAccessory?.updated();
      robot.roomAccessories.forEach(accessory => accessory.updated());

      if (this.refresh !== 'auto' && this.refresh !== 0) {
        debug(`${robot.device.name}: ++ Next background update in ${this.refresh} seconds`);
        robot.timer = setTimeout(() => this.updateRobotTimer(serial), this.refresh * 1000);
      } else if (this.refresh === 'auto' && robot.device.canPause) {
        debug(`${robot.device.name}: ++ Next background update in 60 seconds while cleaning (auto mode)`);
        robot.timer = setTimeout(() => this.updateRobotTimer(serial), 60 * 1000);
      } else {
        debug(`${robot.device.name}: ++ Stopped background updates`);
      }
    });
  }
}
