import type { Characteristic, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { WithUUID } from 'hap-nodejs';
import type { KoboldRobot } from 'node-kobold-control';

import Debug from 'debug';
import 'colors';

import type { KoboldBoundary, KoboldHomebridgePlatform, RobotRecord } from './platform.js';

const debug = Debug('homebridge-kobold');

const dictionaries = {
  en: {
    clean: 'Clean',
    'clean the': 'Clean the',
    goToDock: 'Go to Dock',
    dockState: 'Dock',
    eco: 'Eco Mode',
    noGoLines: 'NoGo Lines',
    extraCare: 'Extra Care',
    schedule: 'Schedule',
    findMe: 'Find me',
    cleanSpot: 'Clean Spot',
    battery: 'Battery',
  },
  de: {
    clean: 'Sauge',
    'clean the': 'Sauge',
    goToDock: 'Zur Basis',
    dockState: 'In der Basis',
    eco: 'Eco Modus',
    noGoLines: 'NoGo Linien',
    extraCare: 'Extra Care',
    schedule: 'Zeitplan',
    findMe: 'Finde mich',
    cleanSpot: 'Spot Reinigung',
    battery: 'Batterie',
  },
  fr: {
    clean: 'Aspirer',
    'clean the': 'Aspirer',
    goToDock: 'Retour à la base',
    dockState: 'Sur la base',
    eco: 'Eco mode',
    noGoLines: 'Lignes NoGo',
    extraCare: 'Extra Care',
    schedule: 'Planifier',
    findMe: 'Me retrouver',
    cleanSpot: 'Nettoyage local',
    battery: 'Batterie',
  },
} as const;

type Dictionary = (typeof dictionaries)[keyof typeof dictionaries];

interface SpotSettings {
  width: number | null;
  height: number | null;
  repeat: boolean;
}

type HapServiceConstructor = (typeof Service) & WithUUID<typeof Service>;
type HapCharacteristicConstructor = WithUUID<new () => Characteristic>;

export class KoboldVacuumAccessory {
  private readonly robotObject: RobotRecord;
  private readonly robot: KoboldRobot;
  private readonly meta: Record<string, unknown>;
  private readonly boundary: KoboldBoundary | null;
  private readonly dict: Dictionary;

  private readonly cleanService: Service;
  private readonly batteryService?: Service;
  private readonly goToDockService?: Service;
  private readonly dockStateService?: Service;
  private readonly ecoService?: Service;
  private readonly noGoLinesService?: Service;
  private readonly extraCareService?: Service;
  private readonly scheduleService?: Service;
  private readonly findMeService?: Service;
  private readonly spotCleanService?: Service;

  private spotWidthCharacteristic?: Characteristic;
  private spotHeightCharacteristic?: Characteristic;
  private spotRepeatCharacteristic?: Characteristic;

  private readonly spotPlusFeatures: boolean;
  private readonly refreshSetting;
  private nextRoom: string | null = null;
  private readonly name: string;
  private pendingBoundaryState: boolean | null = null;

  constructor(
    private readonly platform: KoboldHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    robotObject: RobotRecord,
    boundary?: KoboldBoundary,
  ) {
    this.robotObject = robotObject;
    this.robot = robotObject.device;
    this.meta = robotObject.meta;
    this.boundary = boundary ?? null;
    this.refreshSetting = this.platform.refresh;

    this.dict = dictionaries[this.platform.language as keyof typeof dictionaries] ?? dictionaries.en;
    this.spotPlusFeatures = Array.isArray(this.robotObject.availableServices?.spotCleaning)
      ? this.robotObject.availableServices.spotCleaning.includes('basic')
      : false;

    this.name = this.resolveName();
    this.accessory.displayName = this.name;
    this.accessory.context.displayName = this.name;
    this.accessory.context.robotSerial = this.robot._serial;
    this.accessory.context.boundaryId = this.boundary ? this.boundary.id : null;

    const modelName = typeof this.meta.modelName === 'string' ? this.meta.modelName : 'Unknown Model';
    const firmware = typeof this.meta.firmware === 'string' ? this.meta.firmware : 'Unknown';

    this.informationService()
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Vorwerk Deutschland Stiftung & Co. KG')
      .setCharacteristic(this.platform.Characteristic.Model, modelName)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.robot._serial)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, firmware)
      .setCharacteristic(
        this.platform.Characteristic.Name,
        this.boundary ? `${this.robot.name} - ${this.boundary.name}` : this.robot.name,
      );

    if (this.boundary) {
      const serviceName = this.boundaryServiceName();
      this.cleanService = this.createService(
        this.platform.Service.Switch,
        serviceName,
        `cleanBoundary:${this.boundary.id}`,
      );
    } else {
      this.cleanService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.clean}`,
        'clean',
      );
    }

    this.cleanService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setClean.bind(this))
      .onGet(this.getClean.bind(this));

    this.batteryService = this.createService(
      this.platform.Service.Battery,
      `${this.name} ${this.dict.battery}`,
      'battery',
      !this.boundary,
    );

    if (this.batteryService && !this.boundary) {
      this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
        .onGet(this.getBatteryLevel.bind(this));
      this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState)
        .onGet(this.getBatteryChargingState.bind(this));
    }

    if (!this.boundary) {
      const exposeDock = !this.platform.isServiceHidden('dock');
      this.goToDockService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.goToDock}`,
        'goToDock',
        exposeDock,
      );
      if (exposeDock && this.goToDockService) {
        this.goToDockService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setGoToDock.bind(this))
          .onGet(this.getGoToDock.bind(this));
      }

      const exposeDockState = !this.platform.isServiceHidden('dockstate');
      this.dockStateService = this.createService(
        this.platform.Service.OccupancySensor,
        `${this.name} ${this.dict.dockState}`,
        'dockState',
        exposeDockState,
      );
      if (exposeDockState && this.dockStateService) {
        this.dockStateService.getCharacteristic(this.platform.Characteristic.OccupancyDetected)
          .onGet(this.getDock.bind(this));
      }

      const exposeEco = !this.platform.isServiceHidden('eco');
      this.ecoService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.eco}`,
        'eco',
        exposeEco,
      );
      if (exposeEco && this.ecoService) {
        this.ecoService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setEco.bind(this))
          .onGet(this.getEco.bind(this));
      }

      const exposeNoGo = !this.platform.isServiceHidden('nogolines');
      this.noGoLinesService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.noGoLines}`,
        'noGoLines',
        exposeNoGo,
      );
      if (exposeNoGo && this.noGoLinesService) {
        this.noGoLinesService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setNoGoLines.bind(this))
          .onGet(this.getNoGoLines.bind(this));
      }

      const exposeExtraCare = !this.platform.isServiceHidden('extracare');
      this.extraCareService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.extraCare}`,
        'extraCare',
        exposeExtraCare,
      );
      if (exposeExtraCare && this.extraCareService) {
        this.extraCareService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setExtraCare.bind(this))
          .onGet(this.getExtraCare.bind(this));
      }

      const exposeSchedule = !this.platform.isServiceHidden('schedule');
      this.scheduleService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.schedule}`,
        'schedule',
        exposeSchedule,
      );
      if (exposeSchedule && this.scheduleService) {
        this.scheduleService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setSchedule.bind(this))
          .onGet(this.getSchedule.bind(this));
      }

      const exposeFind = !this.platform.isServiceHidden('find');
      this.findMeService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.findMe}`,
        'findMe',
        exposeFind,
      );
      if (exposeFind && this.findMeService) {
        this.findMeService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setFindMe.bind(this))
          .onGet(this.getFindMe.bind(this));
      }

      const exposeSpot = !this.platform.isServiceHidden('spot');
      this.spotCleanService = this.createService(
        this.platform.Service.Switch,
        `${this.name} ${this.dict.cleanSpot}`,
        'cleanSpot',
        exposeSpot,
      );

      if (exposeSpot && this.spotCleanService) {
        this.spotCleanService.getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.setSpotClean.bind(this))
          .onGet(this.getSpotClean.bind(this));

        this.spotRepeatCharacteristic = this.getOrAddCharacteristic(
          this.spotCleanService,
          this.platform.spotCharacteristics.SpotRepeatCharacteristic,
        );
        this.spotRepeatCharacteristic
          ?.onSet(this.setSpotRepeat.bind(this))
          .onGet(this.getSpotRepeat.bind(this));

        if (this.spotPlusFeatures) {
          this.spotWidthCharacteristic = this.getOrAddCharacteristic(
            this.spotCleanService,
            this.platform.spotCharacteristics.SpotWidthCharacteristic,
          );
          this.spotHeightCharacteristic = this.getOrAddCharacteristic(
            this.spotCleanService,
            this.platform.spotCharacteristics.SpotHeightCharacteristic,
          );

          this.spotWidthCharacteristic
            ?.onSet(this.setSpotWidth.bind(this))
            .onGet(this.getSpotWidth.bind(this));
          this.spotHeightCharacteristic
            ?.onSet(this.setSpotHeight.bind(this))
            .onGet(this.getSpotHeight.bind(this));
        }
      }
    }
  }

  updated(): void {
    if (!this.boundary) {
      const currentClean = this.cleanService.getCharacteristic(this.platform.Characteristic.On).value as boolean | undefined;
      const robotCanPause = !!this.robot.canPause;
      if ((currentClean ?? false) !== robotCanPause) {
        this.cleanService.updateCharacteristic(this.platform.Characteristic.On, robotCanPause);
      }

      if (this.goToDockService) {
        const dockValue = this.goToDockService.getCharacteristic(this.platform.Characteristic.On).value as boolean | undefined;
        if (dockValue === true && !!this.robot.dockHasBeenSeen) {
          this.goToDockService.updateCharacteristic(this.platform.Characteristic.On, false);
        }
      }

      if (this.scheduleService) {
        const scheduleValue = this.scheduleService.getCharacteristic(this.platform.Characteristic.On).value as boolean | undefined;
        const scheduleEnabled = !!this.robot.isScheduleEnabled;
        if ((scheduleValue ?? false) !== scheduleEnabled) {
          this.scheduleService.updateCharacteristic(
            this.platform.Characteristic.On,
            scheduleEnabled,
          );
        }
      }

      const isDocked = !!this.robot.isDocked;
      this.dockStateService?.updateCharacteristic(
        this.platform.Characteristic.OccupancyDetected,
        isDocked ? 1 : 0,
      );

      this.ecoService?.updateCharacteristic(this.platform.Characteristic.On, !!this.robot.eco);
      this.noGoLinesService?.updateCharacteristic(this.platform.Characteristic.On, !!this.robot.noGoLines);
      this.extraCareService?.updateCharacteristic(
        this.platform.Characteristic.On,
        this.robot.navigationMode === 2,
      );

      const repeatValue = this.robot.spotRepeat ?? false;
      this.spotRepeatCharacteristic?.updateValue(repeatValue);

      if (this.spotPlusFeatures && this.spotWidthCharacteristic && this.spotHeightCharacteristic) {
        const widthProps = this.spotWidthCharacteristic.props;
        const heightProps = this.spotHeightCharacteristic.props;

        const widthValid = this.robot.spotWidth !== undefined
          && this.robot.spotWidth >= (widthProps.minValue ?? 0)
          && this.robot.spotWidth <= (widthProps.maxValue ?? Number.MAX_SAFE_INTEGER)
          ? this.robot.spotWidth
          : widthProps.minValue ?? this.robot.spotWidth ?? widthProps.minValue ?? 0;

        const heightValid = this.robot.spotHeight !== undefined
          && this.robot.spotHeight >= (heightProps.minValue ?? 0)
          && this.robot.spotHeight <= (heightProps.maxValue ?? Number.MAX_SAFE_INTEGER)
          ? this.robot.spotHeight
          : heightProps.minValue ?? this.robot.spotHeight ?? heightProps.minValue ?? 0;

        this.spotWidthCharacteristic.updateValue(widthValid);
        this.spotHeightCharacteristic.updateValue(heightValid);
      }
    } else {
      const isCleaningBoundary = !!this.robot.canPause && this.robot.cleaningBoundaryId === this.boundary.id;
      const boundaryValue = this.cleanService.getCharacteristic(this.platform.Characteristic.On).value as boolean | undefined;
      if ((boundaryValue ?? false) !== isCleaningBoundary) {
        this.cleanService.updateCharacteristic(this.platform.Characteristic.On, isCleaningBoundary);
      } else if (this.pendingBoundaryState !== null) {
        this.pendingBoundaryState = null;
      }
    }

    this.batteryService?.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.robot.charge ?? 0);
    this.batteryService?.updateCharacteristic(this.platform.Characteristic.ChargingState, !!this.robot.isCharging);

    if (this.nextRoom != null && this.robot.isDocked && this.boundary) {
      void this.clean().then(() => {
        this.nextRoom = null;
        debug('## Starting cleaning of next room');
      }).catch(() => {
        this.nextRoom = null;
      });
    }
  }

  private informationService(): Service {
    return (
      this.accessory.getService(this.platform.Service.AccessoryInformation)
      || this.accessory.addService(this.platform.Service.AccessoryInformation)
    );
  }

  private resolveName(): string {
    if (!this.boundary) {
      return this.robot.name;
    }

    if (this.platform.boundaryNames.includes(this.boundary.name)) {
      const lastChar = this.boundary.name.slice(-1);
      if (!Number.isNaN(Number(lastChar))) {
        this.boundary.name = `${this.boundary.name.slice(0, -1)}${Number(lastChar) + 1}`;
      } else {
        this.boundary.name = `${this.boundary.name} 2`;
      }
    }
    this.platform.boundaryNames.push(this.boundary.name);
    return `${this.robot.name} - ${this.boundary.name}`;
  }

  private boundaryServiceName(): string {
    if (!this.boundary) {
      return `${this.name} ${this.dict.clean}`;
    }

    const splitName = this.boundary.name.split(' ');
    if (splitName.length >= 2 && /[']s$/g.test(splitName[splitName.length - 2])) {
      return `${this.dict.clean} ${this.boundary.name}`;
    }
    return `${this.dict['clean the']} ${this.boundary.name}`;
  }

  private createService(
    serviceType: HapServiceConstructor,
    name: string,
    subtype: string,
    expose = true,
  ): Service {
    const existing = this.accessory.getServiceById(serviceType, subtype);

    if (expose) {
      if (existing) {
        existing.setCharacteristic(this.platform.Characteristic.Name, name);
        return existing;
      }
      return this.accessory.addService(serviceType, name, subtype);
    }

    if (existing) {
      this.accessory.removeService(existing);
    }

    return new serviceType(name, subtype);
  }

  private getOrAddCharacteristic(service: Service, characteristic: HapCharacteristicConstructor) {
    const ctor = characteristic as unknown as WithUUID<typeof Characteristic>;
    if (service.testCharacteristic(ctor)) {
      return service.getCharacteristic(characteristic);
    }
    return service.addCharacteristic(characteristic);
  }

  private asBool(value: CharacteristicValue): boolean {
    return value === true || value === 1;
  }

  private async getClean(): Promise<CharacteristicValue> {
    if (this.boundary && this.pendingBoundaryState !== null) {
      return this.pendingBoundaryState;
    }

    await this.platform.updateRobot(this.robot._serial);
    const cleaning = this.boundary
      ? !!this.robot.canPause && this.robot.cleaningBoundaryId === this.boundary.id
      : !!this.robot.canPause;
    debug(`${this.name}: Cleaning is ${cleaning ? 'ON'.brightGreen : 'OFF'.red}`);
    return cleaning;
  }

  private async setClean(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    debug(
      `${this.name}: ${on ? 'Enabled '.brightGreen : 'Disabled'.red} Clean ${this.boundary ? JSON.stringify(this.boundary) : ''}`,
    );

    if (this.boundary) {
      this.pendingBoundaryState = on;
    }

    await this.platform.updateRobot(this.robot._serial);

    if (on) {
      if (!this.boundary || this.robot.cleaningBoundaryId === this.boundary.id) {
        if (this.robot.canResume) {
          debug(`${this.name}: ## Resume cleaning`);
          await this.runCommand(cb => this.robot.resumeCleaning(cb));
        } else if (this.robot.canStart) {
          debug(`${this.name}: ## Start cleaning`);
          await this.clean();
        } else {
          debug(`${this.name}: Cannot start, maybe already cleaning (expected)`);
        }
      } else if (this.robot.canPause || this.robot.canResume) {
        debug(`${this.name}: ## Returning to dock to start cleaning of new room`);
        await this.goToDockSequence();
        this.nextRoom = this.boundary.id;
      } else {
        debug(`${this.name}: ## Start cleaning of new room`);
        await this.clean();
      }
    } else if (this.robot.canPause) {
      debug(`${this.name}: ## Pause cleaning`);
      await this.runCommand(cb => this.robot.pauseCleaning(cb));
    } else {
      debug(`${this.name}: Already paused`);
    }

    await this.platform.updateRobot(this.robot._serial);
    if (this.boundary) {
      this.pendingBoundaryState = null;
    }
  }

  private async clean(spot?: SpotSettings): Promise<void> {
    if (this.refreshSetting === 'auto') {
      setTimeout(() => {
        this.platform.updateRobotTimer(this.robot._serial);
      }, 60 * 1000);
    }

    const eco = !!this.robot.eco;
    const extraCare = this.robot.navigationMode === 2;
    const noGoLines = !!this.robot.noGoLines;
    const room = this.boundary ? this.boundary.name : '';

    const roomLabel = room !== '' ? `${room} ` : '';
    const detailText = `eco: ${eco}, extraCare: ${extraCare}, nogoLines: ${noGoLines}, spot: ${JSON.stringify(spot)}`;
    debug(`${this.name}: ## Start cleaning (${roomLabel}${detailText})`);

    if (!this.boundary && !spot) {
      await this.runCommand((cb) => this.robot.startCleaning(eco, extraCare ? 2 : 1, noGoLines, cb), (error, result) => {
        this.platform.log.error(`Cannot start cleaning. ${error}: ${JSON.stringify(result)}`);
      });
    } else if (room !== '') {
      await this.runCommand((cb) => this.robot.startCleaningBoundary(eco, extraCare, this.boundary!.id, cb), (error, result) => {
        this.platform.log.error(`Cannot start room cleaning. ${error}: ${JSON.stringify(result)}`);
      });
    } else if (spot) {
      const widthValue = spot.width ?? this.robot.spotWidth ?? this.spotWidthCharacteristic?.props.minValue ?? 100;
      const heightValue = spot.height ?? this.robot.spotHeight ?? this.spotHeightCharacteristic?.props.minValue ?? 100;
      await this.runCommand((cb) =>
        this.robot.startSpotCleaning(
          eco,
          widthValue,
          heightValue,
          spot.repeat,
          extraCare ? 2 : 1,
          cb,
        ), (error, result) => {
        this.platform.log.error(`Cannot start spot cleaning. ${error}: ${JSON.stringify(result)}`);
      });
    }
  }

  private async getGoToDock(): Promise<CharacteristicValue> {
    return false;
  }

  private async setGoToDock(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    if (!on) {
      return;
    }

    await this.platform.updateRobot(this.robot._serial);
    await this.goToDockSequence();
  }

  private async getEco(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const eco = !!this.robot.eco;
    debug(`${this.name}: Eco Mode is ${eco ? 'ON'.brightGreen : 'OFF'.red}`);
    return eco;
  }

  private async setEco(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    this.robot.eco = on;
    debug(`${this.name}: ${on ? 'Enabled '.red : 'Disabled'.red} Eco Mode`);
  }

  private async getNoGoLines(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const noGo = !!this.robot.noGoLines;
    debug(`${this.name}: NoGoLine is ${noGo ? 'ON'.brightGreen : 'OFF'.red}`);
    return noGo ? 1 : 0;
  }

  private async setNoGoLines(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    this.robot.noGoLines = on;
    debug(`${this.name}: ${on ? 'Enabled '.brightGreen : 'Disabled'.red} NoGoLine`);
  }

  private async getExtraCare(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    debug(`${this.name}: Care Nav is ${this.robot.navigationMode === 2 ? 'ON'.brightGreen : 'OFF'.red}`);
    return this.robot.navigationMode === 2 ? 1 : 0;
  }

  private async setExtraCare(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    this.robot.navigationMode = on ? 2 : 1;
    debug(`${this.name}: ${on ? 'Enabled '.brightGreen : 'Disabled'.red} Care Nav`);
  }

  private async getSchedule(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const enabled = !!this.robot.isScheduleEnabled;
    debug(`${this.name}: Schedule is ${enabled ? 'ON'.brightGreen : 'OFF'.red}`);
    return enabled;
  }

  private async setSchedule(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    await this.platform.updateRobot(this.robot._serial);

    if (on) {
      debug(this.name + ': ' + 'Enabled'.brightGreen + ' Schedule');
      await this.runCommand(cb => this.robot.enableSchedule(cb));
    } else {
      debug(this.name + ': ' + 'Disabled'.red + ' Schedule');
      await this.runCommand(cb => this.robot.disableSchedule(cb));
    }
  }

  private async getFindMe(): Promise<CharacteristicValue> {
    return false;
  }

  private async setFindMe(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    if (!on) {
      return;
    }

    debug(`${this.name}: ## Find me`);
    setTimeout(() => {
      this.findMeService?.updateCharacteristic(this.platform.Characteristic.On, false);
    }, 1000);

    await this.runCommand(cb => this.robot.findMe(cb));
  }

  private async getSpotClean(): Promise<CharacteristicValue> {
    const characteristic = this.spotCleanService?.getCharacteristic(this.platform.Characteristic.On);
    const spotService = characteristic?.value as boolean | undefined;
    return spotService ?? false;
  }

  private async setSpotClean(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);

    const spot: SpotSettings = {
      width: this.spotPlusFeatures && this.spotWidthCharacteristic
        ? ((this.spotWidthCharacteristic.value as number | undefined) ?? this.robot.spotWidth ?? this.spotWidthCharacteristic.props.minValue ?? 100)
        : this.robot.spotWidth ?? null,
      height: this.spotPlusFeatures && this.spotHeightCharacteristic
        ? ((this.spotHeightCharacteristic.value as number | undefined) ?? this.robot.spotHeight ?? this.spotHeightCharacteristic.props.minValue ?? 100)
        : this.robot.spotHeight ?? null,
      repeat: !!(this.spotRepeatCharacteristic?.value ?? false),
    };

    await this.platform.updateRobot(this.robot._serial);

    if (on) {
      if (this.robot.canResume) {
        debug(`${this.name}: ## Resume (spot) cleaning`);
        await this.runCommand(cb => this.robot.resumeCleaning(cb));
      } else if (this.robot.canStart) {
        await this.clean(spot);
      } else {
        debug(`${this.name}: Cannot start spot cleaning, maybe already cleaning`);
      }
    } else if (this.robot.canPause) {
      debug(`${this.name}: ## Pause cleaning`);
      await this.runCommand(cb => this.robot.pauseCleaning(cb));
    } else {
      debug(`${this.name}: Already paused`);
    }
  }

  private async getSpotWidth(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const width = this.robot.spotWidth ?? this.spotWidthCharacteristic?.props.minValue ?? 100;
    debug(`${this.name}: Spot width  is ${width}cm`);
    return width;
  }

  private async setSpotWidth(value: CharacteristicValue): Promise<void> {
    const numericValue = typeof value === 'number' ? value : Number(value);
    this.robot.spotWidth = Number.isNaN(numericValue) ? this.robot.spotWidth ?? 100 : numericValue;
    debug(`${this.name}: Set spot width to ${this.robot.spotWidth}cm`);
  }

  private async getSpotHeight(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const height = this.robot.spotHeight ?? this.spotHeightCharacteristic?.props.minValue ?? 100;
    debug(`${this.name}: Spot height is ${height}cm`);
    return height;
  }

  private async setSpotHeight(value: CharacteristicValue): Promise<void> {
    const numericValue = typeof value === 'number' ? value : Number(value);
    this.robot.spotHeight = Number.isNaN(numericValue) ? this.robot.spotHeight ?? 100 : numericValue;
    debug(`${this.name}: Set spot height to ${this.robot.spotHeight}cm`);
  }

  private async getSpotRepeat(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const repeat = this.robot.spotRepeat ?? false;
    debug(`${this.name}: Spot repeat is ${repeat ? 'ON'.brightGreen : 'OFF'.red}`);
    return repeat;
  }

  private async setSpotRepeat(value: CharacteristicValue): Promise<void> {
    const on = this.asBool(value);
    this.robot.spotRepeat = on;
    debug(`${this.name}: ${on ? 'Enabled '.brightGreen : 'Disabled'.red} Spot repeat`);
  }

  private async getDock(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const isDocked = !!this.robot.isDocked;
    debug(`${this.name}: The Dock is ${isDocked ? 'OCCUPIED'.brightGreen : 'NOT OCCUPIED'.red}`);
    return isDocked ? 1 : 0;
  }

  private async getBatteryLevel(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const charge = this.robot.charge ?? 0;
    debug(`${this.name}: Battery  is ${charge}%`);
    return charge;
  }

  private async getBatteryChargingState(): Promise<CharacteristicValue> {
    await this.platform.updateRobot(this.robot._serial);
    const isCharging = !!this.robot.isCharging;
    debug(`${this.name}: Battery  is ${isCharging ? 'CHARGING'.brightGreen : 'NOT CHARGING'.red}`);
    return isCharging;
  }

  private async goToDockSequence(): Promise<void> {
    if (this.robot.canPause) {
      debug(`${this.name}: ## Pause cleaning to go to dock`);
      await this.runCommand(cb => this.robot.pauseCleaning(cb));
      await this.delay(1000);
      debug(`${this.name}: ## Go to dock`);
      await this.runCommand(cb => this.robot.sendToBase(cb));
    } else if (this.robot.canGoToBase) {
      debug(`${this.name}: ## Go to dock`);
      await this.runCommand(cb => this.robot.sendToBase(cb));
    } else {
      this.platform.log.warn(`${this.name}: Can't go to dock at the moment`);
    }
  }

  private async runCommand<T = unknown>(
    command: (callback: (error?: unknown, result?: T) => void) => void,
    onError?: (error: unknown, result?: T) => void,
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      command((error?: unknown, result?: T) => {
        if (error) {
          onError?.(error, result);
          reject(error instanceof Error ? error : new Error(String(error)));
        } else {
          resolve(result);
        }
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
