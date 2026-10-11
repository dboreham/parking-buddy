// Hybrid-A*-style search over (x, y, heading) for a car-like vehicle.
//
// Headings are discretised into NTH bins and every motion primitive turns
// the vehicle by exactly 0 or +/-1 bin, so headings stay exact while x/y
// remain continuous. The search is run as a Dijkstra flood from the start
// poses, which yields every pose the vehicle can reach (and the cheapest
// manoeuvre to get there) in a single pass.

import { makeObb, obbOverlap, rectObb } from './geometry.js';

export const NTH = 72;
export const DTH = (2 * Math.PI) / NTH;
const MAX_STATES = 3_000_000;

const COS = new Float64Array(NTH);
const SIN = new Float64Array(NTH);
for (let i = 0; i < NTH; i++) {
  COS[i] = Math.cos(i * DTH);
  SIN[i] = Math.sin(i * DTH);
}

export function headingBin(th) {
  return ((Math.round(th / DTH) % NTH) + NTH) % NTH;
}

const COST = { reverse: 1.4, steer: 0.3, switchDir: 6 };

// Pose after travelling arc length s (signed by dir) with curvature kappa.
export function arcPose(x, y, th, dir, kappa, s) {
  if (Math.abs(kappa) < 1e-9) {
    return [x + dir * s * Math.cos(th), y + dir * s * Math.sin(th), th];
  }
  const th2 = th + dir * kappa * s;
  return [x + (Math.sin(th2) - Math.sin(th)) / kappa, y - (Math.cos(th2) - Math.cos(th)) / kappa, th2];
}

function buildPrimitives(model, cell) {
  const prims = [];
  const sTight = model.rMin * DTH;
  const steps = [
    { kappa: 0, s: Math.max(sTight, cell * 1.5), dth: 0 },
    { kappa: 1 / model.rMin, s: sTight, dth: 1 },
    { kappa: -1 / model.rMin, s: sTight, dth: -1 },
    { kappa: 1 / (2 * model.rMin), s: 2 * sTight, dth: 1 },
    { kappa: -1 / (2 * model.rMin), s: 2 * sTight, dth: -1 },
  ];
  for (const dir of [1, -1]) {
    for (const st of steps) {
      const nsub = Math.max(1, Math.ceil(st.s / Math.min(0.5, cell)));
      // Per start heading: offsets (dx, dy, cos, sin) of each sub-pose.
      const tab = new Float64Array(NTH * nsub * 4);
      for (let i = 0; i < NTH; i++) {
        const th = i * DTH;
        for (let k = 1; k <= nsub; k++) {
          const [px, py, pth] = arcPose(0, 0, th, dir, st.kappa, (st.s * k) / nsub);
          const o = (i * nsub + k - 1) * 4;
          tab[o] = px;
          tab[o + 1] = py;
          tab[o + 2] = Math.cos(pth);
          tab[o + 3] = Math.sin(pth);
        }
      }
      const dth = dir * st.dth;
      const cost = st.s * (dir < 0 ? COST.reverse : 1) + (st.kappa ? COST.steer * st.s : 0);
      prims.push({ dir, kappa: st.kappa, s: st.s, dth, nsub, tab, cost });
    }
  }
  return prims;
}

class Heap {
  constructor() {
    this.k = new Float64Array(1024);
    this.v = new Int32Array(1024);
    this.n = 0;
  }
  push(key, val) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() {
    const K = this.k, V = this.v;
    const top = V[0];
    this.topKey = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], val = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = val;
    }
    return top;
  }
}

// Shared state buffers, reused between searches over the same grid size.
let bufCache = null;
function buffers(n) {
  if (!bufCache || bufCache.n !== n) {
    bufCache = {
      n,
      g: new Float64Array(n),
      px: new Float32Array(n),
      py: new Float32Array(n),
      parent: new Int32Array(n),
      prim: new Int8Array(n),
      closed: new Uint8Array(n),
    };
  }
  const b = bufCache;
  b.g.fill(Infinity);
  b.closed.fill(0);
  return b;
}

export class Search {
  // obstacles: array of OBBs the vehicle must not touch (walls, posts,
  // parked vehicles). Clearance inflates the moving vehicle.
  constructor(world, model, obstacles) {
    this.world = world;
    this.m = model;
    this.obstacles = obstacles;
    this.clearance = Math.max(0, world.settings.clearance);
    const { x0, y0, x1, y1 } = world.bounds;
    const area = (x1 - x0) * (y1 - y0);
    this.cell = Math.max(0.5, Math.sqrt((area * NTH) / MAX_STATES));
    this.nx = Math.ceil((x1 - x0) / this.cell);
    this.ny = Math.ceil((y1 - y0) / this.cell);
    this.prims = buildPrimitives(model, this.cell);
    this.body = makeObb(0, 0, model.length / 2 + this.clearance, model.width / 2 + this.clearance, 0);
    this.mirror = makeObb(0, 0, model.mirrorDepth / 2 + this.clearance, model.mirrorWidth / 2 + this.clearance, 0);
    this.envelope = rectObb(-world.t, -world.t, world.W + world.t, world.D + world.t);
    this.buildBuckets();
  }

  // Spatial hash: for each bucket, the obstacles that a vehicle whose body
  // centre lies in that bucket could possibly touch.
  buildBuckets() {
    const { x0, y0, x1, y1 } = this.world.bounds;
    const bs = (this.bs = 2);
    this.bnx = Math.ceil((x1 - x0) / bs) + 1;
    this.bny = Math.ceil((y1 - y0) / bs) + 1;
    const m = this.m;
    const reach = Math.max(this.body.r, Math.abs(m.mirrorOffset - m.bodyOffset) + this.mirror.r);
    this.buckets = Array.from({ length: this.bnx * this.bny }, () => []);
    for (const o of this.obstacles) {
      const ex = Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hy + reach;
      const ey = Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hy + reach;
      const bx0 = Math.max(0, Math.floor((o.cx - ex - x0) / bs)), bx1 = Math.min(this.bnx - 1, Math.floor((o.cx + ex - x0) / bs));
      const by0 = Math.max(0, Math.floor((o.cy - ey - y0) / bs)), by1 = Math.min(this.bny - 1, Math.floor((o.cy + ey - y0) / bs));
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) this.buckets[by * this.bnx + bx].push(o);
    }
  }

  // Collision test for the (clearance-inflated) vehicle with rear axle at
  // (x, y) and heading given by (c, s).
  collides(x, y, c, s) {
    const m = this.m, b = this.body, mi = this.mirror;
    b.cx = x + c * m.bodyOffset; b.cy = y + s * m.bodyOffset; b.c = c; b.s = s;
    // Stay within the modelled area (body only; clearance is for solid things).
    const { x0, y0, x1, y1 } = this.world.bounds;
    const ex = Math.abs(c) * m.length / 2 + Math.abs(s) * m.width / 2;
    const ey = Math.abs(s) * m.length / 2 + Math.abs(c) * m.width / 2;
    if (b.cx - ex < x0 || b.cx + ex > x1 || b.cy - ey < y0 || b.cy + ey > y1) return true;
    mi.cx = x + c * m.mirrorOffset; mi.cy = y + s * m.mirrorOffset; mi.c = c; mi.s = s;
    const obs = this.buckets[Math.floor((b.cy - y0) / this.bs) * this.bnx + Math.floor((b.cx - x0) / this.bs)];
    for (let i = 0; i < obs.length; i++) {
      if (obbOverlap(b, obs[i]) || obbOverlap(mi, obs[i])) return true;
    }
    return false;
  }

  collidesPose(x, y, th) {
    return this.collides(x, y, Math.cos(th), Math.sin(th));
  }

  index(x, y, ith) {
    const ix = Math.floor((x - this.world.bounds.x0) / this.cell);
    const iy = Math.floor((y - this.world.bounds.y0) / this.cell);
    if (ix < 0 || iy < 0 || ix >= this.nx || iy >= this.ny) return -1;
    return (iy * this.nx + ix) * NTH + ith;
  }

  // Entry poses just outside each door: driving in forwards and reversing in.
  startPoses() {
    const m = this.m, w = this.world;
    const poses = [];
    const gap = w.t + this.clearance + 0.3;
    for (const d of w.doors) {
      const ux = Math.cos(d.inward), uy = Math.sin(d.inward);
      const [cx, cy] = d.center;
      const fwd = gap + m.wheelbase + m.frontOverhang;
      poses.push({ x: cx - ux * fwd, y: cy - uy * fwd, ith: headingBin(d.inward), door: d.index });
      const rev = gap + m.rearOverhang;
      poses.push({ x: cx - ux * rev, y: cy - uy * rev, ith: headingBin(d.inward + Math.PI), door: d.index });
    }
    return poses.filter((p) => !this.collides(p.x, p.y, COS[p.ith], SIN[p.ith]));
  }

  // Dijkstra flood. Stops early when goalTest(x, y, ith) returns true and
  // returns that state index; otherwise returns -1 after exhausting the
  // reachable space (or maxExpansions).
  run(starts, { goalTest = null, maxExpansions = 4_000_000 } = {}) {
    const n = this.nx * this.ny * NTH;
    const B = buffers(n);
    const { g, px, py, parent, prim, closed } = B;
    this.B = B;
    const heap = new Heap();
    for (const p of starts) {
      const idx = this.index(p.x, p.y, p.ith);
      if (idx < 0) continue;
      g[idx] = 0; px[idx] = p.x; py[idx] = p.y; parent[idx] = -1; prim[idx] = -1;
      heap.push(0, idx);
    }
    const closedList = [];
    const prims = this.prims;
    const x0 = this.world.bounds.x0, y0 = this.world.bounds.y0, cell = this.cell, nx = this.nx, ny = this.ny;
    let expansions = 0;
    while (heap.n > 0 && expansions < maxExpansions) {
      const idx = heap.pop();
      if (closed[idx] || heap.topKey > g[idx]) continue;
      closed[idx] = 1;
      closedList.push(idx);
      expansions++;
      const ith = idx % NTH;
      const x = px[idx], y = py[idx];
      if (goalTest && goalTest(x, y, ith)) {
        this.closedList = closedList;
        return idx;
      }
      const gi = g[idx];
      const lastDir = prim[idx] >= 0 ? prims[prim[idx]].dir : 0;
      for (let p = 0; p < prims.length; p++) {
        const P = prims[p];
        const nth = (ith + P.dth + NTH) % NTH;
        const tab = P.tab, base = ith * P.nsub * 4;
        const last = base + (P.nsub - 1) * 4;
        const ex = x + tab[last], ey = y + tab[last + 1];
        const ix = Math.floor((ex - x0) / cell), iy = Math.floor((ey - y0) / cell);
        if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
        const nidx = (iy * nx + ix) * NTH + nth;
        if (closed[nidx]) continue;
        const cost = gi + P.cost + (lastDir && lastDir !== P.dir ? COST.switchDir : 0);
        if (cost >= g[nidx]) continue;
        let hit = false;
        for (let k = 0; k < P.nsub; k++) {
          const o = base + k * 4;
          if (this.collides(x + tab[o], y + tab[o + 1], tab[o + 2], tab[o + 3])) { hit = true; break; }
        }
        if (hit) continue;
        g[nidx] = cost; px[nidx] = ex; py[nidx] = ey; parent[nidx] = idx; prim[nidx] = p;
        heap.push(cost, nidx);
      }
    }
    this.closedList = closedList;
    this.expansions = expansions;
    return -1;
  }

  pose(idx) {
    const ith = idx % NTH;
    return { x: this.B.px[idx], y: this.B.py[idx], th: ith * DTH, ith };
  }

  cost(idx) {
    return this.B.g[idx];
  }

  // Dense pose samples along the path to idx: [{x, y, th, dir, steer}].
  path(idx) {
    const chain = [];
    for (let i = idx; i >= 0; i = this.B.parent[i]) chain.push(i);
    chain.reverse();
    const first = this.pose(chain[0]);
    const out = [{ x: first.x, y: first.y, th: first.th, dir: 0, steer: 0 }];
    for (let k = 1; k < chain.length; k++) {
      const a = this.pose(chain[k - 1]);
      const P = this.prims[this.B.prim[chain[k]]];
      const n = Math.max(1, Math.ceil(P.s / 0.25));
      const steer = Math.atan(this.m.wheelbase * P.kappa);
      for (let j = 1; j <= n; j++) {
        const [x, y, th] = arcPose(a.x, a.y, a.th, P.dir, P.kappa, (P.s * j) / n);
        out.push({ x, y, th, dir: P.dir, steer });
      }
      // Snap the segment end to the stored state to avoid drift.
      const b = this.pose(chain[k]);
      Object.assign(out[out.length - 1], { x: b.x, y: b.y, th: b.th });
    }
    return out;
  }
}

export { COS, SIN };
