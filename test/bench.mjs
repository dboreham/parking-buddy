import { defaultConfig } from '../js/world.js';
import { newVehicle } from '../js/vehicles.js';
import { planLayout } from '../js/layout.js';

const scenarios = {
  default3: (c) => { c.vehicles = ['medium', 'large', 'small'].map((p, i) => newVehicle(p, i)); },
  tandem: (c) => {
    c.building = { width: 14, depth: 42, wallThickness: 0.5 };
    c.doors = [{ wall: 'front', offset: 2.5, width: 9 }];
    c.vehicles = ['small', 'medium'].map((p, i) => newVehicle(p, i));
  },
  barn: (c) => {
    c.building = { width: 40, depth: 40, wallThickness: 0.5 };
    c.doors = [{ wall: 'front', offset: 14, width: 12 }];
    c.vehicles = ['pickup', 'large', 'medium', 'small', 'sports'].map((p, i) => newVehicle(p, i));
  },
  barnAngled: (c) => {
    scenarios.barn(c);
    c.settings.allowAngled = true;
  },
  sideDoor: (c) => {
    c.building = { width: 30, depth: 24, wallThickness: 0.5 };
    c.doors = [{ wall: 'left', offset: 7, width: 10 }];
    c.vehicles = ['medium', 'small'].map((p, i) => newVehicle(p, i));
  },
};
const only = process.argv[2];
for (const [name, f] of Object.entries(scenarios)) {
  if (only && name !== only) continue;
  const cfg = defaultConfig();
  f(cfg);
  const t = performance.now();
  const r = planLayout(cfg);
  console.log(`== ${name}: ${r.parkedCount}/${cfg.vehicles.length} parked, ${r.freeExit} free exit, ${Math.round(performance.now() - t)} ms`);
  for (const x of r.results) {
    const v = cfg.vehicles.find((v) => v.id === x.id);
    console.log('  ', v.name.padEnd(18), x.parked ? `(${x.pose.x.toFixed(1)}, ${x.pose.y.toFixed(1)}, ${Math.round(x.pose.th * 180 / Math.PI)}°) moves=${x.moves} exit=${x.exit.ok ? 'ok' : 'blocked by ' + x.exit.blockedBy}` : x.reason);
  }
}

if (process.argv[3] === 'explore') {
  const { explore } = await import('../js/explore.js');
  const cfg = defaultConfig(); scenarios[only](cfg);
  const t = performance.now();
  const best = explore(cfg, { trials: 12, onImproved: (b) => console.log('improved trial', b.trial, b.parkedCount, b.freeExit) });
  console.log('explore', Math.round(performance.now() - t), 'ms', best.parkedCount, best.freeExit);
}
