import * as THREE from 'three';

const SNAPSHOT_COUNT = 24;
const SOURCE_KELVIN_SCALE = 100;

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function temperaturePhase(hours) {
  const localTimeHours = modulo(Number(hours), 24);
  const subsolarLongitude = modulo((12 - localTimeHours) * 15, 360);
  const exactIndex = subsolarLongitude / 15;
  const indexA = Math.floor(exactIndex) % SNAPSHOT_COUNT;
  return {
    localTimeHours,
    subsolarLongitude,
    indexA,
    indexB: (indexA + 1) % SNAPSHOT_COUNT,
    mixAmount: exactIndex - Math.floor(exactIndex)
  };
}

function createPlaceholderTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array([0]),
    1,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  texture.internalFormat = 'R8';
  texture.needsUpdate = true;
  return texture;
}

function configureTemperatureTexture(texture) {
  texture.internalFormat = 'R8';
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export function createDivinerController() {
  const placeholderA = createPlaceholderTexture();
  const placeholderB = createPlaceholderTexture();
  const uniforms = {
    mapA: { value: placeholderA },
    mapB: { value: placeholderB },
    mixAmount: { value: 0 },
    enabled: { value: 0 }
  };

  let metadata = null;
  let packedTemperatures = null;
  let textureA = null;
  let textureB = null;
  let currentIndexA = -1;
  let currentIndexB = -1;
  let localTimeHours = 12;
  const displaySnapshots = new Map();

  function snapshotView(index) {
    const cellCount = metadata.width * metadata.height;
    return packedTemperatures.subarray(index * cellCount, (index + 1) * cellCount);
  }

  function displaySnapshot(index) {
    if (displaySnapshots.has(index)) return displaySnapshots.get(index);
    const source = snapshotView(index);
    const display = new Uint8Array(source.length);
    const range = metadata.maximumKelvin - metadata.minimumKelvin;
    for (let i = 0; i < source.length; i++) {
      const kelvin = source[i] / SOURCE_KELVIN_SCALE;
      display[i] = Math.round(THREE.MathUtils.clamp((kelvin - metadata.minimumKelvin) / range, 0, 1) * 255);
    }
    displaySnapshots.set(index, display);
    return display;
  }

  function updateTexture(texture, index) {
    texture.image.data = displaySnapshot(index);
    texture.needsUpdate = true;
  }

  function setLocalTime(hours) {
    const phase = temperaturePhase(hours);
    localTimeHours = phase.localTimeHours;
    const { subsolarLongitude, indexA, indexB, mixAmount } = phase;

    if (textureA && indexA !== currentIndexA) {
      updateTexture(textureA, indexA);
      currentIndexA = indexA;
    }
    if (textureB && indexB !== currentIndexB) {
      updateTexture(textureB, indexB);
      currentIndexB = indexB;
    }
    uniforms.mixAmount.value = mixAmount;

    return {
      localTimeHours,
      subsolarLongitude,
      indexA,
      indexB,
      mixAmount,
      snapshotA: metadata?.snapshots[indexA] ?? null,
      snapshotB: metadata?.snapshots[indexB] ?? null
    };
  }

  function sampleSnapshotKelvin(index, longitudeRadians, latitudeRadians) {
    if (!metadata || !packedTemperatures) throw new Error('Diviner data has not loaded yet.');
    const width = metadata.width;
    const height = metadata.height;
    const x = modulo(longitudeRadians / (2 * Math.PI) + 0.5, 1) * width - 0.5;
    const y = THREE.MathUtils.clamp(latitudeRadians / Math.PI + 0.5, 0, 1) * height - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const cellCount = width * height;
    const offset = index * cellCount;
    const samples = [
      [modulo(x0, width), THREE.MathUtils.clamp(y0, 0, height - 1), (1 - tx) * (1 - ty)],
      [modulo(x0 + 1, width), THREE.MathUtils.clamp(y0, 0, height - 1), tx * (1 - ty)],
      [modulo(x0, width), THREE.MathUtils.clamp(y0 + 1, 0, height - 1), (1 - tx) * ty],
      [modulo(x0 + 1, width), THREE.MathUtils.clamp(y0 + 1, 0, height - 1), tx * ty]
    ];
    let weightedTemperature = 0;
    let validWeight = 0;
    for (const [sampleX, sampleY, weight] of samples) {
      const encoded = packedTemperatures[offset + sampleY * width + sampleX];
      if (encoded === metadata.missingValue) continue;
      weightedTemperature += encoded / metadata.kelvinScale * weight;
      validWeight += weight;
    }
    return validWeight > 0 ? weightedTemperature / validWeight : Number.NaN;
  }

  function sampleTemperatureKelvin(longitudeRadians, latitudeRadians, hours = localTimeHours) {
    const { indexA, indexB, mixAmount } = temperaturePhase(hours);
    const temperatureA = sampleSnapshotKelvin(indexA, longitudeRadians, latitudeRadians);
    const temperatureB = sampleSnapshotKelvin(indexB, longitudeRadians, latitudeRadians);
    if (!Number.isFinite(temperatureA)) return temperatureB;
    if (!Number.isFinite(temperatureB)) return temperatureA;
    return THREE.MathUtils.lerp(temperatureA, temperatureB, mixAmount);
  }

  async function load() {
    const [metadataResponse, dataResponse] = await Promise.all([
      fetch('./assets/diviner/diviner-tbol-snapshots.json'),
      fetch('./assets/diviner/diviner-tbol-snapshots.bin')
    ]);
    if (!metadataResponse.ok || !dataResponse.ok) {
      throw new Error('Could not load the local Diviner dataset.');
    }

    metadata = await metadataResponse.json();
    const buffer = await dataResponse.arrayBuffer();
    const expectedBytes = metadata.width * metadata.height * metadata.snapshots.length * 2;
    if (metadata.snapshots.length !== SNAPSHOT_COUNT || buffer.byteLength !== expectedBytes) {
      throw new Error(`Invalid Diviner dataset: expected ${expectedBytes} bytes, received ${buffer.byteLength}.`);
    }

    packedTemperatures = new Uint16Array(buffer);
    textureA = configureTemperatureTexture(new THREE.DataTexture(
      displaySnapshot(0), metadata.width, metadata.height, THREE.RedFormat, THREE.UnsignedByteType
    ));
    textureB = configureTemperatureTexture(new THREE.DataTexture(
      displaySnapshot(1), metadata.width, metadata.height, THREE.RedFormat, THREE.UnsignedByteType
    ));
    placeholderA.dispose();
    placeholderB.dispose();
    uniforms.mapA.value = textureA;
    uniforms.mapB.value = textureB;
    currentIndexA = 0;
    currentIndexB = 1;
    setLocalTime(localTimeHours);
    return metadata;
  }

  function setTemperatureVisible(visible) {
    uniforms.enabled.value = visible ? 1 : 0;
    return Boolean(visible);
  }

  return { uniforms, load, setLocalTime, setTemperatureVisible, sampleTemperatureKelvin };
}

export function formatLocalTime(hours) {
  const totalMinutes = Math.round(hours * 60) % (24 * 60);
  const normalizedMinutes = totalMinutes < 0 ? totalMinutes + 24 * 60 : totalMinutes;
  const hour = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
