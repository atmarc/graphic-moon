import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOON_RADIUS_METERS,
  coordinatesFromDirection,
  createSeededRandom,
  createTopographyField,
  createWaterSimulation,
  desorptionRatePerSecond,
  directionFromCoordinates,
  integrateCentralGravity,
  sampleDesorptionEnergyElectronVolts,
  sampleMaxwellBoltzmannFluxVelocity,
  survivalProbability
} from './water-simulation.js';

test('lunar coordinates round-trip in the renderer convention', () => {
  const longitude = 1.2;
  const latitude = -0.4;
  const result = coordinatesFromDirection(directionFromCoordinates(longitude, latitude));
  assert.ok(Math.abs(result.longitudeRadians - longitude) < 1e-12);
  assert.ok(Math.abs(result.latitudeRadians - latitude) < 1e-12);
  const east = directionFromCoordinates(Math.PI / 2, 0);
  assert.ok(Math.abs(east.z + 1) < 1e-12);
});

test('Schorghofer energy sampler follows the truncated distribution', () => {
  const random = createSeededRandom(42);
  const peak = 0.65;
  const width = 0.22;
  const maximum = 1.55;
  let sum = 0;
  const count = 100_000;
  for (let index = 0; index < count; index++) {
    const energy = sampleDesorptionEnergyElectronVolts(random, peak, width, maximum);
    assert.ok(energy >= peak);
    assert.ok(energy <= maximum);
    sum += energy;
  }
  const span = maximum - peak;
  const expectedMean = peak + width - span / Math.expm1(span / width);
  assert.ok(Math.abs(sum / count - expectedMean) < 0.003);
  assert.throws(
    () => sampleDesorptionEnergyElectronVolts(random, peak, width, peak),
    /maximum desorption energy/
  );
});

test('desorption and survival follow the Peschel exponential law', () => {
  const coldRate = desorptionRatePerSecond(0.65, 100);
  const warmRate = desorptionRatePerSecond(0.65, 400);
  assert.ok(warmRate > coldRate);
  assert.equal(survivalProbability(0, 60), 1);
  assert.ok(Math.abs(survivalProbability(0.5, 2) - Math.exp(-1)) < 1e-15);
});

test('Maxwell-Boltzmann flux velocities always point above the local surface', () => {
  const random = createSeededRandom(7);
  const normal = { x: 0.2, y: 0.9, z: -0.1 };
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  for (let index = 0; index < 10_000; index++) {
    const velocity = sampleMaxwellBoltzmannFluxVelocity(random, 300, normal);
    const outward = (velocity.x * normal.x + velocity.y * normal.y + velocity.z * normal.z)
      / normalLength;
    assert.ok(outward >= 0);
  }
});

test('central gravity accelerates a stationary particle toward the Moon', () => {
  const state = integrateCentralGravity(
    { x: MOON_RADIUS_METERS + 1000, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    1
  );
  assert.ok(state.position.x < MOON_RADIUS_METERS + 1000);
  assert.ok(state.velocity.x < 0);
  assert.equal(state.position.y, 0);
});

test('two-second flight integration converges against a finer reference step', () => {
  function propagate(timeStepSeconds) {
    let position = { x: MOON_RADIUS_METERS + 1000, y: 0, z: 0 };
    let velocity = { x: 350, y: 500, z: -220 };
    for (let elapsed = 0; elapsed < 600; elapsed += timeStepSeconds) {
      const state = integrateCentralGravity(position, velocity, timeStepSeconds);
      position = state.position;
      velocity = state.velocity;
    }
    return position;
  }

  const normalStep = propagate(2);
  const reference = propagate(0.25);
  const positionError = Math.hypot(
    normalStep.x - reference.x,
    normalStep.y - reference.y,
    normalStep.z - reference.z
  );
  assert.ok(positionError < 10, `Expected less than 10 m error, received ${positionError} m.`);
});

function createFlatTopography() {
  return createTopographyField({
    width: 2,
    height: 2,
    pixels: new Uint8Array([127, 127, 127, 127]),
    minimumElevationMeters: 0,
    elevationRangeMeters: 0,
    flipY: false
  });
}

test('flat topography produces a radial surface normal', () => {
  const topography = createFlatTopography();
  const longitude = -0.8;
  const latitude = 0.3;
  const expected = directionFromCoordinates(longitude, latitude);
  const actual = topography.surfaceNormalAt(longitude, latitude);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-12);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-12);
  assert.ok(Math.abs(actual.z - expected.z) < 1e-12);
});

test('water simulation resets deterministically and thermally launches particles', () => {
  const simulation = createWaterSimulation({
    topography: createFlatTopography(),
    temperatureKelvinAt: () => 400,
    particleCount: 10,
    randomSeed: 123,
    energyPeakElectronVolts: 0.05,
    energyWidthElectronVolts: 0.001,
    surfaceTimeStepSeconds: 10
  });
  const initialPositions = simulation.particles.map((particle) => ({ ...particle.position }));
  const summary = simulation.advance(10);
  assert.equal(summary.inFlight, 10);
  simulation.reset();
  assert.deepEqual(
    simulation.particles.map((particle) => particle.position),
    initialPositions
  );
  assert.equal(simulation.getSummary().adsorbed, 10);
});

test('simulation continues across lunations and wraps local solar time', () => {
  const simulation = createWaterSimulation({
    topography: createFlatTopography(),
    temperatureKelvinAt: () => 50,
    particleCount: 1,
    lunarDaySeconds: 100,
    energyPeakElectronVolts: 2,
    energyWidthElectronVolts: 0.01,
    energyMaximumElectronVolts: 2.1
  });
  const summary = simulation.advance(250);
  assert.equal(summary.elapsedSeconds, 250);
  assert.equal(summary.elapsedLunarDays, 2.5);
  assert.ok(Math.abs(summary.localTimeHours - 12) < 1e-12);
  assert.equal('completed' in summary, false);
});

test('trajectory events include launch and integration-level flight points', () => {
  const events = [];
  const simulation = createWaterSimulation({
    topography: createFlatTopography(),
    temperatureKelvinAt: () => 400,
    particleCount: 1,
    randomSeed: 5,
    energyPeakElectronVolts: 0.05,
    energyWidthElectronVolts: 0.001,
    surfaceTimeStepSeconds: 10,
    flightTimeStepSeconds: 2,
    onTrajectoryEvent(event) {
      events.push(event);
    }
  });
  simulation.advance(10);
  simulation.advance(10);
  assert.equal(events[0].type, 'reset');
  assert.equal(events[1].type, 'launch');
  assert.ok(events.some((event) => event.type === 'flightPoint'));
  const times = events.filter((event) => event.timeSeconds !== undefined).map((event) => event.timeSeconds);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('simulation rejects invalid advance durations', () => {
  const simulation = createWaterSimulation({
    topography: createFlatTopography(),
    temperatureKelvinAt: () => 100,
    particleCount: 1
  });
  assert.throws(() => simulation.advance(-1), /finite, non-negative/);
  assert.throws(() => simulation.advance(Number.NaN), /finite, non-negative/);
});
