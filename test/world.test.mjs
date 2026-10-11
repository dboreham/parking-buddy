import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, buildWorld, resolveDoorOffsets } from '../js/world.js';
import { makeObb, obbOverlap } from '../js/geometry.js';

const probe = (x, y) => makeObb(x, y, 0.05, 0.05);
const hitsWall = (w, x, y) => w.obstacles.some((o) => obbOverlap(probe(x, y), o.obb));

test('walls are solid except at door openings', () => {
  const w = buildWorld(defaultConfig());
  for (const d of w.doors) assert.ok(!hitsWall(w, d.center[0], -0.25), `door ${d.index} should be open`);
  assert.ok(hitsWall(w, 1, -0.25), 'front wall left of door 1');
  assert.ok(hitsWall(w, 18, 30.25), 'back wall');
  assert.ok(hitsWall(w, -0.25, 15) && hitsWall(w, 36.25, 15), 'side walls');
  assert.ok(!hitsWall(w, 18, 15), 'interior is clear');
});

test('apron only extends beyond walls that have doors', () => {
  const c = defaultConfig();
  c.doors = [{ wall: 'left', offset: 5, width: 10 }];
  const w = buildWorld(c);
  assert.equal(w.bounds.x0, -w.t - c.settings.apron);
  assert.equal(w.bounds.x1, c.building.width + w.t);
  assert.equal(w.bounds.y0, -w.t);
  assert.equal(w.bounds.y1, c.building.depth + w.t);
});

test('doors are clipped to their wall and zero-width doors dropped', () => {
  const c = defaultConfig();
  c.doors = [{ wall: 'front', offset: 30, width: 10 }, { wall: 'back', offset: 50, width: 9 }];
  const w = buildWorld(c);
  assert.equal(w.doors.length, 1);
  assert.equal(w.doors[0].b, 36);
  assert.equal(w.doors[0].width, 6);
});

test('interior obstacles become solid', () => {
  const c = defaultConfig();
  c.obstacles = [{ x: 10, y: 10, w: 1, d: 1 }];
  const w = buildWorld(c);
  assert.ok(hitsWall(w, 10.5, 10.5));
});

test('auto doors: one is centred, several are evenly spaced', () => {
  const b = { width: 36, depth: 30 };
  assert.equal(resolveDoorOffsets(b, [{ wall: 'front', width: 10, auto: true }])[0].offset, 13);
  const three = resolveDoorOffsets(b, [9, 9, 9].map((width) => ({ wall: 'front', width, auto: true })));
  assert.deepEqual(three.map((d) => d.offset), [2.25, 13.5, 24.75]);
  assert.equal(resolveDoorOffsets(b, [{ wall: 'left', width: 10, auto: true }])[0].offset, 10);
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

test('auto doors that cannot fit are packed with no gap', () => {
  const doors = resolveDoorOffsets({ width: 16, depth: 20 }, [{ wall: 'front', width: 9, auto: true }, { wall: 'front', width: 9, auto: true }]);
  assert.deepEqual(doors.map((d) => d.offset), [0, 9]);
});
