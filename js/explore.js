import { planLayout } from './layout.js';

// Ranking key, compared element by element (higher is better):
//   1. vehicles parked
//   2. quick-access vehicles that can drive straight out
//   3. vehicles that can leave without moving others
//   4. quick-access vehicles close to a door (total depth, to 0.5 ft)
//   5. fewer manoeuvres
export function layoutKey(r, vehicles) {
  const quick = new Set(vehicles.filter((v) => v.quickAccess).map((v) => v.id));
  let quickFree = 0, quickDepth = 0, moves = 0;
  for (const x of r.results) {
    if (!x.parked) continue;
    moves += x.moves;
    if (quick.has(x.id)) {
      if (x.exit?.ok) quickFree++;
      quickDepth += x.depth;
    }
  }
  return [r.parkedCount, quickFree, r.freeExit, -Math.round(quickDepth * 2), -moves];
}

// Positive if layout a is better than b.
export function compareLayouts(a, b, vehicles) {
  const ka = layoutKey(a, vehicles), kb = layoutKey(b, vehicles);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Trial 0 is the plain greedy layout in the user's order; later trials
// shuffle the order and add noise to the spot choice.
export function explore(config, { trials = 20, seed = 1, onProgress, onImproved } = {}) {
  const rng = mulberry32(seed);
  const n = config.vehicles.length;
  let best = null;
  for (let t = 0; t < trials; t++) {
    const order = t === 0 ? [...Array(n).keys()] : shuffle([...Array(n).keys()], rng);
    const noise = t === 0 ? 0 : (t % 3) * 0.5 + 0.25;
    const r = planLayout(config, {
      order, rng, noise,
      onProgress: (p) => onProgress?.({ trial: t, trials, ...p }),
    });
    if (!best || compareLayouts(r, best, config.vehicles) > 0) {
      best = { ...r, trial: t };
      onImproved?.(best);
    }
    // Can't do better than everything parked and free, unless quick-access
    // vehicles might still get closer to a door.
    if (best.parkedCount === n && best.freeExit === n && t >= 2 && !config.vehicles.some((v) => v.quickAccess)) break;
  }
  return best;
}
