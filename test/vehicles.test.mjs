import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, newVehicle, vehicleModel, bodyObb, mirrorObb } from '../js/vehicles.js';

test('presets are physically consistent', () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    assert.ok(p.wheelbase + p.frontOverhang < p.length, `${key}: rear overhang must be positive`);
    assert.ok(p.mirrorWidth > p.width, `${key}: mirrors wider than body`);
    assert.ok(p.turningCircle / 2 > p.wheelbase, `${key}: turning circle larger than wheelbase`);
  }
});

test('minimum radius reproduces the curb-to-curb turning circle', () => {
  for (const key of Object.keys(PRESETS)) {
    const m = vehicleModel(newVehicle(key));
    // The outer front wheel should trace the published circle.
    const outerFront = Math.hypot(m.rMin + m.track / 2, m.wheelbase);
    assert.ok(Math.abs(outerFront - m.turningCircle / 2) < 1e-6, key);
    assert.ok(m.rMin > m.wheelbase * 0.6);
  }
});

test('body box spans rear bumper to front bumper from the rear axle', () => {
  const m = vehicleModel(newVehicle('medium'));
  const b = bodyObb(m, 0, 0, 0);
  assert.ok(Math.abs(b.cx + b.hx - (m.wheelbase + m.frontOverhang)) < 1e-9);
  assert.ok(Math.abs(b.cx - b.hx + m.rearOverhang) < 1e-9);
  assert.equal(b.hy, m.width / 2);
  // Pointing up (+y) the box is rotated accordingly.
  const up = bodyObb(m, 0, 0, Math.PI / 2);
  assert.ok(Math.abs(up.cx) < 1e-9 && Math.abs(up.cy - b.cx) < 1e-9);
});

test('mirrors sit between the axles and are wider than the body', () => {
  const m = vehicleModel(newVehicle('pickup'));
  const mi = mirrorObb(m, 0, 0, 0);
  assert.ok(mi.cx > 0 && mi.cx < m.wheelbase);
  assert.equal(mi.hy, m.mirrorWidth / 2);
});

test('new vehicles get unique ids and no pin', () => {
  const a = newVehicle('small'), b = newVehicle('small');
  assert.notEqual(a.id, b.id);
  assert.equal(a.pin, null);
});
