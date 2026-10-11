import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, defaultConfig } from '../js/world.js';
import { newVehicle, vehicleModel, bodyObb, mirrorObb } from '../js/vehicles.js';
import { planLayout, parkValid } from '../js/layout.js';
import { explore, layoutScore } from '../js/explore.js';
import { Search } from '../js/planner.js';
import { rectObb, obbOverlap } from '../js/geometry.js';
import { scenarios, makeConfig } from './scenarios.mjs';

// The core guarantee: every planned manoeuvre is drivable. Each path is
// continuous, never turns tighter than the vehicle can, never touches a wall,
// obstacle or vehicle already parked (with clearance), starts outside the
// building and ends in a spot that meets the spacing rules.
for (const name of Object.keys(scenarios)) {
  test(`planned paths are drivable and collision-free: ${name}`, () => {
    const config = makeConfig(name);
    const world = buildWorld(config);
    const r = planLayout(config);
    assert.ok(r.parkedCount > 0);
    const parked = r.results.filter((x) => x.parked).sort((a, b) => a.seq - b.seq);
    const before = [];
    for (const res of parked) {
      const v = config.vehicles.find((x) => x.id === res.id);
      const m = vehicleModel(v);
      const obstacles = [...world.obstacles.map((o) => o.obb), ...before.flatMap((b) => [b.body, b.mirror])];
      const search = new Search(world, m, obstacles);
      const path = res.path;
      assert.ok(!obbOverlap(bodyObb(m, path[0].x, path[0].y, path[0].th), rectObb(0, 0, world.W, world.D)), `${v.name} starts outside`);
      for (let i = 0; i < path.length; i++) {
        const q = path[i];
        assert.ok(!search.collidesPose(q.x, q.y, q.th), `${v.name} collides at sample ${i}`);
        assert.ok(Math.abs(Math.tan(q.steer)) / m.wheelbase <= 1 / m.rMin + 1e-9, `${v.name} turns too tightly`);
        if (i > 0) assert.ok(Math.hypot(q.x - path[i - 1].x, q.y - path[i - 1].y) < 0.3, `${v.name} jumps at sample ${i}`);
      }
      const end = path[path.length - 1];
      assert.ok(Math.hypot(end.x - res.pose.x, end.y - res.pose.y) < 1e-6 && end.th === res.pose.th);
      assert.ok(parkValid(world, m, res.pose.x, res.pose.y, res.pose.th, before), `${v.name} spacing`);
      const { x, y, th } = res.pose;
      before.push({ body: bodyObb(m, x, y, th), mirror: mirrorObb(m, x, y, th) });
    }
    if (!config.settings.allowAngled) {
      for (const res of parked) assert.ok(Math.abs(Math.sin(2 * res.pose.th)) < 1e-9, 'axis-aligned when angled parking is off');
    }
  });
}

test('three cars fit a standard three-bay garage, each driving straight in', () => {
  const r = planLayout(makeConfig('threeBay'));
  assert.equal(r.parkedCount, 3);
  assert.equal(r.freeExit, 3);
  for (const x of r.results) assert.equal(x.moves, 1);
  assert.deepEqual(r.results.map((x) => x.door).sort(), [0, 1, 2], 'one car per door');
});

test('a crew-cab pickup cannot clear a 9 ft door with 6 in clearance, but can a 10 ft one', () => {
  const c = defaultConfig();
  c.vehicles = [newVehicle('pickup')];
  assert.equal(planLayout(c).parkedCount, 0);
  c.doors = [{ wall: 'front', offset: 13, width: 10 }];
  assert.equal(planLayout(c).parkedCount, 1);
});

test('tandem garage parks two cars, the back one blocked by the front one', () => {
  const c = makeConfig('tandem');
  const r = planLayout(c);
  assert.equal(r.parkedCount, 2);
  const [back, front] = r.results;
  assert.ok(back.pose.y > front.pose.y);
  assert.equal(back.exit.ok, false);
  assert.deepEqual(back.exit.blockedBy, [front.id]);
  assert.equal(front.exit.ok, true);
});

test('a building with no doors parks nothing and says why', () => {
  const c = makeConfig('threeBay');
  c.doors = [];
  const r = planLayout(c);
  assert.equal(r.parkedCount, 0);
  for (const x of r.results) assert.match(x.reason, /door/);
});

test('pinned spot is honoured and pinned vehicles park first', () => {
  const c = makeConfig('threeBay');
  c.vehicles[2].pin = { x: 18, y: 10, th: Math.PI / 2 };
  const r = planLayout(c);
  assert.equal(r.order[0], 2);
  const p = r.results[2].pose;
  assert.ok(Math.hypot(p.x - 18, p.y - 10) < 1);
  assert.equal(p.th, Math.PI / 2);
});

test('a pin that cannot be reached is reported, not silently moved', () => {
  const c = makeConfig('tandem');
  c.vehicles = [c.vehicles[0]];
  c.vehicles[0].pin = { x: 0.5, y: 20, th: 0 }; // sideways in a 14 ft wide stall
  const r = planLayout(c);
  assert.equal(r.parkedCount, 0);
  assert.match(r.results[0].reason, /pinned spot (cannot be reached|is not inside)/);
});

test('a pin outside the building is rejected rather than parking on the driveway', () => {
  const c = makeConfig('threeBay');
  c.vehicles = [c.vehicles[0]];
  c.vehicles[0].pin = { x: 18, y: -20, th: Math.PI / 2 }; // out on the apron
  const r = planLayout(c);
  assert.equal(r.parkedCount, 0);
  assert.match(r.results[0].reason, /not inside the building/);
});

test('a pin straddling the wall is rejected', () => {
  const c = makeConfig('threeBay');
  c.vehicles = [c.vehicles[0]];
  c.vehicles[0].pin = { x: 18, y: -3, th: Math.PI / 2 }; // half in the doorway
  assert.equal(planLayout(c).parkedCount, 0);
});

test('larger clearance and side gap never fit more vehicles', () => {
  const tight = makeConfig('barn');
  const loose = makeConfig('barn');
  loose.settings.clearance = 1.5;
  loose.settings.parkGap = 4;
  assert.ok(planLayout(loose).parkedCount <= planLayout(tight).parkedCount);
});

test('layoutScore ranks parked count, then free exits, then fewer moves', () => {
  const mk = (parked, free, moves) => ({ parkedCount: parked, freeExit: free, results: [{ parked: true, moves }] });
  assert.ok(layoutScore(mk(3, 0, 50)) > layoutScore(mk(2, 2, 1)));
  assert.ok(layoutScore(mk(2, 2, 50)) > layoutScore(mk(2, 1, 1)));
  assert.ok(layoutScore(mk(2, 2, 3)) > layoutScore(mk(2, 2, 4)));
});

test('explore is never worse than the plain greedy layout, and is repeatable for a seed', () => {
  const c = makeConfig('sideDoor');
  const greedy = layoutScore(planLayout(c));
  const a = explore(c, { trials: 4, seed: 42 });
  const b = explore(c, { trials: 4, seed: 42 });
  assert.ok(layoutScore(a) >= greedy);
  assert.equal(layoutScore(a), layoutScore(b));
  assert.deepEqual(a.results.map((x) => x.pose), b.results.map((x) => x.pose));
});
