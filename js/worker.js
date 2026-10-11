import { planLayout } from './layout.js';
import { explore } from './explore.js';

self.onmessage = (e) => {
  const { type, config, id, trials } = e.data;
  try {
    if (type === 'plan') {
      const result = planLayout(config, { onProgress: (p) => self.postMessage({ type: 'progress', id, ...p }) });
      self.postMessage({ type: 'result', id, result });
    } else if (type === 'explore') {
      const result = explore(config, {
        trials,
        seed: (Math.random() * 2 ** 31) | 0,
        onProgress: (p) => self.postMessage({ type: 'progress', id, ...p }),
        onImproved: (best) => self.postMessage({ type: 'improved', id, parkedCount: best.parkedCount, freeExit: best.freeExit, trial: best.trial }),
      });
      self.postMessage({ type: 'result', id, result });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err && err.stack || err) });
  }
};
