import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";
import { clamp, numberOr } from "./utils.js";

const ENEMY_TYPES = CONFIG.enemies;

export class EnemySystem {
  constructor(scene, getHeightAt, worldSize = 220) {
    this.scene = scene;
    this.getHeightAt = getHeightAt;
    this.worldSize = worldSize;
    this.maxWorld = worldSize * 0.5 - CONFIG.world.boundaryPadding;
    this.enemies = [];
    this.enemyMeshToId = new Map();
    this.projectiles = [];
    this.raycaster = new THREE.Raycaster();
    this.difficultyMul = { health: 1, damage: 1, detection: 1 };
  }

  setDifficulty(diffKey) {
    const d = CONFIG.difficulty[diffKey] || CONFIG.difficulty.normal;
    this.difficultyMul = {
      health: d.enemyHealthMul,
      damage: d.enemyDamageMul,
      detection: d.enemyDetectionMul,
    };
    // Update existing enemies' max health
    for (const enemy of this.enemies) {
      const baseCfg = ENEMY_TYPES[enemy.type];
      enemy.maxHealth = Math.round(baseCfg.maxHealth * this.difficultyMul.health);
      if (enemy.alive) enemy.health = Math.min(enemy.health, enemy.maxHealth);
    }
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

  spawn(count = 16) {
    // Distribution: 35% bruiser, 25% shooter, 25% stalker, 15% tank
    const typeThresholds = [
      { max: 0.35, type: "bruiser" },
      { max: 0.60, type: "shooter" },
      { max: 0.85, type: "stalker" },
      { max: 1.00, type: "tank" },
    ];

    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let type = "bruiser";
      for (const t of typeThresholds) {
        if (roll < t.max) { type = t.type; break; }
      }

      const cfg = ENEMY_TYPES[type];
      const geometry = new THREE.CapsuleGeometry(cfg.size * 0.45, cfg.size * 0.75, 6, 10);
      const material = new THREE.MeshStandardMaterial({
        color: cfg.color,
        emissive: cfg.emissive,
        roughness: 0.75,
        metalness: 0.08,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const spawnPos = this._randomSpawnPosition();
      mesh.position.copy(spawnPos).add(new THREE.Vector3(0, 0.9, 0));

      const scaledHealth = Math.round(cfg.maxHealth * this.difficultyMul.health);

      const enemy = {
        id: `e_${i}`,
        type,
        mesh,
        maxHealth: scaledHealth,
        health: scaledHealth,
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
        // Stalker-specific
        dashCooldownAt: 0,
        isDashing: false,
        dashTimer: 0,
        dashDir: new THREE.Vector3(),
        // Tank-specific
        chargeState: "none", // none, windup, charging, recovery
        chargeTimer: 0,
        chargeDir: new THREE.Vector3(),
        chargeCooldownAt: 0,
      };

      this.enemies.push(enemy);
      this.enemyMeshToId.set(mesh.uuid, enemy.id);
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
      enemy.state = "dying";
      enemy.deathTimer = 0.3;
      enemy.respawnAt = time + cfg.respawnDelay;
      return {
        hit: true,
        killed: true,
        score: cfg.rewardScore,
        xp: cfg.rewardXp,
        type: enemy.type,
        deathPos: enemy.mesh.position.clone(),
        deathColor: cfg.color,
      };
    }

    return { hit: true, killed: false, score: 0, xp: 0, type: enemy.type, hitPos: enemy.mesh.position.clone() };
  }

  applyAoeDamage(center, radius, damage, time) {
    const results = [];
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.state === "dying") continue;
      const dx = enemy.mesh.position.x - center.x;
      const dz = enemy.mesh.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius) continue;
      const falloff = 1 - (dist / radius) * 0.5;
      const result = this._applyDamage(enemy, damage * falloff, time);
      if (result.hit) results.push(result);
    }
    return results;
  }

  tryHitFromRay(origin, direction, maxDistance, damage, time) {
    const aliveMeshes = this.enemies.filter((e) => e.alive && e.state !== "dying").map((e) => e.mesh);
    if (aliveMeshes.length === 0) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(aliveMeshes, false);
    if (hits.length === 0) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    const hitEnemyId = this.enemyMeshToId.get(hits[0].object.uuid);
    if (!hitEnemyId) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    const enemy = this._getEnemyById(hitEnemyId);
    if (!enemy) return { hit: false, killed: false, score: 0, xp: 0, type: null };

    return this._applyDamage(enemy, damage, time);
  }

  _updateEnemyVisual(enemy, time) {
    const mat = enemy.mesh.material;
    if (!mat || typeof mat.emissiveIntensity !== "number") return;
    mat.emissiveIntensity = time < enemy.hitFlashUntil ? 1.45 : 1;
  }

  _moveOnTerrain(enemy, move, dt) {
    enemy.mesh.position.addScaledVector(move, dt);
    enemy.mesh.position.x = clamp(enemy.mesh.position.x, -this.maxWorld, this.maxWorld);
    enemy.mesh.position.z = clamp(enemy.mesh.position.z, -this.maxWorld, this.maxWorld);
    enemy.mesh.position.y = this.getHeightAt(enemy.mesh.position.x, enemy.mesh.position.z) + 0.9;
    if (move.lengthSq() > 0.0001) {
      enemy.mesh.rotation.y = Math.atan2(move.x, move.z);
    }
  }

  _spawnProjectile(enemy, playerPos) {
    const cfg = ENEMY_TYPES.shooter;
    const origin = enemy.mesh.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    const direction = playerPos.clone().sub(origin).normalize();

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x9cc0ff })
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(cfg.projectileSpeed),
      life: 3,
      damage: cfg.attackDamage * this.difficultyMul.damage,
    });
  }

  _cleanupProjectile(p) {
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    this.scene.remove(p.mesh);
  }

  _updateStalker(enemy, cfg, dt, elapsed, toPlayer, dist, result) {
    // Stalker: circles at range, periodically dashes in for quick melee, retreats
    if (enemy.isDashing) {
      enemy.dashTimer -= dt;
      this._moveOnTerrain(enemy, enemy.dashDir.clone().multiplyScalar(cfg.dashSpeed), dt);
      if (enemy.dashTimer <= 0) {
        enemy.isDashing = false;
        enemy.dashCooldownAt = elapsed + cfg.dashCooldown;
      }
      // Melee while dashing through player
      if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
        enemy.nextAttackAt = elapsed + cfg.attackCooldown;
        result.playerDamage += cfg.attackDamage * this.difficultyMul.damage;
        enemy.state = "attack";
      }
      return;
    }

    const move = new THREE.Vector3();

    if (dist < cfg.circleRange - 1) {
      // Too close — back away
      move.add(toPlayer.clone().normalize().multiplyScalar(-cfg.speed));
    } else if (dist > cfg.circleRange + 2) {
      // Too far — approach
      move.add(toPlayer.clone().normalize().multiplyScalar(cfg.speed));
    }

    // Strafe around player
    const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x)
      .normalize()
      .multiplyScalar(cfg.speed * 0.7 * enemy.strafeSign);
    move.add(strafe);

    if (move.lengthSq() > 0.0001) {
      this._moveOnTerrain(enemy, move.normalize().multiplyScalar(cfg.speed), dt);
    }

    // Dash attack when ready and within striking distance
    if (elapsed >= enemy.dashCooldownAt && dist < cfg.circleRange + 4 && dist > cfg.attackRange) {
      enemy.isDashing = true;
      enemy.dashTimer = cfg.dashDuration;
      enemy.dashDir.copy(toPlayer).normalize();
      enemy.state = "dash";
    }
  }

  _updateTank(enemy, cfg, dt, elapsed, toPlayer, dist, result) {
    // Tank charge state machine
    if (enemy.chargeState === "windup") {
      enemy.chargeTimer -= dt;
      // Pulsing glow during windup
      enemy.mesh.material.emissiveIntensity = 1.5 + Math.sin(elapsed * 15) * 0.5;
      if (enemy.chargeTimer <= 0) {
        enemy.chargeState = "charging";
        enemy.chargeTimer = cfg.chargeDuration;
        enemy.chargeDir.copy(toPlayer).normalize();
      }
      return;
    }

    if (enemy.chargeState === "charging") {
      enemy.chargeTimer -= dt;
      this._moveOnTerrain(enemy, enemy.chargeDir.clone().multiplyScalar(cfg.chargeSpeed), dt);

      // Hit player during charge
      if (dist <= cfg.attackRange * 1.5 && elapsed >= enemy.nextAttackAt) {
        enemy.nextAttackAt = elapsed + cfg.attackCooldown;
        result.playerDamage += cfg.attackDamage * this.difficultyMul.damage;
        result.knockback = enemy.chargeDir.clone().multiplyScalar(cfg.chargeKnockback);
        result.knockback.y = 4;
        enemy.state = "attack";
      }

      if (enemy.chargeTimer <= 0) {
        enemy.chargeState = "recovery";
        enemy.chargeTimer = cfg.chargeRecovery;
        enemy.mesh.material.emissiveIntensity = 1;
      }
      return;
    }

    if (enemy.chargeState === "recovery") {
      enemy.chargeTimer -= dt;
      if (enemy.chargeTimer <= 0) {
        enemy.chargeState = "none";
        enemy.chargeCooldownAt = elapsed + cfg.chargeCooldown;
      }
      return;
    }

    // Normal tank behavior — approach slowly
    if (dist > cfg.attackRange * 0.9) {
      this._moveOnTerrain(enemy, toPlayer.normalize().multiplyScalar(cfg.speed), dt);
    }

    // Regular melee attack
    if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
      enemy.nextAttackAt = elapsed + cfg.attackCooldown;
      result.playerDamage += cfg.attackDamage * this.difficultyMul.damage;
      enemy.state = "attack";
    }

    // Start charge when ready and at medium range
    if (enemy.chargeState === "none" && elapsed >= enemy.chargeCooldownAt && dist > 5 && dist < cfg.detectionRange) {
      enemy.chargeState = "windup";
      enemy.chargeTimer = cfg.chargeWindup;
      enemy.state = "windup";
    }
  }

  update(dt, elapsed, playerPos) {
    const result = {
      playerDamage: 0,
      kills: 0,
      score: 0,
      xp: 0,
      hitByProjectile: false,
      knockback: null,
    };

    for (const enemy of this.enemies) {
      const cfg = ENEMY_TYPES[enemy.type];
      this._updateEnemyVisual(enemy, elapsed);

      // Death animation: scale down, then remove
      if (enemy.state === "dying") {
        enemy.deathTimer -= dt;
        const t = Math.max(0, enemy.deathTimer / 0.3);
        enemy.mesh.scale.setScalar(t);
        enemy.mesh.material.emissiveIntensity = 2 * (1 - t);
        if (enemy.deathTimer <= 0) {
          this._setEnemyAlive(enemy, false);
          enemy.mesh.scale.setScalar(1);
          enemy.mesh.material.emissiveIntensity = 1;
        }
        continue;
      }

      if (!enemy.alive) {
        if (enemy.respawnAt > 0 && elapsed >= enemy.respawnAt) {
          const scaledHealth = Math.round(cfg.maxHealth * this.difficultyMul.health);
          enemy.maxHealth = scaledHealth;
          enemy.health = scaledHealth;
          enemy.respawnAt = 0;
          enemy.state = "idle";
          enemy.isProvoked = false;
          enemy.aggroUntil = 0;
          enemy.chargeState = "none";
          enemy.isDashing = false;
          enemy.spawnPos = this._randomSpawnPosition();
          enemy.mesh.position.copy(enemy.spawnPos).add(new THREE.Vector3(0, 0.9, 0));
          this._setEnemyAlive(enemy, true);
        }
        continue;
      }

      const toPlayer = playerPos.clone().sub(enemy.mesh.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
      const detectionRange = cfg.detectionRange * this.difficultyMul.detection;

      if (!enemy.isProvoked) {
        enemy.state = "patrol";
        enemy.patrolTimer -= dt;
        if (enemy.patrolTimer <= 0) {
          enemy.patrolTimer = 1 + Math.random() * 3;
          enemy.patrolDir
            .set(Math.random() - 0.5, 0, Math.random() - 0.5)
            .normalize();
        }
        this._moveOnTerrain(enemy, enemy.patrolDir.clone().multiplyScalar(cfg.speed * 0.45), dt);
        continue;
      }

      const hasAggro = dist < detectionRange || elapsed < enemy.aggroUntil;

      if (!hasAggro) {
        enemy.state = "patrol";
        enemy.patrolTimer -= dt;
        if (enemy.patrolTimer <= 0) {
          enemy.patrolTimer = 1 + Math.random() * 3;
          enemy.patrolDir
            .set(Math.random() - 0.5, 0, Math.random() - 0.5)
            .normalize();
        }
        this._moveOnTerrain(enemy, enemy.patrolDir.clone().multiplyScalar(cfg.speed * 0.45), dt);
        continue;
      }

      enemy.state = "chase";
      enemy.aggroUntil = Math.max(enemy.aggroUntil, elapsed + 1.25);

      if (enemy.type === "bruiser") {
        if (dist > cfg.attackRange * 0.9) {
          this._moveOnTerrain(enemy, toPlayer.normalize().multiplyScalar(cfg.speed), dt);
        }
        if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
          enemy.nextAttackAt = elapsed + cfg.attackCooldown;
          result.playerDamage += cfg.attackDamage * this.difficultyMul.damage;
          enemy.state = "attack";
        }
      } else if (enemy.type === "shooter") {
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
        if (move.lengthSq() > 0.0001) this._moveOnTerrain(enemy, move.normalize().multiplyScalar(cfg.speed), dt);

        if (dist <= cfg.attackRange && elapsed >= enemy.nextAttackAt) {
          enemy.nextAttackAt = elapsed + cfg.attackCooldown;
          enemy.state = "attack";
          this._spawnProjectile(enemy, playerPos);
        }
      } else if (enemy.type === "stalker") {
        this._updateStalker(enemy, cfg, dt, elapsed, toPlayer, dist, result);
      } else if (enemy.type === "tank") {
        this._updateTank(enemy, cfg, dt, elapsed, toPlayer, dist, result);
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

      const yGround = this.getHeightAt(p.mesh.position.x, p.mesh.position.z);
      const hitGround = p.mesh.position.y <= yGround + 0.2;
      const hitPlayer = p.mesh.position.distanceTo(playerPos) < CONFIG.player.projectileHitRadius;

      if (hitPlayer) {
        result.playerDamage += p.damage;
        result.hitByProjectile = true;
      }

      if (p.life <= 0 || hitGround || hitPlayer) {
        this._cleanupProjectile(p);
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

      const x = clamp(numberOr(saved.x, enemy.mesh.position.x), -this.maxWorld, this.maxWorld);
      const z = clamp(numberOr(saved.z, enemy.mesh.position.z), -this.maxWorld, this.maxWorld);
      const y = numberOr(saved.y, this.getHeightAt(x, z) + 0.9);
      enemy.mesh.position.set(x, y, z);

      enemy.respawnAt = Math.max(0, numberOr(saved.respawnAt, 0));
      const alive = Boolean(saved.alive) && enemy.health > 0;
      if (!alive && enemy.respawnAt <= now) {
        enemy.respawnAt = now + ENEMY_TYPES[enemy.type].respawnDelay * 0.5;
      }
      this._setEnemyAlive(enemy, alive);
      enemy.state = alive ? "idle" : "dead";
      if (!alive) {
        enemy.isProvoked = false;
      }
    }

    for (const projectile of this.projectiles) {
      this._cleanupProjectile(projectile);
    }
    this.projectiles = [];
  }
}
