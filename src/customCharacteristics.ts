import type { API } from 'homebridge';
import { Perms } from 'hap-nodejs';

export const CustomUUID = {
  SpotCleanWidth: 'A7889A9A-2F27-4293-BEF8-3FE805B36F4E',
  SpotCleanHeight: 'CA282DB2-62BF-4325-A1BE-F8BB5478781A',
  SpotCleanRepeat: '1E79C603-63B8-4E6A-9CE1-D31D67981831',
} as const;

export interface SpotCharacteristicConstructors {
  SpotWidthCharacteristic: any;
  SpotHeightCharacteristic: any;
  SpotRepeatCharacteristic: any;
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
    SpotWidthCharacteristic: SpotWidthCharacteristic as unknown as typeof api.hap.Characteristic,
    SpotHeightCharacteristic: SpotHeightCharacteristic as unknown as typeof api.hap.Characteristic,
    SpotRepeatCharacteristic: SpotRepeatCharacteristic as unknown as typeof api.hap.Characteristic,
  };
};
