import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, buildWorld } from '../js/world.js';
import { newVehicle, vehicleModel, bodyObb } from '../js/vehicles.js';
import { Search, arcPose, headingBin, NTH, DTH } from '../js/planner.js';
import { rectObb, obbOverlap } from '../js/geometry.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('arcPose: driving forward then reversing the same arc returns to the start', () => {
  for (const kappa of [0, 0.07, -0.07, 0.035]) {
    const [x1, y1, t1] = arcPose(3, 4, 0.7, 1, kappa, 2.5);
    const [x2, y2, t2] = arcPose(x1, y1, t1, -1, kappa, 2.5);
    assert.ok(close(x2, 3) && close(y2, 4) && close(t2, 0.7), `kappa ${kappa}`);
  }
});

test('arcPose: a full circle at radius R returns to the start, a half circle is 2R across', () => {
  const R = 15;
  const [x, y, th] = arcPose(0, 0, 0, 1, 1 / R, 2 * Math.PI * R);
  assert.ok(close(x, 0, 1e-6) && close(y, 0, 1e-6) && close(th, 2 * Math.PI, 1e-9));
  const [hx, hy] = arcPose(0, 0, 0, 1, 1 / R, Math.PI * R);
  assert.ok(close(hx, 0, 1e-6) && close(hy, 2 * R, 1e-6), 'left turn ends 2R to the left');
});

test('headingBin wraps negative and large angles', () => {
  assert.equal(headingBin(0), 0);
  assert.equal(headingBin(-DTH), NTH - 1);
  assert.equal(headingBin(2 * Math.PI + 3 * DTH), 3);
  assert.equal(headingBin(Math.PI / 2), NTH / 4);
});

test('motion primitives turn by exactly zero or one heading bin', () => {
  const w = buildWorld(defaultConfig());
  const s = new Search(w, vehicleModel(newVehicle('medium')), []);
  for (const P of s.prims) {
    const o = (5 * P.nsub + P.nsub - 1) * 4; // start heading bin 5, last sub-pose
    const th = (5 + P.dth) * DTH;
    assert.ok(close(P.tab[o + 2], Math.cos(th)) && close(P.tab[o + 3], Math.sin(th)));
    assert.ok(Math.abs(P.dth) <= 1);
    if (P.kappa) assert.ok(Math.abs(P.kappa) <= 1 / s.m.rMin + 1e-12, 'never tighter than the minimum radius');
  }
});

test('start poses sit just outside each door, facing in and facing out', () => {
  const w = buildWorld(defaultConfig());
  const m = vehicleModel(newVehicle('small'));
  const s = new Search(w, m, w.obstacles.map((o) => o.obb));
  const starts = s.startPoses();
  assert.equal(starts.length, 2 * w.doors.length);
  const interior = rectObb(0, 0, w.W, w.D);
  for (const p of starts) {
    assert.ok(!obbOverlap(bodyObb(m, p.x, p.y, p.ith * DTH), interior), 'starts outside the building');
    assert.ok([NTH / 4, (3 * NTH) / 4].includes(p.ith), 'faces straight in or straight out');
  }
});

test('a car cannot turn sideways in a stall barely wider than itself', () => {
  const c = defaultConfig();
  c.building = { width: 9, depth: 40, wallThickness: 0.5 };
  c.doors = [{ wall: 'front', offset: 0, width: 9 }];
  const w = buildWorld(c);
  const m = vehicleModel(newVehicle('small'));
  const s = new Search(w, m, w.obstacles.map((o) => o.obb));
  s.run(s.startPoses());
  let inside = 0;
  for (const idx of s.closedList) {
    const p = s.pose(idx);
    if (p.y < 5) continue; // well inside the building
    inside++;
    const offAxis = Math.min(Math.abs(p.th - Math.PI / 2), Math.abs(p.th - 1.5 * Math.PI));
    assert.ok(offAxis < 0.5, `heading ${(p.th * 180 / Math.PI).toFixed(0)}° should be impossible`);
  }
  assert.ok(inside > 0, 'it does get in');
});

test('goal test stops the search early', () => {
  const w = buildWorld(defaultConfig());
  const m = vehicleModel(newVehicle('small'));
  const s = new Search(w, m, w.obstacles.map((o) => o.obb));
  const idx = s.run(s.startPoses(), { goalTest: (x, y) => y > 5 });
  assert.ok(idx >= 0 && s.pose(idx).y > 5);
  assert.ok(s.closedList.length < 5000);
});
