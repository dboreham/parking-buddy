import { planLayout } from './layout.js';

// Higher is better: park as many as possible, then as many as can leave
// freely, then prefer fewer manoeuvres.
export function layoutScore(r) {
  const moves = r.results.reduce((a, x) => a + (x.parked ? x.moves : 0), 0);
  return r.parkedCount * 1e6 + r.freeExit * 1e3 - moves;
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
  let best = null, bestScore = -Infinity;
  for (let t = 0; t < trials; t++) {
    const order = t === 0 ? [...Array(n).keys()] : shuffle([...Array(n).keys()], rng);
    const noise = t === 0 ? 0 : (t % 3) * 0.5 + 0.25;
    const r = planLayout(config, {
      order, rng, noise,
      onProgress: (p) => onProgress?.({ trial: t, trials, ...p }),
    });
    const sc = layoutScore(r);
    if (sc > bestScore) {
      best = { ...r, trial: t };
      bestScore = sc;
      onImproved?.(best);
    }
    if (best.parkedCount === n && best.freeExit === n && t >= 2) break;
  }
  return best;
}
