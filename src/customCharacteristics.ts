import type { API } from 'homebridge';
import { Perms } from 'hap-nodejs';
import type { Characteristic as HapCharacteristic, WithUUID } from 'hap-nodejs';

export const CustomUUID = {
  SpotCleanWidth: 'A7889A9A-2F27-4293-BEF8-3FE805B36F4E',
  SpotCleanHeight: 'CA282DB2-62BF-4325-A1BE-F8BB5478781A',
  SpotCleanRepeat: '1E79C603-63B8-4E6A-9CE1-D31D67981831',
} as const;

type SpotCharacteristicClass = WithUUID<new () => HapCharacteristic>;

export interface SpotCharacteristicConstructors {
  SpotWidthCharacteristic: SpotCharacteristicClass;
  SpotHeightCharacteristic: SpotCharacteristicClass;
  SpotRepeatCharacteristic: SpotCharacteristicClass;
}

export const buildSpotCharacteristics = (api: API): SpotCharacteristicConstructors => {
  const SpotWidthCharacteristic = class SpotWidthCharacteristicClass extends api.hap.Characteristic {
    static readonly UUID = CustomUUID.SpotCleanWidth;

    constructor() {
      super('Spot ↔', SpotWidthCharacteristicClass.UUID, {
        format: api.hap.Formats.INT,
        unit: 'cm',
        maxValue: 400,
        minValue: 100,
        minStep: 50,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      });
      this.value = this.getDefaultValue();
    }
  };

  const SpotHeightCharacteristic = class SpotHeightCharacteristicClass extends api.hap.Characteristic {
    static readonly UUID = CustomUUID.SpotCleanHeight;

    constructor() {
      super('Spot ↕', SpotHeightCharacteristicClass.UUID, {
        format: api.hap.Formats.INT,
        unit: 'cm',
        maxValue: 400,
        minValue: 100,
        minStep: 50,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      });
      this.value = this.getDefaultValue();
    }
  };

  const SpotRepeatCharacteristic = class SpotRepeatCharacteristicClass extends api.hap.Characteristic {
    static readonly UUID = CustomUUID.SpotCleanRepeat;

    constructor() {
      super('Spot 2x', SpotRepeatCharacteristicClass.UUID, {
        format: api.hap.Formats.BOOL,
        perms: [Perms.PAIRED_READ, Perms.PAIRED_WRITE],
      });
      this.value = this.getDefaultValue();
    }
  };

  return {
    SpotWidthCharacteristic: SpotWidthCharacteristic as SpotCharacteristicClass,
    SpotHeightCharacteristic: SpotHeightCharacteristic as SpotCharacteristicClass,
    SpotRepeatCharacteristic: SpotRepeatCharacteristic as SpotCharacteristicClass,
  };
};
