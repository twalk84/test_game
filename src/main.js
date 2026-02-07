import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";
import { clamp, numberOr } from "./utils.js";
import { events } from "./events.js";
import { createWorld } from "./world.js";
import { PlayerController } from "./player.js";
import { CollectibleSystem } from "./collectibles.js";
import { EnemySystem } from "./enemies.js";
import { loadGame, resetSave, saveGame } from "./save.js";
import { ParticleSystem } from "./particles.js";
import { AbilitySystem } from "./abilities.js";
import { LootSystem } from "./loot.js";
import { Minimap } from "./minimap.js";
import { DamageNumberSystem } from "./damageNumbers.js";
import { WeatherSystem } from "./weather.js";
import { BiomeSystem } from "./biomes.js";
import { BossSystem } from "./bosses.js";
import { QuestSystem } from "./quests.js";
import { SoundDesigner } from "./soundDesign.js";
import { SpatialGrid } from "./spatialGrid.js";
import {
  setAbilityStatus,
  setBuffStatus,
  setCombatStatus,
  setHealth,
  setObjective,
  setPauseMenuVisible,
  setProgression,
  setQuestStatus,
  setScore,
  setStamina,
  setStatus,
  setWeaponStatus,
  setWeatherBiome,
  showDeathScreen,
  hideDeathScreen,
} from "./ui.js";

const canvas = document.getElementById("game");
const sensitivityInput = document.getElementById("sensitivity");
const volumeInput = document.getElementById("volume");
const muteInput = document.getElementById("mute");
const difficultySelect = document.getElementById("difficulty");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.rendering.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8eb);

const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  window.innerWidth / window.innerHeight,
  CONFIG.camera.near,
  CONFIG.camera.far
);

// Lighting
const hemi = new THREE.HemisphereLight(0xbfdfff, 0x35573a, 0.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff7dd, 1.0);
sun.position.set(28, 45, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(CONFIG.rendering.shadowMapSize, CONFIG.rendering.shadowMapSize);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
scene.add(sun);

const world = createWorld(scene);
const particles = new ParticleSystem(scene);
const abilities = new AbilitySystem();
const loot = new LootSystem(scene, world.getHeightAt);
const minimap = new Minimap();
const damageNumbers = new DamageNumberSystem(camera);
const weather = new WeatherSystem(scene);
const biomes = new BiomeSystem();
const boss = new BossSystem(scene, world.getHeightAt);
const quests = new QuestSystem();
const spatialGrid = new SpatialGrid(CONFIG.world.size);

let soundDesigner; // initialized after audio context exists
let autoSaveTimer = 60; // auto-save every 60s
let totalPlaytime = 0;

// Session stats for death screen
const sessionStats = {
  kills: 0,
  survivalTime: 0,
};
let isDead = false;
let deathTimestamp = 0;

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
  difficulty: "normal",
  settings: {
    sensitivity: CONFIG.settings.defaultSensitivity,
    volume: CONFIG.settings.defaultVolume,
    mute: CONFIG.settings.defaultMute,
  },
};

// Active buffs from loot
const buffs = {
  damage: { active: false, multiplier: 1, expiresAt: 0 },
  speed: { active: false, multiplier: 1, expiresAt: 0 },
};

const objective = {
  tier: 1,
  target: CONFIG.objectives.baseTarget,
  timeLimit: CONFIG.objectives.baseTimeLimit,
  timeLeft: CONFIG.objectives.baseTimeLimit,
  collected: 0,
  rewardScore: CONFIG.objectives.baseRewardScore,
  rewardXp: CONFIG.objectives.baseRewardXp,
};

function refreshObjectiveText() {
  setObjective(
    `Collect ${objective.target} crystals in ${Math.ceil(objective.timeLeft)}s (${objective.collected}/${objective.target})`
  );
}

function startObjective(nextTier = objective.tier) {
  const cfg = CONFIG.objectives;
  objective.tier = nextTier;
  objective.target = cfg.baseTarget + (nextTier - 1);
  objective.timeLimit = Math.max(cfg.minTimeLimit, cfg.baseTimeLimit - (nextTier - 1) * cfg.timeLimitDecay);
  objective.timeLeft = objective.timeLimit;
  objective.collected = 0;
  objective.rewardScore = cfg.baseRewardScore + nextTier * cfg.rewardScorePerTier;
  objective.rewardXp = cfg.baseRewardXp + nextTier * cfg.rewardXpPerTier;
  refreshObjectiveText();
}

const player = new PlayerController(camera, world.getHeightAt, {
  scene,
  cameraCollisionMeshes: world.cameraCollisionMeshes,
  canSprint: (dt, wantsSprintMove) => {
    if (!wantsSprintMove) return false;
    if (gameState.stamina <= 0) return false;
    gameState.stamina = clamp(gameState.stamina - CONFIG.player.sprintStaminaCost * dt, 0, gameState.maxStamina);
    return true;
  },
  consumeJumpCost: () => {
    const jumpCost = CONFIG.player.jumpStaminaCost;
    if (gameState.stamina < jumpCost) return false;
    gameState.stamina = clamp(gameState.stamina - jumpCost, 0, gameState.maxStamina);
    return true;
  },
});
player.setPosition(0, world.getHeightAt(0, 0) + CONFIG.player.height, 0);

const collectibles = new CollectibleSystem(scene, world.getHeightAt, CONFIG.world.size);
collectibles.spawn(CONFIG.collectibles.spawnCount);

const enemies = new EnemySystem(scene, world.getHeightAt, CONFIG.world.size);
enemies.spawn(16);

const combatState = {
  nextAttackAt: 0,
};

const weaponDefs = CONFIG.weapons;

const weaponState = {
  order: CONFIG.weaponOrder,
  activeId: "rifle",
  unlocked: {
    rifle: true,
    shotgun: true,
    pulse: true,
    sniper: true,
    grenade: true,
  },
};

const aimOrigin = new THREE.Vector3();
const aimDirection = new THREE.Vector3();
const tempAimVector = new THREE.Vector3();
const centerRayDirection = new THREE.Vector3();
const cameraAimTarget = new THREE.Vector3();
const muzzleOrigin = new THREE.Vector3();
const previousProjectilePosition = new THREE.Vector3();

const playerProjectiles = [];

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
    ambientOsc.frequency.value = CONFIG.audio.ambientFreq;
    ambientGain = audioCtx.createGain();
    ambientGain.gain.value = CONFIG.audio.ambientBaseGain;
    ambientOsc.connect(ambientGain);
    ambientGain.connect(masterGain);
    ambientOsc.start();
  }
  if (!soundDesigner) {
    soundDesigner = new SoundDesigner(
      () => audioCtx,
      () => masterGain,
      () => gameState.settings.mute
    );
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function updateAudioSettings() {
  if (!masterGain) return;
  const vol = gameState.settings.mute ? 0 : gameState.settings.volume;
  masterGain.gain.value = vol * CONFIG.audio.masterVolume;
  if (ambientGain) ambientGain.gain.value = CONFIG.audio.ambientBaseGain + vol * CONFIG.audio.ambientVolumeScale;
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

function playTonePreset(presetName) {
  const t = CONFIG.audio.tones[presetName];
  if (t) playTone(t.freq, t.duration, t.type, t.volume);
}

setScore(gameState.score);
setHealth(gameState.health, gameState.maxHealth);
setStamina(gameState.stamina, gameState.maxStamina);
setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
setCombatStatus("Ready");
setWeaponStatus("Rifle • Ready");
setPauseMenuVisible(false);
startObjective(1);

function updateCombatStatus(gameTime) {
  const cd = combatState.nextAttackAt - gameTime;
  if (cd <= 0) {
    setCombatStatus("Ready");
  } else {
    setCombatStatus(`Cooldown ${cd.toFixed(2)}s`);
  }
}

function applyKillRewards(score, xp, weaponLabel) {
  gameState.score += score;
  addXp(xp);
  sessionStats.kills += 1;
  setScore(gameState.score);
  setStatus(`${weaponLabel}: downed enemy (+${score} score, +${xp} XP)`);
  playTonePreset("kill");
  events.emit("enemy-killed", { score, xp, weaponLabel });
}

function spawnPlayerProjectile(weapon, origin, direction) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(weapon.projectileRadius || 0.07, 8, 8),
    new THREE.MeshBasicMaterial({ color: weapon.projectileColor || 0xffffff })
  );
  mesh.position.copy(origin);
  scene.add(mesh);

  const vel = direction.clone().normalize().multiplyScalar(weapon.projectileSpeed || 48);

  playerProjectiles.push({
    mesh,
    velocity: vel,
    life: weapon.projectileLife || 1,
    damage: weapon.damage * (buffs.damage.active ? buffs.damage.multiplier : 1),
    weaponLabel: weapon.label,
    hitTone: weapon.toneImpact,
    trailColor: weapon.projectileColor || 0xffffff,
    trailCounter: 0,
    isGrenade: weapon.isGrenade || false,
    grenadeGravity: weapon.grenadeGravity || 0,
    explosionRadius: weapon.explosionRadius || 0,
    splashDamage: (weapon.splashDamage || 0) * (buffs.damage.active ? buffs.damage.multiplier : 1),
  });
}

function cleanupProjectile(p) {
  p.mesh.geometry.dispose();
  p.mesh.material.dispose();
  scene.remove(p.mesh);
}

function handleGrenadeExplosion(p, gameTime) {
  const pos = p.mesh.position.clone();
  particles.enemyDeath(pos, 0xff6622);
  playTonePreset("explosion");

  const results = enemies.applyAoeDamage(pos, p.explosionRadius, p.splashDamage, gameTime);

  for (const r of results) {
    const pos = r.deathPos || r.hitPos;
    if (pos) damageNumbers.spawn(pos, p.splashDamage, "#ff8833", true);
    if (r.killed) {
      if (r.deathPos) particles.enemyDeath(r.deathPos, r.deathColor);
      applyKillRewards(r.score, r.xp, p.weaponLabel);
      loot.tryDrop(r.deathPos, gameTime);
    }
  }
}

function updatePlayerProjectiles(dt, gameTime) {
  for (let i = playerProjectiles.length - 1; i >= 0; i--) {
    const p = playerProjectiles[i];
    p.life -= dt;

    previousProjectilePosition.copy(p.mesh.position);

    // Apply gravity for grenades
    if (p.isGrenade && p.grenadeGravity > 0) {
      p.velocity.y -= p.grenadeGravity * dt;
    }

    p.mesh.position.addScaledVector(p.velocity, dt);

    // Projectile trail (every other frame)
    p.trailCounter++;
    if (p.trailCounter % 2 === 0) {
      particles.trail(p.mesh.position, p.trailColor);
    }

    const segment = p.mesh.position.clone().sub(previousProjectilePosition);
    const segmentLength = segment.length();
    let consumed = false;

    if (segmentLength > 0.0001) {
      const attack = enemies.tryHitFromRay(
        previousProjectilePosition,
        segment.normalize(),
        segmentLength + 0.1,
        p.damage,
        gameTime
      );

      if (attack.hit) {
        if (p.isGrenade) {
          handleGrenadeExplosion(p, gameTime);
        } else {
          playTone(p.hitTone || 760, 0.06, "square", 0.09);
          particles.bulletImpact(p.mesh.position, p.trailColor);
          damageNumbers.spawn(p.mesh.position, p.damage, "#ffffff");
          if (attack.killed) {
            if (attack.deathPos) particles.enemyDeath(attack.deathPos, attack.deathColor);
            applyKillRewards(attack.score, attack.xp, p.weaponLabel);
            loot.tryDrop(attack.deathPos, gameTime);
          } else {
            setStatus(`${p.weaponLabel}: hit confirmed.`);
          }
        }
        cleanupProjectile(p);
        playerProjectiles.splice(i, 1);
        consumed = true;
      }

      // Boss hit detection
      if (!consumed && boss.isActive) {
        const bossHit = boss.tryHitFromRay(
          previousProjectilePosition,
          segment.clone().normalize(),
          segmentLength + 0.1,
          p.damage,
          gameTime
        );
        if (bossHit.hit) {
          playTone(p.hitTone || 760, 0.06, "square", 0.09);
          particles.bulletImpact(p.mesh.position, p.trailColor);
          const bPos = bossHit.deathPos || bossHit.hitPos;
          if (bPos) damageNumbers.spawn(bPos, p.damage, "#ffdd44", true);
          if (bossHit.killed) {
            if (bossHit.deathPos) particles.enemyDeath(bossHit.deathPos, bossHit.deathColor);
            applyKillRewards(bossHit.score, bossHit.xp, p.weaponLabel);
            setStatus("BOSS DEFEATED!");
          }
          cleanupProjectile(p);
          playerProjectiles.splice(i, 1);
          consumed = true;
        }
      }
    }

    if (consumed) continue;

    const groundY = world.getHeightAt(p.mesh.position.x, p.mesh.position.z);
    const hitGround = p.mesh.position.y <= groundY + 0.2;

    if (p.life <= 0 || hitGround) {
      if (p.isGrenade) {
        handleGrenadeExplosion(p, gameTime);
      }
      cleanupProjectile(p);
      playerProjectiles.splice(i, 1);
    }
  }
}

function performAttack(gameTime) {
  if (gameState.paused) return;
  if (document.pointerLockElement !== canvas) {
    setStatus("Click the game to lock mouse before firing.");
    return;
  }
  if (gameTime < combatState.nextAttackAt) return;

  const weapon = weaponDefs[weaponState.activeId] || weaponDefs.rifle;
  combatState.nextAttackAt = gameTime + weapon.cooldown;
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
      .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread))
      .normalize();
    spawnPlayerProjectile(weapon, muzzleOrigin, tempAimVector);
  }

  // Muzzle flash particle effect
  camera.getWorldDirection(centerRayDirection);
  particles.muzzleFlash(muzzleOrigin, centerRayDirection);

  playTone(weapon.toneShot, 0.05, "triangle", 0.05);
  if (soundDesigner) soundDesigner.playWeaponFire(weaponState.activeId);
  events.emit("weapon-fired", { weaponId: weapon.id });
}

function updateWeaponStatus(gameTime) {
  const weapon = weaponDefs[weaponState.activeId] || weaponDefs.rifle;
  const cd = combatState.nextAttackAt - gameTime;
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
  if (announce) {
    setStatus(`Weapon switched: ${weaponDefs[nextId].label}`);
    events.emit("weapon-switched", { weaponId: nextId });
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
  return CONFIG.progression.baseXp + (level - 1) * CONFIG.progression.xpPerLevel;
}

function addXp(amount) {
  gameState.xp += amount;
  let leveled = false;
  while (gameState.xp >= xpForLevel(gameState.level)) {
    if (gameState.level >= CONFIG.progression.maxLevel) {
      gameState.xp = 0;
      break;
    }
    gameState.xp -= xpForLevel(gameState.level);
    gameState.level += 1;
    gameState.points += 1;
    leveled = true;
  }
  if (leveled) {
    playTonePreset("levelUp");
    const maxNote = gameState.level >= CONFIG.progression.maxLevel ? " (MAX)" : "";
    setStatus(`Level up! You are now level ${gameState.level}${maxNote}. Upgrade points: ${gameState.points}`);
    events.emit("level-up", { level: gameState.level, points: gameState.points });
  }
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
}

function applyUpgrade(slot) {
  if (gameState.points <= 0) {
    setStatus("No upgrade points available.");
    return;
  }
  const uv = CONFIG.progression.upgradeValues;
  gameState.points -= 1;
  if (slot === 1) {
    gameState.upgrades.speed += 1;
    player.speed += uv.speed.baseSpeed;
    player.sprintSpeed += uv.speed.sprintSpeed;
    setStatus("Upgrade applied: Speed + Sprint.");
  } else if (slot === 2) {
    gameState.upgrades.jump += 1;
    player.jumpPower += uv.jump.jumpPower;
    setStatus("Upgrade applied: Jump power.");
  } else {
    gameState.upgrades.stamina += 1;
    gameState.maxStamina += uv.stamina.maxStamina;
    gameState.stamina = gameState.maxStamina;
    setStatus("Upgrade applied: Max stamina.");
  }
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
}

function setDifficulty(key) {
  gameState.difficulty = key;
  enemies.setDifficulty(key);
  if (difficultySelect) difficultySelect.value = key;
  setStatus(`Difficulty set to ${CONFIG.difficulty[key]?.label || key}.`);
}

function updateBuffs(gameTime) {
  const parts = [];
  if (buffs.damage.active) {
    if (gameTime >= buffs.damage.expiresAt) {
      buffs.damage.active = false;
      buffs.damage.multiplier = 1;
    } else {
      parts.push(`DMG x${buffs.damage.multiplier.toFixed(1)} (${Math.ceil(buffs.damage.expiresAt - gameTime)}s)`);
    }
  }
  if (buffs.speed.active) {
    if (gameTime >= buffs.speed.expiresAt) {
      buffs.speed.active = false;
      buffs.speed.multiplier = 1;
      player.speed = CONFIG.player.baseSpeed + gameState.upgrades.speed * CONFIG.progression.upgradeValues.speed.baseSpeed;
      player.sprintSpeed = CONFIG.player.baseSprintSpeed + gameState.upgrades.speed * CONFIG.progression.upgradeValues.speed.sprintSpeed;
    } else {
      parts.push(`SPD x${buffs.speed.multiplier.toFixed(1)} (${Math.ceil(buffs.speed.expiresAt - gameTime)}s)`);
    }
  }
  setBuffStatus(parts.join(" | "));
}

function applyLootPickup(pickup, gameTime) {
  const cfg = pickup.config;
  if (pickup.type === "health") {
    gameState.health = clamp(gameState.health + cfg.heal, 0, gameState.maxHealth);
    setStatus(`Picked up health pack! +${cfg.heal} HP`);
  } else if (pickup.type === "damageBuff") {
    buffs.damage.active = true;
    buffs.damage.multiplier = cfg.multiplier;
    buffs.damage.expiresAt = gameTime + cfg.duration;
    setStatus(`Damage boost! x${cfg.multiplier} for ${cfg.duration}s`);
  } else if (pickup.type === "speedBuff") {
    buffs.speed.active = true;
    buffs.speed.multiplier = cfg.multiplier;
    buffs.speed.expiresAt = gameTime + cfg.duration;
    const uv = CONFIG.progression.upgradeValues;
    player.speed = (CONFIG.player.baseSpeed + gameState.upgrades.speed * uv.speed.baseSpeed) * cfg.multiplier;
    player.sprintSpeed = (CONFIG.player.baseSprintSpeed + gameState.upgrades.speed * uv.speed.sprintSpeed) * cfg.multiplier;
    setStatus(`Speed boost! x${cfg.multiplier} for ${cfg.duration}s`);
  }
  playTonePreset("lootPickup");
  particles.collectPickup(player.position, cfg.color);
}

function setPaused(shouldPause) {
  gameState.paused = shouldPause;
  setPauseMenuVisible(shouldPause);
  if (shouldPause && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  setStatus(shouldPause ? "Paused." : "Resumed.");
  events.emit(shouldPause ? "game-paused" : "game-resumed");
}

function buildSaveState() {
  return {
    version: 4,
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
    objective,
    combat: {
      nextAttackAt: combatState.nextAttackAt,
    },
    settings: gameState.settings,
    difficulty: gameState.difficulty,
    weapons: {
      activeId: weaponState.activeId,
      unlocked: weaponState.unlocked,
    },
    abilities: abilities.getSaveState(),
    weather: weather.getSaveState(),
    quests: quests.getSaveState(),
    playtime: totalPlaytime,
  };
}

function performSave() {
  saveGame(buildSaveState());
  setStatus("Game saved.");
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
  gameState.level = clamp(numberOr(data.level, 1), 1, CONFIG.progression.maxLevel);
  gameState.xp = Math.max(0, numberOr(data.xp, 0));
  gameState.points = Math.max(0, numberOr(data.points, 0));

  const upgrades = data.upgrades || {};
  gameState.upgrades = {
    speed: Math.max(0, numberOr(upgrades.speed, 0)),
    jump: Math.max(0, numberOr(upgrades.jump, 0)),
    stamina: Math.max(0, numberOr(upgrades.stamina, 0)),
  };

  const uv = CONFIG.progression.upgradeValues;
  player.speed = CONFIG.player.baseSpeed + gameState.upgrades.speed * uv.speed.baseSpeed;
  player.sprintSpeed = CONFIG.player.baseSprintSpeed + gameState.upgrades.speed * uv.speed.sprintSpeed;
  player.jumpPower = CONFIG.player.baseJumpPower + gameState.upgrades.jump * uv.jump.jumpPower;

  const loadedObjective = data.objective;
  if (loadedObjective) {
    objective.tier = Math.max(1, numberOr(loadedObjective.tier, 1));
    objective.target = Math.max(1, numberOr(loadedObjective.target, CONFIG.objectives.baseTarget));
    objective.timeLimit = Math.max(10, numberOr(loadedObjective.timeLimit, CONFIG.objectives.baseTimeLimit));
    objective.timeLeft = clamp(numberOr(loadedObjective.timeLeft, objective.timeLimit), 0, objective.timeLimit);
    objective.collected = Math.max(0, numberOr(loadedObjective.collected, 0));
    objective.rewardScore = Math.max(1, numberOr(loadedObjective.rewardScore, CONFIG.objectives.baseRewardScore));
    objective.rewardXp = Math.max(1, numberOr(loadedObjective.rewardXp, CONFIG.objectives.baseRewardXp));
  } else {
    startObjective(1);
  }

  const loadedSettings = data.settings || {};
  gameState.settings = {
    sensitivity: clamp(numberOr(loadedSettings.sensitivity, CONFIG.settings.defaultSensitivity), CONFIG.settings.minSensitivity, CONFIG.settings.maxSensitivity),
    volume: clamp(numberOr(loadedSettings.volume, CONFIG.settings.defaultVolume), 0, 1),
    mute: Boolean(loadedSettings.mute),
  };
  player.setLookSensitivity(gameState.settings.sensitivity);
  if (sensitivityInput) sensitivityInput.value = String(gameState.settings.sensitivity);
  if (volumeInput) volumeInput.value = String(gameState.settings.volume);
  if (muteInput) muteInput.checked = gameState.settings.mute;
  ensureAudio();
  updateAudioSettings();

  if (data.difficulty && CONFIG.difficulty[data.difficulty]) {
    setDifficulty(data.difficulty);
  }

  const loadedWeapons = data.weapons || {};
  const loadedUnlocked = loadedWeapons.unlocked || {};
  weaponState.unlocked = {
    rifle: loadedUnlocked.rifle !== false,
    shotgun: loadedUnlocked.shotgun !== false,
    pulse: loadedUnlocked.pulse !== false,
    sniper: loadedUnlocked.sniper !== false,
    grenade: loadedUnlocked.grenade !== false,
  };
  const loadedActive = typeof loadedWeapons.activeId === "string" ? loadedWeapons.activeId : "rifle";
  setActiveWeapon(loadedActive, false);
  if (!weaponState.unlocked[weaponState.activeId]) {
    setActiveWeapon("rifle", false);
  }

  const loadedCombat = data.combat || {};
  combatState.nextAttackAt = Math.max(0, numberOr(loadedCombat.nextAttackAt, 0));

  abilities.applySaveState(data.abilities, gameTime);
  weather.applySaveState(data.weather);
  quests.applySaveState(data.quests);
  if (typeof data.playtime === "number") totalPlaytime = data.playtime;
  boss.cleanup();

  // Reset buffs on load
  buffs.damage.active = false;
  buffs.damage.multiplier = 1;
  buffs.speed.active = false;
  buffs.speed.multiplier = 1;

  for (const projectile of playerProjectiles) {
    cleanupProjectile(projectile);
  }
  playerProjectiles.length = 0;
  loot.cleanup();

  setScore(gameState.score);
  setHealth(gameState.health, gameState.maxHealth);
  setStamina(gameState.stamina, gameState.maxStamina);
  setProgression({ level: gameState.level, xp: gameState.xp, points: gameState.points });
  refreshObjectiveText();
  updateWeaponStatus(gameTime);
  setStatus("Game loaded.");
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyP") {
    setPaused(!gameState.paused);
    return;
  }

  if (e.code === "KeyM") {
    minimap.cycleZoom();
    return;
  }

  if (gameState.paused || isDead) return;

  if (e.code === "KeyK") {
    performSave();
  } else if (e.code === "KeyL") {
    performLoad();
  } else if (e.code === "KeyR") {
    resetSave();
    setStatus("Save reset.");
  } else if (e.code === "KeyQ") {
    cycleWeapon();
  } else if (e.code === "Digit1") {
    applyUpgrade(1);
  } else if (e.code === "Digit2") {
    applyUpgrade(2);
  } else if (e.code === "Digit3") {
    applyUpgrade(3);
  } else if (e.code === CONFIG.abilities.dash.key) {
    if (abilities.tryDash(gameTime, player)) {
      playTonePreset("dash");
      setStatus("Dash!");
      particles.muzzleFlash(player.position, new THREE.Vector3(0, 1, 0));
    }
  } else if (e.code === CONFIG.abilities.healPulse.key) {
    if (abilities.tryHealPulse(gameTime)) {
      playTonePreset("heal");
      setStatus("Heal pulse activated!");
      particles.collectPickup(player.position, 0x44ff44);
    }
  } else if (e.code === CONFIG.abilities.shockwave.key) {
    const shockCfg = CONFIG.abilities.shockwave;
    const shockResult = abilities.tryShockwave(gameTime, player.position, enemies.enemies);
    if (shockResult) {
      playTonePreset("shockwave");
      setStatus(`Shockwave! Hit ${shockResult.hit} enemies.`);
      particles.levelUp(player.position);
      // Apply actual damage through enemy system
      const aoeResults = enemies.applyAoeDamage(player.position, shockCfg.radius, shockCfg.damage, gameTime);
      for (const r of aoeResults) {
        const pos = r.deathPos || r.hitPos;
        if (pos) damageNumbers.spawn(pos, shockCfg.damage, "#88ccff", true);
        if (r.killed) {
          if (r.deathPos) particles.enemyDeath(r.deathPos, r.deathColor);
          applyKillRewards(r.score, r.xp, "Shockwave");
          loot.tryDrop(r.deathPos, gameTime);
        }
      }
    }
  }
});

canvas.addEventListener("click", () => {
  ensureAudio();
  if (isDead) return; // respawn handled by death screen
  if (!gameState.paused && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    setStatus("Mouse locked.");
  }
});

// Death screen click-to-respawn
document.getElementById("deathScreen")?.addEventListener("click", () => {
  const elapsed = (performance.now() - deathTimestamp) / 1000;
  if (elapsed < 3) return; // 3 second minimum
  isDead = false;
  hideDeathScreen();
  gameState.health = gameState.maxHealth;
  gameState.stamina = gameState.maxStamina;
  player.setPosition(0, world.getHeightAt(0, 0) + CONFIG.player.height, 0);
  loot.cleanup();
  boss.cleanup();
  buffs.damage.active = false;
  buffs.damage.multiplier = 1;
  buffs.speed.active = false;
  buffs.speed.multiplier = 1;
  sessionStats.kills = 0;
  sessionStats.survivalTime = 0;
  setHealth(gameState.health, gameState.maxHealth);
  setStamina(gameState.stamina, gameState.maxStamina);
  setStatus("Respawned. Good luck!");
  events.emit("player-respawned");
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

window.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || isDead) return;
  performAttack(gameTime);
});

if (sensitivityInput) {
  sensitivityInput.addEventListener("input", (e) => {
    gameState.settings.sensitivity = clamp(Number(e.target.value) || CONFIG.settings.defaultSensitivity, CONFIG.settings.minSensitivity, CONFIG.settings.maxSensitivity);
    player.setLookSensitivity(gameState.settings.sensitivity);
  });
  player.setLookSensitivity(gameState.settings.sensitivity);
}

if (volumeInput) {
  volumeInput.addEventListener("input", (e) => {
    gameState.settings.volume = clamp(Number(e.target.value) || CONFIG.settings.defaultVolume, 0, 1);
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

if (difficultySelect) {
  difficultySelect.addEventListener("change", (e) => {
    setDifficulty(e.target.value);
  });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Custom game clock — only advances when unpaused, fixing the timer jump bug.
let gameTime = 0;
let wallTime = 0;
let lastTimestamp = performance.now();

function animate() {
  const now = performance.now();
  const rawDt = (now - lastTimestamp) / 1000;
  lastTimestamp = now;
  const dt = Math.min(CONFIG.rendering.maxDeltaTime, rawDt);

  wallTime += dt;
  world.updateDayNight(wallTime, sun, hemi);

  if (!gameState.paused && !isDead) {
    gameTime += dt;

    const playerResult = player.update(dt);

    updatePlayerProjectiles(dt, gameTime);

    if (!playerResult.sprinting) {
      const regen = playerResult.hasMoveInput ? CONFIG.player.staminaRegenMoving : CONFIG.player.staminaRegenIdle;
      gameState.stamina = clamp(gameState.stamina + regen * dt, 0, gameState.maxStamina);
    }

    if (playerResult.landed && playerResult.fallSpeed > CONFIG.player.fallDamageThreshold) {
      if (!abilities.isInvulnerable(gameTime)) {
        const impact = Math.max(0, (playerResult.fallSpeed - CONFIG.player.fallDamageThreshold) * CONFIG.player.fallDamageMultiplier);
        gameState.health = clamp(gameState.health - impact, 0, gameState.maxHealth);
        setStatus(`Hard landing! -${Math.round(impact)} HP`);
        playTonePreset("fallDamage");
        events.emit("player-damaged", { amount: impact, source: "fall" });
      }
    }

    const zoneDamage = world.getHazardDamageAt(player.position.x, player.position.z, dt);
    if (zoneDamage > 0 && !abilities.isInvulnerable(gameTime)) {
      gameState.health = clamp(gameState.health - zoneDamage, 0, gameState.maxHealth);
      if (Math.random() < 0.08) {
        playTonePreset("hazardDamage");
      }
      events.emit("player-damaged", { amount: zoneDamage, source: "hazard" });
    }

    // Weather update
    const weatherResult = weather.update(dt, gameTime, player.position);
    if (weatherResult.thunderReady && soundDesigner) {
      soundDesigner.playThunder();
    }
    const windForce = weather.getWindForce();
    if (windForce) {
      player.addImpulse(windForce.multiplyScalar(dt));
    }

    // Biome update
    const biomeResult = biomes.update(player.position.x, player.position.z);
    setWeatherBiome(weather.state, biomes.getCurrentLabel());

    // Sound designer updates
    if (soundDesigner) {
      soundDesigner.setRainIntensity(weatherResult.rainIntensity);
      soundDesigner.setWindIntensity(weather.state === "storm" ? 0.8 : weather.state === "rain" ? 0.3 : 0.1);
      soundDesigner.updateFootsteps(dt, playerResult.hasMoveInput, playerResult.sprinting);
      soundDesigner.updateMusic(dt, enemies.enemies.some(e => e.alive && e.isProvoked));
    }

    // Spatial grid rebuild
    spatialGrid.rebuild(enemies.enemies);

    const enemyResult = enemies.update(dt, gameTime, player.position);
    if (enemyResult.playerDamage > 0 && !abilities.isInvulnerable(gameTime)) {
      gameState.health = clamp(gameState.health - enemyResult.playerDamage, 0, gameState.maxHealth);
      damageNumbers.spawn(player.position, enemyResult.playerDamage, "#ff4444", true);
      if (enemyResult.hitByProjectile) {
        setStatus(`Hit by projectile! -${Math.round(enemyResult.playerDamage)} HP`);
      }
      playTonePreset("damage");
      events.emit("player-damaged", { amount: enemyResult.playerDamage, source: enemyResult.hitByProjectile ? "projectile" : "melee" });
    }

    // Apply tank knockback
    if (enemyResult.knockback) {
      player.addImpulse(enemyResult.knockback);
    }

    // Boss update
    if (boss.isActive) {
      const bossResult = boss.update(dt, gameTime, player.position);
      if (bossResult.playerDamage > 0 && !abilities.isInvulnerable(gameTime)) {
        gameState.health = clamp(gameState.health - bossResult.playerDamage, 0, gameState.maxHealth);
        damageNumbers.spawn(player.position, bossResult.playerDamage, "#ff2222", true);
        if (bossResult.slamHit) {
          setStatus("Boss ground slam!");
          if (soundDesigner) soundDesigner.playExplosion();
          particles.levelUp(player.position);
        }
        playTonePreset("damage");
        events.emit("player-damaged", { amount: bossResult.playerDamage, source: "boss" });
      }
      if (bossResult.spawnAdds && bossResult.addPosition) {
        enemies.spawn(bossResult.addCount);
      }
    }

    // Abilities update
    const abilityResult = abilities.update(dt);
    if (abilityResult.healApplied > 0) {
      gameState.health = clamp(gameState.health + abilityResult.healApplied, 0, gameState.maxHealth);
    }

    // Loot pickup check
    const lootResult = loot.update(gameTime, player.position);
    if (lootResult.pickedUp) {
      applyLootPickup(lootResult.pickedUp, gameTime);
    }

    // Buff expiry
    updateBuffs(gameTime);

    const rewards = collectibles.update(gameTime, player.position);
    if (rewards.count > 0) {
      gameState.score += rewards.score;
      addXp(rewards.xp);
      if (rewards.heal > 0) {
        gameState.health = clamp(gameState.health + rewards.heal, 0, gameState.maxHealth);
      }
      objective.collected += rewards.count;

      setScore(gameState.score);
      setStatus(`Collected +${rewards.score} score, +${rewards.xp} XP`);
      playTonePreset(rewards.rareCount > 0 ? "collectRare" : "collect");
      events.emit("item-collected", { score: rewards.score, xp: rewards.xp, count: rewards.count, heal: rewards.heal });
    }

    objective.timeLeft -= dt;
    if (objective.collected >= objective.target) {
      gameState.score += objective.rewardScore;
      addXp(objective.rewardXp);
      setScore(gameState.score);
      setStatus(`Objective complete! +${objective.rewardScore} score, +${objective.rewardXp} XP`);
      playTonePreset("objectiveComplete");
      events.emit("objective-complete", { tier: objective.tier, score: objective.rewardScore, xp: objective.rewardXp });
      const nextTier = objective.tier + 1;
      startObjective(nextTier);

      // Boss spawns every 5th tier
      if (nextTier % 5 === 0 && !boss.isActive) {
        boss.spawn(player.position);
        setStatus("A BOSS HAS APPEARED!");
        playTonePreset("death"); // dramatic tone
      }
    } else if (objective.timeLeft <= 0) {
      setStatus("Objective failed. Restarting challenge.");
      playTonePreset("objectiveFail");
      events.emit("objective-failed", { tier: objective.tier });
      startObjective(Math.max(1, objective.tier));
    }

    // Quest update
    const questResult = quests.update(dt, player.position);
    if (questResult) {
      if (questResult.type === "completed") {
        gameState.score += questResult.rewardScore;
        addXp(questResult.rewardXp);
        setScore(gameState.score);
        setStatus(`Quest complete: ${questResult.quest.label}! +${questResult.rewardScore} score, +${questResult.rewardXp} XP`);
        playTonePreset("objectiveComplete");
        events.emit("quest-complete", { quest: questResult.quest });
        // Auto-generate next quest
        quests.generate(quests.tier + 1);
      } else if (questResult.type === "failed") {
        setStatus(`Quest failed: ${questResult.quest.label}. Try again!`);
        playTonePreset("objectiveFail");
        quests.generate(quests.tier);
      }
    }
    setQuestStatus(quests.getDisplayText());

    // Auto-save every 60s
    totalPlaytime += dt;
    autoSaveTimer -= dt;
    if (autoSaveTimer <= 0) {
      autoSaveTimer = 60;
      saveGame(buildSaveState());
    }

    if (gameState.health <= 0 && !isDead) {
      isDead = true;
      deathTimestamp = performance.now();
      playTonePreset("death");
      events.emit("player-died");
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
      showDeathScreen({
        kills: sessionStats.kills,
        score: gameState.score,
        level: gameState.level,
        survivalTime: sessionStats.survivalTime,
      });
    }

    sessionStats.survivalTime += dt;

    setHealth(gameState.health, gameState.maxHealth);
    setStamina(gameState.stamina, gameState.maxStamina);
    refreshObjectiveText();
    updateCombatStatus(gameTime);
    updateWeaponStatus(gameTime);
    setAbilityStatus(abilities.getCooldownInfo(gameTime));

    // Update minimap
    minimap.update(player.position, player.yaw, enemies.enemies, collectibles.items, CONFIG.world.hazardZones);
  }

  particles.update(dt);
  damageNumbers.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

// Event-driven particle effects
events.on("item-collected", () => {
  particles.collectPickup(player.position, 0xffcc44);
});

events.on("level-up", () => {
  particles.levelUp(player.position);
});

// Generate initial quest
quests.generate(1);

setStatus("Explore, survive, fight. LMB attack, Q weapon, E dash, F heal, C shockwave.");
animate();
