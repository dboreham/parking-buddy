import { obbCorners } from './geometry.js';
import { bodyObb, mirrorObb } from './vehicles.js';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 10;
    this.ox = 0;
    this.oy = 0;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  // Fit the world bounds (plus room for labels) into the canvas, y up.
  fit(bounds) {
    const pad = 36;
    const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
    this.scale = Math.max(1, Math.min((this.w - 2 * pad) / bw, (this.h - 2 * pad) / bh));
    this.ox = (this.w - bw * this.scale) / 2 - bounds.x0 * this.scale;
    this.oy = (this.h + bh * this.scale) / 2 + bounds.y0 * this.scale;
  }

  toScreen(x, y) {
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  toWorld(sx, sy) {
    return [(sx - this.ox) / this.scale, (this.oy - sy) / this.scale];
  }

  worldTransform() {
    const d = this.dpr;
    this.ctx.setTransform(d * this.scale, 0, 0, -d * this.scale, d * this.ox, d * this.oy);
  }

  screenTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  px(n) {
    return n / this.scale;
  }

  // scene: { world, vehicles: [{ model, pose, steer, color, label, ghost, invalid, highlight, path }], options }
  draw(scene) {
    const ctx = this.ctx;
    const { world, options } = scene;
    const col = {
      bg: cssVar('--cv-bg'), apron: cssVar('--cv-apron'), floor: cssVar('--cv-floor'),
      grid: cssVar('--cv-grid'), grid5: cssVar('--cv-grid5'), wall: cssVar('--cv-wall'),
      door: cssVar('--cv-door'), obstacle: cssVar('--cv-obstacle'), text: cssVar('--cv-text'),
    };
    this.screenTransform();
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!world) return;

    this.worldTransform();
    const { bounds: b, W, D, t } = world;
    ctx.fillStyle = col.apron;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.fillStyle = col.floor;
    ctx.fillRect(0, 0, W, D);

    // Grid: 1 ft and 5 ft lines inside the building.
    ctx.lineWidth = this.px(1);
    for (const [step, color] of [[1, col.grid], [5, col.grid5]]) {
      if (step === 1 && this.scale < 6) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, D); }
      for (let y = step; y < D; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }

    // Door swings / openings.
    for (const d of world.doors) {
      const [cx, cy] = d.center;
      const horiz = d.wall === 'front' || d.wall === 'back';
      ctx.fillStyle = col.door + '33';
      if (horiz) ctx.fillRect(d.a, cy - (d.wall === 'front' ? t : 0), d.width, t);
      else ctx.fillRect(cx - (d.wall === 'left' ? t : 0), d.a, t, d.width);
      ctx.strokeStyle = col.door;
      ctx.lineWidth = this.px(2);
      ctx.setLineDash([this.px(6), this.px(4)]);
      ctx.beginPath();
      if (horiz) { ctx.moveTo(d.a, cy); ctx.lineTo(d.b, cy); } else { ctx.moveTo(cx, d.a); ctx.lineTo(cx, d.b); }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const o of world.obstacles) {
      ctx.fillStyle = o.kind === 'wall' ? col.wall : col.obstacle;
      this.fillObb(o.obb);
    }

    // Paths underneath vehicles.
    if (options.showPaths) {
      for (const v of scene.vehicles) if (v.path) this.drawPath(v.path, v.color, v.pathUpTo);
    }
    for (const v of scene.vehicles) this.drawVehicle(v, options);

    // Labels in screen space.
    this.screenTransform();
    ctx.fillStyle = col.text;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    let [sx, sy] = this.toScreen(W / 2, D + t);
    ctx.fillText(`${fmtFt(W)} wide`, sx, sy - 4);
    [sx, sy] = this.toScreen(-t, D / 2);
    ctx.save();
    ctx.translate(sx - 6, sy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${fmtFt(D)} deep`, 0, 0);
    ctx.restore();
    ctx.textBaseline = 'middle';
    for (const d of world.doors) {
      const off = 14 + t * this.scale;
      const u = [Math.cos(d.inward), Math.sin(d.inward)];
      const [dx, dy] = this.toScreen(d.center[0] - u[0] * off / this.scale, d.center[1] - u[1] * off / this.scale);
      ctx.fillStyle = col.door;
      ctx.fillText(`Door ${d.index + 1} · ${fmtFt(d.width)}`, dx, dy);
    }
    ctx.fillStyle = col.text;
    for (const v of scene.vehicles) {
      if (!v.label) continue;
      const box = bodyObb(v.model, v.pose.x, v.pose.y, v.pose.th);
      const [lx, ly] = this.toScreen(box.cx, box.cy);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.strokeText(v.label, lx, ly);
      ctx.fillStyle = '#1b1d21';
      ctx.fillText(v.label, lx, ly);
    }
  }

  fillObb(o) {
    const c = obbCorners(o);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  strokeObb(o) {
    const c = obbCorners(o);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
    ctx.closePath();
    ctx.stroke();
  }

  drawPath(path, color, upTo = path.length) {
    const ctx = this.ctx;
    ctx.lineWidth = this.px(2);
    ctx.strokeStyle = color + 'aa';
    let i = 1;
    const n = Math.min(upTo, path.length);
    while (i < n) {
      const dir = path[i].dir;
      ctx.setLineDash(dir < 0 ? [this.px(5), this.px(4)] : []);
      ctx.beginPath();
      ctx.moveTo(path[i - 1].x, path[i - 1].y);
      while (i < n && path[i].dir === dir) { ctx.lineTo(path[i].x, path[i].y); i++; }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawVehicle(v, options) {
    const ctx = this.ctx;
    const m = v.model;
    const { x, y, th } = v.pose;
    const c = Math.cos(th), s = Math.sin(th);

    if (options.showClearance && !v.ghost) {
      ctx.strokeStyle = v.color + '88';
      ctx.lineWidth = this.px(1);
      ctx.setLineDash([this.px(3), this.px(3)]);
      if (v.moving) {
        // While driving: the clearance kept around body and mirrors.
        const cl = options.clearance;
        this.strokeObb(bodyObb(m, x, y, th, cl, cl));
        this.strokeObb(mirrorObb(m, x, y, th, cl));
      } else {
        // Parked: the side/end gap no other vehicle or wall may enter.
        // Neighbours' zones may overlap; each only has to clear the other's body.
        const zone = bodyObb(m, x, y, th, options.endGap, options.parkGap);
        ctx.fillStyle = v.color + '1f';
        this.fillObb(zone);
        this.strokeObb(zone);
      }
      ctx.setLineDash([]);
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(th);
    const rear = -m.rearOverhang, front = m.wheelbase + m.frontOverhang, hw = m.width / 2;
    const alpha = v.ghost ? 0.35 : 1;
    ctx.globalAlpha = alpha;

    // Wheels.
    const tw = 0.7, tl = 2.2, ht = m.track / 2;
    ctx.fillStyle = '#1b1d21';
    for (const [wx, wy, steer] of [[0, ht, 0], [0, -ht, 0], [m.wheelbase, ht, v.steer || 0], [m.wheelbase, -ht, v.steer || 0]]) {
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(steer);
      ctx.fillRect(-tl / 2, -tw / 2, tl, tw);
      ctx.restore();
    }

    // Mirrors.
    ctx.fillStyle = v.color;
    const mw = m.mirrorWidth / 2;
    ctx.fillRect(m.mirrorOffset - m.mirrorDepth / 2, hw - 0.1, m.mirrorDepth, mw - hw + 0.1);
    ctx.fillRect(m.mirrorOffset - m.mirrorDepth / 2, -mw, m.mirrorDepth, mw - hw + 0.1);

    // Body.
    roundRect(ctx, rear, -hw, front - rear, m.width, 1.0);
    ctx.fillStyle = v.color;
    ctx.fill();
    ctx.lineWidth = this.px(v.highlight ? 3 : 1.2);
    ctx.strokeStyle = v.invalid ? '#c7392f' : v.highlight ? '#ffffff' : 'rgba(0,0,0,0.45)';
    if (v.ghost) ctx.setLineDash([this.px(5), this.px(3)]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Windscreen and rear window.
    ctx.fillStyle = 'rgba(20, 30, 45, 0.55)';
    const ws = m.wheelbase - 0.4;
    ctx.beginPath();
    ctx.moveTo(ws, -hw + 0.5); ctx.lineTo(ws + 1.0, -hw + 0.7); ctx.lineTo(ws + 1.0, hw - 0.7); ctx.lineTo(ws, hw - 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(rear + 1.2 + (m.length > 18 ? 5 : 0), -hw + 0.7, 0.7, m.width - 1.4);

    // Headlights.
    ctx.fillStyle = 'rgba(255, 245, 200, 0.95)';
    ctx.fillRect(front - 0.35, -hw + 0.35, 0.3, 1.0);
    ctx.fillRect(front - 0.35, hw - 1.35, 0.3, 1.0);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (v.invalid) {
      ctx.strokeStyle = '#c7392f';
      ctx.lineWidth = this.px(2);
      this.strokeObb(bodyObb(m, x, y, th));
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function fmtFt(v) {
  const ft = Math.floor(v + 1e-6);
  const inch = Math.round((v - ft) * 12);
  if (inch === 12) return `${ft + 1}'`;
  return inch ? `${ft}'${inch}"` : `${ft}'`;
}
