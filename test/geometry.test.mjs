import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeObb, rectObb, obbOverlap, obbCorners, obbInsideRect, angleDiff, normAngle } from '../js/geometry.js';

test('axis-aligned boxes: overlapping, separated, touching', () => {
  const a = rectObb(0, 0, 2, 2);
  assert.ok(obbOverlap(a, rectObb(1, 1, 3, 3)));
  assert.ok(!obbOverlap(a, rectObb(2.01, 0, 4, 2)));
  // Touching edges count as a collision (no zero clearance).
  assert.ok(obbOverlap(a, rectObb(2, 0, 4, 2)));
});

test('long wall next to a slightly rotated box: SAT decides when bounding circles overlap', () => {
  const wall = rectObb(0, 0, 10, 1);
  const near = makeObb(5, 2.2, 3, 0.5, 0.1);
  assert.ok(Math.hypot(near.cx - wall.cx, near.cy - wall.cy) < wall.r + near.r, 'bounding circles should overlap');
  assert.ok(!obbOverlap(wall, near));
  // Lower edge reaches y = 1.7 - (3 sin 0.1 + 0.5 cos 0.1) = 0.90 < 1.
  assert.ok(obbOverlap(wall, makeObb(5, 1.7, 3, 0.5, 0.1)));
});

test('overlap is symmetric for random boxes', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    const a = makeObb(rnd() * 10, rnd() * 10, 0.5 + rnd() * 3, 0.5 + rnd() * 3, rnd() * 7);
    const b = makeObb(rnd() * 10, rnd() * 10, 0.5 + rnd() * 3, 0.5 + rnd() * 3, rnd() * 7);
    assert.equal(obbOverlap(a, b), obbOverlap(b, a));
  }
});

test('corners and inside-rect test respect rotation', () => {
  const o = makeObb(5, 5, 2, 1, Math.PI / 2);
  const xs = obbCorners(o).map((c) => c[0]), ys = obbCorners(o).map((c) => c[1]);
  assert.ok(Math.abs(Math.min(...xs) - 4) < 1e-9 && Math.abs(Math.max(...xs) - 6) < 1e-9);
  assert.ok(Math.abs(Math.min(...ys) - 3) < 1e-9 && Math.abs(Math.max(...ys) - 7) < 1e-9);
  assert.ok(obbInsideRect(o, 3.9, 2.9, 6.1, 7.1));
  assert.ok(!obbInsideRect(o, 4.5, 0, 10, 10));
});

test('angle helpers wrap correctly', () => {
  assert.ok(Math.abs(normAngle(-Math.PI / 2) - 1.5 * Math.PI) < 1e-12);
  assert.ok(Math.abs(angleDiff(0.1, 2 * Math.PI - 0.1) - 0.2) < 1e-12);
  assert.ok(Math.abs(angleDiff(0, Math.PI) - Math.PI) < 1e-12);
});
