import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { CONFIG } from "./config.js";

const ABILITIES = CONFIG.abilities;

export class AbilitySystem {
  constructor() {
    this.cooldowns = {
      dash: 0,
      healPulse: 0,
      shockwave: 0,
    };
    this.healRemaining = 0;
    this.healRate = 0;
    this.dashTimeLeft = 0;
    this.dashDirection = new THREE.Vector3();
    this.invulnUntil = 0;
  }

  isInvulnerable(gameTime) {
    return gameTime < this.invulnUntil;
  }

  tryDash(gameTime, player) {
    if (gameTime < this.cooldowns.dash) return false;
    const cfg = ABILITIES.dash;
    this.cooldowns.dash = gameTime + cfg.cooldown;

    // Dash in player's facing direction
    const dir = new THREE.Vector3(
      Math.sin(player.yaw), 0, Math.cos(player.yaw)
    ).normalize();
    this.dashDirection.copy(dir);
    this.dashTimeLeft = cfg.duration;
    this.invulnUntil = gameTime + cfg.invulnDuration;

    player.addImpulse(dir.multiplyScalar(cfg.speed));
    return true;
  }

  tryHealPulse(gameTime) {
    if (gameTime < this.cooldowns.healPulse) return false;
    const cfg = ABILITIES.healPulse;
    this.cooldowns.healPulse = gameTime + cfg.cooldown;
    this.healRemaining = cfg.healTotal;
    this.healRate = cfg.healTotal / cfg.healDuration;
    return true;
  }

  tryShockwave(gameTime, playerPos, enemies) {
    if (gameTime < this.cooldowns.shockwave) return false;
    const cfg = ABILITIES.shockwave;
    this.cooldowns.shockwave = gameTime + cfg.cooldown;

    const result = { hit: 0, kills: 0, totalScore: 0, totalXp: 0, killResults: [] };

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.mesh.position.x - playerPos.x;
      const dz = enemy.mesh.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > cfg.radius) continue;

      // Apply knockback away from player
      const pushDir = new THREE.Vector3(dx, 2, dz).normalize();
      enemy.mesh.position.addScaledVector(pushDir, cfg.knockback * 0.3);

      // Apply damage via enemy system
      result.hit++;
    }

    return result;
  }

  update(dt) {
    let healApplied = 0;
    if (this.healRemaining > 0) {
      const healThisFrame = Math.min(this.healRemaining, this.healRate * dt);
      this.healRemaining -= healThisFrame;
      healApplied = healThisFrame;
    }
    if (this.dashTimeLeft > 0) {
      this.dashTimeLeft -= dt;
    }
    return { healApplied };
  }

  getCooldownInfo(gameTime) {
    return {
      dash: {
        ready: gameTime >= this.cooldowns.dash,
        remaining: Math.max(0, this.cooldowns.dash - gameTime),
        total: ABILITIES.dash.cooldown,
        label: ABILITIES.dash.label,
      },
      healPulse: {
        ready: gameTime >= this.cooldowns.healPulse,
        remaining: Math.max(0, this.cooldowns.healPulse - gameTime),
        total: ABILITIES.healPulse.cooldown,
        label: ABILITIES.healPulse.label,
      },
      shockwave: {
        ready: gameTime >= this.cooldowns.shockwave,
        remaining: Math.max(0, this.cooldowns.shockwave - gameTime),
        total: ABILITIES.shockwave.cooldown,
        label: ABILITIES.shockwave.label,
      },
    };
  }

  getSaveState() {
    return {
      dashCd: this.cooldowns.dash,
      healCd: this.cooldowns.healPulse,
      shockCd: this.cooldowns.shockwave,
    };
  }

  applySaveState(data, gameTime) {
    if (!data) return;
    this.cooldowns.dash = Math.max(0, Number(data.dashCd) || 0);
    this.cooldowns.healPulse = Math.max(0, Number(data.healCd) || 0);
    this.cooldowns.shockwave = Math.max(0, Number(data.shockCd) || 0);
  }
}
