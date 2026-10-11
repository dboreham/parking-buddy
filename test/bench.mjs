// Prints the layout found for each scenario, with timings.
//   node test/bench.mjs [scenario] [explore]
import { planLayout } from '../js/layout.js';
import { explore } from '../js/explore.js';
import { scenarios, makeConfig } from './scenarios.mjs';

const only = process.argv[2];
for (const name of Object.keys(scenarios)) {
  if (only && name !== only) continue;
  const cfg = makeConfig(name);
  const t = performance.now();
  const r = planLayout(cfg);
  console.log(`== ${name}: ${r.parkedCount}/${cfg.vehicles.length} parked, ${r.freeExit} free exit, ${Math.round(performance.now() - t)} ms`);
  for (const x of r.results) {
    const v = cfg.vehicles.find((v) => v.id === x.id);
    console.log('  ', v.name.padEnd(18), x.parked
      ? `(${x.pose.x.toFixed(1)}, ${x.pose.y.toFixed(1)}, ${Math.round(x.pose.th * 180 / Math.PI)}°) moves=${x.moves} exit=${x.exit.ok ? 'ok' : 'blocked by ' + x.exit.blockedBy}`
      : x.reason);
  }
}

if (only && process.argv[3] === 'explore') {
  const cfg = makeConfig(only);
  const t = performance.now();
  const best = explore(cfg, { trials: 12, onImproved: (b) => console.log('improved trial', b.trial, b.parkedCount, b.freeExit) });
  console.log('explore', Math.round(performance.now() - t), 'ms', best.parkedCount, best.freeExit);
}
