import * as THREE from 'three';

const RETAINED_HOPS = 1;
const SURFACE_TRACE_OFFSET_METERS = 500;
const ADSORBED_MARKER_OFFSET_METERS = 2000;

function traceResolution(particleCount) {
  if (particleCount <= 100) {
    return { pointsPerHop: 64, sampleIntervalSeconds: 8, sampleDistanceMeters: 5000 };
  }
  if (particleCount <= 1000) {
    return { pointsPerHop: 32, sampleIntervalSeconds: 20, sampleDistanceMeters: 15_000 };
  }
  if (particleCount <= 10_000) {
    return { pointsPerHop: 16, sampleIntervalSeconds: 45, sampleDistanceMeters: 40_000 };
  }
  return { pointsPerHop: 8, sampleIntervalSeconds: 90, sampleDistanceMeters: 75_000 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function createSimulationRenderer({
  parent,
  particleCount,
  moonRadiusMeters,
  moonRenderRadius
}) {
  const group = new THREE.Group();
  const renderScale = moonRenderRadius / moonRadiusMeters;
  const { pointsPerHop, sampleIntervalSeconds, sampleDistanceMeters } = traceResolution(particleCount);
  const segmentsPerHop = pointsPerHop - 1;
  const particlePositions = new Float32Array(particleCount * 3);

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    color: 0x72d7ff,
    size: 0.105,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  }));
  particles.frustumCulled = false;

  // Fixed slots make the memory cost independent of run duration. Each new
  // launch overwrites that particle's previous hop.
  const segmentsPerParticle = RETAINED_HOPS * segmentsPerHop;
  const tracePositions = new Float32Array(particleCount * segmentsPerParticle * 6);
  const traceGeometry = new THREE.BufferGeometry();
  const traceAttribute = new THREE.BufferAttribute(tracePositions, 3);
  traceAttribute.setUsage(THREE.DynamicDrawUsage);
  traceGeometry.setAttribute('position', traceAttribute);
  traceGeometry.setDrawRange(0, 0);
  const traceMaterial = new THREE.LineBasicMaterial({
    color: 0x72d7ff,
    transparent: true,
    opacity: 0.58,
    depthWrite: false
  });
  const traces = new THREE.LineSegments(traceGeometry, traceMaterial);
  traces.frustumCulled = false;
  group.add(traces, particles);
  parent.add(group);

  const traceStates = Array.from({ length: particleCount }, () => ({
    hopIndex: -1,
    pointCount: 0,
    sampleScale: 1,
    lastPosition: null,
    lastTimeSeconds: 0
  }));
  let traceBufferDirty = false;
  let hasTraceData = false;

  function writeRenderPosition(target, offset, position, radialOffsetMeters = 0) {
    const radius = Math.hypot(position.x, position.y, position.z);
    const factor = renderScale * (1 + radialOffsetMeters / radius);
    target[offset] = position.x * factor;
    target[offset + 1] = position.y * factor;
    target[offset + 2] = position.z * factor;
  }

  function hopOffset(particleId, hopIndex) {
    return (particleId * segmentsPerParticle + hopIndex * segmentsPerHop) * 6;
  }

  function initializeHop(particleId, state, position) {
    state.hopIndex = (state.hopIndex + 1) % RETAINED_HOPS;
    state.pointCount = 1;
    state.sampleScale = 1;
    state.lastPosition = position;
    const offset = hopOffset(particleId, state.hopIndex);
    for (let segment = 0; segment < segmentsPerHop; segment++) {
      writeRenderPosition(tracePositions, offset + segment * 6, position, SURFACE_TRACE_OFFSET_METERS);
      writeRenderPosition(tracePositions, offset + segment * 6 + 3, position, SURFACE_TRACE_OFFSET_METERS);
    }
    traceAttribute.addUpdateRange(offset, segmentsPerHop * 6);
    traceBufferDirty = true;
    hasTraceData = true;
  }

  function renderedPoint(offset, pointIndex) {
    const source = pointIndex === 0 ? offset : offset + (pointIndex - 1) * 6 + 3;
    return [tracePositions[source], tracePositions[source + 1], tracePositions[source + 2]];
  }

  function compressHop(particleId, state) {
    const offset = hopOffset(particleId, state.hopIndex);
    const retainedPoints = [];
    for (let point = 0; point < state.pointCount; point += 2) {
      retainedPoints.push(renderedPoint(offset, point));
    }
    if ((state.pointCount - 1) % 2 !== 0) {
      retainedPoints.push(renderedPoint(offset, state.pointCount - 1));
    }
    const lastPoint = retainedPoints.at(-1);
    for (let segment = 0; segment < segmentsPerHop; segment++) {
      const start = retainedPoints[Math.min(segment, retainedPoints.length - 1)] ?? lastPoint;
      const end = retainedPoints[Math.min(segment + 1, retainedPoints.length - 1)] ?? lastPoint;
      tracePositions.set(start, offset + segment * 6);
      tracePositions.set(end, offset + segment * 6 + 3);
    }
    state.pointCount = retainedPoints.length;
    state.sampleScale *= 2;
    traceAttribute.addUpdateRange(offset, segmentsPerHop * 6);
    traceBufferDirty = true;
  }

  function appendPoint(particleId, state, position) {
    if (state.pointCount >= pointsPerHop) compressHop(particleId, state);
    const segmentIndex = state.pointCount - 1;
    const offset = hopOffset(particleId, state.hopIndex) + segmentIndex * 6;
    writeRenderPosition(tracePositions, offset, state.lastPosition, SURFACE_TRACE_OFFSET_METERS);
    writeRenderPosition(tracePositions, offset + 3, position, SURFACE_TRACE_OFFSET_METERS);
    state.pointCount++;
    traceAttribute.addUpdateRange(offset, 6);
    traceBufferDirty = true;
    state.lastPosition = position;
  }

  function recordPoint(event, force = false) {
    const state = traceStates[event.particleId];
    if (!state?.lastPosition) return;
    const shouldRecord = force
      || event.timeSeconds - state.lastTimeSeconds >= sampleIntervalSeconds * state.sampleScale
      || distance(event.position, state.lastPosition) >= sampleDistanceMeters * state.sampleScale;
    if (!shouldRecord) return;
    appendPoint(event.particleId, state, event.position);
    state.lastTimeSeconds = event.timeSeconds;
  }

  function handleTrajectoryEvent(event) {
    if (event.type === 'reset') {
      clearTraces();
      return;
    }
    const state = traceStates[event.particleId];
    if (!state || !event.position) return;
    if (event.type === 'launch') {
      initializeHop(event.particleId, state, event.position);
      state.lastTimeSeconds = event.timeSeconds;
      return;
    }
    if (event.type === 'flightPoint') {
      recordPoint(event, event.endsFlight);
      if (event.endsFlight) state.lastPosition = null;
      return;
    }
    if (event.type === 'landing') {
      recordPoint(event, true);
      state.lastPosition = null;
    }
  }

  function updateParticles(simulationParticles) {
    for (const particle of simulationParticles) {
      const offset = particle.id * 3;
      const markerOffset = particle.state === 'adsorbed' ? ADSORBED_MARKER_OFFSET_METERS : 0;
      writeRenderPosition(particlePositions, offset, particle.position, markerOffset);
    }
    particleGeometry.attributes.position.needsUpdate = true;
    if (traceBufferDirty) {
      traceAttribute.needsUpdate = true;
      traceGeometry.setDrawRange(0, hasTraceData ? tracePositions.length / 3 : 0);
      traceBufferDirty = false;
    }
  }

  function clearTraces() {
    tracePositions.fill(0);
    traceAttribute.clearUpdateRanges();
    traceAttribute.addUpdateRange(0, tracePositions.length);
    traceGeometry.setDrawRange(0, 0);
    traceBufferDirty = true;
    hasTraceData = false;
    for (const state of traceStates) {
      state.hopIndex = -1;
      state.pointCount = 0;
      state.sampleScale = 1;
      state.lastPosition = null;
      state.lastTimeSeconds = 0;
    }
  }

  function setVisible(visible) {
    group.visible = Boolean(visible);
  }

  function setTracesVisible(visible) {
    traces.visible = Boolean(visible);
    return traces.visible;
  }

  function dispose() {
    particleGeometry.dispose();
    particles.material.dispose();
    traceGeometry.dispose();
    traceMaterial.dispose();
    parent.remove(group);
  }

  return {
    clearTraces,
    dispose,
    handleTrajectoryEvent,
    setTracesVisible,
    setVisible,
    updateParticles
  };
}
