const GRAVITATIONAL_CONSTANT = 6.67430e-11;
const BOLTZMANN_CONSTANT = 1.380649e-23;
const PLANCK_CONSTANT = 6.62607015e-34;
const ELECTRON_VOLT_JOULES = 1.602176634e-19;
const ATOMIC_MASS_UNIT_KG = 1.66053906660e-27;

export const MOON_RADIUS_METERS = 1_737_400;
export const MOON_MASS_KG = 7.342e22;
export const LUNAR_DAY_SECONDS = 29.53059 * 86_400;
export const WATER_MOLECULE_MASS_KG = 18.01528 * ATOMIC_MASS_UNIT_KG;

// Schorghofer (2023), Section 6.1, Equation 15. These are intentionally
// grouped here because E_p and W are the principal tunable surface parameters.
export const WATER_DESORPTION_ENERGY = Object.freeze({
  peakElectronVolts: 0.65, // E_p: lowest energy represented by the fit
  widthElectronVolts: 0.22, // W: exponential tail width
  maximumElectronVolts: 1.55
});

export const DEFAULT_WATER_SIMULATION_OPTIONS = Object.freeze({
  particleCount: 10,
  randomSeed: 20_260_811,
  lunarDaySeconds: LUNAR_DAY_SECONDS,
  surfaceTimeStepSeconds: 60,
  flightTimeStepSeconds: 2,
  launchOffsetMeters: 1,
  escapeRadiusMultiples: 3,
  energyPeakElectronVolts: WATER_DESORPTION_ENERGY.peakElectronVolts,
  energyWidthElectronVolts: WATER_DESORPTION_ENERGY.widthElectronVolts,
  energyMaximumElectronVolts: WATER_DESORPTION_ENERGY.maximumElectronVolts
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector) {
  const length = magnitude(vector);
  if (!(length > 0)) throw new Error('Cannot normalize a zero-length vector.');
  return scale(vector, 1 / length);
}

function lerpVector(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    z: a.z + (b.z - a.z) * amount
  };
}

export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

export function directionFromCoordinates(longitudeRadians, latitudeRadians) {
  const cosLatitude = Math.cos(latitudeRadians);
  return {
    x: cosLatitude * Math.cos(longitudeRadians),
    y: Math.sin(latitudeRadians),
    z: -cosLatitude * Math.sin(longitudeRadians)
  };
}

export function coordinatesFromDirection(direction) {
  const unit = normalize(direction);
  return {
    longitudeRadians: Math.atan2(-unit.z, unit.x),
    latitudeRadians: Math.asin(clamp(unit.y, -1, 1))
  };
}

function tangentBasis(longitudeRadians, latitudeRadians) {
  const up = directionFromCoordinates(longitudeRadians, latitudeRadians);
  const east = {
    x: -Math.sin(longitudeRadians),
    y: 0,
    z: -Math.cos(longitudeRadians)
  };
  const north = {
    x: -Math.sin(latitudeRadians) * Math.cos(longitudeRadians),
    y: Math.cos(latitudeRadians),
    z: Math.sin(latitudeRadians) * Math.sin(longitudeRadians)
  };
  return { up, east, north };
}

function bilinearSample(pixels, width, height, u, v, flipY) {
  const x = modulo(u, 1) * width - 0.5;
  const sourceV = flipY ? 1 - clamp(v, 0, 1) : clamp(v, 0, 1);
  const y = sourceV * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const wrappedX0 = modulo(x0, width);
  const wrappedX1 = modulo(x0 + 1, width);
  const clampedY0 = clamp(y0, 0, height - 1);
  const clampedY1 = clamp(y0 + 1, 0, height - 1);
  const a = pixels[clampedY0 * width + wrappedX0];
  const b = pixels[clampedY0 * width + wrappedX1];
  const c = pixels[clampedY1 * width + wrappedX0];
  const d = pixels[clampedY1 * width + wrappedX1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

export function createTopographyField({
  width,
  height,
  pixels,
  minimumElevationMeters = -10_000,
  elevationRangeMeters = 20_000,
  flipY = true,
  normalAngularStepRadians = Math.PI / 2880
}) {
  if (!(width > 1 && height > 1) || pixels.length !== width * height) {
    throw new Error('Topography pixels must match the supplied raster dimensions.');
  }

  function elevationAt(longitudeRadians, latitudeRadians) {
    const u = longitudeRadians / (2 * Math.PI) + 0.5;
    const v = latitudeRadians / Math.PI + 0.5;
    const encoded = bilinearSample(pixels, width, height, u, v, flipY);
    return minimumElevationMeters + encoded / 255 * elevationRangeMeters;
  }

  function elevationInDirection(direction) {
    const coordinates = coordinatesFromDirection(direction);
    return elevationAt(coordinates.longitudeRadians, coordinates.latitudeRadians);
  }

  function surfaceNormalAt(longitudeRadians, latitudeRadians) {
    const { up, east, north } = tangentBasis(longitudeRadians, latitudeRadians);
    const eastPlus = normalize(add(up, scale(east, normalAngularStepRadians)));
    const eastMinus = normalize(add(up, scale(east, -normalAngularStepRadians)));
    const northPlus = normalize(add(up, scale(north, normalAngularStepRadians)));
    const northMinus = normalize(add(up, scale(north, -normalAngularStepRadians)));
    const radius = MOON_RADIUS_METERS + elevationAt(longitudeRadians, latitudeRadians);
    const eastSlope = (elevationInDirection(eastPlus) - elevationInDirection(eastMinus))
      / (2 * normalAngularStepRadians * radius);
    const northSlope = (elevationInDirection(northPlus) - elevationInDirection(northMinus))
      / (2 * normalAngularStepRadians * radius);
    return normalize(add(add(up, scale(east, -eastSlope)), scale(north, -northSlope)));
  }

  return { elevationAt, surfaceNormalAt };
}

async function decodeImageBlob(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  if (typeof document === 'undefined') throw new Error('No browser image decoder is available.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    const loadPromise = typeof image.decode === 'function' ? null : new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', () => reject(new Error('The topography image could not be decoded.')), { once: true });
    });
    image.src = url;
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await loadPromise;
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadLunarTopography(url = './assets/ldem_16_8bit.webp') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load lunar topography from ${url}.`);
  const image = await decodeImageBlob(await response.blob());
  const width = image.width;
  const height = image.height;
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
  if (!context) {
    image.close?.();
    throw new Error('A 2D canvas is required to read lunar topography.');
  }
  try {
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height);
    for (let source = 0, target = 0; target < pixels.length; source += 4, target++) {
      pixels[target] = rgba[source];
    }
    return createTopographyField({ width, height, pixels });
  } finally {
    image.close?.();
  }
}

// Inverse CDF of Schorghofer (2023), Equation 15.
export function sampleDesorptionEnergyElectronVolts(
  random,
  peakElectronVolts = WATER_DESORPTION_ENERGY.peakElectronVolts,
  widthElectronVolts = WATER_DESORPTION_ENERGY.widthElectronVolts,
  maximumElectronVolts = WATER_DESORPTION_ENERGY.maximumElectronVolts
) {
  if (!(peakElectronVolts > 0) || !(widthElectronVolts > 0)) {
    throw new Error('E_p and W must both be positive.');
  }
  if (!(maximumElectronVolts > peakElectronVolts)) {
    throw new Error('The maximum desorption energy must be greater than E_p.');
  }
  const truncatedProbability = 1
    - Math.exp(-(maximumElectronVolts - peakElectronVolts) / widthElectronVolts);
  return peakElectronVolts
    - widthElectronVolts * Math.log(1 - random() * truncatedProbability);
}

// Peschel et al. (2026), Equation 5.
export function desorptionRatePerSecond(energyElectronVolts, temperatureKelvin) {
  if (!(temperatureKelvin > 0)) return 0;
  const thermalEnergy = BOLTZMANN_CONSTANT * temperatureKelvin;
  return thermalEnergy / PLANCK_CONSTANT
    * Math.exp(-energyElectronVolts * ELECTRON_VOLT_JOULES / thermalEnergy);
}

export function survivalProbability(ratePerSecond, timeStepSeconds) {
  return Math.exp(-Math.max(0, ratePerSecond) * Math.max(0, timeStepSeconds));
}

function sampleStandardNormal(random) {
  const radius = Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, 1 - random())));
  return radius * Math.cos(2 * Math.PI * random());
}

// This Cartesian sampler is algebraically equivalent to the
// Maxwell-Boltzmann flux distribution in Peschel et al. (2026), Appendix A.
export function sampleMaxwellBoltzmannFluxVelocity(random, temperatureKelvin, surfaceNormal) {
  const normal = normalize(surfaceNormal);
  const reference = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const tangentA = normalize(cross(reference, normal));
  const tangentB = cross(normal, tangentA);
  const sigma = Math.sqrt(BOLTZMANN_CONSTANT * temperatureKelvin / WATER_MOLECULE_MASS_KG);
  const tangentVelocityA = sigma * sampleStandardNormal(random);
  const tangentVelocityB = sigma * sampleStandardNormal(random);
  const outwardVelocity = sigma * Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, 1 - random())));
  return add(
    add(scale(tangentA, tangentVelocityA), scale(tangentB, tangentVelocityB)),
    scale(normal, outwardVelocity)
  );
}

function gravityAcceleration(position) {
  const radius = magnitude(position);
  const factor = -GRAVITATIONAL_CONSTANT * MOON_MASS_KG / (radius * radius * radius);
  return scale(position, factor);
}

export function integrateCentralGravity(position, velocity, timeStepSeconds) {
  const accelerationA = gravityAcceleration(position);
  const nextPosition = add(
    add(position, scale(velocity, timeStepSeconds)),
    scale(accelerationA, 0.5 * timeStepSeconds * timeStepSeconds)
  );
  const accelerationB = gravityAcceleration(nextPosition);
  const nextVelocity = add(velocity, scale(add(accelerationA, accelerationB), 0.5 * timeStepSeconds));
  return { position: nextPosition, velocity: nextVelocity };
}

function surfacePosition(topography, longitudeRadians, latitudeRadians) {
  const radius = MOON_RADIUS_METERS + topography.elevationAt(longitudeRadians, latitudeRadians);
  return scale(directionFromCoordinates(longitudeRadians, latitudeRadians), radius);
}

function altitudeAboveTerrain(topography, position) {
  const coordinates = coordinatesFromDirection(position);
  return magnitude(position) - MOON_RADIUS_METERS
    - topography.elevationAt(coordinates.longitudeRadians, coordinates.latitudeRadians);
}

export function createWaterSimulation({
  temperatureKelvinAt,
  topography,
  onTrajectoryEvent = () => {},
  ...overrides
}) {
  if (typeof temperatureKelvinAt !== 'function') throw new Error('A temperatureKelvinAt provider is required.');
  if (!topography?.elevationAt || !topography?.surfaceNormalAt) {
    throw new Error('A topography field is required.');
  }

  const options = { ...DEFAULT_WATER_SIMULATION_OPTIONS, ...overrides };
  let random = createSeededRandom(options.randomSeed);
  let elapsedSeconds = 0;
  let particles = [];

  function localTimeHoursAt(timeSeconds = elapsedSeconds) {
    return modulo(timeSeconds / options.lunarDaySeconds * 24, 24);
  }

  function emitTrajectoryEvent(event) {
    onTrajectoryEvent({ ...event, position: event.position ? { ...event.position } : undefined });
  }

  function sampleEnergy() {
    return sampleDesorptionEnergyElectronVolts(
      random,
      options.energyPeakElectronVolts,
      options.energyWidthElectronVolts,
      options.energyMaximumElectronVolts
    );
  }

  function createParticle(id) {
    const longitudeRadians = random() * 2 * Math.PI - Math.PI;
    const latitudeRadians = Math.asin(random() * 2 - 1);
    return {
      id,
      state: 'adsorbed',
      position: surfacePosition(topography, longitudeRadians, latitudeRadians),
      velocity: { x: 0, y: 0, z: 0 },
      desorptionEnergyElectronVolts: sampleEnergy(),
      lastTemperatureKelvin: temperatureKelvinAt(longitudeRadians, latitudeRadians, 0),
      hopCount: 0,
      escaping: false
    };
  }

  function reset() {
    random = createSeededRandom(options.randomSeed);
    elapsedSeconds = 0;
    particles = Array.from({ length: options.particleCount }, (_, index) => createParticle(index));
    emitTrajectoryEvent({ type: 'reset', timeSeconds: 0 });
    return particles;
  }

  function launch(particle, temperatureKelvin, timeSeconds) {
    const coordinates = coordinatesFromDirection(particle.position);
    const normal = topography.surfaceNormalAt(
      coordinates.longitudeRadians,
      coordinates.latitudeRadians
    );
    particle.position = add(particle.position, scale(normal, options.launchOffsetMeters));
    particle.velocity = sampleMaxwellBoltzmannFluxVelocity(random, temperatureKelvin, normal);
    particle.state = 'inFlight';
    particle.escaping = 0.5 * dot(particle.velocity, particle.velocity)
      - GRAVITATIONAL_CONSTANT * MOON_MASS_KG / magnitude(particle.position) >= 0;
    emitTrajectoryEvent({
      type: 'launch',
      particleId: particle.id,
      position: particle.position,
      timeSeconds
    });
  }

  function land(particle, approximatePosition, timeSeconds) {
    const coordinates = coordinatesFromDirection(approximatePosition);
    particle.position = surfacePosition(
      topography,
      coordinates.longitudeRadians,
      coordinates.latitudeRadians
    );
    particle.velocity = { x: 0, y: 0, z: 0 };
    particle.desorptionEnergyElectronVolts = sampleEnergy();
    particle.state = 'adsorbed';
    particle.escaping = false;
    particle.hopCount++;
    emitTrajectoryEvent({
      type: 'landing',
      particleId: particle.id,
      position: particle.position,
      timeSeconds
    });
  }

  function advanceFlight(particle, durationSeconds, stepStartSeconds) {
    let remaining = durationSeconds;
    let flightElapsedSeconds = 0;
    while (remaining > 0 && particle.state === 'inFlight') {
      const step = Math.min(remaining, options.flightTimeStepSeconds);
      const previousPosition = particle.position;
      const previousAltitude = altitudeAboveTerrain(topography, previousPosition);
      const integrated = integrateCentralGravity(previousPosition, particle.velocity, step);
      const nextAltitude = altitudeAboveTerrain(topography, integrated.position);
      particle.position = integrated.position;
      particle.velocity = integrated.velocity;

      if (previousAltitude > 0 && nextAltitude <= 0) {
        const crossing = clamp(previousAltitude / (previousAltitude - nextAltitude), 0, 1);
        const landingTime = stepStartSeconds + flightElapsedSeconds + step * crossing;
        land(particle, lerpVector(previousPosition, integrated.position, crossing), landingTime);
      } else if (particle.escaping
        && magnitude(particle.position) >= MOON_RADIUS_METERS * options.escapeRadiusMultiples) {
        particle.state = 'escaped';
        const escapeTime = stepStartSeconds + flightElapsedSeconds + step;
        emitTrajectoryEvent({
          type: 'flightPoint',
          particleId: particle.id,
          position: particle.position,
          timeSeconds: escapeTime,
          endsFlight: true
        });
        emitTrajectoryEvent({
          type: 'escape',
          particleId: particle.id,
          position: particle.position,
          timeSeconds: escapeTime
        });
      } else {
        emitTrajectoryEvent({
          type: 'flightPoint',
          particleId: particle.id,
          position: particle.position,
          timeSeconds: stepStartSeconds + flightElapsedSeconds + step,
          endsFlight: false
        });
      }
      flightElapsedSeconds += step;
      remaining -= step;
    }
  }

  function advanceParticle(particle, durationSeconds, stepStartSeconds) {
    if (particle.state === 'escaped') return;
    if (particle.state === 'inFlight') {
      advanceFlight(particle, durationSeconds, stepStartSeconds);
      return;
    }

    const coordinates = coordinatesFromDirection(particle.position);
    const localTimeHours = localTimeHoursAt(stepStartSeconds + durationSeconds * 0.5);
    const temperatureKelvin = temperatureKelvinAt(
      coordinates.longitudeRadians,
      coordinates.latitudeRadians,
      localTimeHours
    );
    particle.lastTemperatureKelvin = temperatureKelvin;
    const rate = desorptionRatePerSecond(
      particle.desorptionEnergyElectronVolts,
      temperatureKelvin
    );
    const survives = random() <= survivalProbability(rate, durationSeconds);
    if (!survives) launch(particle, temperatureKelvin, stepStartSeconds + durationSeconds);
  }

  function advance(durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      throw new Error('Simulation advance duration must be a finite, non-negative number.');
    }
    let remaining = durationSeconds;
    while (remaining > 0) {
      const step = Math.min(remaining, options.surfaceTimeStepSeconds);
      for (const particle of particles) advanceParticle(particle, step, elapsedSeconds);
      elapsedSeconds += step;
      remaining -= step;
    }
    return getSummary();
  }

  function getSummary() {
    const summary = {
      adsorbed: 0,
      inFlight: 0,
      escaped: 0,
      hops: 0,
      elapsedSeconds,
      elapsedLunarDays: elapsedSeconds / options.lunarDaySeconds,
      localTimeHours: localTimeHoursAt(),
    };
    for (const particle of particles) {
      summary[particle.state]++;
      summary.hops += particle.hopCount;
    }
    return summary;
  }

  reset();
  return {
    advance,
    reset,
    getSummary,
    get particles() { return particles; },
    options
  };
}
