import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { GAME_CONFIG } from "../config.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const VEHICLE_ARCHETYPES = {
  sedan: {
    name: "Sedan",
    color: 0xb62525,
    hoodColor: 0xa82020,
    cabinColor: 0x2e394a,
    bodyLength: 4.45,
    bodyWidth: 1.82,
    bodyHeight: 0.58,
    maxForwardSpeed: 19,
    maxReverseSpeed: 7,
    acceleration: 24,
    reverseAcceleration: 16,
    steerRate: 2.6,
    drag: 0.3,
    wheelRadius: 0.34,
    wheelWidth: 0.22,
    wheelOffsetX: 0.76,
    wheelFrontZ: 1.32,
    wheelRearZ: -1.24,
    cabinWidth: 1.56,
    cabinHeight: 0.74,
    cabinLength: 2.2,
    cabinOffsetZ: -0.05,
    hoodWidth: 1.7,
    hoodHeight: 0.24,
    hoodLength: 1.2,
    hoodOffsetZ: 0.29,
  },
  scout: {
    name: "Scout",
    color: 0x2d7db8,
    hoodColor: 0x2b6c9b,
    cabinColor: 0x31414e,
    bodyLength: 4.05,
    bodyWidth: 1.74,
    bodyHeight: 0.54,
    maxForwardSpeed: 24,
    maxReverseSpeed: 8,
    acceleration: 30,
    reverseAcceleration: 18,
    steerRate: 2.95,
    drag: 0.28,
    wheelRadius: 0.31,
    wheelWidth: 0.2,
    wheelOffsetX: 0.72,
    wheelFrontZ: 1.16,
    wheelRearZ: -1.08,
    cabinWidth: 1.52,
    cabinHeight: 0.76,
    cabinLength: 1.92,
    cabinOffsetZ: 0.07,
    hoodWidth: 1.6,
    hoodHeight: 0.22,
    hoodLength: 0.9,
    hoodOffsetZ: 0.34,
    hatchSpoiler: true,
  },
  muscle: {
    name: "Muscle",
    color: 0x9840bf,
    hoodColor: 0x7f32a2,
    cabinColor: 0x2b2a33,
    bodyLength: 4.68,
    bodyWidth: 1.88,
    bodyHeight: 0.56,
    maxForwardSpeed: 27,
    maxReverseSpeed: 8,
    acceleration: 28,
    reverseAcceleration: 17,
    steerRate: 2.45,
    drag: 0.27,
    wheelRadius: 0.35,
    wheelWidth: 0.24,
    wheelOffsetX: 0.79,
    wheelFrontZ: 1.42,
    wheelRearZ: -1.28,
    cabinWidth: 1.42,
    cabinHeight: 0.63,
    cabinLength: 1.7,
    cabinOffsetZ: -0.3,
    hoodWidth: 1.74,
    hoodHeight: 0.2,
    hoodLength: 1.5,
    hoodOffsetZ: 0.38,
    rearSpoiler: true,
  },
  truck: {
    name: "Truck",
    color: 0x4e7f3a,
    hoodColor: 0x436c32,
    cabinColor: 0x38414a,
    bodyLength: 5.1,
    bodyWidth: 2.02,
    bodyHeight: 0.72,
    maxForwardSpeed: 16,
    maxReverseSpeed: 6,
    acceleration: 19,
    reverseAcceleration: 13,
    steerRate: 2.05,
    drag: 0.34,
    wheelRadius: 0.39,
    wheelWidth: 0.26,
    wheelOffsetX: 0.86,
    wheelFrontZ: 1.54,
    wheelRearZ: -1.46,
    cabinWidth: 1.5,
    cabinHeight: 0.96,
    cabinLength: 1.5,
    cabinOffsetZ: 0.78,
    hoodWidth: 1.64,
    hoodHeight: 0.25,
    hoodLength: 1.02,
    hoodOffsetZ: 1.45,
    pickupBed: true,
  },
};

export class VehicleSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.vehicles = [];
    this.explosionConfig = {
      criticalHealthRatio: GAME_CONFIG.vehicles?.explosions?.criticalHealthRatio ?? 0.25,
      criticalDelayMin: GAME_CONFIG.vehicles?.explosions?.criticalDelayMin ?? 0.7,
      criticalDelayMax: GAME_CONFIG.vehicles?.explosions?.criticalDelayMax ?? 1.8,
      burnDurationMin: GAME_CONFIG.vehicles?.explosions?.burnDurationMin ?? 1.4,
      burnDurationMax: GAME_CONFIG.vehicles?.explosions?.burnDurationMax ?? 2.6,
      wreckTransitionSeconds: GAME_CONFIG.vehicles?.explosions?.wreckTransitionSeconds ?? 0.45,
      radius: GAME_CONFIG.vehicles?.explosions?.radius ?? 7.5,
      maxDamage: GAME_CONFIG.vehicles?.explosions?.maxDamage ?? 56,
      chainVehicleDamageMultiplier: GAME_CONFIG.vehicles?.explosions?.chainVehicleDamageMultiplier ?? 0.72,
      playerDamageMultiplier: GAME_CONFIG.vehicles?.explosions?.playerDamageMultiplier ?? 0.95,
      impulse: GAME_CONFIG.vehicles?.explosions?.impulse ?? 8,
      respawnAfterSeconds: GAME_CONFIG.vehicles?.explosions?.respawnAfterSeconds ?? 0,
    };
    this.pendingExplosionEvents = [];
  }

  _randRange(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.random() * (hi - lo);
  }

  _setExplosionStage(vehicle, stage, elapsed = 0) {
    if (!vehicle || !vehicle.explosionState) return;
    vehicle.explosionState.stage = stage;
    vehicle.explosionState.stageAt = elapsed;
  }

  _enterCritical(vehicle, elapsed, options = {}) {
    if (!vehicle || !vehicle.explosionState) return;
    const state = vehicle.explosionState;
    if (state.stage === "critical" || state.stage === "burning" || state.stage === "exploded" || state.stage === "wreck") {
      if (options.shorten && state.stage === "critical") {
        state.criticalUntil = Math.min(state.criticalUntil, elapsed + Math.max(0.08, Number(options.shortenToSeconds) || 0.2));
      }
      return;
    }

    this._setExplosionStage(vehicle, "critical", elapsed);
    vehicle.health = Math.max(1, Number(vehicle.health) || 1);
    const delay = options.immediate
      ? Math.max(0.08, Number(options.criticalDelaySeconds) || 0.15)
      : this._randRange(this.explosionConfig.criticalDelayMin, this.explosionConfig.criticalDelayMax);
    state.criticalUntil = elapsed + delay;
    state.burningUntil = 0;
  }

  _enterBurning(vehicle, elapsed, options = {}) {
    if (!vehicle || !vehicle.explosionState) return;
    const state = vehicle.explosionState;
    if (state.stage === "burning" || state.stage === "exploded" || state.stage === "wreck") return;

    this._setExplosionStage(vehicle, "burning", elapsed);
    const burnDuration = options.shortBurn
      ? Math.max(0.2, Number(options.burnSeconds) || 0.6)
      : this._randRange(this.explosionConfig.burnDurationMin, this.explosionConfig.burnDurationMax);
    state.burningUntil = elapsed + burnDuration;
    vehicle.health = 0;
  }

  _explodeVehicle(vehicle, elapsed, cause = "damage") {
    if (!vehicle || !vehicle.explosionState) return;
    const state = vehicle.explosionState;
    if (state.stage === "exploded" || state.stage === "wreck") return;

    this._setExplosionStage(vehicle, "exploded", elapsed);
    state.wreckAt = elapsed + this.explosionConfig.wreckTransitionSeconds;
    state.respawnAt =
      this.explosionConfig.respawnAfterSeconds > 0
        ? elapsed + this.explosionConfig.respawnAfterSeconds
        : 0;

    vehicle.health = 0;
    vehicle.speed = 0;
    vehicle.velocity.set(0, 0, 0);
    vehicle.destroyedUntil = state.respawnAt > 0 ? state.respawnAt - elapsed : 0;
    this.setHeadlights(vehicle, false);

    this.pendingExplosionEvents.push({
      vehicleId: vehicle.id,
      label: vehicle.label,
      position: vehicle.mesh.position.clone(),
      radius: this.explosionConfig.radius,
      maxDamage: this.explosionConfig.maxDamage,
      chainVehicleDamageMultiplier: this.explosionConfig.chainVehicleDamageMultiplier,
      playerDamageMultiplier: this.explosionConfig.playerDamageMultiplier,
      impulse: this.explosionConfig.impulse,
      cause,
    });
  }

  _updateExplosionState(vehicle, dt, elapsed) {
    if (!vehicle || !vehicle.explosionState) return;
    const state = vehicle.explosionState;

    if (state.stage === "critical" && elapsed >= state.criticalUntil) {
      this._enterBurning(vehicle, elapsed);
    }

    if (state.stage === "burning" && elapsed >= state.burningUntil) {
      this._explodeVehicle(vehicle, elapsed, "burnout");
    }

    if (state.stage === "exploded" && elapsed >= state.wreckAt) {
      this._setExplosionStage(vehicle, "wreck", elapsed);
    }

    if (
      state.stage === "wreck" &&
      state.respawnAt > 0 &&
      elapsed >= state.respawnAt
    ) {
      this._setExplosionStage(vehicle, "intact", elapsed);
      state.criticalUntil = 0;
      state.burningUntil = 0;
      state.wreckAt = 0;
      state.respawnAt = 0;
      vehicle.health = Math.max(1, Math.round(vehicle.maxHealth * 0.72));
      this.setHeadlights(vehicle, true);
      this._applyDamageVisual(vehicle);
    }

    if (state.stage === "critical") {
      vehicle.speed *= Math.max(0, 1 - dt * 1.2);
    } else if (state.stage === "burning") {
      vehicle.speed *= Math.max(0, 1 - dt * 3.5);
    }
  }

  consumeExplosionEvents() {
    if (this.pendingExplosionEvents.length === 0) return [];
    const out = this.pendingExplosionEvents.slice();
    this.pendingExplosionEvents.length = 0;
    return out;
  }

  spawnDefault() {
    const spawnList = [
      { id: "car_0", archetype: "sedan", x: 0, z: 10 },
      { id: "car_1", archetype: "scout", x: -14, z: 12 },
      { id: "car_2", archetype: "muscle", x: 16, z: 9 },
      { id: "car_3", archetype: "truck", x: 5, z: 24 },
    ];
    for (const spec of spawnList) {
      const vehicle = this._createVehicle(spec);
      this.vehicles.push(vehicle);
    }
  }

  _createVehicle({ id, archetype = "sedan", x, z }) {
    const style = VEHICLE_ARCHETYPES[archetype] || VEHICLE_ARCHETYPES.sedan;
    const root = new THREE.Group();
    const wheels = [];
    const frontWheelIndices = [0, 1];

    const bodyLength = style.bodyLength;
    const bodyWidth = style.bodyWidth;
    const bodyHeight = style.bodyHeight;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength),
      new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.62, metalness: 0.26 })
    );
    body.position.y = style.pickupBed ? 1.02 : 0.92;

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(style.cabinWidth, style.cabinHeight, style.cabinLength),
      new THREE.MeshStandardMaterial({ color: style.cabinColor, roughness: 0.36, metalness: 0.32 })
    );
    cabin.position.set(0, body.position.y + style.cabinHeight * 0.7, style.cabinOffsetZ);

    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(style.hoodWidth, style.hoodHeight, style.hoodLength),
      new THREE.MeshStandardMaterial({ color: style.hoodColor, roughness: 0.58, metalness: 0.3 })
    );
    hood.position.set(0, body.position.y + 0.15, bodyLength * style.hoodOffsetZ);

    const extraMeshes = [];
    if (style.hatchSpoiler) {
      const spoiler = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, 0.08, 0.3),
        new THREE.MeshStandardMaterial({ color: style.cabinColor, roughness: 0.5, metalness: 0.3 })
      );
      spoiler.position.set(0, cabin.position.y + style.cabinHeight * 0.55, cabin.position.z - style.cabinLength * 0.55);
      extraMeshes.push(spoiler);
    }

    if (style.rearSpoiler) {
      const spoilerStandL = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.2, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4, metalness: 0.55 })
      );
      spoilerStandL.position.set(-0.42, body.position.y + 0.42, -bodyLength * 0.47);
      const spoilerStandR = spoilerStandL.clone();
      spoilerStandR.position.x *= -1;
      const spoilerWing = new THREE.Mesh(
        new THREE.BoxGeometry(1.08, 0.06, 0.3),
        new THREE.MeshStandardMaterial({ color: style.hoodColor, roughness: 0.4, metalness: 0.35 })
      );
      spoilerWing.position.set(0, body.position.y + 0.56, -bodyLength * 0.47);
      extraMeshes.push(spoilerStandL, spoilerStandR, spoilerWing);
    }

    if (style.pickupBed) {
      const bed = new THREE.Mesh(
        new THREE.BoxGeometry(bodyWidth * 0.96, 0.56, bodyLength * 0.48),
        new THREE.MeshStandardMaterial({ color: style.hoodColor, roughness: 0.7, metalness: 0.2 })
      );
      bed.position.set(0, body.position.y + 0.05, -bodyLength * 0.24);
      const rack = new THREE.Mesh(
        new THREE.BoxGeometry(bodyWidth * 0.85, 0.08, 0.75),
        new THREE.MeshStandardMaterial({ color: 0x252729, roughness: 0.5, metalness: 0.4 })
      );
      rack.position.set(0, cabin.position.y + style.cabinHeight * 0.46, cabin.position.z - 0.18);
      extraMeshes.push(bed, rack);
    }

    const wheelGeo = new THREE.CylinderGeometry(style.wheelRadius, style.wheelRadius, style.wheelWidth, 14);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x191919, roughness: 0.9, metalness: 0.18 });
    const wheelOffsets = [
      [-style.wheelOffsetX, style.wheelRadius, style.wheelFrontZ],
      [style.wheelOffsetX, style.wheelRadius, style.wheelFrontZ],
      [-style.wheelOffsetX, style.wheelRadius, style.wheelRearZ],
      [style.wheelOffsetX, style.wheelRadius, style.wheelRearZ],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI * 0.5;
      wheel.position.set(wx, wy, wz);
      wheels.push(wheel);
      root.add(wheel);
    }

    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff3ce,
      emissive: 0xffe39d,
      emissiveIntensity: 0.8,
      roughness: 0.25,
      metalness: 0.15,
    });
    const headlightGeo = new THREE.BoxGeometry(0.18, 0.12, 0.1);
    const headlightL = new THREE.Mesh(headlightGeo, headlightMat);
    const headlightR = new THREE.Mesh(headlightGeo, headlightMat);
    headlightL.position.set(-0.62, 0.95, bodyLength * 0.5 + 0.03);
    headlightR.position.set(0.62, 0.95, bodyLength * 0.5 + 0.03);

    const headlightBeamL = new THREE.PointLight(0xffefc8, 0.55, 16, 1.7);
    const headlightBeamR = new THREE.PointLight(0xffefc8, 0.55, 16, 1.7);
    headlightBeamL.position.copy(headlightL.position).add(new THREE.Vector3(0, 0, 0.35));
    headlightBeamR.position.copy(headlightR.position).add(new THREE.Vector3(0, 0, 0.35));

    root.add(body, cabin, hood, ...extraMeshes, headlightL, headlightR, headlightBeamL, headlightBeamR);

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    const y = this.world.getHeightAtDetailed(x, z, this.world.getHeightAt(x, z)) + 0.1;
    root.position.set(x, y, z);
    this.scene.add(root);

    return {
      id,
      archetype,
      label: style.name,
      mesh: root,
      wheels,
      frontWheelIndices,
      headlightMeshes: [headlightL, headlightR],
      headlightLights: [headlightBeamL, headlightBeamR],
      headlightsOn: true,
      speed: 0,
      yaw: 0,
      maxHealth: 140,
      health: 140,
      destroyedUntil: 0,
      damageState: "intact",
      damageMaterials: [body.material, cabin.material, hood.material],
      collisionRadius: Math.max(0.95, bodyWidth * 0.55),
      steerVisual: 0,
      wasBraking: false,
      wheelRadius: style.wheelRadius,
      velocity: new THREE.Vector3(),
      driftState: {
        active: false,
        intensity: 0,
        slip: 0,
        surfaceGrip: 1,
      },
      explosionState: {
        stage: "intact",
        stageAt: 0,
        criticalUntil: 0,
        burningUntil: 0,
        wreckAt: 0,
        respawnAt: 0,
      },
      config: {
        maxForwardSpeed: style.maxForwardSpeed,
        maxReverseSpeed: style.maxReverseSpeed,
        acceleration: style.acceleration,
        reverseAcceleration: style.reverseAcceleration,
        brakeDecel: 34,
        rollFriction: 7.2,
        drag: style.drag,
        steerRate: style.steerRate,
        steerVisualRate: 10,
        maxSteerAngle: 0.48,
        highSpeedSteerReduction: 0.45,
        gripBase: 0.94,
        gripBrake: 0.84,
        driftGrip: 0.72,
        handbrakeYawImpulse: 0.09,
      },
    };
  }

  getDurability(vehicle) {
    if (!vehicle) return { health: 0, maxHealth: 0, ratio: 0, destroyed: false };
    const maxHealth = Math.max(1, Number(vehicle.maxHealth) || 1);
    const health = clamp(Number(vehicle.health) || 0, 0, maxHealth);
    const ratio = clamp(health / maxHealth, 0, 1);
    return {
      health,
      maxHealth,
      ratio,
      destroyed: ratio <= 0,
    };
  }

  _applyDamageVisual(vehicle) {
    const durability = this.getDurability(vehicle);
    const ratio = durability.ratio;
    const stage = vehicle.explosionState?.stage || "intact";
    const damageLevel =
      stage === "burning" || stage === "exploded" || stage === "wreck"
        ? 3
        : stage === "critical" || ratio <= 0.25
          ? 2
          : ratio <= 0.58
            ? 1
            : 0;
    vehicle.damageState =
      damageLevel >= 3
        ? "wreck"
        : damageLevel === 2
          ? "critical"
          : damageLevel === 1
            ? "damaged"
            : "intact";
    const emissiveIntensity =
      damageLevel >= 3 ? 0.38 : damageLevel === 2 ? 0.22 : damageLevel === 1 ? 0.08 : 0;
    const emissiveColor =
      damageLevel >= 3 ? 0x7a1b00 : damageLevel === 2 ? 0x552200 : 0x220000;

    for (const mat of vehicle.damageMaterials || []) {
      if (!mat) continue;
      mat.emissive = mat.emissive || new THREE.Color(0x000000);
      mat.emissive.setHex(emissiveColor);
      mat.emissiveIntensity = emissiveIntensity;
      mat.roughness = clamp((mat.roughness || 0.6) + damageLevel * 0.02, 0.25, 1);
    }
  }

  applyDamage(vehicle, amount = 0, time = 0, options = {}) {
    if (!vehicle) return { applied: 0, destroyed: false, health: 0, maxHealth: 0 };
    const stage = vehicle.explosionState?.stage || "intact";
    if (stage === "burning" || stage === "exploded" || stage === "wreck") {
      return {
        applied: 0,
        destroyed: true,
        health: vehicle.health,
        maxHealth: vehicle.maxHealth,
      };
    }

    const incoming = Math.max(0, Number(amount) || 0);
    if (incoming <= 0) {
      return {
        applied: 0,
        destroyed: vehicle.health <= 0,
        health: vehicle.health,
        maxHealth: vehicle.maxHealth,
      };
    }

    vehicle.health = clamp(vehicle.health - incoming, 0, vehicle.maxHealth);
    const ratio = vehicle.maxHealth > 0 ? vehicle.health / vehicle.maxHealth : 0;

    if (vehicle.health <= 0) {
      this._enterCritical(vehicle, time, {
        immediate: true,
        criticalDelaySeconds: options.fromExplosion ? 0.12 : 0.24,
      });
    } else if (ratio <= this.explosionConfig.criticalHealthRatio) {
      this._enterCritical(vehicle, time, {
        shorten: Boolean(options.fromExplosion),
        shortenToSeconds: 0.28,
      });
    }

    this._applyDamageVisual(vehicle);

    const nextStage = vehicle.explosionState?.stage || "intact";
    const destroyed = nextStage === "burning" || nextStage === "exploded" || nextStage === "wreck";
    return {
      applied: incoming,
      destroyed,
      health: vehicle.health,
      maxHealth: vehicle.maxHealth,
    };
  }

  repairVehicle(vehicle, amount = 0) {
    if (!vehicle) return { ok: false, reason: "No vehicle" };
    const stage = vehicle.explosionState?.stage || "intact";
    if (stage === "burning" || stage === "exploded" || stage === "wreck") {
      return { ok: false, reason: "Vehicle disabled" };
    }
    const repair = Math.max(0, Number(amount) || 0);
    if (repair <= 0) return { ok: false, reason: "Invalid repair amount" };
    if (vehicle.health >= vehicle.maxHealth) return { ok: false, reason: "Vehicle already full" };
    vehicle.health = clamp(vehicle.health + repair, 0, vehicle.maxHealth);
    if (vehicle.explosionState && vehicle.health / Math.max(1, vehicle.maxHealth) > this.explosionConfig.criticalHealthRatio) {
      this._setExplosionStage(vehicle, "intact", 0);
      vehicle.explosionState.criticalUntil = 0;
      vehicle.explosionState.burningUntil = 0;
      vehicle.explosionState.wreckAt = 0;
      vehicle.explosionState.respawnAt = 0;
    }
    this._applyDamageVisual(vehicle);
    return { ok: true, amount: repair, health: vehicle.health, maxHealth: vehicle.maxHealth };
  }

  getAllVehicles() {
    return this.vehicles;
  }

  getExplosionStage(vehicle) {
    if (!vehicle || !vehicle.explosionState) return "intact";
    return vehicle.explosionState.stage || "intact";
  }

  resolveInterVehicleCollisions(activeVehicleId = null) {
    for (let i = 0; i < this.vehicles.length; i++) {
      const a = this.vehicles[i];
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const b = this.vehicles[j];
        const dx = a.mesh.position.x - b.mesh.position.x;
        const dz = a.mesh.position.z - b.mesh.position.z;
        const distSq = dx * dx + dz * dz;
        const minDist = (a.collisionRadius || 1) + (b.collisionRadius || 1);
        if (distSq >= minDist * minDist) continue;

        const dist = Math.max(0.0001, Math.sqrt(distSq));
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minDist - dist;

        const aIsActive = a.id === activeVehicleId;
        const bIsActive = b.id === activeVehicleId;
        let aPush = 0.5;
        let bPush = 0.5;
        if (aIsActive && !bIsActive) {
          aPush = 0.92;
          bPush = 0.08;
        } else if (bIsActive && !aIsActive) {
          aPush = 0.08;
          bPush = 0.92;
        }

        a.mesh.position.x += nx * overlap * aPush;
        a.mesh.position.z += nz * overlap * aPush;
        b.mesh.position.x -= nx * overlap * bPush;
        b.mesh.position.z -= nz * overlap * bPush;

        const damp = 0.8;
        a.speed *= damp;
        b.speed *= damp;
      }
    }
  }

  resolvePointCollision(position, radius = 0.42, excludeVehicleId = null) {
    let collided = false;
    for (const vehicle of this.vehicles) {
      if (!vehicle || vehicle.id === excludeVehicleId) continue;
      const dx = position.x - vehicle.mesh.position.x;
      const dz = position.z - vehicle.mesh.position.z;
      const distSq = dx * dx + dz * dz;
      const minDist = radius + (vehicle.collisionRadius || 1);
      if (distSq >= minDist * minDist) continue;

      const dist = Math.max(0.0001, Math.sqrt(distSq));
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minDist - dist;
      position.x += nx * overlap;
      position.z += nz * overlap;
      collided = true;
    }
    return collided;
  }

  getById(id) {
    return this.vehicles.find((v) => v.id === id) || null;
  }

  getNearestVehicle(position, maxDistance = 3.2) {
    let best = null;
    let bestDist = Infinity;
    for (const v of this.vehicles) {
      const d = v.mesh.position.distanceTo(position);
      if (d < bestDist && d <= maxDistance) {
        best = v;
        bestDist = d;
      }
    }
    return best;
  }

  getForwardVector(vehicle, target = new THREE.Vector3()) {
    return target.set(Math.sin(vehicle.yaw), 0, Math.cos(vehicle.yaw)).normalize();
  }

  setHeadlights(vehicle, enabled) {
    if (!vehicle) return;
    const on = Boolean(enabled);
    vehicle.headlightsOn = on;
    for (const light of vehicle.headlightLights || []) {
      light.visible = on;
      light.intensity = on ? 0.55 : 0;
    }
    for (const mesh of vehicle.headlightMeshes || []) {
      if (!mesh.material) continue;
      mesh.material.emissiveIntensity = on ? 0.8 : 0.05;
    }
  }

  toggleHeadlights(vehicle) {
    if (!vehicle) return false;
    this.setHeadlights(vehicle, !vehicle.headlightsOn);
    return vehicle.headlightsOn;
  }

  update(dt, controlsByVehicleId = null, elapsed = 0) {
    for (const vehicle of this.vehicles) {
      const controls = controlsByVehicleId ? controlsByVehicleId(vehicle.id) : null;
      this._updateVehicle(vehicle, dt, controls, elapsed);
    }
  }

  _updateVehicle(vehicle, dt, controls, elapsed = 0) {
    if (vehicle.health <= 0 && (vehicle.explosionState?.stage || "intact") === "intact") {
      this._enterCritical(vehicle, elapsed, { immediate: true, criticalDelaySeconds: 0.16 });
      this._applyDamageVisual(vehicle);
    }

    this._updateExplosionState(vehicle, dt, elapsed);
    const stage = vehicle.explosionState?.stage || "intact";

    if (stage === "burning" || stage === "exploded" || stage === "wreck") {
      vehicle.speed = 0;
      vehicle.velocity.set(0, 0, 0);
      vehicle.driftState.active = false;
      vehicle.driftState.intensity = 0;
      vehicle.driftState.slip = 0;
      vehicle.driftState.surfaceGrip = 1;
      return;
    }

    const c = vehicle.config;
    const preStepSpeed = Math.abs(vehicle.speed || 0);
    const throttle = controls ? clamp(controls.throttle || 0, -1, 1) : 0;
    const steer = controls ? clamp(controls.steer || 0, -1, 1) : 0;
    const braking = Boolean(controls && controls.brake);
    const boosting = Boolean(controls && controls.boost);

    const criticalMul = stage === "critical" ? 0.62 : 1;
    const forwardSpeedCap = (boosting ? c.maxForwardSpeed * 1.75 : c.maxForwardSpeed) * criticalMul;
    const accelScale = (boosting ? 1.95 : 1) * criticalMul;

    if (throttle > 0) {
      vehicle.speed += c.acceleration * accelScale * throttle * dt;
    } else if (throttle < 0) {
      vehicle.speed += c.reverseAcceleration * throttle * dt;
    }

    if (braking) {
      if (vehicle.speed > 0) vehicle.speed = Math.max(0, vehicle.speed - c.brakeDecel * dt);
      else vehicle.speed = Math.min(0, vehicle.speed + c.brakeDecel * dt);
    } else {
      const friction = c.rollFriction * dt;
      if (vehicle.speed > 0) vehicle.speed = Math.max(0, vehicle.speed - friction);
      else vehicle.speed = Math.min(0, vehicle.speed + friction);
      vehicle.speed *= 1 - c.drag * dt;
    }

    vehicle.speed = clamp(vehicle.speed, -c.maxReverseSpeed, forwardSpeedCap);

    const speedNorm = clamp(Math.abs(vehicle.speed) / Math.max(0.001, c.maxForwardSpeed), 0, 1);
    const steerFactor = Math.min(1, Math.abs(vehicle.speed) / 2.4);
    const steeringInputFactor = Math.max(0.28, steerFactor);

    const targetSteerVisual = steer * c.maxSteerAngle * steeringInputFactor;
    vehicle.steerVisual += (targetSteerVisual - vehicle.steerVisual) * Math.min(1, c.steerVisualRate * dt);

    if (braking && !vehicle.wasBraking && Math.abs(vehicle.speed) > 4.8 && Math.abs(steer) > 0.15) {
      const directionSign = vehicle.speed >= 0 ? 1 : -1;
      vehicle.yaw += steer * c.handbrakeYawImpulse * directionSign;
    }

    if (Math.abs(vehicle.speed) > 0.15) {
      const directionSign = vehicle.speed >= 0 ? 1 : -1;
      const speedSteerScale = 1 - speedNorm * (1 - c.highSpeedSteerReduction);
      vehicle.yaw += steer * c.steerRate * steerFactor * speedSteerScale * directionSign * dt;
    }

    const forward = this.getForwardVector(vehicle);

    let grip = braking ? c.gripBrake : c.gripBase;
    const surfaceGrip = this.world.getSurfaceGripAt
      ? clamp(this.world.getSurfaceGripAt(vehicle.mesh.position.x, vehicle.mesh.position.z), 0.55, 1.05)
      : 1;
    const drifting = braking && Math.abs(steer) > 0.25 && Math.abs(vehicle.speed) > 6;
    if (drifting) grip = c.driftGrip;
    grip *= surfaceGrip;

    const velocity = forward.clone().multiplyScalar(vehicle.speed);
    vehicle.velocity.lerp(velocity, Math.min(1, grip * dt * 8));
    vehicle.mesh.position.addScaledVector(vehicle.velocity, dt);

    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    const longitudinal = Math.abs(vehicle.velocity.dot(forward));
    const lateral = Math.abs(vehicle.velocity.dot(right));
    const slip = longitudinal > 0.2 ? clamp(lateral / longitudinal, 0, 2) : 0;
    const driftIntensity = clamp(
      (drifting ? 0.45 : 0) +
        slip * 0.35 +
        Math.max(0, 1 - surfaceGrip) * 0.75 +
        Math.abs(steer) * 0.12,
      0,
      1
    );
    vehicle.driftState.active = drifting || driftIntensity > 0.24;
    vehicle.driftState.intensity = driftIntensity;
    vehicle.driftState.slip = slip;
    vehicle.driftState.surfaceGrip = surfaceGrip;
    vehicle.wasBraking = braking;

    let collisionPush = 0;
    if (this.world.resolveHorizontalCollision) {
      collisionPush = this.world.resolveHorizontalCollision(
        vehicle.mesh.position,
        0.85,
        vehicle.mesh.position.y,
        vehicle.mesh.position.y + 1.8
      ) || 0;
    }

    if (collisionPush > 0.001 && preStepSpeed > 2.5) {
      const hitDamage = collisionPush * (6 + preStepSpeed * 1.7);
      this.applyDamage(vehicle, hitDamage, elapsed, {
        fromCollision: true,
      });
    }

    const previousY = vehicle.mesh.position.y;
    const y = this.world.getHeightAtDetailed(
      vehicle.mesh.position.x,
      vehicle.mesh.position.z,
      previousY - 0.06
    );
    const targetY = y + 0.06;
    const upRate = 12;
    const downRate = 18;
    const deltaY = targetY - previousY;
    const maxRise = upRate * dt;
    const maxDrop = downRate * dt;
    vehicle.mesh.position.y =
      previousY + clamp(deltaY, -maxDrop, maxRise);

    const estimatedDrop = Math.max(0, previousY - targetY);
    if (estimatedDrop > 1.8) {
      const fallDamage = (estimatedDrop - 1.8) * (7 + preStepSpeed * 0.55);
      this.applyDamage(vehicle, fallDamage, elapsed, {
        fromFall: true,
      });
    }

    vehicle.mesh.rotation.y = vehicle.yaw;

    if (vehicle.wheels && vehicle.wheels.length > 0) {
      const wheelSpin = (vehicle.speed * dt) / Math.max(0.15, vehicle.wheelRadius || 0.34);
      for (let i = 0; i < vehicle.wheels.length; i++) {
        const wheel = vehicle.wheels[i];
        wheel.rotation.x += wheelSpin;
        if (vehicle.frontWheelIndices && vehicle.frontWheelIndices.includes(i)) {
          wheel.rotation.y = vehicle.steerVisual;
        }
      }
    }
  }

  getSaveState() {
    return this.vehicles.map((v) => ({
      id: v.id,
      archetype: v.archetype,
      x: v.mesh.position.x,
      y: v.mesh.position.y,
      z: v.mesh.position.z,
      yaw: v.yaw,
      speed: v.speed,
      health: v.health,
      maxHealth: v.maxHealth,
      destroyedUntil: v.destroyedUntil,
      explosionState: {
        stage: v.explosionState?.stage || "intact",
        stageAt: Number(v.explosionState?.stageAt) || 0,
        criticalUntil: Number(v.explosionState?.criticalUntil) || 0,
        burningUntil: Number(v.explosionState?.burningUntil) || 0,
        wreckAt: Number(v.explosionState?.wreckAt) || 0,
        respawnAt: Number(v.explosionState?.respawnAt) || 0,
      },
    }));
  }

  applySaveState(savedList = []) {
    if (!Array.isArray(savedList)) return;
    const map = new Map(savedList.map((v) => [v.id, v]));
    for (const vehicle of this.vehicles) {
      const saved = map.get(vehicle.id);
      if (!saved) continue;
      vehicle.mesh.position.set(
        Number(saved.x) || vehicle.mesh.position.x,
        Number(saved.y) || vehicle.mesh.position.y,
        Number(saved.z) || vehicle.mesh.position.z
      );
      vehicle.yaw = Number(saved.yaw) || 0;
      vehicle.speed = Number(saved.speed) || 0;
      vehicle.maxHealth = Math.max(1, Number(saved.maxHealth) || vehicle.maxHealth || 140);
      vehicle.health = clamp(Number(saved.health) || vehicle.maxHealth, 0, vehicle.maxHealth);
      vehicle.destroyedUntil = Math.max(0, Number(saved.destroyedUntil) || 0);
      vehicle.mesh.rotation.y = vehicle.yaw;
      vehicle.wasBraking = false;
      vehicle.velocity.set(0, 0, 0);
      vehicle.driftState.active = false;
      vehicle.driftState.intensity = 0;
      vehicle.driftState.slip = 0;
      vehicle.driftState.surfaceGrip = 1;

      const savedExplosion = saved.explosionState || {};
      if (!vehicle.explosionState) {
        vehicle.explosionState = {
          stage: "intact",
          stageAt: 0,
          criticalUntil: 0,
          burningUntil: 0,
          wreckAt: 0,
          respawnAt: 0,
        };
      }
      vehicle.explosionState.stage =
        typeof savedExplosion.stage === "string" ? savedExplosion.stage : "intact";
      vehicle.explosionState.stageAt = Number(savedExplosion.stageAt) || 0;
      vehicle.explosionState.criticalUntil = Number(savedExplosion.criticalUntil) || 0;
      vehicle.explosionState.burningUntil = Number(savedExplosion.burningUntil) || 0;
      vehicle.explosionState.wreckAt = Number(savedExplosion.wreckAt) || 0;
      vehicle.explosionState.respawnAt = Number(savedExplosion.respawnAt) || 0;

      if (vehicle.explosionState.stage === "burning" || vehicle.explosionState.stage === "exploded" || vehicle.explosionState.stage === "wreck") {
        this.setHeadlights(vehicle, false);
      } else {
        this.setHeadlights(vehicle, true);
      }
      this._applyDamageVisual(vehicle);
    }
  }
}
