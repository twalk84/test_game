import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { createWorld } from "./world.js";
import { PlayerController } from "./player.js";
import { CollectibleSystem } from "./collectibles.js";
import { EnemySystem } from "./enemies.js";
import { loadGame, resetSave, saveGame } from "./save.js";
import { GAME_CONFIG } from "./config.js";
import { MissionSystem } from "./systems/missions.js";
import { InventorySystem } from "./systems/inventory.js";
import { VehicleSystem } from "./systems/vehicles.js";
import {
  pushStatusFeed,
  setCombatStatus,
  setCrosshairSpread,
  setDamageOverlay,
  setBlackoutOverlay,
  setEffectsStatus,
  setHealth,
  setInventoryPanelVisible,
  setInventorySummary,
  setObjective,
  setPauseMenuVisible,
  setProgression,
  setScore,
  setVehicleStatus,
  setVehicleHealth,
  setDebugOverlayVisible,
  setDebugText,
  setControlsPanelVisible,
  setSniperScopeActive,
  setStamina,
  setStatus,
  setInteractionHint,
  setWeaponHeat,
  setWeaponStatus,
} from "./ui.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const gameEventHandlers = new Map();

function onGameEvent(type, handler) {
  if (!gameEventHandlers.has(type)) gameEventHandlers.set(type, new Set());
  gameEventHandlers.get(type).add(handler);
}

function emitGameEvent(type, payload = {}) {
  const handlers = gameEventHandlers.get(type);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch {
      // no-op: event handlers should never break gameplay loop
    }
  }
}

const canvas = document.getElementById("game");
const sensitivityInput = document.getElementById("sensitivity");
const volumeInput = document.getElementById("volume");
const muteInput = document.getElementById("mute");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8eb);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

const hemi = new THREE.HemisphereLight(0xbfdfff, 0x35573a, 0.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff7dd, 1.0);
sun.position.set(28, 45, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
scene.add(sun);

const world = createWorld(scene);

const gameState = {
  score: 0,
  maxHealth: 100,
  health: 100,
  maxStamina: 100,
  stamina: 100,
  level: 1,
  xp: 0,
  points: 0,
  upgrades: {
    speed: 0,
    jump: 0,
    stamina: 0,
  },
  paused: false,
  inVehicle: false,
  activeVehicleId: null,
  inventoryPanelOpen: false,
  controlsPanelOpen: false,
  settings: {
    sensitivity: 1,
    volume: 0.4,
    mute: false,
  },
  effects: {
    stimUntil: 0,
  },
};

const missionSystem = new MissionSystem();
const inventorySystem = new InventorySystem();

const player = new PlayerController(camera, world.getHeightAt, {
  scene,
  cameraCollisionMeshes: world.cameraCollisionMeshes,
  getHeightAtDetailed: world.getHeightAtDetailed,
  resolveHorizontalCollision: world.resolveHorizontalCollision,
  resolveExternalCollision: (position, radius) => {
    vehicles.resolvePointCollision?.(position, radius, gameState.activeVehicleId);
  },
  getCameraTuningForPosition: world.getCameraTuningForPosition,
  constrainCameraPosition: world.constrainCameraPosition,
  canSprint: (dt, wantsSprintMove) => {
    if (!wantsSprintMove) return false;
    if (gameState.stamina <= 0) return false;
    gameState.stamina = clamp(gameState.stamina - 20 * dt, 0, gameState.maxStamina);
    return true;
  },
  consumeJumpCost: () => {
    const jumpCost = 15;
    if (gameState.stamina < jumpCost) return false;
    gameState.stamina = clamp(gameState.stamina - jumpCost, 0, gameState.maxStamina);
    return true;
  },
});
player.setPosition(0, world.getHeightAtDetailed(0, 0, world.getHeightAt(0, 0)) + 1.6, 0);

const collectibles = new CollectibleSystem(scene, world.getHeightAt, world.worldSize);
collectibles.spawn(45);

const vehicles = new VehicleSystem(scene, world);
vehicles.spawnDefault();

const enemies = new EnemySystem(scene, world.getHeightAt, world.worldSize, {
  getHeightAtDetailed: world.getHeightAtDetailed,
  resolveHorizontalCollision: world.resolveHorizontalCollision,
  getContainmentState: world.getEnemyContainmentState,
});
enemies.spawn(12);

const combatState = {
  nextAttackAt: 0,
  nextTreeIgniteAt: 0,
  nightRushAnnounced: false,
  punch: {
    active: false,
    hitAt: 0,
    endAt: 0,
    resolved: false,
  },
};

const weaponDefs = {
  rifle: {
    id: "rifle",
    label: "Rifle",
    damage: 18,
    range: 30,
    cooldown: 0.26,
    projectileSpeed: 52,
    projectileLife: 1.2,
    projectileRadius: 0.08,
    projectileColor: 0xfff2a8,
    toneHit: 760,
    toneMiss: 300,
  },
  shotgun: {
    id: "shotgun",
    label: "Shotgun",
    damage: 8,
    range: 18,
    cooldown: 0.85,
    pellets: 6,
    spread: 0.08,
    projectileSpeed: 42,
    projectileLife: 0.45,
    projectileRadius: 0.06,
    projectileColor: 0xffc78b,
    toneHit: 690,
    toneMiss: 250,
  },
  pulse: {
    id: "pulse",
    label: "Pulse",
    damage: 11,
    range: 26,
    cooldown: 0.14,
    projectileSpeed: 60,
    projectileLife: 0.9,
    projectileRadius: 0.065,
    projectileColor: 0x8fd6ff,
    toneHit: 820,
    toneMiss: 340,
  },
  smg: {
    id: "smg",
    label: "SMG",
    damage: 9,
    range: 24,
    cooldown: 0.09,
    spread: 0.045,
    projectileSpeed: 68,
    projectileLife: 0.8,
    projectileRadius: 0.055,
    projectileColor: 0xffe5ac,
    toneHit: 740,
    toneMiss: 420,
  },
  sniperPlayer: {
    id: "sniperPlayer",
    label: "Sniper",
    damage: 9999,
    range: 90,
    cooldown: 1.3,
    toneHit: 990,
    toneMiss: 220,
  },
  flamethrower: {
    id: "flamethrower",
    label: "Flamethrower",
    damage: 7,
    range: 9,
    coneDot: 0.72,
    maxHits: 4,
    cooldown: 0.08,
    civilianRadius: 5,
    treeRadius: GAME_CONFIG.combat.flamethrower.treeIgniteRadius,
    treeIgniteCooldown: GAME_CONFIG.combat.flamethrower.treeIgniteCooldown,
    toneHit: 520,
    toneMiss: 190,
    projectileColor: 0xff7a2b,
  },
};

const weaponHandlingDefs = {
  rifle: { bloomPerShot: 0.12, bloomDecayPerSec: 0.95, maxBloom: 0.9 },
  shotgun: { bloomPerShot: 0.22, bloomDecayPerSec: 0.9, maxBloom: 1.05 },
  pulse: { bloomPerShot: 0.1, bloomDecayPerSec: 1.2, maxBloom: 0.78 },
  smg: { bloomPerShot: 0.085, bloomDecayPerSec: 0.75, maxBloom: 1.15 },
  sniperPlayer: { bloomPerShot: 0.04, bloomDecayPerSec: 1.5, maxBloom: 0.3 },
  flamethrower: { bloomPerShot: 0.055, bloomDecayPerSec: 0.7, maxBloom: 1.25 },
};

const weaponState = {
  order: ["rifle", "shotgun", "pulse", "smg", "sniperPlayer", "flamethrower"],
  activeId: "rifle",
  unlocked: {
    rifle: true,
    shotgun: true,
    pulse: true,
    smg: true,
    sniperPlayer: true,
    flamethrower: true,
  },
};

const weaponRuntime = {
  heatById: Object.create(null),
};

const aimOrigin = new THREE.Vector3();
const aimDirection = new THREE.Vector3();
const tempAimVector = new THREE.Vector3();
const centerRayDirection = new THREE.Vector3();
const cameraAimTarget = new THREE.Vector3();
const muzzleOrigin = new THREE.Vector3();
const previousProjectilePosition = new THREE.Vector3();
const punchOrigin = new THREE.Vector3();
const punchDirection = new THREE.Vector3();

const playerProjectiles = [];
const muzzleFlashes = [];
const flameBursts = [];
const driftPuffs = [];
const vehicleSmokePlumes = [];
const explosionDebris = [];
const ambientTrafficVehicles = [];
const inputState = {
  primaryDown: false,
};
const driftAudioState = {
  nextAt: 0,
};

const supplyCache = {
  id: "cache_alpha",
  position: new THREE.Vector3(6, world.getHeightAtDetailed(6, 2, world.getHeightAt(6, 2)) + 0.3, 2),
  opened: false,
  cooldownUntil: 0,
};

const vehicleCombatConfig = {
  repairAmount: GAME_CONFIG.vehicles?.combat?.repairAmount ?? 48,
  repairRange: GAME_CONFIG.vehicles?.combat?.repairRange ?? 4.2,
  destroyRecoverySeconds: GAME_CONFIG.vehicles?.combat?.destroyRecoverySeconds ?? 8,
  projectileHitRadius: GAME_CONFIG.vehicles?.combat?.projectileHitRadius ?? 1.4,
};

const mountedWeaponConfig = {
  damage: GAME_CONFIG.vehicles?.mountedWeapon?.damage ?? 16,
  range: GAME_CONFIG.vehicles?.mountedWeapon?.range ?? 72,
  fireRate: GAME_CONFIG.vehicles?.mountedWeapon?.fireRate ?? 8,
  spread: GAME_CONFIG.vehicles?.mountedWeapon?.spread ?? 0.03,
  hitRadius: GAME_CONFIG.vehicles?.mountedWeapon?.hitRadius ?? 0.22,
  heatPerShot: GAME_CONFIG.vehicles?.mountedWeapon?.heatPerShot ?? 0.1,
  coolPerSecond: GAME_CONFIG.vehicles?.mountedWeapon?.coolPerSecond ?? 0.24,
  maxHeat: GAME_CONFIG.vehicles?.mountedWeapon?.maxHeat ?? 1,
  overheatDuration: GAME_CONFIG.vehicles?.mountedWeapon?.overheatDuration ?? 1.35,
  resumeHeatThreshold: GAME_CONFIG.vehicles?.mountedWeapon?.resumeHeatThreshold ?? 0.34,
};

const mountedWeaponState = {
  nextFireAt: 0,
  heat: 0,
  overheatUntil: 0,
};

const voidRespawnState = {
  active: false,
  until: 0,
};

function startVoidRespawn(elapsed, message = "Out of bounds") {
  if (voidRespawnState.active) return;
  voidRespawnState.active = true;
  voidRespawnState.until = elapsed + 2;
  inputState.primaryDown = false;
  announce(`${message}. Respawning...`, { tone: "danger", priority: 3, hold: 1.6 });
  setBlackoutOverlay(1);
}

function completeVoidRespawn() {
  if (gameState.inVehicle) {
    gameState.inVehicle = false;
    gameState.activeVehicleId = null;
  }
  vehicleCameraState.initialized = false;
  player.avatarRoot.visible = true;
  player.setPosition(0, world.getHeightAtDetailed(0, 0, world.getHeightAt(0, 0)) + 1.6, 0);
  setVehicleHealth(0, 0, false);
  setVehicleStatus("On foot");
  setBlackoutOverlay(0);
  voidRespawnState.active = false;
}

function getActiveVehicle() {
  if (!gameState.activeVehicleId) return null;
  return vehicles.getById(gameState.activeVehicleId);
}

function getVehicleControlsFromPlayerKeys() {
  let throttle = 0;
  if (player.keys.has("KeyW") || player.keys.has("ArrowUp")) throttle += 1;
  if (player.keys.has("KeyS") || player.keys.has("ArrowDown")) throttle -= 1;

  let steer = 0;
  if (player.keys.has("KeyA")) steer += 1;
  if (player.keys.has("KeyD")) steer -= 1;
  if (player.keys.has("ArrowLeft")) steer -= 1;
  if (player.keys.has("ArrowRight")) steer += 1;

  const brake = player.keys.has("Space");
  const boost = player.keys.has("KeyN");
  return { throttle, steer, brake, boost };
}

function updateVehicleCamera(vehicle, dt) {
  const forward = vehicles.getForwardVector(vehicle);
  const desired = vehicle.mesh.position
    .clone()
    .add(new THREE.Vector3(0, 2.7, 0))
    .add(forward.clone().multiplyScalar(-7.2));
  const lookAt = vehicle.mesh.position.clone().add(forward.clone().multiplyScalar(7.5)).add(new THREE.Vector3(0, 1.4, 0));

  if (!vehicleCameraState.initialized) {
    vehicleCameraState.position.copy(desired);
    vehicleCameraState.initialized = true;
  }
  vehicleCameraState.position.lerp(desired, 1 - Math.exp(-8 * dt));
  camera.position.copy(vehicleCameraState.position);
  camera.lookAt(lookAt);
}

function exitVehicle() {
  const vehicle = getActiveVehicle();
  if (!vehicle) return;

  const right = new THREE.Vector3(Math.cos(vehicle.yaw), 0, -Math.sin(vehicle.yaw));
  const forward = vehicles.getForwardVector(vehicle);
  const offsets = [
    right.clone().multiplyScalar(1.9),
    right.clone().multiplyScalar(-1.9),
    forward.clone().multiplyScalar(-2.1),
    forward.clone().multiplyScalar(2.0),
    right.clone().multiplyScalar(1.35).add(forward.clone().multiplyScalar(-1.2)),
    right.clone().multiplyScalar(-1.35).add(forward.clone().multiplyScalar(-1.2)),
  ];

  let selected = null;
  for (const offset of offsets) {
    const candidate = vehicle.mesh.position.clone().add(offset);
    candidate.y = world.getHeightAtDetailed(candidate.x, candidate.z, vehicle.mesh.position.y - 0.06) + 1.6;
    if (world.resolveHorizontalCollision) {
      world.resolveHorizontalCollision(candidate, 0.45, candidate.y - 1.6, candidate.y + 0.2);
    }
    vehicles.resolvePointCollision?.(candidate, 0.45, vehicle.id);
    if (candidate.distanceTo(vehicle.mesh.position) <= 3.2) {
      selected = candidate;
      break;
    }
  }

  if (!selected) {
    selected = vehicle.mesh.position.clone().add(right.multiplyScalar(1.6));
    selected.y = world.getHeightAtDetailed(selected.x, selected.z, vehicle.mesh.position.y - 0.06) + 1.6;
  }

  player.setPosition(selected.x, selected.y, selected.z);
  player.avatarRoot.visible = true;
  gameState.inVehicle = false;
  gameState.activeVehicleId = null;
  vehicleCameraState.initialized = false;
  emitGameEvent("vehicle_exited", { id: vehicle.id });
  announce("Exited vehicle.", { tone: "info", priority: 2, hold: 1.1 });
}

function enterNearestVehicle() {
  if (gameState.inVehicle) {
    exitVehicle();
    return;
  }

  const nearest = vehicles.getNearestVehicle(player.position, GAME_CONFIG.vehicles.enterRange);
  if (!nearest) {
    announce("No vehicle nearby. Move closer and press E.", { tone: "warn", priority: 1, hold: 1.1 });
    return;
  }

  const stage = vehicles.getExplosionStage ? vehicles.getExplosionStage(nearest) : "intact";
  if (stage === "burning" || stage === "exploded" || stage === "wreck") {
    announce("That vehicle is wrecked and cannot be driven.", { tone: "warn", priority: 2, hold: 1.2 });
    return;
  }

  gameState.inVehicle = true;
  gameState.activeVehicleId = nearest.id;
  player.avatarRoot.visible = false;
  inputState.primaryDown = false;
  emitGameEvent("vehicle_entered", { id: nearest.id });
  announce(`Entered ${nearest.label || "vehicle"}. WASD drive, Space brake, E exit.`, {
    tone: "info",
    priority: 2,
    hold: 1.6,
  });
  announce("Mounted cannon online: hold LMB to fire.", { tone: "info", priority: 1, hold: 1.2 });
}

const uiState = {
  statusPriority: 0,
  statusUntil: 0,
  damageFlash: 0,
  nextVehicleHintAt: 0,
  nextVehicleImpactAnnounceAt: 0,
  debugEnabled: GAME_CONFIG.debug.enabledByDefault,
  nextDebugRefreshAt: 0,
};

const telemetry = {
  kills: 0,
  damageTaken: 0,
  vehiclesEntered: 0,
  vehiclesExited: 0,
};

const vehicleScoreState = {
  combo: 1,
  bank: 0,
  chainTimeLeft: 0,
  payoutCooldown: 0,
  bestBank: 0,
  lifetimeDriftScore: 0,
  tierAnnounced: Object.create(null),
};

onGameEvent("enemy_killed", () => {
  telemetry.kills += 1;
});

onGameEvent("player_damaged", ({ amount }) => {
  telemetry.damageTaken += Math.max(0, Number(amount) || 0);
});

onGameEvent("vehicle_entered", () => {
  telemetry.vehiclesEntered += 1;
});

onGameEvent("vehicle_exited", () => {
  telemetry.vehiclesExited += 1;
});

const vehicleCameraState = {
  position: new THREE.Vector3(),
  initialized: false,
};

const ambientTrafficState = {
  initialized: false,
};

function initializeAmbientTraffic() {
  if (ambientTrafficState.initialized) return;
  const pathData = world.getFreewayTrafficPath ? world.getFreewayTrafficPath() : null;
  if (!pathData || !Array.isArray(pathData.points) || pathData.points.length < 12) {
    ambientTrafficState.initialized = true;
    return;
  }

  const laneOffsets = Array.isArray(pathData.laneOffsets) && pathData.laneOffsets.length
    ? pathData.laneOffsets
    : [-5.1, -1.7, 1.7, 5.1];
  const perLane = 3;
  const spacing = 1 / perLane;

  for (let laneIndex = 0; laneIndex < laneOffsets.length; laneIndex++) {
    for (let i = 0; i < perLane; i++) {
      const color = laneIndex < 2 ? 0xc7d4e6 : 0xadc6d9;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.9, 3.4),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      ambientTrafficVehicles.push({
        mesh,
        laneOffset: laneOffsets[laneIndex],
        t: (i * spacing + laneIndex * 0.11) % 1,
        speed: 0.018 + Math.random() * 0.014,
      });
    }
  }

  ambientTrafficState.initialized = true;
}

function sampleTrafficPath(points, t) {
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * points.length;
  const i0 = Math.floor(scaled) % points.length;
  const i1 = (i0 + 1) % points.length;
  const f = scaled - Math.floor(scaled);
  const p0 = points[i0];
  const p1 = points[i1];
  return {
    x: p0.x + (p1.x - p0.x) * f,
    y: p0.y + (p1.y - p0.y) * f,
    z: p0.z + (p1.z - p0.z) * f,
    tx: p1.x - p0.x,
    tz: p1.z - p0.z,
  };
}

function updateAmbientTraffic(dt) {
  if (!ambientTrafficState.initialized) initializeAmbientTraffic();
  if (ambientTrafficVehicles.length === 0) return;
  const pathData = world.getFreewayTrafficPath ? world.getFreewayTrafficPath() : null;
  if (!pathData || !Array.isArray(pathData.points) || pathData.points.length < 12) return;

  const points = pathData.points;
  for (const car of ambientTrafficVehicles) {
    car.t = (car.t + car.speed * dt) % 1;
    const sample = sampleTrafficPath(points, car.t);
    const tangent = new THREE.Vector3(sample.tx, 0, sample.tz).normalize();
    const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
    car.mesh.position.set(
      sample.x + right.x * car.laneOffset,
      sample.y + 0.48,
      sample.z + right.z * car.laneOffset
    );
    car.mesh.rotation.y = Math.atan2(tangent.x, tangent.z);
  }
}

let audioCtx;
let masterGain;
let ambientGain;

function ensureAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.2;
    masterGain.connect(audioCtx.destination);

    const ambientOsc = audioCtx.createOscillator();
    ambientOsc.type = "triangle";
    ambientOsc.frequency.value = 86;
    ambientGain = audioCtx.createGain();
    ambientGain.gain.value = 0.02;
    ambientOsc.connect(ambientGain);
    ambientGain.connect(masterGain);
    ambientOsc.start();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function updateAudioSettings() {
  if (!masterGain) return;
  const vol = gameState.settings.mute ? 0 : gameState.settings.volume;
  masterGain.gain.value = vol * 0.6;
  if (ambientGain) ambientGain.gain.value = 0.02 + vol * 0.03;
}

function playTone(freq, duration = 0.12, type = "sine", volume = 0.2) {
  if (gameState.settings.mute) return;
  const ctx = ensureAudio();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;

  osc.connect(gain);
  gain.connect(masterGain);

  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function announce(message, { tone = "info", priority = 1, hold = 1.2 } = {}) {
  const now = clock ? clock.elapsedTime : 0;
  if (now >= uiState.statusUntil || priority >= uiState.statusPriority) {
    setStatus(message);
    uiState.statusPriority = priority;
    uiState.statusUntil = now + hold;
  }
  pushStatusFeed(message, tone);
}

function triggerDamageFlash(amount = 0.35) {
  uiState.damageFlash = Math.max(uiState.damageFlash, amount);
}

function updateInventoryUI() {
  setInventorySummary(inventorySystem.getSummaryText());
  const scrap = document.getElementById("invScrap");
  const crystal = document.getElementById("invCrystal");
  const alloy = document.getElementById("invAlloy");
  const medkit = document.getElementById("invMedkit");
  const stim = document.getElementById("invStim");
  const repairKit = document.getElementById("invRepairKit");
  if (scrap) scrap.textContent = String(inventorySystem.resources.scrap);
  if (crystal) crystal.textContent = String(inventorySystem.resources.crystal);
  if (alloy) alloy.textContent = String(inventorySystem.resources.alloy);
  if (medkit) medkit.textContent = String(inventorySystem.consumables.medkit);
  if (stim) stim.textContent = String(inventorySystem.consumables.stim);
  if (repairKit) repairKit.textContent = String(inventorySystem.consumables.repairKit);
}

function applyMissionResult(missionResult) {
  if (!missionResult) return;

  setObjective(missionResult.objectiveText || missionSystem.getObjectiveText());

  if (missionResult.state === "completed") {
    gameState.score += missionResult.reward.score;
    addXp(missionResult.reward.xp);
    setScore(gameState.score);
    announce(missionResult.message, { tone: "good", priority: 2, hold: 1.8 });
    playTone(930, 0.2, "triangle", 0.16);
  } else if (missionResult.state === "failed") {
    announce(missionResult.message, { tone: "warn", priority: 2, hold: 1.8 });
    playTone(220, 0.25, "sawtooth", 0.12);
  }
}

setScore(gameState.score);
setHealth(gameState.health, gameState.maxHealth);
setStamina(gameState.stamina, gameState.maxStamina);
setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
setCombatStatus("Ready");
setVehicleStatus("On foot");
setWeaponStatus("Rifle • Ready");
setWeaponHeat(0, 1);
setPauseMenuVisible(false);
setInventoryPanelVisible(false);
setControlsPanelVisible(false);
setObjective(missionSystem.getObjectiveText());
updateInventoryUI();

function updateCombatStatus(elapsed) {
  const cd = combatState.nextAttackAt - elapsed;
  if (cd <= 0) {
    setCombatStatus("Ready");
  } else {
    setCombatStatus(`Cooldown ${cd.toFixed(2)}s`);
  }
}

function applyKillRewards(score, xp, weaponLabel, enemyType) {
  gameState.score += score;
  addXp(xp);
  missionSystem.onEvent("enemy_killed", { count: 1, type: enemyType });

  if (enemyType === "sniper") {
    inventorySystem.addResource("crystal", 1);
    inventorySystem.addResource("alloy", 1);
  } else if (enemyType === "charger") {
    inventorySystem.addResource("scrap", 2);
  } else if (enemyType === "engineer") {
    inventorySystem.addResource("alloy", 2);
    inventorySystem.addResource("scrap", 1);
  } else {
    inventorySystem.addResource("scrap", 1);
  }

  setScore(gameState.score);
  updateInventoryUI();
  emitGameEvent("enemy_killed", { score, xp, weaponLabel, enemyType });
  announce(`${weaponLabel}: downed ${enemyType || "enemy"} (+${score} score, +${xp} XP)`, {
    tone: "good",
    priority: 2,
    hold: 1.3,
  });
  playTone(980, 0.12, "triangle", 0.12);
}

function spawnPlayerProjectile(weapon, origin, direction) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(weapon.projectileRadius || 0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: weapon.projectileColor || 0xffffff })
  );
  mesh.position.copy(origin);
  scene.add(mesh);

  playerProjectiles.push({
    mesh,
    velocity: direction.clone().normalize().multiplyScalar(weapon.projectileSpeed || 48),
    life: weapon.projectileLife || 1,
    damage: weapon.damage,
    weaponLabel: weapon.label,
    hitTone: weapon.toneHit,
    hitRadius: weapon.hitRadius || 0.2,
  });
}

function spawnMuzzleFlash(origin, color = 0xffddaa, scale = 1) {
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.09 * scale, 8, 8),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    })
  );
  flash.position.copy(origin);
  scene.add(flash);
  muzzleFlashes.push({ mesh: flash, life: 0.06 });
}

function updateMuzzleFlashes(dt) {
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const flash = muzzleFlashes[i];
    flash.life -= dt;
    const alpha = clamp(flash.life / 0.06, 0, 1);
    flash.mesh.material.opacity = alpha;
    flash.mesh.scale.setScalar(1 + (1 - alpha) * 0.5);
    if (flash.life <= 0) {
      scene.remove(flash.mesh);
      muzzleFlashes.splice(i, 1);
    }
  }
}

function updatePlayerProjectiles(dt, elapsed) {
  for (let i = playerProjectiles.length - 1; i >= 0; i--) {
    const p = playerProjectiles[i];
    p.life -= dt;

    previousProjectilePosition.copy(p.mesh.position);
    p.mesh.position.addScaledVector(p.velocity, dt);

    const segment = p.mesh.position.clone().sub(previousProjectilePosition);
    const segmentLength = segment.length();
    let consumed = false;

    if (segmentLength > 0.0001) {
      const attack = enemies.tryHitFromRay(
        previousProjectilePosition,
        segment.normalize(),
        segmentLength + 0.1,
        p.damage,
        elapsed,
        p.hitRadius || 0
      );

      if (attack.hit) {
        playTone(p.hitTone || 760, 0.06, "square", 0.09);
        if (attack.killed) {
          applyKillRewards(attack.score, attack.xp, p.weaponLabel, attack.type);
        } else {
          announce(`${p.weaponLabel}: hit confirmed.`, { tone: "info", priority: 1, hold: 0.7 });
        }
        scene.remove(p.mesh);
        playerProjectiles.splice(i, 1);
        consumed = true;
      }
    }

    if (consumed) continue;

    const groundY = world.getHeightAt(p.mesh.position.x, p.mesh.position.z);
    const hitGround = p.mesh.position.y <= groundY + 0.2;

    if (p.life <= 0 || hitGround) {
      scene.remove(p.mesh);
      playerProjectiles.splice(i, 1);
    }
  }
}

function spawnFlameBurst(origin, direction) {
  const burst = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8a2d, transparent: true, opacity: 0.85 })
  );
  burst.position.copy(origin);
  scene.add(burst);
  flameBursts.push({
    mesh: burst,
    velocity: direction.clone().multiplyScalar(14 + Math.random() * 6),
    life: 0.24 + Math.random() * 0.18,
  });
}

function updateFlameBursts(dt) {
  for (let i = flameBursts.length - 1; i >= 0; i--) {
    const f = flameBursts[i];
    f.life -= dt;
    f.mesh.position.addScaledVector(f.velocity, dt);
    f.mesh.scale.setScalar(1 + (0.3 - Math.max(0, f.life)) * 4);
    f.mesh.material.opacity = clamp(f.life / 0.35, 0, 1);
    if (f.life <= 0) {
      scene.remove(f.mesh);
      flameBursts.splice(i, 1);
    }
  }
}

function spawnDriftPuff(position, intensity = 0.4, surfaceGrip = 1) {
  const radius = 0.07 + intensity * 0.1;
  const baseGray = clamp(0.35 + (1 - surfaceGrip) * 0.35, 0.35, 0.82);
  const color = new THREE.Color(baseGray, baseGray, baseGray);
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 7, 7),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.52 })
  );
  puff.position.copy(position);
  scene.add(puff);
  driftPuffs.push({
    mesh: puff,
    life: 0.24 + intensity * 0.22,
    rise: 0.8 + intensity * 0.9,
    spread: 0.35 + intensity * 0.4,
  });
}

function updateDriftPuffs(dt) {
  for (let i = driftPuffs.length - 1; i >= 0; i--) {
    const puff = driftPuffs[i];
    puff.life -= dt;
    puff.mesh.position.y += puff.rise * dt;
    const expansion = 1 + puff.spread * dt * 6;
    puff.mesh.scale.multiplyScalar(expansion);
    puff.mesh.material.opacity = clamp(puff.life / 0.42, 0, 0.55);
    if (puff.life <= 0) {
      scene.remove(puff.mesh);
      driftPuffs.splice(i, 1);
    }
  }
}

function spawnVehicleSmoke(position, stage = "critical") {
  const radius = stage === "burning" ? 0.26 + Math.random() * 0.15 : 0.18 + Math.random() * 0.1;
  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 8),
    new THREE.MeshBasicMaterial({ color: stage === "burning" ? 0x2a2a2a : 0x3a3a3a, transparent: true, opacity: 0.55 })
  );
  smoke.position.copy(position).add(
    new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.85 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5)
  );
  scene.add(smoke);
  vehicleSmokePlumes.push({
    mesh: smoke,
    life: stage === "burning" ? 1.05 + Math.random() * 0.55 : 0.8 + Math.random() * 0.45,
    rise: 0.5 + Math.random() * 0.8,
    spread: 0.26 + Math.random() * 0.35,
  });
}

function updateVehicleSmokePlumes(dt) {
  for (let i = vehicleSmokePlumes.length - 1; i >= 0; i--) {
    const plume = vehicleSmokePlumes[i];
    plume.life -= dt;
    plume.mesh.position.y += plume.rise * dt;
    plume.mesh.scale.multiplyScalar(1 + plume.spread * dt);
    plume.mesh.material.opacity = clamp(plume.life / 1.3, 0, 0.55);
    if (plume.life <= 0) {
      scene.remove(plume.mesh);
      vehicleSmokePlumes.splice(i, 1);
    }
  }
}

function spawnExplosionDebris(origin, count = 14) {
  for (let i = 0; i < count; i++) {
    const size = 0.08 + Math.random() * 0.14;
    const debris = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.82, metalness: 0.12 })
    );
    debris.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.7));
    scene.add(debris);
    explosionDebris.push({
      mesh: debris,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 8, 3 + Math.random() * 5, (Math.random() - 0.5) * 8),
      life: 1.4 + Math.random() * 1.4,
      spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
    });
  }
}

function updateExplosionDebris(dt) {
  for (let i = explosionDebris.length - 1; i >= 0; i--) {
    const d = explosionDebris[i];
    d.life -= dt;
    d.velocity.y -= 12 * dt;
    d.mesh.position.addScaledVector(d.velocity, dt);
    d.mesh.rotation.x += d.spin.x * dt;
    d.mesh.rotation.y += d.spin.y * dt;
    d.mesh.rotation.z += d.spin.z * dt;
    if (d.mesh.position.y < world.getHeightAt(d.mesh.position.x, d.mesh.position.z) + 0.04) {
      d.velocity.multiplyScalar(0.55);
      d.velocity.y = Math.abs(d.velocity.y) * 0.25;
    }
    if (d.life <= 0) {
      scene.remove(d.mesh);
      explosionDebris.splice(i, 1);
    }
  }
}

function updateVehicleDriftFeedback(vehicle, dt, elapsed) {
  if (!vehicle || !vehicle.driftState || !vehicle.driftState.active) return;

  const intensity = clamp(vehicle.driftState.intensity || 0, 0, 1);
  if (intensity < 0.2) return;

  const forward = vehicles.getForwardVector(vehicle);
  const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
  const rearBase = vehicle.mesh.position.clone().add(forward.clone().multiplyScalar(-1.18));
  const leftRear = rearBase.clone().add(right.clone().multiplyScalar(-0.72));
  const rightRear = rearBase.clone().add(right.clone().multiplyScalar(0.72));
  leftRear.y = vehicle.mesh.position.y + 0.24;
  rightRear.y = vehicle.mesh.position.y + 0.24;

  const spawnChance = clamp((0.9 + intensity * 1.8) * dt * 10, 0, 1);
  if (Math.random() < spawnChance) spawnDriftPuff(leftRear, intensity, vehicle.driftState.surfaceGrip || 1);
  if (Math.random() < spawnChance) spawnDriftPuff(rightRear, intensity, vehicle.driftState.surfaceGrip || 1);

  if (elapsed >= driftAudioState.nextAt) {
    const pitch = 120 + intensity * 60;
    const volume = 0.018 + intensity * 0.03;
    playTone(pitch, 0.045, "sawtooth", volume);
    driftAudioState.nextAt = elapsed + (0.12 - intensity * 0.06);
  }
}

function processVehicleExplosionEvents(elapsed) {
  const events = vehicles.consumeExplosionEvents ? vehicles.consumeExplosionEvents() : [];
  if (!events || events.length === 0) return;

  for (const event of events) {
    const radius = Math.max(0.5, Number(event.radius) || 6.5);
    const maxDamage = Math.max(1, Number(event.maxDamage) || 48);
    const chainMultiplier = clamp(Number(event.chainVehicleDamageMultiplier) || 0.7, 0.1, 2);
    const playerMultiplier = clamp(Number(event.playerDamageMultiplier) || 1, 0, 2);

    announce(`${event.label || "Vehicle"} exploded!`, { tone: "danger", priority: 3, hold: 1.2 });
    spawnExplosionDebris(event.position, 16);
    playTone(105, 0.22, "sawtooth", 0.15);
    playTone(62, 0.34, "triangle", 0.1);
    triggerDamageFlash(0.45);

    const enemyBlast = enemies.applyAreaDamage(
      event.position,
      new THREE.Vector3(0, 1, 0),
      radius,
      -1,
      maxDamage * 0.85,
      elapsed,
      Infinity
    );
    for (const kill of enemyBlast.kills || []) {
      applyKillRewards(kill.score, kill.xp, `${event.label || "Vehicle"} explosion`, kill.type);
    }

    for (const other of vehicles.getAllVehicles ? vehicles.getAllVehicles() : []) {
      if (!other || other.id === event.vehicleId) continue;
      const dist = other.mesh.position.distanceTo(event.position);
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const dmg = Math.max(0, maxDamage * chainMultiplier * falloff);
      if (dmg <= 0.05) continue;
      vehicles.applyDamage(other, dmg, elapsed, { fromExplosion: true });
    }

    const playerDist = player.position.distanceTo(event.position);
    if (playerDist <= radius) {
      const falloff = 1 - playerDist / radius;
      const dmg = Math.max(0, maxDamage * playerMultiplier * falloff);
      if (dmg > 0.05) {
        gameState.health = clamp(gameState.health - dmg, 0, gameState.maxHealth);
        emitGameEvent("player_damaged", { amount: dmg, source: "vehicle_explosion" });
        announce(`Explosion shockwave! -${Math.round(dmg)} HP`, {
          tone: "danger",
          priority: 2,
          hold: 1,
        });
        triggerDamageFlash(0.55);
      }
    }
  }
}

function performFlamethrowerAttack(elapsed) {
  const weapon = weaponDefs.flamethrower;
  const cooldownMultiplier = elapsed < gameState.effects.stimUntil ? 0.72 : 1;
  combatState.nextAttackAt = elapsed + weapon.cooldown * cooldownMultiplier;
  player.notifyWeaponFired?.(0.45, "flamethrower");

  player.getAimOrigin(aimOrigin);
  player.getAimDirection(aimDirection);
  player.getMuzzleOrigin(muzzleOrigin);

  const result = enemies.applyAreaDamage(
    muzzleOrigin,
    aimDirection,
    weapon.range,
    weapon.coneDot,
    weapon.damage,
    elapsed,
    weapon.maxHits
  );

  if (world.applyFireToCivilians) {
    const civ = world.applyFireToCivilians(muzzleOrigin, weapon.civilianRadius, 28, weapon.cooldown);
    if (civ.killed > 0) {
      announce(`Flames neutralized ${civ.killed} civilian${civ.killed > 1 ? "s" : ""}.`, {
        tone: "danger",
        priority: 2,
        hold: 1.6,
      });
    }
  }

  if (world.igniteTreesInRadius && elapsed >= combatState.nextTreeIgniteAt) {
    const trees = world.igniteTreesInRadius(muzzleOrigin, weapon.treeRadius);
    combatState.nextTreeIgniteAt = elapsed + (weapon.treeIgniteCooldown || 0.65);
    if (trees.ignited > 0) {
      announce("Tree ignited.", {
        tone: "warn",
        priority: 1,
        hold: 1.1,
      });
    }
  }

  for (const kill of result.kills) {
    applyKillRewards(kill.score, kill.xp, weapon.label, kill.type);
  }

  spawnFlameBurst(muzzleOrigin, aimDirection);
  if (Math.random() < 0.42) {
    playTone(weapon.toneMiss, 0.04, "sawtooth", 0.03);
  }
}

function performAttack(elapsed) {
  if (gameState.paused) return;

  if (gameState.inVehicle) {
    const activeVehicle = getActiveVehicle();
    if (!activeVehicle) return;
    if (elapsed < mountedWeaponState.nextFireAt) return;
    if (elapsed < mountedWeaponState.overheatUntil) return;

    mountedWeaponState.nextFireAt = elapsed + 1 / Math.max(0.1, mountedWeaponConfig.fireRate);
    mountedWeaponState.heat = Math.min(
      mountedWeaponConfig.maxHeat,
      mountedWeaponState.heat + mountedWeaponConfig.heatPerShot
    );

    if (mountedWeaponState.heat >= mountedWeaponConfig.maxHeat) {
      mountedWeaponState.overheatUntil = elapsed + mountedWeaponConfig.overheatDuration;
      announce("Mounted cannon overheated.", { tone: "warn", priority: 2, hold: 1.1 });
      playTone(180, 0.14, "sawtooth", 0.09);
      return;
    }

    const forward = vehicles.getForwardVector(activeVehicle, aimDirection);
    const origin = activeVehicle.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)).add(forward.clone().multiplyScalar(1.35));
    const spread = mountedWeaponConfig.spread;
    const shotDir = forward
      .clone()
      .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.5, (Math.random() - 0.5) * spread))
      .normalize();

    const hit = enemies.tryHitFromRay(
      origin,
      shotDir,
      mountedWeaponConfig.range,
      mountedWeaponConfig.damage,
      elapsed,
      mountedWeaponConfig.hitRadius
    );

    spawnMuzzleFlash(origin, 0x9fd7ff, 1.1);
    playTone(420, 0.05, "square", 0.06);

    if (hit.hit) {
      if (hit.killed) {
        applyKillRewards(hit.score, hit.xp, "Mounted Cannon", hit.type);
      } else {
        announce("Mounted hit confirmed.", { tone: "info", priority: 1, hold: 0.6 });
      }
    }
    return;
  }

  if (document.pointerLockElement !== canvas) {
    announce("Click the game to lock mouse before firing.", { tone: "warn", priority: 2, hold: 1.2 });
    return;
  }
  if (elapsed < combatState.nextAttackAt) return;

  const weapon = weaponDefs[weaponState.activeId] || weaponDefs.rifle;
  const handling = weaponHandlingDefs[weapon.id] || weaponHandlingDefs.rifle;

  if (weapon.id === "sniperPlayer" && !player.isAiming) {
    announce("Sniper requires RMB aim.", { tone: "warn", priority: 2, hold: 1.1 });
    return;
  }

  if (weapon.id === "flamethrower") {
    performFlamethrowerAttack(elapsed);
    return;
  }

  const cooldownMultiplier = elapsed < gameState.effects.stimUntil ? 0.72 : 1;
  combatState.nextAttackAt = elapsed + weapon.cooldown * cooldownMultiplier;
  const recoilProfile =
    weapon.id === "sniperPlayer"
      ? "sniper"
      : weapon.id === "shotgun"
        ? "shotgun"
        : weapon.id === "smg"
          ? "smg"
          : "rifle";
  player.notifyWeaponFired?.(weapon.id === "sniperPlayer" ? 1.15 : weapon.id === "shotgun" ? 1 : 0.72, recoilProfile);

  const currentHeat = weaponRuntime.heatById[weapon.id] || 0;
  const heatAfterShot = Math.min(handling.maxBloom, currentHeat + handling.bloomPerShot);
  weaponRuntime.heatById[weapon.id] = heatAfterShot;

  player.getAimOrigin(aimOrigin);
  player.getAimDirection(aimDirection);
  player.getMuzzleOrigin(muzzleOrigin);

  camera.getWorldDirection(centerRayDirection);
  cameraAimTarget.copy(camera.position).add(centerRayDirection.multiplyScalar(weapon.range));

  const shots = weapon.pellets || 1;
  const heatSpreadScale = 1 + heatAfterShot;
  const adsSpreadMultiplier = player.isAiming ? (weapon.id === "sniperPlayer" ? 0.18 : 0.62) : 1;
  const moveMagnitude = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / Math.max(0.001, player.sprintSpeed));
  const movingSpreadMultiplier = 1 + moveMagnitude * (player.isAiming ? 0.35 : 0.9);
  const sprintSpreadMultiplier = player.locomotionState === "sprint" ? 1.28 : 1;
  const spreadScalar = adsSpreadMultiplier * movingSpreadMultiplier * sprintSpreadMultiplier;
  for (let i = 0; i < shots; i++) {
    const spread = (weapon.spread || 0) * heatSpreadScale * spreadScalar;
    tempAimVector
      .copy(cameraAimTarget)
      .sub(muzzleOrigin)
      .normalize()
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        )
      )
      .normalize();

    if (weapon.id === "sniperPlayer") {
      const hit = enemies.tryHitFromRay(
        muzzleOrigin,
        tempAimVector,
        weapon.range,
        weapon.damage,
        elapsed,
        weapon.hitRadius || 0.28
      );
      if (hit.hit) {
        playTone(weapon.toneHit || 900, 0.06, "triangle", 0.1);
        if (hit.killed) {
          applyKillRewards(hit.score, hit.xp, weapon.label, hit.type);
        }
      } else {
        announce("Sniper shot missed.", { tone: "warn", priority: 1, hold: 0.7 });
      }
    } else {
      spawnPlayerProjectile(weapon, muzzleOrigin, tempAimVector);
    }
  }

  spawnMuzzleFlash(
    muzzleOrigin,
    weapon.projectileColor || (weapon.id === "sniperPlayer" ? 0xd8eeff : 0xffddaa),
    weapon.id === "shotgun" ? 1.35 : weapon.id === "sniperPlayer" ? 1.45 : 1
  );

  playTone(weapon.toneMiss, 0.05, "triangle", 0.05);
}

function performPunch(elapsed) {
  if (gameState.paused) return;
  if (gameState.inVehicle) return;
  const start = player.tryStartPunch(elapsed);
  if (!start) return;

  combatState.punch.active = true;
  combatState.punch.hitAt = start.hitAt;
  combatState.punch.endAt = start.endAt;
  combatState.punch.resolved = false;
  announce("Punch!", { tone: "info", priority: 1, hold: 0.6 });
  playTone(260, 0.06, "square", 0.06);
}

function updateWeaponStatus(elapsed) {
  if (gameState.inVehicle) {
    if (elapsed < mountedWeaponState.overheatUntil) {
      setWeaponStatus(`Mounted Cannon • OVERHEAT ${(mountedWeaponState.overheatUntil - elapsed).toFixed(1)}s`);
      return;
    }
    const cd = mountedWeaponState.nextFireAt - elapsed;
    setWeaponStatus(cd <= 0 ? "Mounted Cannon • Ready" : `Mounted Cannon • Cooldown ${cd.toFixed(2)}s`);
    return;
  }

  const weapon = weaponDefs[weaponState.activeId] || weaponDefs.rifle;
  const cd = combatState.nextAttackAt - elapsed;
  if (cd <= 0) {
    setWeaponStatus(`${weapon.label} • Ready`);
  } else {
    setWeaponStatus(`${weapon.label} • CD ${cd.toFixed(2)}s`);
  }
}

function setActiveWeapon(nextId, shouldAnnounce = true) {
  if (!weaponDefs[nextId]) return;
  if (!weaponState.unlocked[nextId]) return;
  weaponState.activeId = nextId;
  if (shouldAnnounce) {
    announce(`Weapon switched: ${weaponDefs[nextId].label}`, { tone: "info", priority: 1, hold: 1.1 });
  }
}

function cycleWeapon() {
  const unlocked = weaponState.order.filter((id) => weaponState.unlocked[id]);
  if (unlocked.length === 0) return;
  const i = unlocked.indexOf(weaponState.activeId);
  const next = unlocked[(i + 1 + unlocked.length) % unlocked.length];
  setActiveWeapon(next);
}

function xpForLevel(level) {
  return 70 + (level - 1) * 35;
}

function addXp(amount) {
  gameState.xp += amount;
  let leveled = false;
  while (gameState.xp >= xpForLevel(gameState.level)) {
    gameState.xp -= xpForLevel(gameState.level);
    gameState.level += 1;
    gameState.points += 1;
    leveled = true;
  }
  if (leveled) {
    playTone(660, 0.2, "triangle", 0.14);
    announce(`Level up! You are now level ${gameState.level}. Upgrade points: ${gameState.points}`, {
      tone: "good",
      priority: 2,
      hold: 1.8,
    });
  }
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
}

function applyUpgrade(slot) {
  if (gameState.points <= 0) {
    announce("No upgrade points available.", { tone: "warn", priority: 1, hold: 1.1 });
    return;
  }
  gameState.points -= 1;
  if (slot === 1) {
    gameState.upgrades.speed += 1;
    player.speed += 0.7;
    player.sprintSpeed += 1.1;
    announce("Upgrade applied: Speed + Sprint.", { tone: "good", priority: 1, hold: 1.2 });
  } else if (slot === 2) {
    gameState.upgrades.jump += 1;
    player.jumpPower += 0.55;
    announce("Upgrade applied: Jump power.", { tone: "good", priority: 1, hold: 1.2 });
  } else {
    gameState.upgrades.stamina += 1;
    gameState.maxStamina += 15;
    gameState.stamina = gameState.maxStamina;
    announce("Upgrade applied: Max stamina.", { tone: "good", priority: 1, hold: 1.2 });
  }
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
}

function useMedkit() {
  if (!inventorySystem.consumeConsumable("medkit", 1)) {
    announce("No medkits available.", { tone: "warn", priority: 1, hold: 1 });
    return;
  }
  const healAmount = 28;
  gameState.health = clamp(gameState.health + healAmount, 0, gameState.maxHealth);
  setHealth(gameState.health, gameState.maxHealth);
  updateInventoryUI();
  announce(`Used medkit (+${healAmount} HP).`, { tone: "good", priority: 1, hold: 1.1 });
  playTone(540, 0.12, "triangle", 0.1);
}

function useStim() {
  if (!inventorySystem.consumeConsumable("stim", 1)) {
    announce("No stim available.", { tone: "warn", priority: 1, hold: 1 });
    return;
  }

  gameState.effects.stimUntil = Math.max(gameState.effects.stimUntil, clock.elapsedTime + 12);
  gameState.stamina = clamp(gameState.stamina + 22, 0, gameState.maxStamina);
  setStamina(gameState.stamina, gameState.maxStamina);
  updateInventoryUI();
  announce("Stim injected: fire-rate and stamina recovery boosted.", { tone: "good", priority: 2, hold: 1.4 });
  playTone(760, 0.11, "triangle", 0.1);
}

function craftConsumable(type) {
  const result = inventorySystem.craftConsumable(type);
  if (!result.ok) {
    announce(`Craft failed: ${result.reason}`, { tone: "warn", priority: 1, hold: 1.2 });
    return;
  }
  missionSystem.onEvent("crafted_consumable", { count: 1, type });
  updateInventoryUI();
  announce(`Crafted ${type}.`, { tone: "good", priority: 1, hold: 1.1 });
  playTone(640, 0.08, "triangle", 0.09);
}

function useRepairKit(elapsed) {
  const targetVehicle = gameState.inVehicle
    ? getActiveVehicle()
    : vehicles.getNearestVehicle(player.position, vehicleCombatConfig.repairRange);
  if (!targetVehicle) {
    announce("No vehicle in repair range.", { tone: "warn", priority: 1, hold: 1 });
    return;
  }

  if (!inventorySystem.consumeConsumable("repairKit", 1)) {
    announce("No repair kit available.", { tone: "warn", priority: 1, hold: 1 });
    return;
  }

  const repair = vehicles.repairVehicle(targetVehicle, vehicleCombatConfig.repairAmount);
  if (!repair.ok) {
    inventorySystem.addConsumable("repairKit", 1);
    announce(`Repair failed: ${repair.reason}`, { tone: "warn", priority: 1, hold: 1.2 });
    return;
  }

  updateInventoryUI();
  const durability = vehicles.getDurability(targetVehicle);
  announce(
    `Repair complete: ${targetVehicle.label || "Vehicle"} ${Math.round(durability.health)}/${Math.round(durability.maxHealth)} HP.`,
    { tone: "good", priority: 2, hold: 1.4 }
  );
  playTone(560, 0.12, "triangle", 0.1);
}

function interactNearestWorldObject(elapsed) {
  const dist = player.position.distanceTo(supplyCache.position);
  if (dist > 3.4) {
    announce("No interactable nearby.", { tone: "warn", priority: 1, hold: 0.9 });
    return;
  }

  if (elapsed < supplyCache.cooldownUntil) {
    announce(`Supply cache recharging (${Math.ceil(supplyCache.cooldownUntil - elapsed)}s).`, {
      tone: "info",
      priority: 1,
      hold: 1,
    });
    return;
  }

  inventorySystem.addResource("scrap", 4);
  inventorySystem.addResource("alloy", 2);
  inventorySystem.addConsumable("stim", 1);
  updateInventoryUI();
  supplyCache.opened = true;
  supplyCache.cooldownUntil = elapsed + 35;
  announce("Supply cache looted: +4 scrap, +2 alloy, +1 stim.", { tone: "good", priority: 2, hold: 1.6 });
}

function setPaused(shouldPause) {
  gameState.paused = shouldPause;
  setPauseMenuVisible(shouldPause);
  if (shouldPause && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  announce(shouldPause ? "Paused." : "Resumed.", { tone: "info", priority: 2, hold: 1 });
}

function updateVehicleScoreLoop(vehicle, dt, elapsed) {
  if (!vehicle || !vehicle.driftState) {
    setVehicleHealth(0, 0, false);
    setVehicleStatus("On foot");
    return;
  }

  const explosionStage = vehicles.getExplosionStage ? vehicles.getExplosionStage(vehicle) : "intact";
  const durability = vehicles.getDurability ? vehicles.getDurability(vehicle) : null;
  const hpCurrent =
    explosionStage === "critical" || explosionStage === "burning" || explosionStage === "exploded" || explosionStage === "wreck"
      ? 0
      : Math.max(0, Math.round(durability?.health || 0));
  const hpMax = Math.max(1, Math.round(durability?.maxHealth || 1));
  setVehicleHealth(hpCurrent, hpMax, true);

  if (explosionStage === "critical") {
    setVehicleStatus(`${vehicle.label || "Vehicle"} • CRITICAL • Engine failing`);
    return;
  }
  if (explosionStage === "burning") {
    setVehicleStatus(`${vehicle.label || "Vehicle"} • BURNING • Evacuate now`);
    return;
  }
  if (explosionStage === "exploded" || explosionStage === "wreck") {
    setVehicleStatus(`${vehicle.label || "Vehicle"} • WRECKED`);
    return;
  }

  const hpText = durability
    ? `HP ${Math.round(durability.health)}/${Math.round(durability.maxHealth)}`
    : "HP --";

  if (durability && durability.destroyed) {
    const recover = Math.max(0, Number(vehicle.destroyedUntil) || 0);
    setVehicleStatus(`${vehicle.label || "Vehicle"} • DISABLED • ${recover.toFixed(1)}s • ${hpText}`);
    return;
  }

  const speed = Math.abs(vehicle.speed || 0);
  const intensity = clamp(vehicle.driftState.intensity || 0, 0, 1);
  const drifting = Boolean(vehicle.driftState.active) && intensity > 0.18 && speed > 4.5;

  if (drifting) {
    const earnRate = (2.2 + speed * 0.18) * (0.4 + intensity * 1.15);
    const gain = earnRate * dt * vehicleScoreState.combo;
    vehicleScoreState.bank += gain;
    vehicleScoreState.chainTimeLeft = 2.35;
    vehicleScoreState.payoutCooldown = 0.32;
    if (intensity > 0.6 && vehicleScoreState.combo < 8) {
      vehicleScoreState.combo += dt * 0.8;
    }

    if (vehicleScoreState.bank > vehicleScoreState.bestBank) {
      vehicleScoreState.bestBank = vehicleScoreState.bank;
    }

    const driftTiers = GAME_CONFIG.vehicles?.drift?.tiers || [];
    for (const tier of driftTiers) {
      const threshold = Number(tier.bank) || 0;
      if (threshold <= 0) continue;
      if (vehicleScoreState.bank >= threshold && !vehicleScoreState.tierAnnounced[tier.name]) {
        vehicleScoreState.tierAnnounced[tier.name] = true;
        announce(`Drift tier reached: ${tier.name}!`, { tone: "good", priority: 1, hold: 0.9 });
        playTone(820, 0.06, "triangle", 0.07);
      }
    }
  } else {
    vehicleScoreState.chainTimeLeft = Math.max(0, vehicleScoreState.chainTimeLeft - dt);
    vehicleScoreState.payoutCooldown = Math.max(0, vehicleScoreState.payoutCooldown - dt);
  }

  if (!drifting && vehicleScoreState.chainTimeLeft <= 0 && vehicleScoreState.bank >= 1 && vehicleScoreState.payoutCooldown <= 0) {
    const payoutScore = Math.round(vehicleScoreState.bank);
    const payoutXp = Math.max(1, Math.round(payoutScore * 0.35));
    gameState.score += payoutScore;
    addXp(payoutXp);
    missionSystem.onEvent("drift_bank_scored", { score: payoutScore });
    setScore(gameState.score);
    announce(`Drift banked! +${payoutScore} score, +${payoutXp} XP`, { tone: "good", priority: 1, hold: 1.15 });
    playTone(720, 0.08, "triangle", 0.08);
    vehicleScoreState.lifetimeDriftScore += payoutScore;

    vehicleScoreState.bank = 0;
    vehicleScoreState.combo = 1;
    vehicleScoreState.chainTimeLeft = 0;
    vehicleScoreState.tierAnnounced = Object.create(null);
  }

  const comboText = `x${Math.max(1, Math.floor(vehicleScoreState.combo))}`;
  const bankText = Math.round(vehicleScoreState.bank);
  if (drifting) {
    setVehicleStatus(`${vehicle.label || "Vehicle"} • Drifting ${comboText} • Bank ${bankText} • ${hpText}`);
  } else if (vehicleScoreState.bank >= 1 && vehicleScoreState.chainTimeLeft > 0) {
    setVehicleStatus(
      `${vehicle.label || "Vehicle"} • Chain ${comboText} • Bank ${bankText} • ${vehicleScoreState.chainTimeLeft.toFixed(1)}s • ${hpText}`
    );
  } else {
    setVehicleStatus(
      speed > 1 ? `${vehicle.label || "Vehicle"} • ${speed.toFixed(1)} m/s • ${hpText}` : `${vehicle.label || "Vehicle"} idle • ${hpText}`
    );
  }
}

function updateVehicleEnemyImpacts(vehicle, dt, elapsed) {
  if (!vehicle) return;

  const stage = vehicles.getExplosionStage ? vehicles.getExplosionStage(vehicle) : "intact";
  if (stage === "burning" || stage === "exploded" || stage === "wreck") return;

  const impact = enemies.applyVehicleImpact(vehicle, elapsed, {
    minSpeed: 5,
    runOverSpeed: 10.5,
    hitCooldown: 0.45,
    radius: 1.3,
  });

  if (!impact || impact.hitCount <= 0) return;

  const bump = clamp(impact.impactStrength || 0.12, 0.08, 0.36);
  const forward = vehicles.getForwardVector(vehicle);
  vehicle.mesh.position.addScaledVector(forward, -0.16 * bump);
  vehicle.speed *= 1 - bump * 0.9;

  for (const kill of impact.kills || []) {
    applyKillRewards(kill.score, kill.xp, `${vehicle.label || "Vehicle"} run-over`, kill.type);
  }

  if (impact.nonLethalHits > 0 && elapsed >= uiState.nextVehicleImpactAnnounceAt) {
    announce("Impact! Enemy hit by vehicle.", { tone: "warn", priority: 1, hold: 0.8 });
    uiState.nextVehicleImpactAnnounceAt = elapsed + 0.6;
  }

  playTone(160 + bump * 120, 0.05, "sawtooth", 0.06 + bump * 0.03);

  const selfDamage = impact.hitCount * 1.3 + bump * 12;
  if (selfDamage > 0) {
    const damaged = vehicles.applyDamage(vehicle, selfDamage, elapsed, {
      recoverySeconds: vehicleCombatConfig.destroyRecoverySeconds,
    });
    if (damaged.destroyed) {
      announce(`${vehicle.label || "Vehicle"} disabled by impact!`, { tone: "danger", priority: 3, hold: 1.5 });
      playTone(120, 0.2, "sawtooth", 0.12);
    }
  }
}

function toggleInventoryPanel() {
  gameState.inventoryPanelOpen = !gameState.inventoryPanelOpen;
  setInventoryPanelVisible(gameState.inventoryPanelOpen);
}

function toggleControlsPanel() {
  gameState.controlsPanelOpen = !gameState.controlsPanelOpen;
  setControlsPanelVisible(gameState.controlsPanelOpen);
}

function buildSaveState() {
  const elapsedNow = clock ? clock.elapsedTime : 0;
  const stimRemaining = Math.max(0, gameState.effects.stimUntil - elapsedNow);
  const supplyCacheCooldownRemaining = Math.max(0, supplyCache.cooldownUntil - elapsedNow);

  return {
    position: player.getPositionArray(),
    collectedIds: collectibles.getCollectedList(),
    enemies: enemies.getSaveState(),
    score: gameState.score,
    health: gameState.health,
    maxHealth: gameState.maxHealth,
    stamina: gameState.stamina,
    maxStamina: gameState.maxStamina,
    level: gameState.level,
    xp: gameState.xp,
    points: gameState.points,
    upgrades: gameState.upgrades,
    mission: missionSystem.getSaveState(),
    inventory: inventorySystem.getSaveState(),
    combat: {
      nextAttackAt: combatState.nextAttackAt,
    },
    settings: gameState.settings,
    effects: {
      stimRemaining,
    },
    playerState: {
      inVehicle: gameState.inVehicle,
      activeVehicleId: gameState.activeVehicleId,
    },
    weapons: {
      activeId: weaponState.activeId,
      unlocked: weaponState.unlocked,
    },
    vehicles: vehicles.getSaveState(),
    vehicleProgress: {
      bestBank: Math.round(vehicleScoreState.bestBank),
      lifetimeDriftScore: Math.round(vehicleScoreState.lifetimeDriftScore),
    },
    world: world.getDynamicState ? world.getDynamicState() : null,
    worldObjects: {
      supplyCache: {
        id: supplyCache.id,
        opened: supplyCache.opened,
        cooldownRemaining: supplyCacheCooldownRemaining,
      },
    },
  };
}

function performSave() {
  saveGame(buildSaveState());
  announce("Game saved.", { tone: "good", priority: 1, hold: 0.9 });
}

function buildMissionStateFromLegacyObjective(legacyObjective) {
  if (!legacyObjective) return null;
  const tier = Math.max(1, numberOr(legacyObjective.tier, 1));
  const target = Math.max(1, numberOr(legacyObjective.target, 3));
  const timeLimit = Math.max(10, numberOr(legacyObjective.timeLimit, 45));
  const progress = Math.max(0, numberOr(legacyObjective.collected, 0));
  const rewardScore = Math.max(1, numberOr(legacyObjective.rewardScore, 10));
  const rewardXp = Math.max(1, numberOr(legacyObjective.rewardXp, 40));

  return {
    tier,
    templateIndex: 0,
    activeMission: {
      title: "Crystal Sweep",
      type: "collect",
      target,
      progress,
      timeLimit,
      timeLeft: clamp(numberOr(legacyObjective.timeLeft, timeLimit), 0, timeLimit),
      rewardScore,
      rewardXp,
    },
  };
}

function performLoad() {
  const data = loadGame();
  if (!data) {
    announce("No save found.", { tone: "warn", priority: 2, hold: 1.2 });
    return;
  }

  const saveVersion = Number(data.meta?.version) || 1;
  if (saveVersion > GAME_CONFIG.save.version) {
    announce("Save was created with a newer game version. Loading with compatibility mode.", {
      tone: "warn",
      priority: 2,
      hold: 2,
    });
  }

  if (Array.isArray(data.position) && data.position.length === 3) {
    player.setPosition(data.position[0], data.position[1], data.position[2]);
  }
  collectibles.applyCollectedList(data.collectedIds || []);
  enemies.applySaveState(data.enemies || [], 0);
  if (world.applyDynamicState) {
    world.applyDynamicState(data.world || null);
  }
  vehicles.applySaveState(data.vehicles || []);

  gameState.score = Number(data.score) || 0;
  gameState.maxHealth = Math.max(1, numberOr(data.maxHealth, 100));
  gameState.health = clamp(numberOr(data.health, gameState.maxHealth), 0, gameState.maxHealth);
  gameState.maxStamina = Math.max(1, numberOr(data.maxStamina, 100));
  gameState.stamina = clamp(numberOr(data.stamina, gameState.maxStamina), 0, gameState.maxStamina);
  gameState.level = Math.max(1, numberOr(data.level, 1));
  gameState.xp = Math.max(0, numberOr(data.xp, 0));
  gameState.points = Math.max(0, numberOr(data.points, 0));

  const upgrades = data.upgrades || {};
  gameState.upgrades = {
    speed: Math.max(0, numberOr(upgrades.speed, 0)),
    jump: Math.max(0, numberOr(upgrades.jump, 0)),
    stamina: Math.max(0, numberOr(upgrades.stamina, 0)),
  };

  player.speed = 8 + gameState.upgrades.speed * 0.7;
  player.sprintSpeed = 13 + gameState.upgrades.speed * 1.1;
  player.jumpPower = 9 + gameState.upgrades.jump * 0.55;

  inventorySystem.applySaveState(data.inventory || null);
  missionSystem.applySaveState(data.mission || buildMissionStateFromLegacyObjective(data.objective));

  const loadedSettings = data.settings || {};
  gameState.settings = {
    sensitivity: clamp(numberOr(loadedSettings.sensitivity, 1), 0.4, 2.2),
    volume: clamp(numberOr(loadedSettings.volume, 0.4), 0, 1),
    mute: Boolean(loadedSettings.mute),
  };

  const loadedEffects = data.effects || {};
  const nowElapsed = clock ? clock.elapsedTime : 0;
  gameState.effects = {
    stimUntil: nowElapsed + Math.max(0, numberOr(loadedEffects.stimRemaining, 0)),
  };
  player.setLookSensitivity(gameState.settings.sensitivity);
  if (sensitivityInput) sensitivityInput.value = String(gameState.settings.sensitivity);
  if (volumeInput) volumeInput.value = String(gameState.settings.volume);
  if (muteInput) muteInput.checked = gameState.settings.mute;
  ensureAudio();
  updateAudioSettings();

  const loadedWeapons = data.weapons || {};
  const loadedUnlocked = loadedWeapons.unlocked || {};
  weaponState.unlocked = {
    rifle: loadedUnlocked.rifle !== false,
    shotgun: loadedUnlocked.shotgun !== false,
    pulse: loadedUnlocked.pulse !== false,
    smg: loadedUnlocked.smg !== false,
    sniperPlayer: loadedUnlocked.sniperPlayer !== false,
    flamethrower: loadedUnlocked.flamethrower !== false,
  };
  const loadedActive = typeof loadedWeapons.activeId === "string" ? loadedWeapons.activeId : "rifle";
  setActiveWeapon(loadedActive, false);
  if (!weaponState.unlocked[weaponState.activeId]) {
    setActiveWeapon("rifle", false);
  }

  const loadedCombat = data.combat || {};
  combatState.nextAttackAt = Math.max(0, numberOr(loadedCombat.nextAttackAt, 0));

  const loadedVehicleProgress = data.vehicleProgress || {};
  vehicleScoreState.bestBank = Math.max(0, numberOr(loadedVehicleProgress.bestBank, 0));
  vehicleScoreState.lifetimeDriftScore = Math.max(0, numberOr(loadedVehicleProgress.lifetimeDriftScore, 0));
  vehicleScoreState.bank = 0;
  vehicleScoreState.combo = 1;
  vehicleScoreState.chainTimeLeft = 0;
  vehicleScoreState.payoutCooldown = 0;
  vehicleScoreState.tierAnnounced = Object.create(null);

  const loadedPlayerState = data.playerState || {};
  gameState.inVehicle = Boolean(loadedPlayerState.inVehicle);
  gameState.activeVehicleId =
    typeof loadedPlayerState.activeVehicleId === "string" ? loadedPlayerState.activeVehicleId : null;

  const loadedVehicle = getActiveVehicle();
  const loadedVehicleStage = loadedVehicle && vehicles.getExplosionStage
    ? vehicles.getExplosionStage(loadedVehicle)
    : "intact";

  const loadedWorldObjects = data.worldObjects || {};
  if (loadedWorldObjects.supplyCache) {
    const loadedCache = loadedWorldObjects.supplyCache;
    supplyCache.opened = Boolean(loadedCache.opened);
    supplyCache.cooldownUntil = nowElapsed + Math.max(0, numberOr(loadedCache.cooldownRemaining, 0));
  }
  if (
    gameState.inVehicle &&
    loadedVehicle &&
    loadedVehicleStage !== "burning" &&
    loadedVehicleStage !== "exploded" &&
    loadedVehicleStage !== "wreck"
  ) {
    player.avatarRoot.visible = false;
    player.position.copy(loadedVehicle.mesh.position).add(new THREE.Vector3(0, 1.6, 0));
    vehicleCameraState.initialized = false;
  } else {
    gameState.inVehicle = false;
    gameState.activeVehicleId = null;
    player.avatarRoot.visible = true;
  }

  for (const projectile of playerProjectiles) {
    scene.remove(projectile.mesh);
  }
  playerProjectiles.length = 0;
  for (const burst of flameBursts) {
    scene.remove(burst.mesh);
  }
  flameBursts.length = 0;
  for (const puff of driftPuffs) {
    scene.remove(puff.mesh);
  }
  driftPuffs.length = 0;
  for (const plume of vehicleSmokePlumes) {
    scene.remove(plume.mesh);
  }
  vehicleSmokePlumes.length = 0;
  for (const debris of explosionDebris) {
    scene.remove(debris.mesh);
  }
  explosionDebris.length = 0;
  driftAudioState.nextAt = 0;

  setScore(gameState.score);
  setHealth(gameState.health, gameState.maxHealth);
  setStamina(gameState.stamina, gameState.maxStamina);
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
  updateInventoryUI();
  setObjective(missionSystem.getObjectiveText());
  updateWeaponStatus(clock.elapsedTime);
  setBlackoutOverlay(0);
  voidRespawnState.active = false;
  voidRespawnState.until = 0;
  announce("Game loaded.", { tone: "good", priority: 2, hold: 1.2 });
}

window.addEventListener("keydown", (e) => {
  if ((e.code === "ControlLeft" || e.code === "ControlRight") && !e.repeat) {
    toggleControlsPanel();
    return;
  }

  if (e.code === "F3") {
    uiState.debugEnabled = !uiState.debugEnabled;
    setDebugOverlayVisible(uiState.debugEnabled);
    announce(uiState.debugEnabled ? "Debug overlay enabled." : "Debug overlay disabled.", {
      tone: "info",
      priority: 1,
      hold: 0.8,
    });
    return;
  }

  if (e.code === "KeyP") {
    setPaused(!gameState.paused);
    return;
  }

  if (e.code === "KeyK") {
    performSave();
  } else if (e.code === "KeyL") {
    performLoad();
  } else if (e.code === "KeyR") {
    resetSave();
    announce("Save reset.", { tone: "warn", priority: 2, hold: 1.2 });
  } else if (e.code === "KeyQ") {
    cycleWeapon();
  } else if (e.code === "KeyI") {
    toggleInventoryPanel();
  } else if (e.code === "KeyH") {
    useMedkit();
  } else if (e.code === "KeyJ") {
    useStim();
  } else if (e.code === "KeyC") {
    craftConsumable("medkit");
  } else if (e.code === "KeyX") {
    craftConsumable("stim");
  } else if (e.code === "KeyZ") {
    craftConsumable("repairKit");
  } else if (e.code === "KeyU") {
    useRepairKit(clock.elapsedTime);
  } else if (e.code === "Digit1") {
    applyUpgrade(1);
  } else if (e.code === "Digit2") {
    applyUpgrade(2);
  } else if (e.code === "Digit3") {
    applyUpgrade(3);
  } else if (e.code === "KeyE") {
    enterNearestVehicle();
  } else if (e.code === "KeyB") {
    if (!gameState.inVehicle) return;
    const active = getActiveVehicle();
    if (!active) return;
    const on = vehicles.toggleHeadlights ? vehicles.toggleHeadlights(active) : false;
    announce(on ? "Headlights on." : "Headlights off.", { tone: "info", priority: 1, hold: 0.9 });
  } else if (e.code === "KeyF") {
    performPunch(clock.elapsedTime);
  } else if (e.code === "KeyY") {
    const doorResult = world.toggleNearestDoor ? world.toggleNearestDoor(player.position) : null;
    if (doorResult) announce(doorResult.message, { tone: "info", priority: 1, hold: 1 });
  } else if (e.code === "KeyT") {
    interactNearestWorldObject(clock.elapsedTime);
  }
});

canvas.addEventListener("click", () => {
  ensureAudio();
  if (!gameState.paused && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    announce("Mouse locked.", { tone: "info", priority: 1, hold: 0.8 });
  }
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

window.addEventListener("mousedown", (e) => {
  if (e.button === 0) {
    inputState.primaryDown = true;
    performAttack(clock.elapsedTime);
  }
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) {
    inputState.primaryDown = false;
  }
});

if (sensitivityInput) {
  sensitivityInput.addEventListener("input", (e) => {
    gameState.settings.sensitivity = clamp(Number(e.target.value) || 1, 0.4, 2.2);
    player.setLookSensitivity(gameState.settings.sensitivity);
  });
  player.setLookSensitivity(gameState.settings.sensitivity);
}

if (volumeInput) {
  volumeInput.addEventListener("input", (e) => {
    gameState.settings.volume = clamp(Number(e.target.value) || 0.4, 0, 1);
    ensureAudio();
    updateAudioSettings();
  });
}

if (muteInput) {
  muteInput.addEventListener("change", (e) => {
    gameState.settings.mute = Boolean(e.target.checked);
    ensureAudio();
    updateAudioSettings();
  });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(0.05, clock.getDelta());
  const elapsed = clock.elapsedTime;

  if (voidRespawnState.active) {
    setBlackoutOverlay(1);
    if (elapsed >= voidRespawnState.until) {
      completeVoidRespawn();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
    return;
  }

  const sniperScoped = weaponState.activeId === "sniperPlayer" && player.isAiming;
  const targetFov = sniperScoped ? 34 : 70;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();
  setSniperScopeActive(sniperScoped);

  const dayNight = world.getDayNightState(elapsed);
  world.updateDayNight(elapsed, sun, hemi);

  if (!gameState.paused) {
    for (const [weaponId, heat] of Object.entries(weaponRuntime.heatById)) {
      const handling = weaponHandlingDefs[weaponId] || weaponHandlingDefs.rifle;
      weaponRuntime.heatById[weaponId] = Math.max(0, heat - handling.bloomDecayPerSec * dt);
    }

    mountedWeaponState.heat = Math.max(0, mountedWeaponState.heat - mountedWeaponConfig.coolPerSecond * dt);
    if (elapsed >= mountedWeaponState.overheatUntil && mountedWeaponState.heat <= mountedWeaponConfig.resumeHeatThreshold) {
      mountedWeaponState.overheatUntil = 0;
    }

    if (world.updateDoors) {
      world.updateDoors(dt);
    }

    vehicles.update(dt, (vehicleId) => {
      if (!gameState.inVehicle) return null;
      if (vehicleId !== gameState.activeVehicleId) return null;
      return getVehicleControlsFromPlayerKeys();
    }, elapsed);
    vehicles.resolveInterVehicleCollisions?.(gameState.activeVehicleId);
    processVehicleExplosionEvents(elapsed);

    if (gameState.inVehicle) {
      const activeVehicle = getActiveVehicle();
      if (activeVehicle) {
        const voidLimit = world.worldSize * 0.5 + 12;
        if (
          Math.abs(activeVehicle.mesh.position.x) > voidLimit ||
          Math.abs(activeVehicle.mesh.position.z) > voidLimit ||
          activeVehicle.mesh.position.y < -28
        ) {
          startVoidRespawn(elapsed, "Vehicle left the world");
        }

        const activeVehicleStage = vehicles.getExplosionStage ? vehicles.getExplosionStage(activeVehicle) : "intact";
        if (activeVehicleStage === "burning" || activeVehicleStage === "exploded" || activeVehicleStage === "wreck") {
          exitVehicle();
          announce("Vehicle catastrophic failure. Auto-eject!", {
            tone: "danger",
            priority: 3,
            hold: 1.2,
          });
          triggerDamageFlash(0.35);
        }
        updateVehicleDriftFeedback(activeVehicle, dt, elapsed);
        updateVehicleEnemyImpacts(activeVehicle, dt, elapsed);
        updateVehicleScoreLoop(activeVehicle, dt, elapsed);
      }
    } else {
      updateVehicleScoreLoop(null, dt, elapsed);
    }

    let playerResult;
    if (gameState.inVehicle) {
      const activeVehicle = getActiveVehicle();
      if (activeVehicle) {
        player.position.copy(activeVehicle.mesh.position).add(new THREE.Vector3(0, 1.6, 0));
        updateVehicleCamera(activeVehicle, dt);
        playerResult = {
          landed: false,
          fallSpeed: 0,
          sprinting: false,
          hasMoveInput: false,
          isAiming: false,
        };
      } else {
        gameState.inVehicle = false;
        gameState.activeVehicleId = null;
        player.avatarRoot.visible = true;
        playerResult = player.update(dt);
      }
    } else {
      playerResult = player.update(dt);
      if (elapsed >= uiState.nextVehicleHintAt) {
        const nearVehicle = vehicles.getNearestVehicle(player.position, GAME_CONFIG.vehicles.hintRange);
        if (nearVehicle) {
          announce("Press E to enter vehicle.", { tone: "info", priority: 1, hold: 0.9 });
          uiState.nextVehicleHintAt = elapsed + GAME_CONFIG.vehicles.hintCooldown;
        }
      }
    }

    updatePlayerProjectiles(dt, elapsed);
    updateMuzzleFlashes(dt);
    updateFlameBursts(dt);
    updateDriftPuffs(dt);
    updateVehicleSmokePlumes(dt);
    updateExplosionDebris(dt);
    if (world.updateTrees) world.updateTrees(dt);
    updateAmbientTraffic(dt);

    for (const vehicle of vehicles.getAllVehicles ? vehicles.getAllVehicles() : []) {
      const stage = vehicles.getExplosionStage ? vehicles.getExplosionStage(vehicle) : "intact";
      if (stage !== "critical" && stage !== "burning") continue;
      const smokeChance = (stage === "burning" ? 0.85 : 0.48) * dt * 10;
      if (Math.random() < smokeChance) {
        spawnVehicleSmoke(vehicle.mesh.position, stage);
      }
    }

    if (
      !gameState.inVehicle &&
      inputState.primaryDown &&
      (weaponState.activeId === "flamethrower" || weaponState.activeId === "smg") &&
      document.pointerLockElement === canvas
    ) {
      performAttack(elapsed);
    }

    if (gameState.inVehicle && inputState.primaryDown) {
      performAttack(elapsed);
    }

    if (!playerResult.sprinting) {
      const regen = playerResult.hasMoveInput ? 12 : 22;
      gameState.stamina = clamp(gameState.stamina + regen * dt, 0, gameState.maxStamina);
    }

    if (playerResult.landed && playerResult.fallSpeed > 13.5) {
      const impact = Math.max(0, (playerResult.fallSpeed - 13.5) * 5.5);
      gameState.health = clamp(gameState.health - impact, 0, gameState.maxHealth);
      announce(`Hard landing! -${Math.round(impact)} HP`, { tone: "danger", priority: 2, hold: 1.3 });
      triggerDamageFlash(0.42);
      playTone(150, 0.2, "sawtooth", 0.1);
    }

    const zoneDamage = world.getHazardDamageAt(player.position.x, player.position.z, dt);
    if (zoneDamage > 0) {
      gameState.health = clamp(gameState.health - zoneDamage, 0, gameState.maxHealth);
      triggerDamageFlash(0.18);
      if (Math.random() < 0.08) {
        playTone(180, 0.08, "square", 0.06);
      }
    }


    const activeVehicleForDamage = getActiveVehicle();
    const enemyResult = enemies.update(dt, elapsed, player.position, {
      isNight: dayNight.isNight,
      inVehicle: gameState.inVehicle,
      vehicle: activeVehicleForDamage,
      vehicleHitRadius: vehicleCombatConfig.projectileHitRadius,
    });

    if (enemyResult.vehicleDamage > 0 && gameState.inVehicle && activeVehicleForDamage) {
      const damageResult = vehicles.applyDamage(activeVehicleForDamage, enemyResult.vehicleDamage, elapsed, {
        recoverySeconds: vehicleCombatConfig.destroyRecoverySeconds,
      });
      if (enemyResult.hitVehicleByProjectile) {
        announce(`Vehicle hit! -${Math.round(enemyResult.vehicleDamage)} durability`, {
          tone: "danger",
          priority: 2,
          hold: 1,
        });
      }
      if (damageResult.destroyed) {
        announce("Vehicle disabled! Hold position until systems recover.", {
          tone: "danger",
          priority: 3,
          hold: 1.8,
        });
        playTone(110, 0.25, "sawtooth", 0.13);
      }
      triggerDamageFlash(0.24);
    }

    if (enemyResult.playerDamage > 0) {
      gameState.health = clamp(gameState.health - enemyResult.playerDamage, 0, gameState.maxHealth);
      emitGameEvent("player_damaged", {
        amount: enemyResult.playerDamage,
        source: enemyResult.hitByProjectile ? "projectile" : "melee",
      });
      if (enemyResult.hitByProjectile) {
        announce(`Hit by projectile! -${Math.round(enemyResult.playerDamage)} HP`, {
          tone: "danger",
          priority: 2,
          hold: 1.2,
        });
      }
      triggerDamageFlash(0.5);
      playTone(165, 0.09, "square", 0.07);
    }

    if (combatState.punch.active && !combatState.punch.resolved && elapsed >= combatState.punch.hitAt) {
      const query = player.getPunchQuery(punchOrigin, punchDirection);
      const hit = enemies.tryHitFromMelee(query.origin, query.direction, 2.3, 26, elapsed, 0.4);
      if (hit.hit) {
        if (hit.killed) {
          applyKillRewards(hit.score, hit.xp, "Punch", hit.type);
        } else {
          announce("Punch connected.", { tone: "info", priority: 1, hold: 0.7 });
        }
        playTone(480, 0.05, "square", 0.08);
      } else {
        announce("Punch missed.", { tone: "warn", priority: 1, hold: 0.7 });
      }
      combatState.punch.resolved = true;
    }
    if (combatState.punch.active && elapsed >= combatState.punch.endAt) {
      combatState.punch.active = false;
    }

    if (enemyResult.nightRushActive && !combatState.nightRushAnnounced) {
      combatState.nightRushAnnounced = true;
      announce("Night rush! Enemies are swarming your position.", { tone: "warn", priority: 2, hold: 1.8 });
      playTone(250, 0.22, "sawtooth", 0.13);
    } else if (!enemyResult.nightRushActive && combatState.nightRushAnnounced) {
      combatState.nightRushAnnounced = false;
      if (dayNight.isNight) {
        announce("Rush wave ended. Stay alert for another attack tonight.", {
          tone: "info",
          priority: 1,
          hold: 1.4,
        });
      } else {
        announce("Dawn breaks. Enemy rushes have ended.", { tone: "good", priority: 1, hold: 1.4 });
      }
    }

    const rewards = collectibles.update(elapsed, player.position);
    if (rewards.count > 0) {
      gameState.score += rewards.score;
      addXp(rewards.xp);

      if (rewards.heal > 0) {
        gameState.health = clamp(gameState.health + rewards.heal, 0, gameState.maxHealth);
      }

      inventorySystem.addResource("scrap", rewards.inventory.scrap);
      inventorySystem.addResource("crystal", rewards.inventory.crystal);
      inventorySystem.addResource("alloy", rewards.inventory.alloy);
      inventorySystem.addConsumable("medkit", rewards.inventory.medkit);
      inventorySystem.addConsumable("stim", rewards.inventory.stim);
      inventorySystem.addConsumable("repairKit", rewards.inventory.repairKit);
      missionSystem.onEvent("collectible_collected", { count: rewards.count });

      setScore(gameState.score);
      updateInventoryUI();
      announce(`Collected +${rewards.score} score, +${rewards.xp} XP`, {
        tone: "good",
        priority: 1,
        hold: 1,
      });
      playTone(rewards.rareCount > 0 ? 820 : 520, 0.15, "triangle", 0.12);
    }

    const missionResult = missionSystem.update(dt);
    applyMissionResult(missionResult);

    if (world.updateCivilians) {
      world.updateCivilians(dt, elapsed);
    }

    if (gameState.health <= 0) {
      gameState.health = gameState.maxHealth;
      gameState.stamina = gameState.maxStamina;
      player.setPosition(0, world.getHeightAtDetailed(0, 0, world.getHeightAt(0, 0)) + 1.6, 0);
      announce("You were downed! Respawned at origin.", { tone: "danger", priority: 3, hold: 2 });
      playTone(120, 0.3, "square", 0.13);
    }

    if (!gameState.inVehicle && player.position.y < -36) {
      startVoidRespawn(elapsed, "You fell off the world");
    }

    setHealth(gameState.health, gameState.maxHealth);

    if (elapsed < gameState.effects.stimUntil) {
      gameState.stamina = clamp(gameState.stamina + 14 * dt, 0, gameState.maxStamina);
    }

    setStamina(gameState.stamina, gameState.maxStamina);
    updateCombatStatus(elapsed);
    updateWeaponStatus(elapsed);

    if (elapsed < gameState.effects.stimUntil) {
      setEffectsStatus(`Stim (${Math.ceil(gameState.effects.stimUntil - elapsed)}s)`);
    } else {
      setEffectsStatus("None");
    }

    const cacheDist = player.position.distanceTo(supplyCache.position);
    if (cacheDist <= 3.6) {
      if (elapsed < supplyCache.cooldownUntil) {
        setInteractionHint(`Supply cache recharging (${Math.ceil(supplyCache.cooldownUntil - elapsed)}s)`);
      } else {
        setInteractionHint("Press T to loot supply cache");
      }
    } else {
      setInteractionHint("");
    }

    const activeWeaponId = weaponState.activeId;
    let uiHeatValue = 0;
    if (gameState.inVehicle) {
      uiHeatValue = mountedWeaponState.heat;
      setWeaponHeat(uiHeatValue, mountedWeaponConfig.maxHeat || 1);
    } else {
      const activeHandling = weaponHandlingDefs[activeWeaponId] || weaponHandlingDefs.rifle;
      uiHeatValue = weaponRuntime.heatById[activeWeaponId] || 0;
      setWeaponHeat(uiHeatValue, activeHandling.maxBloom || 1);
    }

    const crosshairMove = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / Math.max(0.001, player.sprintSpeed));
    const crosshairSpread =
      3 +
      uiHeatValue * 10 +
      crosshairMove * (player.isAiming ? 1.8 : 5.4) +
      (player.locomotionState === "sprint" ? 2.2 : 0);
    setCrosshairSpread(crosshairSpread, player.isAiming);

    const healthPct = gameState.maxHealth > 0 ? gameState.health / gameState.maxHealth : 1;
    const lowHpPulse = healthPct < 0.35 ? (0.35 - healthPct) * (0.35 + 0.2 * Math.sin(elapsed * 6)) : 0;
    uiState.damageFlash = Math.max(0, uiState.damageFlash - dt * 1.8);
    setDamageOverlay(Math.max(uiState.damageFlash, lowHpPulse));

    if (uiState.debugEnabled && elapsed >= uiState.nextDebugRefreshAt) {
      const activeVehicle = getActiveVehicle();
      const lines = [
        `FPS ~ ${(1 / Math.max(0.0001, dt)).toFixed(0)} | dt ${dt.toFixed(3)} | t ${elapsed.toFixed(1)}`,
        `Player xyz: ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}`,
        `Locomotion: ${playerResult.previousLocomotionState || "n/a"} -> ${playerResult.locomotionState || "n/a"} (${(playerResult.speedNormalized || 0).toFixed(2)})`,
        `Blend ${(playerResult.locomotionBlend || 0).toFixed(2)} | stateTime ${(playerResult.locomotionStateTime || 0).toFixed(2)}s | aiming ${playerResult.isAiming ? "yes" : "no"}`,
        `CamKick x:${(playerResult.cameraKickX || 0).toFixed(3)} y:${(playerResult.cameraKickY || 0).toFixed(3)} | landing ${(playerResult.cameraLandingImpulse || 0).toFixed(3)} | profile ${playerResult.cameraKickProfile || "default"}#${playerResult.recoilPatternIndex ?? 0}`,
        `WeaponHeat ${weaponState.activeId}: ${(weaponRuntime.heatById[weaponState.activeId] || 0).toFixed(2)}`,
        `HP ${gameState.health.toFixed(0)}/${gameState.maxHealth} | Stamina ${gameState.stamina.toFixed(0)}/${gameState.maxStamina}`,
        `Vehicle: ${gameState.inVehicle ? gameState.activeVehicleId : "none"}${activeVehicle ? ` | speed ${activeVehicle.speed.toFixed(2)}` : ""}`,
        `Telemetry: kills ${telemetry.kills} | dmg ${telemetry.damageTaken.toFixed(0)} | enter ${telemetry.vehiclesEntered} | exit ${telemetry.vehiclesExited}`,
      ];
      setDebugText(lines.join("\n"));
      uiState.nextDebugRefreshAt = elapsed + GAME_CONFIG.debug.refreshInterval;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

announce("Explore, survive, fight enemies. LMB attack. Y door, I inventory, H medkit.", {
  tone: "info",
  priority: 1,
  hold: 2,
});
animate();