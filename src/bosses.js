import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";

const BOSS_CONFIG = {
  sentinel: {
    label: "The Sentinel",
    maxHealth: 300,
    color: 0xdd2222,
    emissive: 0x440808,
    size: 2.5,
    speed: 3.0,
    // Phase 1
    slamCooldown: 5,
    slamRadius: 7,
    slamDamage: 18,
    barrageInterval: 0.3,
    barrageDamage: 8,
    barrageCount: 5,
    // Phase 2 (below 50% HP)
    phase2Speed: 5.0,
    chargeDamage: 25,
    chargeSpeed: 14,
    chargeWindup: 0.8,
    chargeDuration: 0.6,
    addSpawnCount: 2,
    addSpawnCooldown: 15,
    // Rewards
    rewardScore: 100,
    rewardXp: 500,
  },
};

export class BossSystem {
  constructor(scene, getHeightAt) {
    this.scene = scene;
    this.getHeightAt = getHeightAt;
    this.boss = null;
    this.bossProjectiles = [];
    this.hpBarEl = null;
    this.hpFillEl = null;
    this.hpLabelEl = null;

    this._createHpBar();
  }

  _createHpBar() {
    this.hpBarEl = document.createElement("div");
    Object.assign(this.hpBarEl.style, {
      position: "fixed",
      top: "10px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "400px",
      height: "20px",
      background: "rgba(0,0,0,0.6)",
      border: "1px solid rgba(255,80,80,0.5)",
      borderRadius: "10px",
      overflow: "hidden",
      zIndex: "14",
      display: "none",
    });

    this.hpFillEl = document.createElement("div");
    Object.assign(this.hpFillEl.style, {
      height: "100%",
      width: "100%",
      background: "linear-gradient(90deg, #cc2222, #ff4444)",
      transition: "width 150ms linear",
      borderRadius: "10px",
    });
    this.hpBarEl.appendChild(this.hpFillEl);

    this.hpLabelEl = document.createElement("div");
    Object.assign(this.hpLabelEl.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      fontSize: "12px",
      fontWeight: "bold",
      textShadow: "0 0 4px rgba(0,0,0,0.8)",
    });
    this.hpBarEl.appendChild(this.hpLabelEl);
    document.body.appendChild(this.hpBarEl);
  }

  get isActive() {
    return this.boss !== null && this.boss.alive;
  }

  spawn(playerPos) {
    if (this.boss && this.boss.alive) return; // already active

    const cfg = BOSS_CONFIG.sentinel;
    const angle = Math.random() * Math.PI * 2;
    const dist = 25 + Math.random() * 15;
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    const clampedX = Math.max(-CONFIG.world.maxWorld, Math.min(CONFIG.world.maxWorld, x));
    const clampedZ = Math.max(-CONFIG.world.maxWorld, Math.min(CONFIG.world.maxWorld, z));
    const y = this.getHeightAt(clampedX, clampedZ);

    const geo = new THREE.BoxGeometry(cfg.size, cfg.size * 1.8, cfg.size);
    const mat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      emissive: cfg.emissive,
      emissiveIntensity: 1.2,
      roughness: 0.5,
      metalness: 0.3,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(clampedX, y + cfg.size * 0.9, clampedZ);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.boss = {
      mesh,
      health: cfg.maxHealth,
      maxHealth: cfg.maxHealth,
      alive: true,
      phase: 1,
      state: "idle", // idle, slam_windup, slamming, barrage, charge_windup, charging
      stateTimer: 0,
      slamCooldownAt: 0,
      nextBarrageAt: 0,
      barrageRemaining: 0,
      chargeCooldownAt: 0,
      chargeDirection: new THREE.Vector3(),
      addSpawnCooldownAt: 0,
      hitFlashUntil: 0,
      deathTimer: 0,
    };

    this.hpBarEl.style.display = "block";
    this._updateHpBar();
  }

  _updateHpBar() {
    if (!this.boss) return;
    const pct = Math.max(0, this.boss.health / this.boss.maxHealth);
    this.hpFillEl.style.width = `${pct * 100}%`;
    const cfg = BOSS_CONFIG.sentinel;
    const phaseText = this.boss.phase === 2 ? " [ENRAGED]" : "";
    this.hpLabelEl.textContent = `${cfg.label}${phaseText} — ${Math.ceil(this.boss.health)} / ${this.boss.maxHealth}`;
  }

  applyDamage(amount, gameTime) {
    if (!this.boss || !this.boss.alive) return { hit: false };
    this.boss.health = Math.max(0, this.boss.health - amount);
    this.boss.hitFlashUntil = gameTime + 0.1;
    this._updateHpBar();

    // Phase transition
    if (this.boss.phase === 1 && this.boss.health <= this.boss.maxHealth * 0.5) {
      this.boss.phase = 2;
      this._updateHpBar();
    }

    if (this.boss.health <= 0) {
      this.boss.alive = false;
      this.boss.state = "dying";
      this.boss.deathTimer = 0.8;
      const cfg = BOSS_CONFIG.sentinel;
      return {
        hit: true,
        killed: true,
        score: cfg.rewardScore,
        xp: cfg.rewardXp,
        deathPos: this.boss.mesh.position.clone(),
        deathColor: cfg.color,
      };
    }

    return { hit: true, killed: false, hitPos: this.boss.mesh.position.clone() };
  }

  tryHitFromRay(origin, direction, maxDistance, damage, gameTime) {
    if (!this.boss || !this.boss.alive || this.boss.state === "dying") {
      return { hit: false };
    }

    const bossPos = this.boss.mesh.position;
    const cfg = BOSS_CONFIG.sentinel;
    const toBoss = bossPos.clone().sub(origin);
    const proj = toBoss.dot(direction);
    if (proj < 0 || proj > maxDistance) return { hit: false };

    const closest = origin.clone().add(direction.clone().multiplyScalar(proj));
    const dist = closest.distanceTo(bossPos);
    if (dist > cfg.size * 1.2) return { hit: false };

    return this.applyDamage(damage, gameTime);
  }

  update(dt, gameTime, playerPos) {
    const result = {
      playerDamage: 0,
      slamHit: false,
      spawnAdds: false,
      addCount: 0,
      addPosition: null,
      killed: false,
      deathPos: null,
      deathColor: null,
    };

    if (!this.boss) return result;

    // Death animation
    if (this.boss.state === "dying") {
      this.boss.deathTimer -= dt;
      const t = this.boss.deathTimer / 0.8;
      this.boss.mesh.scale.setScalar(Math.max(0.01, t));
      this.boss.mesh.material.opacity = t;

      if (this.boss.deathTimer <= 0) {
        result.killed = true;
        result.deathPos = this.boss.mesh.position.clone();
        result.deathColor = BOSS_CONFIG.sentinel.color;
        this._removeBoss();
      }
      return result;
    }

    if (!this.boss.alive) return result;

    const cfg = BOSS_CONFIG.sentinel;
    const toPlayer = playerPos.clone().sub(this.boss.mesh.position);
    const dist = toPlayer.length();
    const dir = toPlayer.clone().normalize();
    const speed = this.boss.phase === 2 ? cfg.phase2Speed : cfg.speed;

    // Hit flash visual
    const mat = this.boss.mesh.material;
    mat.emissiveIntensity = gameTime < this.boss.hitFlashUntil ? 2.5 : 1.2;

    // Phase 2 pulsing glow
    if (this.boss.phase === 2) {
      mat.emissiveIntensity += Math.sin(gameTime * 6) * 0.3;
    }

    // State machine
    switch (this.boss.state) {
      case "idle": {
        // Move toward player
        if (dist > cfg.slamRadius * 0.6) {
          const move = dir.multiplyScalar(speed * dt);
          this.boss.mesh.position.add(move);
          this.boss.mesh.position.y = this.getHeightAt(this.boss.mesh.position.x, this.boss.mesh.position.z) + cfg.size * 0.9;
          this.boss.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        }

        // Decide next attack
        if (dist < cfg.slamRadius && gameTime >= this.boss.slamCooldownAt) {
          this.boss.state = "slam_windup";
          this.boss.stateTimer = 0.6;
        } else if (dist > 8 && gameTime >= this.boss.nextBarrageAt) {
          this.boss.state = "barrage";
          this.boss.barrageRemaining = cfg.barrageCount + (this.boss.phase === 2 ? 3 : 0);
          this.boss.nextBarrageAt = gameTime + cfg.barrageInterval;
        }

        // Phase 2: charge attack
        if (this.boss.phase === 2 && dist > 10 && dist < 30 && gameTime >= this.boss.chargeCooldownAt) {
          this.boss.state = "charge_windup";
          this.boss.stateTimer = cfg.chargeWindup;
          this.boss.chargeDirection.copy(dir);
        }

        // Phase 2: spawn adds
        if (this.boss.phase === 2 && gameTime >= this.boss.addSpawnCooldownAt) {
          result.spawnAdds = true;
          result.addCount = cfg.addSpawnCount;
          result.addPosition = this.boss.mesh.position.clone();
          this.boss.addSpawnCooldownAt = gameTime + cfg.addSpawnCooldown;
        }
        break;
      }

      case "slam_windup": {
        this.boss.stateTimer -= dt;
        // Visual: grow slightly during windup
        const t = 1 + (1 - this.boss.stateTimer / 0.6) * 0.15;
        this.boss.mesh.scale.setScalar(t);
        if (this.boss.stateTimer <= 0) {
          this.boss.state = "slamming";
          this.boss.stateTimer = 0.15;
        }
        break;
      }

      case "slamming": {
        this.boss.stateTimer -= dt;
        this.boss.mesh.scale.setScalar(1);
        if (this.boss.stateTimer <= 0) {
          // Check if player in slam radius
          if (dist < cfg.slamRadius) {
            result.playerDamage = cfg.slamDamage;
            result.slamHit = true;
          }
          this.boss.slamCooldownAt = gameTime + cfg.slamCooldown;
          this.boss.state = "idle";
        }
        break;
      }

      case "barrage": {
        if (gameTime >= this.boss.nextBarrageAt && this.boss.barrageRemaining > 0) {
          this._fireProjectile(playerPos);
          this.boss.barrageRemaining--;
          this.boss.nextBarrageAt = gameTime + cfg.barrageInterval;
        }
        if (this.boss.barrageRemaining <= 0) {
          this.boss.state = "idle";
          this.boss.nextBarrageAt = gameTime + 4 + Math.random() * 3;
        }
        break;
      }

      case "charge_windup": {
        this.boss.stateTimer -= dt;
        mat.emissiveIntensity = 2.0 + Math.sin(gameTime * 15) * 0.8;
        if (this.boss.stateTimer <= 0) {
          this.boss.state = "charging";
          this.boss.stateTimer = cfg.chargeDuration;
        }
        break;
      }

      case "charging": {
        this.boss.stateTimer -= dt;
        const chargeMove = this.boss.chargeDirection.clone().multiplyScalar(cfg.chargeSpeed * dt);
        this.boss.mesh.position.add(chargeMove);
        this.boss.mesh.position.y = this.getHeightAt(this.boss.mesh.position.x, this.boss.mesh.position.z) + cfg.size * 0.9;

        if (dist < cfg.size * 1.5) {
          result.playerDamage = cfg.chargeDamage;
        }

        if (this.boss.stateTimer <= 0) {
          this.boss.chargeCooldownAt = gameTime + 8;
          this.boss.state = "idle";
        }
        break;
      }
    }

    // Update boss projectiles
    this._updateProjectiles(dt, playerPos, result);

    return result;
  }

  _fireProjectile(targetPos) {
    if (!this.boss) return;
    const cfg = BOSS_CONFIG.sentinel;
    const origin = this.boss.mesh.position.clone().add(new THREE.Vector3(0, cfg.size * 0.8, 0));
    const dir = targetPos.clone().sub(origin).normalize();
    // Add slight spread
    dir.x += (Math.random() - 0.5) * 0.15;
    dir.z += (Math.random() - 0.5) * 0.15;
    dir.normalize();

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);

    this.bossProjectiles.push({
      mesh,
      velocity: dir.multiplyScalar(22),
      life: 3.0,
      damage: cfg.barrageDamage,
    });
  }

  _updateProjectiles(dt, playerPos, result) {
    for (let i = this.bossProjectiles.length - 1; i >= 0; i--) {
      const p = this.bossProjectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt);

      const dist = p.mesh.position.distanceTo(playerPos);
      if (dist < 1.5) {
        result.playerDamage += p.damage;
        this._cleanupProjectile(p);
        this.bossProjectiles.splice(i, 1);
        continue;
      }

      if (p.life <= 0) {
        this._cleanupProjectile(p);
        this.bossProjectiles.splice(i, 1);
      }
    }
  }

  _cleanupProjectile(p) {
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    this.scene.remove(p.mesh);
  }

  _removeBoss() {
    if (this.boss && this.boss.mesh) {
      this.boss.mesh.geometry.dispose();
      this.boss.mesh.material.dispose();
      this.scene.remove(this.boss.mesh);
    }
    for (const p of this.bossProjectiles) {
      this._cleanupProjectile(p);
    }
    this.bossProjectiles = [];
    this.boss = null;
    this.hpBarEl.style.display = "none";
  }

  cleanup() {
    this._removeBoss();
  }
}
