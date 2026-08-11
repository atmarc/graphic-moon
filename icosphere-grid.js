const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

const BASE_VERTICES = [
  [-1, GOLDEN_RATIO, 0], [1, GOLDEN_RATIO, 0], [-1, -GOLDEN_RATIO, 0], [1, -GOLDEN_RATIO, 0],
  [0, -1, GOLDEN_RATIO], [0, 1, GOLDEN_RATIO], [0, -1, -GOLDEN_RATIO], [0, 1, -GOLDEN_RATIO],
  [GOLDEN_RATIO, 0, -1], [GOLDEN_RATIO, 0, 1], [-GOLDEN_RATIO, 0, -1], [-GOLDEN_RATIO, 0, 1]
].map(([x, y, z]) => {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
});

const BASE_FACE_INDICES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
];

function crossDotOutward(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const center = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
  return cross[0] * center[0] + cross[1] * center[1] + cross[2] * center[2];
}

export function createIcosahedronFaceAttributes() {
  const faceA = new Float32Array(20 * 3);
  const faceB = new Float32Array(20 * 3);
  const faceC = new Float32Array(20 * 3);

  BASE_FACE_INDICES.forEach(([indexA, indexB, indexC], faceIndex) => {
    const a = BASE_VERTICES[indexA];
    let b = BASE_VERTICES[indexB];
    let c = BASE_VERTICES[indexC];
    if (crossDotOutward(a, b, c) < 0) [b, c] = [c, b];
    faceA.set(a, faceIndex * 3);
    faceB.set(b, faceIndex * 3);
    faceC.set(c, faceIndex * 3);
  });

  return { faceA, faceB, faceC };
}

export function buildTriangularPatch(frequency) {
  const vertexCount = (frequency + 1) * (frequency + 2) / 2;
  const coordinates = new Uint16Array(vertexCount * 3);
  const triangleCount = frequency * frequency;
  const indices = new Uint32Array(triangleCount * 3);

  const rowStart = (row) => row * (frequency + 1) - row * (row - 1) / 2;
  let vertexOffset = 0;
  for (let row = 0; row <= frequency; row++) {
    for (let column = 0; column <= frequency - row; column++) {
      const weightB = row / frequency;
      const weightC = column / frequency;
      const weightA = Math.max(0, 1 - weightB - weightC);
      coordinates[vertexOffset++] = Math.round(weightA * 65_535);
      coordinates[vertexOffset++] = Math.round(weightB * 65_535);
      coordinates[vertexOffset++] = Math.round(weightC * 65_535);
    }
  }

  let indexOffset = 0;
  for (let row = 0; row < frequency; row++) {
    for (let column = 0; column < frequency - row; column++) {
      const a = rowStart(row) + column;
      const b = rowStart(row + 1) + column;
      const c = rowStart(row) + column + 1;
      indices[indexOffset++] = a;
      indices[indexOffset++] = b;
      indices[indexOffset++] = c;

      if (column < frequency - row - 1) {
        indices[indexOffset++] = b;
        indices[indexOffset++] = rowStart(row + 1) + column + 1;
        indices[indexOffset++] = c;
      }
    }
  }

  return { frequency, coordinates, indices, vertexCount, triangleCount };
}

export function icosphereStatistics(level) {
  const scale = 4 ** level;
  return {
    level,
    uniqueVertices: 10 * scale + 2,
    triangles: 20 * scale
  };
}
