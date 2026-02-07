import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { createWorld } from "./world.js";
import { PlayerController } from "./player.js";
import { CollectibleSystem } from "./collectibles.js";
import { EnemySystem } from "./enemies.js";
import { loadGame, resetSave, saveGame } from "./save.js";
import { MissionSystem } from "./systems/missions.js";
import { InventorySystem } from "./systems/inventory.js";
import {
  setCombatStatus,
  setHealth,
  setInventoryPanelVisible,
  setInventorySummary,
  setObjective,
  setPauseMenuVisible,
  setProgression,
  setScore,
  setStamina,
  setStatus,
  setWeaponStatus,
} from "./ui.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  inventoryPanelOpen: false,
  settings: {
    sensitivity: 1,
    volume: 0.4,
    mute: false,
  },
};

const missionSystem = new MissionSystem();
const inventorySystem = new InventorySystem();

const player = new PlayerController(camera, world.getHeightAt, {
  scene,
  cameraCollisionMeshes: world.cameraCollisionMeshes,
  getHeightAtDetailed: world.getHeightAtDetailed,
  resolveHorizontalCollision: world.resolveHorizontalCollision,
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

const enemies = new EnemySystem(scene, world.getHeightAt, world.worldSize, {
  getHeightAtDetailed: world.getHeightAtDetailed,
  resolveHorizontalCollision: world.resolveHorizontalCollision,
});
enemies.spawn(12);

const combatState = {
  nextAttackAt: 0,
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
};

const weaponState = {
  order: ["rifle", "shotgun", "pulse"],
  activeId: "rifle",
  unlocked: {
    rifle: true,
    shotgun: true,
    pulse: true,
  },
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

function updateInventoryUI() {
  setInventorySummary(inventorySystem.getSummaryText());
  const scrap = document.getElementById("invScrap");
  const crystal = document.getElementById("invCrystal");
  const medkit = document.getElementById("invMedkit");
  if (scrap) scrap.textContent = String(inventorySystem.resources.scrap);
  if (crystal) crystal.textContent = String(inventorySystem.resources.crystal);
  if (medkit) medkit.textContent = String(inventorySystem.consumables.medkit);
}

function applyMissionResult(missionResult) {
  if (!missionResult) return;

  setObjective(missionResult.objectiveText || missionSystem.getObjectiveText());

  if (missionResult.state === "completed") {
    gameState.score += missionResult.reward.score;
    addXp(missionResult.reward.xp);
    setScore(gameState.score);
    setStatus(missionResult.message);
    playTone(930, 0.2, "triangle", 0.16);
  } else if (missionResult.state === "failed") {
    setStatus(missionResult.message);
    playTone(220, 0.25, "sawtooth", 0.12);
  }
}

setScore(gameState.score);
setHealth(gameState.health, gameState.maxHealth);
setStamina(gameState.stamina, gameState.maxStamina);
setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
setCombatStatus("Ready");
setWeaponStatus("Rifle • Ready");
setPauseMenuVisible(false);
setInventoryPanelVisible(false);
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
  } else if (enemyType === "charger") {
    inventorySystem.addResource("scrap", 2);
  } else {
    inventorySystem.addResource("scrap", 1);
  }

  setScore(gameState.score);
  updateInventoryUI();
  setStatus(`${weaponLabel}: downed ${enemyType || "enemy"} (+${score} score, +${xp} XP)`);
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
        elapsed
      );

      if (attack.hit) {
        playTone(p.hitTone || 760, 0.06, "square", 0.09);
        if (attack.killed) {
          applyKillRewards(attack.score, attack.xp, p.weaponLabel, attack.type);
        } else {
          setStatus(`${p.weaponLabel}: hit confirmed.`);
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

function performAttack(elapsed) {
  if (gameState.paused) return;
  if (document.pointerLockElement !== canvas) {
    setStatus("Click the game to lock mouse before firing.");
    return;
  }
  if (elapsed < combatState.nextAttackAt) return;

  const weapon = weaponDefs[weaponState.activeId] || weaponDefs.rifle;
  combatState.nextAttackAt = elapsed + weapon.cooldown;
  player.getAimOrigin(aimOrigin);
  player.getAimDirection(aimDirection);
  player.getMuzzleOrigin(muzzleOrigin);

  camera.getWorldDirection(centerRayDirection);
  cameraAimTarget.copy(camera.position).add(centerRayDirection.multiplyScalar(weapon.range));

  const shots = weapon.pellets || 1;
  for (let i = 0; i < shots; i++) {
    const spread = weapon.spread || 0;
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
    spawnPlayerProjectile(weapon, muzzleOrigin, tempAimVector);
  }

  spawnMuzzleFlash(muzzleOrigin, weapon.projectileColor || 0xffddaa, weapon.id === "shotgun" ? 1.35 : 1);

  playTone(weapon.toneMiss, 0.05, "triangle", 0.05);
}

function performPunch(elapsed) {
  if (gameState.paused) return;
  const start = player.tryStartPunch(elapsed);
  if (!start) return;

  combatState.punch.active = true;
  combatState.punch.hitAt = start.hitAt;
  combatState.punch.endAt = start.endAt;
  combatState.punch.resolved = false;
  setStatus("Punch!");
  playTone(260, 0.06, "square", 0.06);
}

function updateWeaponStatus(elapsed) {
  const weapon = weaponDefs[weaponState.activeId] || weaponDefs.rifle;
  const cd = combatState.nextAttackAt - elapsed;
  if (cd <= 0) {
    setWeaponStatus(`${weapon.label} • Ready`);
  } else {
    setWeaponStatus(`${weapon.label} • CD ${cd.toFixed(2)}s`);
  }
}

function setActiveWeapon(nextId, announce = true) {
  if (!weaponDefs[nextId]) return;
  if (!weaponState.unlocked[nextId]) return;
  weaponState.activeId = nextId;
  if (announce) setStatus(`Weapon switched: ${weaponDefs[nextId].label}`);
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
    setStatus(`Level up! You are now level ${gameState.level}. Upgrade points: ${gameState.points}`);
  }
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
}

function applyUpgrade(slot) {
  if (gameState.points <= 0) {
    setStatus("No upgrade points available.");
    return;
  }
  gameState.points -= 1;
  if (slot === 1) {
    gameState.upgrades.speed += 1;
    player.speed += 0.7;
    player.sprintSpeed += 1.1;
    setStatus("Upgrade applied: Speed + Sprint.");
  } else if (slot === 2) {
    gameState.upgrades.jump += 1;
    player.jumpPower += 0.55;
    setStatus("Upgrade applied: Jump power.");
  } else {
    gameState.upgrades.stamina += 1;
    gameState.maxStamina += 15;
    gameState.stamina = gameState.maxStamina;
    setStatus("Upgrade applied: Max stamina.");
  }
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
}

function useMedkit() {
  if (!inventorySystem.consumeConsumable("medkit", 1)) {
    setStatus("No medkits available.");
    return;
  }
  const healAmount = 28;
  gameState.health = clamp(gameState.health + healAmount, 0, gameState.maxHealth);
  setHealth(gameState.health, gameState.maxHealth);
  updateInventoryUI();
  setStatus(`Used medkit (+${healAmount} HP).`);
  playTone(540, 0.12, "triangle", 0.1);
}

function setPaused(shouldPause) {
  gameState.paused = shouldPause;
  setPauseMenuVisible(shouldPause);
  if (shouldPause && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  setStatus(shouldPause ? "Paused." : "Resumed.");
}

function toggleInventoryPanel() {
  gameState.inventoryPanelOpen = !gameState.inventoryPanelOpen;
  setInventoryPanelVisible(gameState.inventoryPanelOpen);
}

function buildSaveState() {
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
    weapons: {
      activeId: weaponState.activeId,
      unlocked: weaponState.unlocked,
    },
  };
}

function performSave() {
  saveGame(buildSaveState());
  setStatus("Game saved.");
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
    setStatus("No save found.");
    return;
  }

  if (Array.isArray(data.position) && data.position.length === 3) {
    player.setPosition(data.position[0], data.position[1], data.position[2]);
  }
  collectibles.applyCollectedList(data.collectedIds || []);
  enemies.applySaveState(data.enemies || [], 0);

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
  };
  const loadedActive = typeof loadedWeapons.activeId === "string" ? loadedWeapons.activeId : "rifle";
  setActiveWeapon(loadedActive, false);
  if (!weaponState.unlocked[weaponState.activeId]) {
    setActiveWeapon("rifle", false);
  }

  const loadedCombat = data.combat || {};
  combatState.nextAttackAt = Math.max(0, numberOr(loadedCombat.nextAttackAt, 0));

  for (const projectile of playerProjectiles) {
    scene.remove(projectile.mesh);
  }
  playerProjectiles.length = 0;

  setScore(gameState.score);
  setHealth(gameState.health, gameState.maxHealth);
  setStamina(gameState.stamina, gameState.maxStamina);
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
  updateInventoryUI();
  setObjective(missionSystem.getObjectiveText());
  updateWeaponStatus(clock.elapsedTime);
  setStatus("Game loaded.");
}

window.addEventListener("keydown", (e) => {
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
    setStatus("Save reset.");
  } else if (e.code === "KeyQ") {
    cycleWeapon();
  } else if (e.code === "KeyI") {
    toggleInventoryPanel();
  } else if (e.code === "KeyH") {
    useMedkit();
  } else if (e.code === "Digit1") {
    applyUpgrade(1);
  } else if (e.code === "Digit2") {
    applyUpgrade(2);
  } else if (e.code === "Digit3") {
    applyUpgrade(3);
  } else if (e.code === "KeyF") {
    performPunch(clock.elapsedTime);
  } else if (e.code === "KeyY") {
    const doorResult = world.toggleNearestDoor ? world.toggleNearestDoor(player.position) : null;
    if (doorResult) setStatus(doorResult.message);
  }
});

canvas.addEventListener("click", () => {
  ensureAudio();
  if (!gameState.paused && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    setStatus("Mouse locked.");
  }
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  performAttack(clock.elapsedTime);
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

  const dayNight = world.getDayNightState(elapsed);
  world.updateDayNight(elapsed, sun, hemi);

  if (!gameState.paused) {
    if (world.updateDoors) {
      world.updateDoors(dt);
    }

    const playerResult = player.update(dt);

    updatePlayerProjectiles(dt, elapsed);
    updateMuzzleFlashes(dt);

    if (!playerResult.sprinting) {
      const regen = playerResult.hasMoveInput ? 12 : 22;
      gameState.stamina = clamp(gameState.stamina + regen * dt, 0, gameState.maxStamina);
    }

    if (playerResult.landed && playerResult.fallSpeed > 13.5) {
      const impact = Math.max(0, (playerResult.fallSpeed - 13.5) * 5.5);
      gameState.health = clamp(gameState.health - impact, 0, gameState.maxHealth);
      setStatus(`Hard landing! -${Math.round(impact)} HP`);
      playTone(150, 0.2, "sawtooth", 0.1);
    }

    const zoneDamage = world.getHazardDamageAt(player.position.x, player.position.z, dt);
    if (zoneDamage > 0) {
      gameState.health = clamp(gameState.health - zoneDamage, 0, gameState.maxHealth);
      if (Math.random() < 0.08) {
        playTone(180, 0.08, "square", 0.06);
      }
    }

    const enemyResult = enemies.update(dt, elapsed, player.position, { isNight: dayNight.isNight });
    if (enemyResult.playerDamage > 0) {
      gameState.health = clamp(gameState.health - enemyResult.playerDamage, 0, gameState.maxHealth);
      if (enemyResult.hitByProjectile) {
        setStatus(`Hit by projectile! -${Math.round(enemyResult.playerDamage)} HP`);
      }
      playTone(165, 0.09, "square", 0.07);
    }

    if (combatState.punch.active && !combatState.punch.resolved && elapsed >= combatState.punch.hitAt) {
      const query = player.getPunchQuery(punchOrigin, punchDirection);
      const hit = enemies.tryHitFromMelee(query.origin, query.direction, 2.3, 26, elapsed, 0.4);
      if (hit.hit) {
        if (hit.killed) {
          applyKillRewards(hit.score, hit.xp, "Punch", hit.type);
        } else {
          setStatus("Punch connected.");
        }
        playTone(480, 0.05, "square", 0.08);
      } else {
        setStatus("Punch missed.");
      }
      combatState.punch.resolved = true;
    }
    if (combatState.punch.active && elapsed >= combatState.punch.endAt) {
      combatState.punch.active = false;
    }

    if (enemyResult.nightRushActive && !combatState.nightRushAnnounced) {
      combatState.nightRushAnnounced = true;
      setStatus("Night rush! Enemies are swarming your position.");
      playTone(250, 0.22, "sawtooth", 0.13);
    } else if (!enemyResult.nightRushActive && combatState.nightRushAnnounced) {
      combatState.nightRushAnnounced = false;
      if (dayNight.isNight) {
        setStatus("Rush wave ended. Stay alert for another attack tonight.");
      } else {
        setStatus("Dawn breaks. Enemy rushes have ended.");
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
      inventorySystem.addConsumable("medkit", rewards.inventory.medkit);
      missionSystem.onEvent("collectible_collected", { count: rewards.count });

      setScore(gameState.score);
      updateInventoryUI();
      setStatus(`Collected +${rewards.score} score, +${rewards.xp} XP`);
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
      setStatus("You were downed! Respawned at origin.");
      playTone(120, 0.3, "square", 0.13);
    }

    setHealth(gameState.health, gameState.maxHealth);
    setStamina(gameState.stamina, gameState.maxStamina);
    updateCombatStatus(elapsed);
    updateWeaponStatus(elapsed);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

setStatus("Explore, survive, fight enemies. LMB attack. Y door, I inventory, H medkit.");
animate();