import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDivinerController, formatLocalTime } from './diviner.js';
import { createMoon } from './moon.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010307);
scene.fog = new THREE.FogExp2(0x010307, 0.0065);

const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.01, 900);
camera.position.set(10.8, 7.2, 11.8);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.minDistance = 4.2;
controls.maxDistance = 52;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function createStars() {
  const random = mulberry32(81026);
  const positions = [];
  const colors = [];
  for (let i = 0; i < 2200; i++) {
    const radius = 90 + random() * 280;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
    const warmth = random();
    colors.push(0.56 + warmth * 0.35, 0.67 + warmth * 0.24, 0.75 + (1 - warmth) * 0.25);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.17,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    vertexColors: true,
    depthWrite: false
  }));
}

const localTimeInput = document.querySelector('#local-time');
const localTimeValue = document.querySelector('#local-time-value');
const snapshotStatus = document.querySelector('#snapshot-status');
const legendMinimum = document.querySelector('#legend-min');
const legendMaximum = document.querySelector('#legend-max');
const temperatureLegend = document.querySelector('.legend');
const temperatureLayerButton = document.querySelector('#temperature-layer');
const resetViewButton = document.querySelector('#reset-view');

const diviner = createDivinerController();
const moon = createMoon({
  renderer,
  thermalUniforms: diviner.uniforms,
  onMeshReady() {
    requestRender();
  },
  onMeshError(error) {
    console.error('Icosphere worker failed.', error);
  },
  onTextureReady: requestRender
});
scene.add(createStars(), moon.body);

function snapshotLabel(snapshot) {
  return `${String(snapshot.subsolarLongitude).padStart(3, '0')}E`;
}

function applyLocalTime() {
  const inputHours = Number(localTimeInput.value);
  const state = diviner.setLocalTime(inputHours === 24 ? 0 : inputHours);
  const formattedTime = inputHours === 24 ? '24:00' : formatLocalTime(inputHours);
  localTimeValue.value = formattedTime;
  moon.setSubsolarLongitude(state.subsolarLongitude);

  if (state.snapshotA && state.snapshotB) {
    snapshotStatus.textContent = `${snapshotLabel(state.snapshotA)} → ${snapshotLabel(state.snapshotB)} · ${Math.round(state.mixAmount * 100)}%`;
  }
  requestRender();
}

localTimeInput.addEventListener('input', applyLocalTime);

let temperatureLayerVisible = false;
temperatureLayerButton.addEventListener('click', () => {
  temperatureLayerVisible = diviner.setTemperatureVisible(!temperatureLayerVisible);
  temperatureLayerButton.classList.toggle('active', temperatureLayerVisible);
  temperatureLayerButton.setAttribute('aria-pressed', String(temperatureLayerVisible));
  temperatureLayerButton.textContent = temperatureLayerVisible ? 'Hide temperature' : 'Show temperature';
  temperatureLegend.classList.toggle('inactive', !temperatureLayerVisible);
  requestRender();
});

resetViewButton.addEventListener('click', () => {
  camera.position.set(10.8, 7.2, 11.8);
  controls.target.set(0, 0, 0);
  controls.update();
  requestRender();
});

diviner.load().then((metadata) => {
  const minimum = Math.floor(metadata.minimumKelvin);
  const maximum = Math.ceil(metadata.maximumKelvin);
  legendMinimum.textContent = `${minimum} K`;
  legendMaximum.textContent = `${maximum} K`;
  localTimeInput.disabled = false;
  applyLocalTime();
}).catch((error) => {
  console.error('Diviner data failed to load.', error);
  snapshotStatus.textContent = 'Diviner data unavailable';
});

let frameRequested = false;

function requestRender() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(renderFrame);
}

function renderFrame() {
  frameRequested = false;
  const controlsChanged = controls.update();
  renderer.render(scene, camera);
  if (controlsChanged) requestRender();
}

controls.addEventListener('change', requestRender);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  requestRender();
});

applyLocalTime();
requestRender();
