import { buildTriangularPatch, icosphereStatistics } from './icosphere-grid.js';

const level = 9;
const patch = buildTriangularPatch(2 ** level);
self.postMessage(
  { level, patch, statistics: icosphereStatistics(level) },
  [patch.coordinates.buffer, patch.indices.buffer]
);
