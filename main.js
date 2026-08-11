import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDivinerController, formatLocalTime } from './diviner.js';
import { createMoon, MOON_RENDER_RADIUS } from './moon.js';
import { createSimulationRenderer } from './simulation-renderer.js';
import {
  createWaterSimulation,
  loadLunarTopography,
  LUNAR_DAY_SECONDS,
  MOON_RADIUS_METERS
} from './water-simulation.js';

const DEFAULT_PARTICLE_COUNT = 10;
const MAX_PARTICLE_COUNT = 100_000;

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
  return function random() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function createStars() {
  const random = mulberry32(81026);
  const positions = [];
  const colors = [];
  for (let index = 0; index < 2200; index++) {
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

const staticTab = document.querySelector('#static-tab');
const controlsPanel = document.querySelector('#controls-panel');
const controlsPanelContent = document.querySelector('#controls-panel-content');
const controlsCollapseButton = document.querySelector('#controls-collapse');
const startupError = document.querySelector('#startup-error');
const simulationTab = document.querySelector('#simulation-tab');
const staticPanel = document.querySelector('#static-panel');
const simulationPanel = document.querySelector('#simulation-panel');
const staticLocalTimeInput = document.querySelector('#static-local-time');
const staticLocalTimeValue = document.querySelector('#static-local-time-value');
const snapshotStatus = document.querySelector('#snapshot-status');
const simulationDataStatus = document.querySelector('#simulation-data-status');
const simulationLocalTime = document.querySelector('#simulation-local-time');
const elapsedLunations = document.querySelector('#elapsed-lunations');
const legendMinimum = document.querySelector('#legend-min');
const legendMaximum = document.querySelector('#legend-max');
const temperatureLegend = document.querySelector('.legend');
const temperatureLayerButton = document.querySelector('#temperature-layer');
const resetViewButton = document.querySelector('#reset-view');
const simulationToggleButton = document.querySelector('#simulation-toggle');
const simulationResetButton = document.querySelector('#simulation-reset');
const simulationSpeedInput = document.querySelector('#simulation-speed');
const simulationSpeedValue = document.querySelector('#simulation-speed-value');
const particleCountInput = document.querySelector('#particle-count');
const particleCountNote = document.querySelector('#particle-count-note');
const traceToggleButton = document.querySelector('#trace-toggle');
const traceClearButton = document.querySelector('#trace-clear');
const adsorbedCount = document.querySelector('#adsorbed-count');
const flightCount = document.querySelector('#flight-count');
const escapedCount = document.querySelector('#escaped-count');
const hopCount = document.querySelector('#hop-count');

function showVisualizationError(message, reason = 'runtime') {
  startupError.dataset.reason = reason;
  startupError.textContent = message;
  startupError.hidden = false;
}

function clearVisualizationError(reason) {
  if (startupError.dataset.reason !== reason) return;
  startupError.hidden = true;
  delete startupError.dataset.reason;
}

function setControlsCollapsed(collapsed) {
  controlsPanel.classList.toggle('collapsed', collapsed);
  controlsPanelContent.hidden = collapsed;
  controlsCollapseButton.setAttribute('aria-expanded', String(!collapsed));
  controlsCollapseButton.setAttribute('aria-label', collapsed ? 'Expand controls' : 'Collapse controls');
}

controlsCollapseButton.addEventListener('click', () => {
  setControlsCollapsed(controlsCollapseButton.getAttribute('aria-expanded') === 'true');
});

setControlsCollapsed(matchMedia('(max-width: 680px)').matches);

const diviner = createDivinerController();
const moon = createMoon({
  renderer,
  thermalUniforms: diviner.uniforms,
  onMeshReady: requestRender,
  onMeshError(error) {
    console.error('Icosphere worker failed.', error);
  },
  onTextureReady: requestRender,
  onTextureError(url, error) {
    console.error(`Lunar texture failed to load from ${url}.`, error);
    showVisualizationError('A lunar surface texture could not be loaded. Check your network connection and reload the page.', 'texture');
  }
});
scene.add(createStars(), moon.body);

let activeTab = 'simulation';
let staticTimeHours = 12;
let waterSimulation = null;
let simulationDisplay = null;
let simulationTopography = null;
let simulationRunning = false;
let tracesVisible = true;
let previousFrameTime = null;
let frameRequested = false;

function requestRender() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(renderFrame);
}

function snapshotLabel(snapshot) {
  return `${String(snapshot.subsolarLongitude).padStart(3, '0')}E`;
}

function applyMoonTime(hours, { showSnapshot = false, scheduleRender = true } = {}) {
  const displayHours = hours === 24 ? 24 : ((hours % 24) + 24) % 24;
  const state = diviner.setLocalTime(displayHours === 24 ? 0 : displayHours);
  moon.setSubsolarLongitude(state.subsolarLongitude);
  if (showSnapshot && state.snapshotA && state.snapshotB) {
    snapshotStatus.textContent = `${snapshotLabel(state.snapshotA)} → ${snapshotLabel(state.snapshotB)} · ${Math.round(state.mixAmount * 100)}%`;
  }
  if (scheduleRender) requestRender();
}

function updateStaticTime(hours) {
  staticTimeHours = hours;
  staticLocalTimeInput.value = hours;
  staticLocalTimeValue.value = hours === 24 ? '24:00' : formatLocalTime(hours);
  if (activeTab === 'static') applyMoonTime(hours, { showSnapshot: true });
}

function updateSimulationDisplay(summary = waterSimulation?.getSummary(), scheduleRender = true) {
  if (!summary || !waterSimulation) return;
  simulationLocalTime.value = formatLocalTime(summary.localTimeHours);
  elapsedLunations.value = `${summary.elapsedLunarDays.toFixed(3)} lunations`;
  adsorbedCount.textContent = summary.adsorbed;
  flightCount.textContent = summary.inFlight;
  escapedCount.textContent = summary.escaped;
  hopCount.textContent = summary.hops;
  simulationDisplay?.updateParticles(waterSimulation.particles);
  if (activeTab === 'simulation') {
    applyMoonTime(summary.localTimeHours, { scheduleRender });
  } else if (scheduleRender) {
    requestRender();
  }
}

function setSimulationRunning(running) {
  simulationRunning = Boolean(running && waterSimulation && activeTab === 'simulation');
  previousFrameTime = null;
  simulationToggleButton.textContent = simulationRunning ? 'Pause' : 'Play';
  simulationToggleButton.classList.toggle('active', simulationRunning);
  simulationToggleButton.setAttribute('aria-pressed', String(simulationRunning));
  if (simulationRunning) requestRender();
}

function activateTab(tabName, focusTab = false) {
  if (tabName !== 'static' && tabName !== 'simulation') return;
  if (activeTab === 'simulation' && tabName !== 'simulation') setSimulationRunning(false);
  activeTab = tabName;
  const staticActive = tabName === 'static';
  staticTab.setAttribute('aria-selected', String(staticActive));
  staticTab.tabIndex = staticActive ? 0 : -1;
  simulationTab.setAttribute('aria-selected', String(!staticActive));
  simulationTab.tabIndex = staticActive ? -1 : 0;
  staticPanel.hidden = !staticActive;
  simulationPanel.hidden = staticActive;
  simulationDisplay?.setVisible(!staticActive);
  if (staticActive) {
    applyMoonTime(staticTimeHours, { showSnapshot: true });
  } else if (waterSimulation) {
    updateSimulationDisplay();
  } else {
    requestRender();
  }
  if (focusTab) (staticActive ? staticTab : simulationTab).focus();
}

staticTab.addEventListener('click', () => activateTab('static'));
simulationTab.addEventListener('click', () => activateTab('simulation'));
for (const tab of [staticTab, simulationTab]) {
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const useStatic = event.key === 'ArrowLeft' || event.key === 'Home';
    activateTab(useStatic ? 'static' : 'simulation', true);
  });
}

staticLocalTimeInput.addEventListener('input', () => updateStaticTime(Number(staticLocalTimeInput.value)));

simulationToggleButton.addEventListener('click', () => setSimulationRunning(!simulationRunning));

simulationResetButton.addEventListener('click', () => {
  setSimulationRunning(false);
  createConfiguredSimulation(normalizedParticleCount());
});

simulationSpeedInput.addEventListener('input', () => {
  const speed = Number(simulationSpeedInput.value);
  simulationSpeedValue.value = `${speed.toFixed(speed % 1 ? 2 : 0)} lunation${speed === 1 ? '' : 's'}/min`;
});

traceToggleButton.addEventListener('click', () => {
  tracesVisible = simulationDisplay?.setTracesVisible(!tracesVisible) ?? tracesVisible;
  traceToggleButton.classList.toggle('active', tracesVisible);
  traceToggleButton.setAttribute('aria-pressed', String(tracesVisible));
  traceToggleButton.textContent = tracesVisible ? 'Hide paths' : 'Show paths';
  requestRender();
});

traceClearButton.addEventListener('click', () => {
  simulationDisplay?.clearTraces();
  requestRender();
});

function normalizedParticleCount() {
  const requested = Math.trunc(Number(particleCountInput.value));
  const count = Number.isFinite(requested)
    ? THREE.MathUtils.clamp(requested, 1, MAX_PARTICLE_COUNT)
    : DEFAULT_PARTICLE_COUNT;
  particleCountInput.value = count;
  return count;
}

particleCountInput.addEventListener('input', () => {
  particleCountNote.textContent = 'Changes apply when Reset is pressed';
});

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

const divinerReady = diviner.load();
divinerReady.then((metadata) => {
  legendMinimum.textContent = `${Math.floor(metadata.minimumKelvin)} K`;
  legendMaximum.textContent = `${Math.ceil(metadata.maximumKelvin)} K`;
  staticLocalTimeInput.disabled = false;
  snapshotStatus.removeAttribute('role');
  updateStaticTime(staticTimeHours);
}).catch((error) => {
  console.error('Diviner data failed to load.', error);
  snapshotStatus.textContent = 'Diviner data unavailable';
});

const topographyReady = loadLunarTopography();
topographyReady.catch((error) => {
  console.error('Topography data failed to load.', error);
});

function createConfiguredSimulation(particleCount) {
  simulationDisplay?.dispose();
  simulationDisplay = createSimulationRenderer({
    parent: moon.body,
    particleCount,
    moonRadiusMeters: MOON_RADIUS_METERS,
    moonRenderRadius: MOON_RENDER_RADIUS
  });
  simulationDisplay.setVisible(activeTab === 'simulation');
  simulationDisplay.setTracesVisible(tracesVisible);
  waterSimulation = createWaterSimulation({
    topography: simulationTopography,
    particleCount,
    onTrajectoryEvent: simulationDisplay.handleTrajectoryEvent,
    temperatureKelvinAt(longitudeRadians, latitudeRadians, localTimeHours) {
      return diviner.sampleTemperatureKelvin(longitudeRadians, latitudeRadians, localTimeHours);
    }
  });
  particleCountNote.textContent = `${particleCount} particles active`;
  simulationDataStatus.textContent = `Ready · ${particleCount} particles · last hop retained`;
  updateSimulationDisplay();
}

Promise.all([divinerReady, topographyReady]).then(([, topography]) => {
  simulationTopography = topography;
  createConfiguredSimulation(normalizedParticleCount());
  simulationToggleButton.disabled = false;
  simulationResetButton.disabled = false;
  traceToggleButton.disabled = false;
  traceClearButton.disabled = false;
  simulationToggleButton.textContent = 'Play';
}).catch(() => {
  simulationDataStatus.textContent = 'Simulation data unavailable';
  simulationToggleButton.textContent = 'Unavailable';
});

function renderFrame(timestamp) {
  frameRequested = false;
  if (simulationRunning && waterSimulation && activeTab === 'simulation') {
    if (previousFrameTime !== null) {
      const wallSeconds = Math.min((timestamp - previousFrameTime) / 1000, 0.05);
      const simulatedSeconds = wallSeconds * Number(simulationSpeedInput.value) * LUNAR_DAY_SECONDS / 60;
      updateSimulationDisplay(waterSimulation.advance(simulatedSeconds), false);
    }
    previousFrameTime = timestamp;
  }
  const controlsChanged = controls.update();
  renderer.render(scene, camera);
  if (controlsChanged || simulationRunning) requestRender();
}

controls.addEventListener('change', requestRender);

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  setSimulationRunning(false);
  showVisualizationError('The graphics context was lost. Waiting for the browser to restore it…', 'context');
});

renderer.domElement.addEventListener('webglcontextrestored', () => {
  clearVisualizationError('context');
  requestRender();
});

document.addEventListener('visibilitychange', () => {
  previousFrameTime = null;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  requestRender();
});

updateStaticTime(staticTimeHours);
requestRender();
