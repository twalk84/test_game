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

  spawn(count = 12) {
    for (let i = 0; i < count; i++) {
      const type = Math.random() < 0.7 ? "bruiser" : "shooter";
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

      const enemy = {
        id: `e_${i}`,
        type,
        mesh,
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
      damage: cfg.attackDamage,
    });
  }

  _cleanupProjectile(p) {
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    this.scene.remove(p.mesh);
  }

  update(dt, elapsed, playerPos) {
    const result = {
      playerDamage: 0,
      kills: 0,
      score: 0,
      xp: 0,
      hitByProjectile: false,
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
          enemy.mesh.position.copy(enemy.spawnPos).add(new THREE.Vector3(0, 0.9, 0));
          this._setEnemyAlive(enemy, true);
        }
        continue;
      }

      const toPlayer = playerPos.clone().sub(enemy.mesh.position);
      toPlayer.y = 0;
      const dist = toPlayer.length();
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

      const hasAggro = dist < cfg.detectionRange || elapsed < enemy.aggroUntil;

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
          result.playerDamage += cfg.attackDamage;
          enemy.state = "attack";
        }
      } else {
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
