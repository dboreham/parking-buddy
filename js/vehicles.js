import { makeObb } from './geometry.js';

// Typical dimensions in feet. Width is the body width (doors closed, mirrors
// excluded); mirrorWidth is the overall width across the mirrors.
// turningCircle is the published curb-to-curb turning diameter.
export const PRESETS = {
  small: {
    label: 'Small car (compact sedan)',
    length: 15.1, width: 5.9, mirrorWidth: 6.8, wheelbase: 8.9, frontOverhang: 3.0, turningCircle: 36.4,
  },
  medium: {
    label: 'Medium (compact SUV)',
    length: 15.3, width: 6.1, mirrorWidth: 7.0, wheelbase: 8.8, frontOverhang: 3.0, turningCircle: 36.0,
  },
  large: {
    label: 'Large SUV',
    length: 17.6, width: 6.7, mirrorWidth: 7.8, wheelbase: 10.1, frontOverhang: 3.2, turningCircle: 39.0,
  },
  pickup: {
    label: 'Full-size pickup (crew cab)',
    length: 19.4, width: 6.7, mirrorWidth: 8.0, wheelbase: 12.1, frontOverhang: 3.1, turningCircle: 47.8,
  },
  sports: {
    label: 'Sports car',
    length: 14.8, width: 6.2, mirrorWidth: 6.9, wheelbase: 8.0, frontOverhang: 3.3, turningCircle: 36.0,
  },
};

export const COLORS = ['#e4572e', '#2e86ab', '#f3a712', '#6a994e', '#a8577e', '#4c5b8c', '#c96f3b', '#3a9e9e'];

let nextId = 1;
export function newVehicle(presetKey, index = 0) {
  const p = PRESETS[presetKey] || PRESETS.medium;
  return {
    id: nextId++,
    name: p.label.replace(/\s*\(.*\)/, ''),
    preset: presetKey,
    length: p.length,
    width: p.width,
    mirrorWidth: p.mirrorWidth,
    wheelbase: p.wheelbase,
    frontOverhang: p.frontOverhang,
    turningCircle: p.turningCircle,
    color: COLORS[index % COLORS.length],
    pin: null, // optional user-chosen parking pose { x, y, th }
  };
}

export function syncNextId(vehicles) {
  for (const v of vehicles) nextId = Math.max(nextId, v.id + 1);
}

// Derived geometry. The reference point is the centre of the rear axle,
// which is the point the kinematic (bicycle) model rotates about.
export function vehicleModel(v) {
  const rearOverhang = Math.max(0, v.length - v.wheelbase - v.frontOverhang);
  const track = v.width * 0.86;
  const rc = v.turningCircle / 2;
  // Outer front wheel traces the curb-to-curb circle:
  //   rc^2 = (R + track/2)^2 + wheelbase^2
  const rMin = Math.max(v.wheelbase * 0.6, Math.sqrt(Math.max(rc * rc - v.wheelbase * v.wheelbase, 1)) - track / 2);
  return {
    ...v,
    rearOverhang,
    track,
    rMin,
    maxSteer: Math.atan(v.wheelbase / rMin),
    // Body box centre offset from the rear axle, along the heading.
    bodyOffset: (v.wheelbase + v.frontOverhang - rearOverhang) / 2,
    // Mirrors sit roughly at the A-pillars.
    mirrorOffset: v.wheelbase - Math.min(2.4, v.wheelbase * 0.3),
    mirrorDepth: 0.7,
  };
}

// Body box at pose, with optional inflation (longitudinal, lateral) per side.
export function bodyObb(m, x, y, th, inflLong = 0, inflLat = 0) {
  const c = Math.cos(th), s = Math.sin(th);
  return makeObb(x + c * m.bodyOffset, y + s * m.bodyOffset, m.length / 2 + inflLong, m.width / 2 + inflLat, th);
}

export function mirrorObb(m, x, y, th, infl = 0) {
  const c = Math.cos(th), s = Math.sin(th);
  return makeObb(x + c * m.mirrorOffset, y + s * m.mirrorOffset, m.mirrorDepth / 2 + infl, m.mirrorWidth / 2 + infl, th);
}
