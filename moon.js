import * as THREE from 'three';
import { buildTriangularPatch, createIcosahedronFaceAttributes } from './icosphere-grid.js';

export const MOON_MASS_KG = 7.342e22;
export const MOON_RADIUS_METERS = 1_737_400;

const MOON_RENDER_RADIUS = 2.6;
const MOON_AXIAL_TILT = THREE.MathUtils.degToRad(1.543);
const ELEVATION_MIN_WORLD = -10_000 * MOON_RENDER_RADIUS / MOON_RADIUS_METERS;
const ELEVATION_RANGE_WORLD = 20_000 * MOON_RENDER_RADIUS / MOON_RADIUS_METERS;
const HEIGHT_ANGULAR_STEP = Math.PI / 2880;

const SURFACE_VERTEX_SHADER = `
  attribute vec3 faceA;
  attribute vec3 faceB;
  attribute vec3 faceC;
  uniform sampler2D elevationMap;
  uniform float renderRadius;
  uniform float elevationMinimum;
  uniform float elevationRange;
  uniform float elevationTexelWidth;
  uniform float surfaceOffset;
  varying vec3 vLocalDirection;

  const float PI = 3.141592653589793;

  vec2 sphericalUv(vec3 direction) {
    float longitude = atan(-direction.z, direction.x);
    float latitude = asin(clamp(direction.y, -1.0, 1.0));
    return vec2(fract(longitude / (2.0 * PI) + 0.5), clamp(latitude / PI + 0.5, 0.0001736, 0.9998264));
  }

  float periodicElevation(vec2 uv) {
    float edgeDistance = min(uv.x, 1.0 - uv.x);
    float current = texture2D(elevationMap, uv).r;
    float seamWidth = elevationTexelWidth * 4.0;
    if (edgeDistance >= seamWidth) return current;

    float pairedDistance = max(edgeDistance, elevationTexelWidth * 0.5);
    float pairedU = uv.x < 0.5 ? 1.0 - pairedDistance : pairedDistance;
    float paired = texture2D(elevationMap, vec2(pairedU, uv.y)).r;
    float edgeBlend = 1.0 - smoothstep(0.0, seamWidth, edgeDistance);
    return mix(current, (current + paired) * 0.5, edgeBlend);
  }

  void main() {
    vec3 weights = position / max(position.x + position.y + position.z, 0.00001);
    vec3 direction = normalize(faceA * weights.x + faceB * weights.y + faceC * weights.z);
    float elevation = periodicElevation(sphericalUv(direction)) * elevationRange + elevationMinimum;
    vec3 displacedPosition = direction * (renderRadius + elevation + surfaceOffset);
    vLocalDirection = direction;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
  }
`;

const SURFACE_FRAGMENT_SHADER = `
  uniform sampler2D colorMap;
  uniform sampler2D elevationMap;
  uniform sampler2D thermalMapA;
  uniform sampler2D thermalMapB;
  uniform vec3 sunDirection;
  uniform float elevationMinimum;
  uniform float elevationRange;
  uniform float renderRadius;
  uniform float heightAngularStep;
  uniform float thermalMix;
  uniform float thermalEnabled;
  uniform float colorTexelWidth;
  uniform float elevationTexelWidth;
  uniform float thermalTexelWidth;
  varying vec3 vLocalDirection;

  const float PI = 3.141592653589793;

  vec2 sphericalUv(vec3 direction) {
    float longitude = atan(-direction.z, direction.x);
    float latitude = asin(clamp(direction.y, -1.0, 1.0));
    return vec2(fract(longitude / (2.0 * PI) + 0.5), clamp(latitude / PI + 0.5, 0.0001736, 0.9998264));
  }

  vec2 wrappedDerivative(vec2 derivativeValue) {
    if (derivativeValue.x > 0.5) derivativeValue.x -= 1.0;
    if (derivativeValue.x < -0.5) derivativeValue.x += 1.0;
    return derivativeValue;
  }

  vec4 periodicSampleGrad(sampler2D map, vec2 uv, float texelWidth) {
    vec2 derivativeX = wrappedDerivative(dFdx(uv));
    vec2 derivativeY = wrappedDerivative(dFdy(uv));
    vec4 current = texture2DGradEXT(map, uv, derivativeX, derivativeY);
    float edgeDistance = min(uv.x, 1.0 - uv.x);
    float seamWidth = texelWidth * 4.0;
    if (edgeDistance >= seamWidth) return current;

    float pairedDistance = max(edgeDistance, texelWidth * 0.5);
    float pairedU = uv.x < 0.5 ? 1.0 - pairedDistance : pairedDistance;
    vec4 paired = texture2DGradEXT(map, vec2(pairedU, uv.y), derivativeX, derivativeY);
    float edgeBlend = 1.0 - smoothstep(0.0, seamWidth, edgeDistance);
    return mix(current, (current + paired) * 0.5, edgeBlend);
  }

  float periodicSample(sampler2D map, vec2 uv, float texelWidth) {
    float edgeDistance = min(uv.x, 1.0 - uv.x);
    float current = texture2D(map, uv).r;
    float seamWidth = texelWidth * 4.0;
    if (edgeDistance >= seamWidth) return current;

    float pairedDistance = max(edgeDistance, texelWidth * 0.5);
    float pairedU = uv.x < 0.5 ? 1.0 - pairedDistance : pairedDistance;
    float paired = texture2D(map, vec2(pairedU, uv.y)).r;
    float edgeBlend = 1.0 - smoothstep(0.0, seamWidth, edgeDistance);
    return mix(current, (current + paired) * 0.5, edgeBlend);
  }

  float heightAt(vec3 direction) {
    return periodicSampleGrad(elevationMap, sphericalUv(direction), elevationTexelWidth).r * elevationRange + elevationMinimum;
  }

  void tangentBasis(vec3 normal, out vec3 tangent, out vec3 bitangent) {
    float signValue = normal.z >= 0.0 ? 1.0 : -1.0;
    float factor = -1.0 / (signValue + normal.z);
    float mixed = normal.x * normal.y * factor;
    tangent = normalize(vec3(1.0 + signValue * normal.x * normal.x * factor, signValue * mixed, -signValue * normal.x));
    bitangent = normalize(vec3(mixed, signValue + normal.y * normal.y * factor, -normal.y));
  }

  vec3 displacedNormal(vec3 direction) {
    vec3 tangent;
    vec3 bitangent;
    tangentBasis(direction, tangent, bitangent);
    vec3 tangentPlus = normalize(direction + tangent * heightAngularStep);
    vec3 tangentMinus = normalize(direction - tangent * heightAngularStep);
    vec3 bitangentPlus = normalize(direction + bitangent * heightAngularStep);
    vec3 bitangentMinus = normalize(direction - bitangent * heightAngularStep);
    float tangentSlope = (heightAt(tangentPlus) - heightAt(tangentMinus)) / (2.0 * heightAngularStep * renderRadius);
    float bitangentSlope = (heightAt(bitangentPlus) - heightAt(bitangentMinus)) / (2.0 * heightAngularStep * renderRadius);
    return normalize(direction - tangent * tangentSlope - bitangent * bitangentSlope);
  }

  vec3 thermalPalette(float value) {
    vec3 c0 = vec3(0.000, 0.000, 0.016);
    vec3 c1 = vec3(0.259, 0.039, 0.408);
    vec3 c2 = vec3(0.576, 0.149, 0.404);
    vec3 c3 = vec3(0.867, 0.318, 0.227);
    vec3 c4 = vec3(0.988, 0.647, 0.039);
    vec3 c5 = vec3(0.988, 1.000, 0.643);
    float segment = clamp(value, 0.0, 1.0) * 5.0;
    if (segment < 1.0) return mix(c0, c1, segment);
    if (segment < 2.0) return mix(c1, c2, segment - 1.0);
    if (segment < 3.0) return mix(c2, c3, segment - 2.0);
    if (segment < 4.0) return mix(c3, c4, segment - 3.0);
    return mix(c4, c5, segment - 4.0);
  }

  void main() {
    vec3 direction = normalize(vLocalDirection);
    vec2 uv = sphericalUv(direction);

    if (thermalEnabled > 0.5) {
      float encodedA = periodicSample(thermalMapA, uv, thermalTexelWidth);
      float encodedB = periodicSample(thermalMapB, uv, thermalTexelWidth);
      float normalizedTemperature = mix(encodedA, encodedB, thermalMix);
      gl_FragColor = vec4(thermalPalette(normalizedTemperature), 1.0);
      #include <colorspace_fragment>
      return;
    }

    vec3 albedo = periodicSampleGrad(colorMap, uv, colorTexelWidth).rgb;
    vec3 normal = displacedNormal(direction);
    float sunlight = max(dot(normal, normalize(sunDirection)), 0.0);
    vec3 litSurface = albedo * sunlight * 1.35;
    gl_FragColor = vec4(litSurface, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function configureTexture(texture, renderer, colorSpace) {
  texture.colorSpace = colorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function sharedGeometryAttributes(geometry) {
  const { faceA, faceB, faceC } = createIcosahedronFaceAttributes();
  geometry.setAttribute('faceA', new THREE.InstancedBufferAttribute(faceA, 3));
  geometry.setAttribute('faceB', new THREE.InstancedBufferAttribute(faceB, 3));
  geometry.setAttribute('faceC', new THREE.InstancedBufferAttribute(faceC, 3));
  geometry.instanceCount = 20;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), MOON_RENDER_RADIUS + 0.05);
  return geometry;
}

function createPatchGeometry(patch) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Uint16BufferAttribute(patch.coordinates, 3, true));
  geometry.setIndex(new THREE.Uint32BufferAttribute(patch.indices, 1));
  return sharedGeometryAttributes(geometry);
}

function createSurfaceMaterial(colorMap, elevationMap, thermalUniforms, sunDirection) {
  return new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX_SHADER,
    fragmentShader: SURFACE_FRAGMENT_SHADER,
    uniforms: {
      colorMap: { value: colorMap },
      elevationMap: { value: elevationMap },
      thermalMapA: thermalUniforms.mapA,
      thermalMapB: thermalUniforms.mapB,
      thermalMix: thermalUniforms.mixAmount,
      thermalEnabled: thermalUniforms.enabled,
      sunDirection,
      renderRadius: { value: MOON_RENDER_RADIUS },
      elevationMinimum: { value: ELEVATION_MIN_WORLD },
      elevationRange: { value: ELEVATION_RANGE_WORLD },
      colorTexelWidth: { value: 1 / 8192 },
      elevationTexelWidth: { value: 1 / 5760 },
      thermalTexelWidth: { value: 1 / 720 },
      heightAngularStep: { value: HEIGHT_ANGULAR_STEP },
      surfaceOffset: { value: 0 }
    },
    side: THREE.FrontSide,
    toneMapped: true,
    extensions: {
      derivatives: true,
      shaderTextureLOD: true
    }
  });
}

export function createMoon({ renderer, thermalUniforms, onMeshReady, onMeshError, onTextureReady }) {
  const textureLoader = new THREE.TextureLoader();
  const colorMap = configureTexture(
    textureLoader.load('./assets/lroc_color_8k_runtime.webp', onTextureReady), renderer, THREE.SRGBColorSpace
  );
  const elevationMap = configureTexture(
    textureLoader.load('./assets/ldem_16_8bit.webp', onTextureReady), renderer, THREE.NoColorSpace
  );
  const sunDirection = { value: new THREE.Vector3(1, 0, 0) };
  const surfaceMaterial = createSurfaceMaterial(colorMap, elevationMap, thermalUniforms, sunDirection);

  const body = new THREE.Group();
  body.rotation.z = MOON_AXIAL_TILT;

  const previewPatch = buildTriangularPatch(128);
  const previewMesh = new THREE.Mesh(createPatchGeometry(previewPatch), surfaceMaterial);
  body.add(previewMesh);

  const worker = new Worker(new URL('./icosphere-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event) => {
    const { patch, statistics } = event.data;
    const mesh = new THREE.Mesh(createPatchGeometry(patch), surfaceMaterial);
    body.add(mesh);
    previewMesh.visible = false;
    onMeshReady?.(statistics);
    worker.terminate();
  });
  worker.addEventListener('error', (error) => {
    onMeshError?.(error);
    worker.terminate();
  });

  function setSubsolarLongitude(longitudeDegrees) {
    const longitude = THREE.MathUtils.degToRad(longitudeDegrees);
    sunDirection.value.set(Math.cos(longitude), 0, -Math.sin(longitude)).normalize();
  }

  setSubsolarLongitude(0);
  return {
    body,
    setSubsolarLongitude
  };
}
