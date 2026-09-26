// Seeded, dependency-free random helpers for the performance dataset. The
// same seed always produces the same data (mulberry32), so a benchmark
// dataset can be rebuilt exactly and two runs compared fairly.

// Stable 32-bit hash of any string (FNV-1a), used to derive per-tenant seeds.
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    // weights: { value: weight } or [[value, weight], …]
    weighted: (weights) => {
      const entries = Array.isArray(weights) ? weights : Object.entries(weights);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) {
        r -= w;
        if (r < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    // Skewed index in [0, n): a few items get most of the picks (owners with
    // big books, hot accounts). s > 1 means stronger skew.
    skewedIndex: (n, s = 1.6) => Math.min(n - 1, Math.floor(n * Math.pow(next(), s))),
    // A date `daysAgoMax`…`daysAgoMin` days before `now`, biased towards recent.
    pastDate: (now, daysAgoMax, daysAgoMin = 0, recencyBias = 1.8) => {
      const days = daysAgoMin + (daysAgoMax - daysAgoMin) * Math.pow(next(), recencyBias);
      return new Date(now.getTime() - days * 86400000 - Math.floor(next() * 86400000));
    },
    futureDate: (now, daysMin, daysMax) => new Date(now.getTime() + (daysMin + next() * (daysMax - daysMin)) * 86400000),
    money: (min, max) => Math.round((min + (max - min) * Math.pow(next(), 2.2)) / 50) * 50,
  };
  return rng;
}
