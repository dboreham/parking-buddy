// Oriented-box geometry. All units are feet, angles are radians.
// An OBB is { cx, cy, hx, hy, c, s, r } where (c, s) is the unit vector of its
// local x axis, hx/hy are half extents and r is the bounding-circle radius.

export function makeObb(cx, cy, hx, hy, th = 0) {
  return { cx, cy, hx, hy, c: Math.cos(th), s: Math.sin(th), r: Math.hypot(hx, hy) };
}

// Axis-aligned rectangle from corner coordinates.
export function rectObb(x0, y0, x1, y1) {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  return makeObb((xa + xb) / 2, (ya + yb) / 2, (xb - xa) / 2, (yb - ya) / 2, 0);
}

// Separating-axis test for two OBBs.
export function obbOverlap(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const rr = a.r + b.r;
  if (dx * dx + dy * dy > rr * rr) return false;
  // Axes of a.
  let ab = Math.abs(a.c * b.c + a.s * b.s); // |ax . bx|
  let ab2 = Math.abs(a.c * -b.s + a.s * b.c); // |ax . by|
  if (Math.abs(dx * a.c + dy * a.s) > a.hx + b.hx * ab + b.hy * ab2) return false;
  const ab3 = Math.abs(-a.s * b.c + a.c * b.s); // |ay . bx|
  const ab4 = Math.abs(a.s * b.s + a.c * b.c); // |ay . by|
  if (Math.abs(-dx * a.s + dy * a.c) > a.hy + b.hx * ab3 + b.hy * ab4) return false;
  // Axes of b.
  if (Math.abs(dx * b.c + dy * b.s) > b.hx + a.hx * ab + a.hy * ab3) return false;
  if (Math.abs(-dx * b.s + dy * b.c) > b.hy + a.hx * ab2 + a.hy * ab4) return false;
  return true;
}

export function obbCorners(o) {
  const ux = o.c * o.hx, uy = o.s * o.hx;
  const vx = -o.s * o.hy, vy = o.c * o.hy;
  return [
    [o.cx + ux + vx, o.cy + uy + vy],
    [o.cx - ux + vx, o.cy - uy + vy],
    [o.cx - ux - vx, o.cy - uy - vy],
    [o.cx + ux - vx, o.cy + uy - vy],
  ];
}

// True if every corner of the OBB lies inside the axis-aligned box.
export function obbInsideRect(o, x0, y0, x1, y1) {
  const ex = Math.abs(o.c) * o.hx + Math.abs(o.s) * o.hy;
  const ey = Math.abs(o.s) * o.hx + Math.abs(o.c) * o.hy;
  return o.cx - ex >= x0 && o.cx + ex <= x1 && o.cy - ey >= y0 && o.cy + ey <= y1;
}

export function normAngle(a) {
  a %= 2 * Math.PI;
  return a < 0 ? a + 2 * Math.PI : a;
}

export function angleDiff(a, b) {
  const d = Math.abs(normAngle(a) - normAngle(b));
  return Math.min(d, 2 * Math.PI - d);
}
