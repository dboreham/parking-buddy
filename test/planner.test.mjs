import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, resolveDoorOffsets } from '../js/world.js';
import { newVehicle } from '../js/vehicles.js';
import { planLayout } from '../js/layout.js';
import { parseLength } from '../js/units.js';

const config = (f) => { const c = defaultConfig(); f(c); return c; };

test('three cars fit a standard three-bay garage and can all leave', () => {
  const r = planLayout(config((c) => { c.vehicles = ['medium', 'large', 'small'].map((p, i) => newVehicle(p, i)); }));
  assert.equal(r.parkedCount, 3);
  assert.equal(r.freeExit, 3);
  for (const x of r.results) assert.equal(x.moves, 1);
});

test('a crew-cab pickup cannot clear a 9 ft door with 6 in clearance', () => {
  const r = planLayout(config((c) => { c.vehicles = [newVehicle('pickup')]; }));
  assert.equal(r.parkedCount, 0);
});

test('tandem garage parks two cars, the back one blocked by the front one', () => {
  const r = planLayout(config((c) => {
    c.building = { width: 14, depth: 42, wallThickness: 0.5 };
    c.doors = [{ wall: 'front', offset: 2.5, width: 9 }];
    c.vehicles = ['small', 'medium'].map((p, i) => newVehicle(p, i));
  }));
  assert.equal(r.parkedCount, 2);
  const [back, front] = r.results;
  assert.equal(back.exit.ok, false);
  assert.deepEqual(back.exit.blockedBy, [front.id]);
  assert.equal(front.exit.ok, true);
});

test('pinned spot is honoured', () => {
  const r = planLayout(config((c) => {
    const v = newVehicle('small');
    v.pin = { x: 18, y: 10, th: Math.PI / 2 };
    c.vehicles = [v];
  }));
  const p = r.results[0].pose;
  assert.ok(Math.hypot(p.x - 18, p.y - 10) < 1);
});

test('length parsing', () => {
  assert.equal(parseLength('9'), 9);
  assert.equal(parseLength(`9'6"`), 9.5);
  assert.equal(parseLength('9 ft 6 in'), 9.5);
  assert.equal(parseLength('114"'), 9.5);
  assert.ok(Number.isNaN(parseLength('abc')));
});

test('auto doors: one is centred, several are evenly spaced', () => {
  const b = { width: 36, depth: 30 };
  const one = resolveDoorOffsets(b, [{ wall: 'front', width: 10, auto: true }]);
  assert.equal(one[0].offset, 13);
  const three = resolveDoorOffsets(b, [9, 9, 9].map((width) => ({ wall: 'front', width, auto: true })));
  assert.deepEqual(three.map((d) => d.offset), [2.25, 13.5, 24.75]);
  // Side wall uses the depth.
  const side = resolveDoorOffsets(b, [{ wall: 'left', width: 10, auto: true }]);
  assert.equal(side[0].offset, 10);
});

test('auto doors fill the largest gap left by manually placed doors', () => {
  const doors = resolveDoorOffsets({ width: 40, depth: 30 }, [
    { wall: 'front', offset: 0, width: 10 },
    { wall: 'front', width: 9, auto: true },
    { wall: 'front', width: 9, auto: true },
    { wall: 'back', offset: 5, width: 9 },
  ]);
  // Free stretch is 10..40 (30 ft) for 18 ft of doors: gaps of 4 ft.
  assert.deepEqual(doors.map((d) => d.offset), [0, 14, 27, 5]);
});
