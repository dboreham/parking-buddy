// Parks a list of vehicles one after another. Each vehicle floods the
// reachable pose space from the doors, then a parking pose is chosen
// (the user's pinned pose, or the best-scoring free spot).

import { obbOverlap, obbInsideRect, rectObb, makeObb, angleDiff } from './geometry.js';
import { vehicleModel, bodyObb, mirrorObb } from './vehicles.js';
import { buildWorld } from './world.js';
import { Search, NTH, DTH, headingBin } from './planner.js';

const AXIS_STEP = NTH / 4;

function staticObbs(world) {
  return world.obstacles.map((o) => o.obb);
}

function parkedObbs(list, exclude = -1) {
  const out = [];
  for (const p of list) {
    if (p.vi === exclude) continue;
    out.push(p.body, p.mirror);
  }
  return out;
}

// Is a parked vehicle at (x, y, th) leaving enough room around it?
// parked: [{ body }] of vehicles already in place.
export function parkValid(world, m, x, y, th, parked) {
  const s = world.settings;
  const body = bodyObb(m, x, y, th, Math.max(0, s.endGap), Math.max(0, s.parkGap));
  const bare = bodyObb(m, x, y, th);
  if (!obbInsideRect(bare, 0, 0, world.W, world.D)) return false;
  for (const o of world.obstacles) if (obbOverlap(body, o.obb)) return false;
  for (const p of parked) if (obbOverlap(body, p.body)) return false;
  return true;
}

// Does the area just beyond a side of the box touch anything?
function sideTouches(box, side, probe, solids) {
  const along = side < 2;
  const sign = side % 2 === 0 ? 1 : -1;
  const h = along ? box.hx : box.hy;
  const off = (h + probe / 2) * sign;
  const cx = box.cx + (along ? box.c * off : -box.s * off);
  const cy = box.cy + (along ? box.s * off : box.c * off);
  const slab = makeObb(cx, cy, along ? probe / 2 : box.hx * 0.8, along ? box.hy * 0.8 : probe / 2, Math.atan2(box.s, box.c));
  for (const o of solids) if (obbOverlap(slab, o)) return true;
  return false;
}

function doorLanes(world, laneDepth) {
  return world.doors.map((d) => {
    const { W, D } = world;
    const L = Math.min(laneDepth, d.wall === 'front' || d.wall === 'back' ? D : W);
    switch (d.wall) {
      case 'front': return rectObb(d.a, 0, d.b, L);
      case 'back': return rectObb(d.a, D - L, d.b, D);
      case 'left': return rectObb(0, d.a, L, d.b);
      default: return rectObb(W - L, d.a, W, d.b);
    }
  });
}

// Swept area of a parked vehicle's entry path (clearance-inflated), used to
// avoid parking later vehicles in the way of earlier ones.
function sweptPath(world, m, path) {
  const c = Math.max(0, world.settings.clearance);
  const obbs = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < path.length; i += 2) {
    const q = path[i];
    const b = bodyObb(m, q.x, q.y, q.th, c, c);
    obbs.push(b, mirrorObb(m, q.x, q.y, q.th, c));
    x0 = Math.min(x0, b.cx - b.r); x1 = Math.max(x1, b.cx + b.r);
    y0 = Math.min(y0, b.cy - b.r); y1 = Math.max(y1, b.cy + b.r);
  }
  return { obbs, x0, y0, x1, y1 };
}

function blocksSweep(box, sw) {
  if (box.cx + box.r < sw.x0 || box.cx - box.r > sw.x1 || box.cy + box.r < sw.y0 || box.cy - box.r > sw.y1) return false;
  for (const o of sw.obbs) if (obbOverlap(box, o)) return true;
  return false;
}

// How far "in" a point is relative to a door: distance into the building,
// plus a lesser amount for being off to the side of the opening.
function doorDepth(d, x, y) {
  const ux = Math.cos(d.inward), uy = Math.sin(d.inward);
  const dx = x - d.center[0], dy = y - d.center[1];
  const perp = dx * ux + dy * uy;
  const lat = Math.abs(-dx * uy + dy * ux);
  return perp + 0.5 * Math.max(0, lat - d.width / 2);
}

// Scores are in rough "feet of benefit" units.
const W = { depth: 1.0, touch: 0.75, lane: 12, offAxisDeg: 0.15, cost: 0.5, blocks: 200, noise: 25 };

function chooseAuto(ctx, search, m, remaining) {
  const { world, parked, rng, noise } = ctx;
  const s = world.settings;
  const solids = [...staticObbs(world), ...parked.map((p) => p.body)];
  const lanes = remaining > 0 ? doorLanes(world, ctx.laneDepth) : [];
  const sweeps = s.requireExit === false ? [] : parked.map((p) => p.sweep);
  let best = -1, bestScore = -Infinity;
  const seen = new Set();
  for (const idx of search.closedList) {
    const ith = idx % NTH;
    if (!s.allowAngled && ith % AXIS_STEP !== 0) continue;
    const { x, y, th } = search.pose(idx);
    // Coarse de-duplication: one candidate per 0.5 ft cell and heading.
    const key = `${Math.round(x * 2)},${Math.round(y * 2)},${ith}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!parkValid(world, m, x, y, th, parked)) continue;
    const box = bodyObb(m, x, y, th, Math.max(0, s.endGap), Math.max(0, s.parkGap));
    let depth = Infinity;
    for (const d of world.doors) depth = Math.min(depth, doorDepth(d, box.cx, box.cy));
    let touches = 0;
    for (let side = 0; side < 4; side++) if (sideTouches(box, side, 1.0, solids)) touches++;
    let laneHits = 0;
    for (const l of lanes) if (obbOverlap(box, l)) laneHits++;
    const offAxis = angleDiff(th, Math.round(th / (Math.PI / 2)) * (Math.PI / 2)) * 180 / Math.PI;
    let score = W.depth * depth + W.touch * touches - W.lane * laneHits - W.offAxisDeg * offAxis - W.cost * search.cost(idx);
    if (sweeps.length) {
      const bare = bodyObb(m, x, y, th);
      for (const sw of sweeps) if (blocksSweep(bare, sw)) score -= W.blocks;
    }
    if (noise) score += noise * W.noise * rng();
    if (score > bestScore) { bestScore = score; best = idx; }
  }
  return best;
}

function choosePinned(search, pin) {
  const ith = headingBin(pin.th);
  let best = -1, bestD = 1.0;
  for (const idx of search.closedList) {
    if (idx % NTH !== ith) continue;
    const p = search.pose(idx);
    const d = Math.hypot(p.x - pin.x, p.y - pin.y);
    if (d < bestD || (d === bestD && search.cost(idx) < search.cost(best))) { bestD = d; best = idx; }
  }
  return best;
}

function summarizePath(path) {
  let moves = 0, last = 0, dist = 0;
  const firstDir = path.length > 1 ? path[1].dir : 1;
  for (let i = 1; i < path.length; i++) {
    if (path[i].dir !== last) { moves++; last = path[i].dir; }
    dist += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return { moves, distance: dist, firstDir };
}

// Can vehicle p drive out with the others in place? First try simply
// reversing its own entry path; if that is blocked, search for another way.
function canExit(world, p, others) {
  const search = new Search(world, p.model, [...staticObbs(world), ...parkedObbs(others)]);
  if (p.path && p.path.every((q) => !search.collidesPose(q.x, q.y, q.th))) return true;
  const env = search.envelope;
  const test = (x, y, ith) => !obbOverlap(bodyObb(p.model, x, y, ith * DTH), env);
  return search.run([{ x: p.x, y: p.y, ith: headingBin(p.th) }], { goalTest: test, maxExpansions: 1_500_000 }) >= 0;
}

export function exitReport(world, parked) {
  const report = new Map();
  for (const p of parked) {
    const others = parked.filter((q) => q !== p);
    if (canExit(world, p, others)) { report.set(p.vi, { ok: true, blockedBy: [] }); continue; }
    const blockedBy = [];
    if (others.length <= 8) {
      for (const q of others) {
        if (canExit(world, p, others.filter((r) => r !== q))) blockedBy.push(q.vi);
      }
    }
    report.set(p.vi, { ok: false, blockedBy });
  }
  return report;
}

// config: the full app config. options: { order, rng, noise, checkExit, onProgress }
export function planLayout(config, options = {}) {
  const world = buildWorld(config);
  const vehicles = config.vehicles;
  const order = options.order || vehicles.map((_, i) => i);
  const rng = options.rng || Math.random;
  const laneDepth = Math.max(10, ...vehicles.map((v) => v.length)) + 2;
  const ctx = { world, parked: [], rng, noise: options.noise || 0, laneDepth };
  const results = vehicles.map((v) => ({ id: v.id, parked: false, reason: 'not attempted' }));
  // Pinned vehicles are parked first (deepest first) so the automatic ones
  // work around them.
  const depth = (i) => {
    const p = vehicles[i].pin;
    return Math.min(...world.doors.map((d) => doorDepth(d, p.x, p.y)));
  };
  const pinned = order.filter((i) => vehicles[i].pin).sort((a, b) => depth(b) - depth(a));
  const seq = [...pinned, ...order.filter((i) => !vehicles[i].pin)];

  seq.forEach((vi, n) => {
    const v = vehicles[vi];
    const m = vehicleModel(v);
    options.onProgress?.({ step: n, total: seq.length, name: v.name });
    const search = new Search(world, m, [...staticObbs(world), ...parkedObbs(ctx.parked)]);
    const starts = search.startPoses();
    if (!starts.length) {
      results[vi] = { id: v.id, parked: false, reason: 'cannot line up with any door (door too narrow or apron too short)' };
      return;
    }
    search.run(starts);
    const idx = v.pin ? choosePinned(search, v.pin) : chooseAuto(ctx, search, m, seq.length - n - 1);
    if (idx < 0) {
      results[vi] = {
        id: v.id, parked: false,
        reason: v.pin ? 'pinned spot cannot be reached' : 'no reachable spot with the required spacing',
      };
      return;
    }
    const pose = search.pose(idx);
    const path = search.path(idx);
    const entry = starts.find((s) => Math.abs(s.x - path[0].x) < 1e-3 && Math.abs(s.y - path[0].y) < 1e-3);
    ctx.parked.push({
      vi, model: m, x: pose.x, y: pose.y, th: pose.th, path,
      sweep: sweptPath(world, m, path),
      body: bodyObb(m, pose.x, pose.y, pose.th),
      mirror: mirrorObb(m, pose.x, pose.y, pose.th),
    });
    results[vi] = {
      id: v.id, parked: true, pose: { x: pose.x, y: pose.y, th: pose.th }, path,
      seq: n, door: entry ? entry.door : null,
      spacingOk: parkValid(world, m, pose.x, pose.y, pose.th, ctx.parked.slice(0, -1)),
      ...summarizePath(path),
    };
  });

  if (options.checkExit !== false && ctx.parked.length) {
    options.onProgress?.({ step: seq.length, total: seq.length, name: 'exit check' });
    const report = exitReport(world, ctx.parked);
    for (const [vi, r] of report) results[vi].exit = { ok: r.ok, blockedBy: r.blockedBy.map((j) => vehicles[j].id) };
  }

  const parkedCount = results.filter((r) => r.parked).length;
  const freeExit = results.filter((r) => r.parked && r.exit?.ok).length;
  return { results, parkedCount, freeExit, order: seq };
}
