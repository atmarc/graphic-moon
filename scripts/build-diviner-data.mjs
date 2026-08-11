import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIRECTORY = join(ROOT, 'assets', 'diviner', 'raw');
const OUTPUT_DIRECTORY = join(ROOT, 'assets', 'diviner');
const OUTPUT_DATA = join(OUTPUT_DIRECTORY, 'diviner-tbol-snapshots.bin');
const OUTPUT_METADATA = join(OUTPUT_DIRECTORY, 'diviner-tbol-snapshots.json');

const WIDTH = 720;
const HEIGHT = 360;
const CELL_COUNT = WIDTH * HEIGHT;
const LONGITUDES = Array.from({ length: 24 }, (_, index) => index * 15);
const KELVIN_SCALE = 100;
const MISSING_VALUE = 65_535;

function coordinateIndex(value, firstCenter, count, label, fileName) {
  const index = Math.round((value - firstCenter) / 0.5);
  const expected = firstCenter + index * 0.5;
  if (index < 0 || index >= count || Math.abs(value - expected) > 1e-6) {
    throw new Error(`${fileName}: invalid ${label} ${value}`);
  }
  return index;
}

async function packSnapshot(subsolarLongitude, output, byteOffset) {
  const suffix = String(subsolarLongitude).padStart(3, '0');
  const fileName = `diviner_tbol_snapshot_${suffix}E.xyz`;
  const content = await readFile(join(RAW_DIRECTORY, fileName), 'utf8');
  const lines = content.trim().split(/\r?\n/);
  if (lines.length !== CELL_COUNT) {
    throw new Error(`${fileName}: expected ${CELL_COUNT} rows, found ${lines.length}`);
  }

  const seen = new Uint8Array(CELL_COUNT);
  let minimumKelvin = Infinity;
  let maximumKelvin = -Infinity;

  for (const [lineNumber, line] of lines.entries()) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 3) {
      throw new Error(`${fileName}:${lineNumber + 1}: expected longitude latitude temperature`);
    }

    const longitude = Number(fields[0]);
    const latitude = Number(fields[1]);
    const temperature = Number(fields[2]);
    if (![longitude, latitude, temperature].every(Number.isFinite)) {
      throw new Error(`${fileName}:${lineNumber + 1}: non-finite value`);
    }

    const x = coordinateIndex(longitude, -179.75, WIDTH, 'longitude', fileName);
    const y = coordinateIndex(latitude, -89.75, HEIGHT, 'latitude', fileName);
    const gridIndex = y * WIDTH + x;
    if (seen[gridIndex]) {
      throw new Error(`${fileName}:${lineNumber + 1}: duplicate grid cell ${x},${y}`);
    }
    seen[gridIndex] = 1;

    const encoded = Math.round(temperature * KELVIN_SCALE);
    if (encoded < 0 || encoded >= MISSING_VALUE) {
      throw new Error(`${fileName}:${lineNumber + 1}: temperature ${temperature} K is out of range`);
    }
    output.setUint16(byteOffset + gridIndex * 2, encoded, true);
    minimumKelvin = Math.min(minimumKelvin, temperature);
    maximumKelvin = Math.max(maximumKelvin, temperature);
  }

  return { subsolarLongitude, fileName, minimumKelvin, maximumKelvin };
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const buffer = new ArrayBuffer(LONGITUDES.length * CELL_COUNT * 2);
  const output = new DataView(buffer);
  const snapshots = [];

  for (const [index, longitude] of LONGITUDES.entries()) {
    const metadata = await packSnapshot(longitude, output, index * CELL_COUNT * 2);
    snapshots.push(metadata);
    process.stdout.write(`Validated ${metadata.fileName}\n`);
  }

  const metadata = {
    title: 'Diviner instantaneous bolometric temperature snapshots',
    source: 'https://luna1.diviner.ucla.edu/~jpierre/diviner/level4_raster_data/',
    citation: 'Williams et al. (2017), Icarus 283, 300-325',
    width: WIDTH,
    height: HEIGHT,
    longitudeCenters: [-179.75, 179.75],
    latitudeCenters: [-89.75, 89.75],
    snapshotIntervalDegrees: 15,
    encoding: 'unsigned 16-bit little-endian centikelvin',
    kelvinScale: KELVIN_SCALE,
    missingValue: MISSING_VALUE,
    minimumKelvin: Math.min(...snapshots.map((snapshot) => snapshot.minimumKelvin)),
    maximumKelvin: Math.max(...snapshots.map((snapshot) => snapshot.maximumKelvin)),
    snapshots
  };

  await writeFile(OUTPUT_DATA, Buffer.from(buffer));
  await writeFile(OUTPUT_METADATA, `${JSON.stringify(metadata, null, 2)}\n`);
  process.stdout.write(`Wrote ${OUTPUT_DATA} (${buffer.byteLength} bytes)\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
