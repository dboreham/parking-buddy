// Building/vehicle setups shared by the tests and the benchmark.
import { defaultConfig } from '../js/world.js';
import { newVehicle } from '../js/vehicles.js';

const vehicles = (...presets) => presets.map((p, i) => newVehicle(p, i));

export const scenarios = {
  threeBay: (c) => {
    c.vehicles = vehicles('medium', 'large', 'small');
  },
  tandem: (c) => {
    c.building = { width: 14, depth: 42, wallThickness: 0.5 };
    c.doors = [{ wall: 'front', offset: 2.5, width: 9 }];
    c.vehicles = vehicles('small', 'medium');
  },
  barn: (c) => {
    c.building = { width: 40, depth: 40, wallThickness: 0.5 };
    c.doors = [{ wall: 'front', offset: 14, width: 12 }];
    c.vehicles = vehicles('pickup', 'large', 'medium', 'small', 'sports');
  },
  barnAngled: (c) => {
    scenarios.barn(c);
    c.settings.allowAngled = true;
  },
  sideDoor: (c) => {
    c.building = { width: 30, depth: 24, wallThickness: 0.5 };
    c.doors = [{ wall: 'left', offset: 7, width: 10 }];
    c.vehicles = vehicles('medium', 'small');
  },
  postInBay: (c) => {
    c.building = { width: 24, depth: 26, wallThickness: 0.5 };
    c.doors = [{ wall: 'front', offset: 7, width: 10 }];
    c.obstacles = [{ x: 11, y: 13, w: 1, d: 1 }];
    c.vehicles = vehicles('small');
  },
};

export function makeConfig(name) {
  const c = defaultConfig();
  scenarios[name](c);
  return c;
}
