import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";

const ENEMY_TYPES = {
  bruiser: {
    color: 0xc45454,
    emissive: 0x2a1010,
    speed: 4.2,
    maxHealth: 42,
    attackRange: 2.2,
    attackDamage: 8,
    attackCooldown: 1.0,
    detectionRange: 22,
    rewardScore: 6,
    rewardXp: 22,
    respawnDelay: 20,
    size: 0.85,
  },
  shooter: {
    color: 0x4f7acb,
    emissive: 0x0f1733,
    speed: 3.8,
    maxHealth: 32,
    attackRange: 24,
    attackDamage: 7,
    attackCooldown: 1.4,
    detectionRange: 28,
    rewardScore: 8,
    rewardXp: 28,
    respawnDelay: 24,
    preferredRange: 13,
    size: 0.75,
    projectileSpeed: 18,
    projectileColor: 0x9cc0ff,
  },
  charger: {
    color: 0xd46d34,
    emissive: 0x321709,
    speed: 5.7,
    maxHealth: 36,
    attackRange: 1.9,
    attackDamage: 10,
    attackCooldown: 0.9,
    detectionRange: 24,
    rewardScore: 9,
    rewardXp: 30,
    respawnDelay: 23,
    size: 0.82,
  },
  sniper: {
    color: 0x8c64cb,
    emissive: 0x1d1130,
    speed: 3.4,
    maxHealth: 28,
    attackRange: 38,
    attackDamage: 12,
    attackCooldown: 2.2,
    detectionRange: 40,
    rewardScore: 12,
    rewardXp: 40,
    respawnDelay: 28,
    preferredRange: 20,
    size: 0.72,
    projectileSpeed: 24,
    projectileColor: 0xd0b8ff,
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class EnemySystem {
  constructor(scene, getHeightAt, worldSize = 220) {
    this.scene = scene;
    this.getHeightAt = getHeightAt;
    this.worldSize = worldSize;
    this.maxWorld = worldSize * 0.5 - 4;
    this.enemies = [];
    this.enemyMeshToId = new Map();
    this.projectiles = [];
    this.raycaster = new THREE.Raycaster();
    this.nightRush = {
      active: false,
      activeUntil: 0,
      nextTriggerAt: 0,
      initializedForNight: false,
      wasNight: false,
      dawnResetPending: false,
    };
  }

  _createHumanoidEnemyModel(cfg) {
    const root = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.emissive,
      roughness: 0.75,
      metalness: 0.05,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cfg.color).multiplyScalar(0.48),
      emissive: cfg.emissive,
      roughness: 0.85,
      metalness: 0.05,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xf0c7a1,
      emissive: cfg.emissive,
      roughness: 0.9,
      metalness: 0,
    });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 6, 10), bodyMat);
    torso.position.set(0, 1.2, 0);
    torso.castShadow = true;
    torso.receiveShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 14), skinMat);
    head.position.set(0, 1.95, 0);
    head.castShadow = true;

    const shoulderL = new THREE.Group();
    shoulderL.position.set(-0.34, 1.55, 0);
    const shoulderR = new THREE.Group();
    shoulderR.position.set(0.34, 1.55, 0);

    const armUpperGeo = new THREE.CapsuleGeometry(0.08, 0.32, 4, 8);
    const armLowerGeo = new THREE.CapsuleGeometry(0.07, 0.28, 4, 8);

    const armUpperL = new THREE.Mesh(armUpperGeo, accentMat);
    armUpperL.position.set(0, -0.2, 0);
    const armUpperR = new THREE.Mesh(armUpperGeo, accentMat);
    armUpperR.position.set(0, -0.2, 0);

    const forearmL = new THREE.Group();
    forearmL.position.set(0, -0.38, 0);
    const forearmR = new THREE.Group();
    forearmR.position.set(0, -0.38, 0);

    const armLowerL = new THREE.Mesh(armLowerGeo, skinMat);
    armLowerL.position.set(0, -0.16, 0);
    const armLowerR = new THREE.Mesh(armLowerGeo, skinMat);
    armLowerR.position.set(0, -0.16, 0);

    const hipL = new THREE.Group();
    hipL.position.set(-0.17, 0.78, 0);
    const hipR = new THREE.Group();
    hipR.position.set(0.17, 0.78, 0);

    const legUpperGeo = new THREE.CapsuleGeometry(0.1, 0.46, 4, 8);
    const legLowerGeo = new THREE.CapsuleGeometry(0.09, 0.42, 4, 8);

    const thighL = new THREE.Mesh(legUpperGeo, accentMat);
    thighL.position.set(0, -0.28, 0);
    const thighR = new THREE.Mesh(legUpperGeo, accentMat);
    thighR.position.set(0, -0.28, 0);

    const shinL = new THREE.Group();
    shinL.position.set(0, -0.56, 0);
    const shinR = new THREE.Group();
    shinR.position.set(0, -0.56, 0);

    const calfL = new THREE.Mesh(legLowerGeo, bodyMat);
    calfL.position.set(0, -0.22, 0.02);
    const calfR = new THREE.Mesh(legLowerGeo, bodyMat);
    calfR.position.set(0, -0.22, 0.02);

    shoulderL.add(armUpperL, forearmL);
    shoulderR.add(armUpperR, forearmR);
    forearmL.add(armLowerL);
    forearmR.add(armLowerR);

    hipL.add(thighL, shinL);
    hipR.add(thighR, shinR);
    shinL.add(calfL);
    shinR.add(calfR);

    root.add(torso, head, shoulderL, shoulderR, hipL, hipR);

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
    });

    return {
      root,
      materials: [bodyMat, accentMat, skinMat],
      parts: {
        torso,
        shoulderL,
        shoulderR,
        forearmL,
        forearmR,
        hipL,
        hipR,
        shinL,
        shinR,
      },
    };
  }

  _registerEnemyMeshIds(enemy) {
    enemy.mesh.traverse((obj) => {
      if (obj.isMesh) {
        this.enemyMeshToId.set(obj.uuid, enemy.id);
      }
    });
  }

  _randomSpawnPosition() {
    const x = (Math.random() - 0.5) * (this.worldSize - 24);
    const z = (Math.random() - 0.5) * (this.worldSize - 24);
    const y = this.getHeightAt(x, z);
    return new THREE.Vector3(x, y, z);
  }

  _setEnemyAlive(enemy, alive) {
    enemy.alive = alive;
    if (alive) {
      if (!this.scene.children.includes(enemy.mesh)) this.scene.add(enemy.mesh);
      enemy.mesh.visible = true;
    } else {
      this.scene.remove(enemy.mesh);
      enemy.mesh.visible = false;
    }
  }

  _pickSpawnType() {
    const roll = Math.random();
    if (roll < 0.45) return "bruiser";
    if (roll < 0.75) return "shooter";
    if (roll < 0.9) return "charger";
    return "sniper";
  }

  spawn(count = 12) {
    for (let i = 0; i < count; i++) {
      const type = this._pickSpawnType();
      const cfg = ENEMY_TYPES[type];
      const model = this._createHumanoidEnemyModel(cfg);
      const mesh = model.root;

      const spawnPos = this._randomSpawnPosition();
      mesh.position.copy(spawnPos).add(new THREE.Vector3(0, 0.05, 0));
      mesh.scale.setScalar(0.8 + cfg.size * 0.5);

      const enemy = {
        id: `e_${i}`,
        type,
        mesh,
        visualMaterials: model.materials,
        maxHealth: cfg.maxHealth,
        health: cfg.maxHealth,
        state: "idle",
        isProvoked: false,
        alive: true,
        spawnPos: spawnPos.clone(),
        nextAttackAt: 0,
        respawnAt: 0,
        aggroUntil: 0,
        patrolTimer: Math.random() * 3,
        patrolDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
        hitFlashUntil: 0,
        strafeSign: Math.random() < 0.5 ? -1 : 1,
        visualParts: model.parts,
        walkCycle: Math.random() * Math.PI * 2,
        moveBlend: 0,
        movedThisFrame: false,
      };

      this.enemies.push(enemy);
      this._registerEnemyMeshIds(enemy);
      this.scene.add(mesh);
    }
  }

  _getEnemyById(id) {
    return this.enemies.find((e) => e.id === id);
  }

  _applyDamage(enemy, amount, time) {
    if (!enemy.alive) return { hit: false, killed: false, score: 0, xp: 0, type: enemy.type };
    enemy.isProvoked = true;
    enemy.health = Math.max(0, enemy.health - amount);
    enemy.aggroUntil = Math.max(enemy.aggroUntil, time + 8);
    enemy.hitFlashUntil = time + 0.1;

    if (enemy.health <= 0) {
      const cfg = ENEMY_TYPES[enemy.type];
      enemy.state = "dead";
      enemy.respawnAt = time + cfg.respawnDelay;
      this._setEnemyAlive(enemy, false);
      return {
        hit: true,
        killed: true,
        score: cfg.rewardScore,
        xp: cfg.rewardXp,
        type: enemy.type,
      };
    }

    return { hit: true, killed: false, score: 0, xp: 0, type: enemy.type };
  }

  tryHitFromRay(origin, direction, maxDistance, damage, time) {
    const aliveMeshes = this.enemies.filter((e) => e.alive).map((e) => e.mesh);
    if (aliveMeshes.length === 0) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(aliveMeshes, true);
    if (hits.length === 0) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    const hitEnemyId = this.enemyMeshToId.get(hits[0].object.uuid);
    if (!hitEnemyId) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    const enemy = this._getEnemyById(hitEnemyId);
    if (!enemy) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    return this._applyDamage(enemy, damage, time);
  }

  _updateEnemyVisual(enemy, time) {
    const intensity = time < enemy.hitFlashUntil ? 1.45 : 1;
    for (const mat of enemy.visualMaterials || []) {
      if (mat && (mat.emissiveIntensity || mat.emissiveIntensity === 0)) {
        mat.emissiveIntensity = intensity;
      }
    }
  }

  _animateEnemyMovement(enemy, dt, movementSpeed = 0) {
    if (!enemy.visualParts) return;
    const moveTarget = movementSpeed > 0.2 ? 1 : 0;
    enemy.moveBlend += (moveTarget - enemy.moveBlend) * Math.min(1, dt * 9);
    enemy.walkCycle += dt * (2 + movementSpeed * 1.2) * (0.2 + enemy.moveBlend * 1.1);

    const swing = Math.sin(enemy.walkCycle) * 0.66 * enemy.moveBlend;
    const kneeBendL = Math.max(0, Math.sin(enemy.walkCycle + Math.PI * 0.5)) * 0.38 * enemy.moveBlend;
    const kneeBendR = Math.max(0, Math.sin(enemy.walkCycle + Math.PI * 1.5)) * 0.38 * enemy.moveBlend;

    enemy.visualParts.shoulderL.rotation.x = swing;
    enemy.visualParts.shoulderR.rotation.x = -swing;
    enemy.visualParts.forearmL.rotation.x = -Math.max(0, swing) * 0.42;
    enemy.visualParts.forearmR.rotation.x = Math.max(0, swing) * 0.42;

    enemy.visualParts.hipL.rotation.x = -swing;
    enemy.visualParts.hipR.rotation.x = swing;
    enemy.visualParts.shinL.rotation.x = kneeBendL;
    enemy.visualParts.shinR.rotation.x = kneeBendR;

    enemy.visualParts.torso.position.y = 1.2 + Math.sin(enemy.walkCycle * 2) * 0.025 * enemy.moveBlend;
  }

  _moveOnTerrain(enemy, move, dt) {
    enemy.mesh.position.addScaledVector(move, dt);
    enemy.mesh.position.x = clamp(enemy.mesh.position.x, -this.maxWorld, this.maxWorld);
    enemy.mesh.position.z = clamp(enemy.mesh.position.z, -this.maxWorld, this.maxWorld);
    enemy.mesh.position.y = this.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z) + 0.05;
    if (move.lengthSq() > 0.0001) {
      enemy.mesh.rotation.y = Math.atan2(move.x, move.z);
    }
    enemy.movedThisFrame = true;
    this._animateEnemyMovement(enemy, dt, move.length());
  }

  _updateNightRush(enemy, cfg, dist, toPlayer, dt, elapsed, result) {
    const chaseSpeed = cfg.speed * 1.2;
    if (dist > 0.7) {
      this._moveOnTerrain(enemy, toPlayer.normalize().multiplyScalar(chaseSpeed), dt);
    }

    if (enemy.type === "bruiser" || enemy.type === "charger") {
      if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
        enemy.nextAttackAt = elapsed + cfg.attackCooldown;
        result.playerDamage += cfg.attackDamage;
        enemy.state = "attack";
      }
      return;
    }

    if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
      enemy.nextAttackAt = elapsed + cfg.attackCooldown;
      enemy.state = "attack";
      this._spawnProjectile(enemy, this._playerPosRef);
    }
  }

  _updateNightRushState(elapsed, isNight) {
    if (!isNight) {
      if (this.nightRush.wasNight) {
        this.nightRush.dawnResetPending = true;
      }
      this.nightRush.active = false;
      this.nightRush.activeUntil = 0;
      this.nightRush.nextTriggerAt = 0;
      this.nightRush.initializedForNight = false;
      this.nightRush.wasNight = false;
      return false;
    }

    this.nightRush.wasNight = true;

    if (!this.nightRush.initializedForNight) {
      this.nightRush.initializedForNight = true;
      this.nightRush.active = false;
      this.nightRush.activeUntil = 0;
      this.nightRush.nextTriggerAt = elapsed + 4 + Math.random() * 8;
    }

    if (this.nightRush.active && elapsed >= this.nightRush.activeUntil) {
      this.nightRush.active = false;
      this.nightRush.nextTriggerAt = elapsed + 7 + Math.random() * 12;
    }

    if (!this.nightRush.active && elapsed >= this.nightRush.nextTriggerAt) {
      this.nightRush.active = true;
      this.nightRush.activeUntil = elapsed + 5 + Math.random() * 7;
    }

    return this.nightRush.active;
  }

  _spawnProjectile(enemy, playerPos) {
    const cfg = ENEMY_TYPES[enemy.type];
    const origin = enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const direction = playerPos.clone().sub(origin).normalize();

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshBasicMaterial({ color: cfg.projectileColor || 0x9cc0ff })
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(cfg.projectileSpeed || 18),
      life: enemy.type === "sniper" ? 3.5 : 3,
      damage: cfg.attackDamage,
    });
  }

  _updatePatrol(enemy, cfg, dt) {
    enemy.state = "patrol";
    enemy.patrolTimer -= dt;
    if (enemy.patrolTimer <= 0) {
      enemy.patrolTimer = 1 + Math.random() * 3;
      enemy.patrolDir
        .set(Math.random() - 0.5, 0, Math.random() - 0.5)
        .normalize();
    }
    this._moveOnTerrain(enemy, enemy.patrolDir.clone().multiplyScalar(cfg.speed * 0.45), dt);
  }

  _updateBruiser(enemy, cfg, dist, toPlayer, dt, elapsed, result) {
    if (dist > cfg.attackRange * 0.9) {
      this._moveOnTerrain(enemy, toPlayer.normalize().multiplyScalar(cfg.speed), dt);
    }
    if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
      enemy.nextAttackAt = elapsed + cfg.attackCooldown;
      result.playerDamage += cfg.attackDamage;
      enemy.state = "attack";
    }
  }

  _updateCharger(enemy, cfg, dist, toPlayer, dt, elapsed, result) {
    const chargeSpeed = cfg.speed * (dist > 5 ? 1.35 : 1.0);
    if (dist > cfg.attackRange * 0.9) {
      this._moveOnTerrain(enemy, toPlayer.normalize().multiplyScalar(chargeSpeed), dt);
    }
    if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
      enemy.nextAttackAt = elapsed + cfg.attackCooldown;
      result.playerDamage += cfg.attackDamage;
      enemy.state = "attack";
    }
  }

  _updateRanged(enemy, cfg, dist, toPlayer, dt, elapsed) {
    const move = new THREE.Vector3();
    const preferred = cfg.preferredRange;

    if (dist < preferred - 2) {
      move.add(toPlayer.clone().normalize().multiplyScalar(-cfg.speed));
    } else if (dist > preferred + 3) {
      move.add(toPlayer.clone().normalize().multiplyScalar(cfg.speed));
    }

    const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x)
      .normalize()
      .multiplyScalar(cfg.speed * 0.55 * enemy.strafeSign);
    move.add(strafe);

    if (move.lengthSq() > 0.0001) {
      this._moveOnTerrain(enemy, move.normalize().multiplyScalar(cfg.speed), dt);
    }

    if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
      enemy.nextAttackAt = elapsed + cfg.attackCooldown;
      enemy.state = "attack";
      this._spawnProjectile(enemy, this._playerPosRef);
    }
  }

  update(dt, elapsed, playerPos, context = {}) {
    this._playerPosRef = playerPos;
    const isNight = Boolean(context.isNight);
    const nightRushActive = this._updateNightRushState(elapsed, isNight);

    if (this.nightRush.dawnResetPending) {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        enemy.isProvoked = false;
        enemy.aggroUntil = 0;
        enemy.state = "patrol";
      }
      this.nightRush.dawnResetPending = false;
    }

    const result = {
      playerDamage: 0,
      kills: 0,
      score: 0,
      xp: 0,
      hitByProjectile: false,
      nightRushActive,
    };

    for (const enemy of this.enemies) {
      const cfg = ENEMY_TYPES[enemy.type];
      this._updateEnemyVisual(enemy, elapsed);

      if (!enemy.alive) {
        if (enemy.respawnAt > 0 && elapsed >= enemy.respawnAt) {
          enemy.health = enemy.maxHealth;
          enemy.respawnAt = 0;
          enemy.state = "idle";
          enemy.isProvoked = false;
          enemy.aggroUntil = 0;
          enemy.spawnPos = this._randomSpawnPosition();
          enemy.mesh.position.copy(enemy.spawnPos).add(new THREE.Vector3(0, 0.05, 0));
          this._setEnemyAlive(enemy, true);
        }
        continue;
      }

      enemy.movedThisFrame = false;

      const toPlayer = playerPos.clone().sub(enemy.mesh.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();

      if (nightRushActive) {
        enemy.isProvoked = true;
        enemy.aggroUntil = Math.max(enemy.aggroUntil, elapsed + 2);
        enemy.state = "chase";
        this._updateNightRush(enemy, cfg, dist, toPlayer, dt, elapsed, result);
        if (!enemy.movedThisFrame) this._animateEnemyMovement(enemy, dt, 0);
        continue;
      }

      if (!enemy.isProvoked) {
        this._updatePatrol(enemy, cfg, dt);
        if (!enemy.movedThisFrame) this._animateEnemyMovement(enemy, dt, 0);
        continue;
      }

      const hasAggro = dist < cfg.detectionRange || elapsed < enemy.aggroUntil;
      if (!hasAggro) {
        this._updatePatrol(enemy, cfg, dt);
        if (!enemy.movedThisFrame) this._animateEnemyMovement(enemy, dt, 0);
        continue;
      }

      enemy.state = "chase";
      enemy.aggroUntil = Math.max(enemy.aggroUntil, elapsed + 1.25);

      if (enemy.type === "bruiser") {
        this._updateBruiser(enemy, cfg, dist, toPlayer, dt, elapsed, result);
      } else if (enemy.type === "charger") {
        this._updateCharger(enemy, cfg, dist, toPlayer, dt, elapsed, result);
      } else {
        this._updateRanged(enemy, cfg, dist, toPlayer, dt, elapsed);
      }

      if (!enemy.movedThisFrame) this._animateEnemyMovement(enemy, dt, 0);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

      const yGround = this.getHeightAt(p.mesh.position.x, p.mesh.position.z);
      const hitGround = p.mesh.position.y <= yGround + 0.2;
      const hitPlayer = p.mesh.position.distanceTo(playerPos) < 1.2;

      if (hitPlayer) {
        result.playerDamage += p.damage;
        result.hitByProjectile = true;
      }

      if (p.life <= 0 || hitGround || hitPlayer) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    return result;
  }

  getSaveState() {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      type: enemy.type,
      alive: enemy.alive,
      x: enemy.mesh.position.x,
      y: enemy.mesh.position.y,
      z: enemy.mesh.position.z,
      health: enemy.health,
      isProvoked: enemy.isProvoked,
      nextAttackAt: enemy.nextAttackAt,
      respawnAt: enemy.respawnAt,
      aggroUntil: enemy.aggroUntil,
    }));
  }

  applySaveState(savedEnemies = [], now = 0) {
    if (!Array.isArray(savedEnemies)) return;

    for (const saved of savedEnemies) {
      if (!saved || typeof saved.id !== "string") continue;
      const enemy = this._getEnemyById(saved.id);
      if (!enemy) continue;

      enemy.health = clamp(numberOr(saved.health, enemy.maxHealth), 0, enemy.maxHealth);
      enemy.isProvoked = Boolean(saved.isProvoked);
      enemy.nextAttackAt = numberOr(saved.nextAttackAt, 0);
      enemy.aggroUntil = numberOr(saved.aggroUntil, 0);

      if (typeof saved.type === "string" && ENEMY_TYPES[saved.type]) {
        enemy.type = saved.type;
      }

      const x = clamp(numberOr(saved.x, enemy.mesh.position.x), -this.maxWorld, this.maxWorld);
      const z = clamp(numberOr(saved.z, enemy.mesh.position.z), -this.maxWorld, this.maxWorld);
      const y = numberOr(saved.y, this.getHeightAt(x, z) + 0.05);
      enemy.mesh.position.set(x, y, z);

      enemy.respawnAt = Math.max(0, numberOr(saved.respawnAt, 0));
      const alive = Boolean(saved.alive) && enemy.health > 0;
      if (!alive && enemy.respawnAt <= now) {
        enemy.respawnAt = now + ENEMY_TYPES[enemy.type].respawnDelay * 0.5;
      }
      this._setEnemyAlive(enemy, alive);
      enemy.state = alive ? "idle" : "dead";
      if (!alive) enemy.isProvoked = false;
    }

    for (const projectile of this.projectiles) {
      this.scene.remove(projectile.mesh);
    }
    this.projectiles = [];
  }
}