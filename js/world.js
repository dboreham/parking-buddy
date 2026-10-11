import { rectObb } from './geometry.js';

// Coordinate system: the building interior spans x in [0, width] (left to
// right) and y in [0, depth] (front to back). Walls sit outside the interior.
// Door offsets are measured from the left end of the front/back walls and
// from the front end of the left/right walls.

export const WALLS = ['front', 'back', 'left', 'right'];

export const INWARD = { front: Math.PI / 2, back: -Math.PI / 2, left: 0, right: Math.PI };

export function defaultConfig() {
  return {
    building: { width: 36, depth: 30, wallThickness: 0.5 },
    doors: [
      { wall: 'front', offset: 2.25, width: 9, auto: true },
      { wall: 'front', offset: 13.5, width: 9, auto: true },
      { wall: 'front', offset: 24.75, width: 9, auto: true },
    ],
    obstacles: [],
    settings: { clearance: 0.5, parkGap: 2.5, endGap: 1.0, apron: 30, allowAngled: false, requireExit: true },
    vehicles: [],
  };
}

export function wallLength(b, wall) {
  return wall === 'front' || wall === 'back' ? b.width : b.depth;
}

// Sets the offset of every door marked `auto` (mutating it). Auto doors on a
// wall are spread with equal gaps at the ends and between doors. If the wall
// also has manually placed doors, the auto ones are spread across the largest
// stretch of wall left free by them.
export function resolveDoorOffsets(building, doors) {
  for (const wall of WALLS) {
    const onWall = doors.filter((d) => d.wall === wall);
    const auto = onWall.filter((d) => d.auto);
    if (!auto.length) continue;
    const len = wallLength(building, wall);
    const fixed = onWall.filter((d) => !d.auto).sort((p, q) => p.offset - q.offset);
    let best = [0, len], pos = 0;
    const consider = (a, b) => { if (b - a > best[1] - best[0]) best = [a, b]; };
    if (fixed.length) {
      best = [0, 0];
      for (const d of fixed) {
        consider(pos, d.offset);
        pos = Math.max(pos, d.offset + d.width);
      }
      consider(pos, len);
    }
    const [a, b] = best;
    const total = auto.reduce((sum, d) => sum + d.width, 0);
    const gap = Math.max(0, (b - a - total) / (auto.length + 1));
    let x = a + gap;
    for (const d of auto) {
      d.offset = Math.round(x * 100) / 100;
      x += d.width + gap;
    }
  }
  return doors;
}

export function buildWorld(config) {
  const { width: W, depth: D } = config.building;
  const t = config.building.wallThickness ?? 0.5;
  const apron = Math.max(0, config.settings.apron);

  const doors = config.doors
    .map((d, i) => {
      const len = wallLength(config.building, d.wall);
      const a = Math.max(0, Math.min(len, d.offset));
      const b = Math.max(a, Math.min(len, d.offset + d.width));
      return { ...d, index: i, a, b, width: b - a };
    })
    .filter((d) => d.width > 0.1)
    .map((d) => {
      const mid = (d.a + d.b) / 2;
      const center = {
        front: [mid, 0], back: [mid, D], left: [0, mid], right: [W, mid],
      }[d.wall];
      return { ...d, center, inward: INWARD[d.wall] };
    });

  const obstacles = [];
  // Walls, with door gaps cut out. Front/back walls own the corners.
  const addWall = (wall, from, to, rect) => {
    const gaps = doors.filter((d) => d.wall === wall).map((d) => [d.a, d.b]).sort((p, q) => p[0] - q[0]);
    let pos = from;
    for (const [a, b] of gaps) {
      if (a > pos) obstacles.push({ kind: 'wall', obb: rect(pos, a) });
      pos = Math.max(pos, b);
    }
    if (to > pos) obstacles.push({ kind: 'wall', obb: rect(pos, to) });
  };
  addWall('front', -t, W + t, (a, b) => rectObb(a, -t, b, 0));
  addWall('back', -t, W + t, (a, b) => rectObb(a, D, b, D + t));
  addWall('left', 0, D, (a, b) => rectObb(-t, a, 0, b));
  addWall('right', 0, D, (a, b) => rectObb(W, a, W + t, b));

  for (const o of config.obstacles || []) {
    if (o.w > 0 && o.d > 0) obstacles.push({ kind: 'obstacle', obb: rectObb(o.x, o.y, o.x + o.w, o.y + o.d), label: o.label });
  }

  const has = (w) => doors.some((d) => d.wall === w);
  const bounds = {
    x0: -t - (has('left') ? apron : 0),
    x1: W + t + (has('right') ? apron : 0),
    y0: -t - (has('front') ? apron : 0),
    y1: D + t + (has('back') ? apron : 0),
  };

  return { W, D, t, apron, doors, obstacles, bounds, settings: config.settings };
}
