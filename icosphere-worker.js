import { buildTriangularPatch, icosphereStatistics } from './icosphere-grid.js';

self.addEventListener('message', (event) => {
  const requestedLevel = Math.trunc(Number(event.data?.level));
  const level = Number.isFinite(requestedLevel) ? Math.min(9, Math.max(0, requestedLevel)) : 9;
  const patch = buildTriangularPatch(2 ** level);
  self.postMessage(
    { level, patch, statistics: icosphereStatistics(level) },
    [patch.coordinates.buffer, patch.indices.buffer]
  );
});
